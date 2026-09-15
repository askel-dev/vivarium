"""
FastAPI WebSocket server entry point for Agent World.

Runs the simulation in a background thread and broadcasts tick state
to all connected WebSocket clients via a thread-safe queue.

Usage:
    python main_server.py --agents 4 --port 8080
"""

import argparse
import asyncio
import json
import os
import random
import sys
import threading
import time
from queue import Queue, Empty

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import uvicorn

from world import generate_world, load_world_from_map, Item, spawn_regrowth_food
from actions import execute_action, ACTION_HANDLERS, EventSink, sink_context, sink_emit
from perception import build_perception, read_notes_on_tile
from prompts import build_prompt, SYSTEM_PROMPT
from llm import get_agent_action
from communication import deliver_speech, clear_pending_speech, clear_agent_pending_speech
from memory import (
    maybe_compress_journal, maybe_summarize_working_memory,
    update_beliefs_from_tile, update_beliefs_from_agents,
    derive_relations, build_relation_edges,
)
from save_load import save_world, load_world
from config import (
    ENERGY_DRAIN_PER_TICK, SHELTER_DRAIN_REDUCTION, DEFAULT_TICK_SPEED,
    MAX_ENERGY, TICKS_PER_DAY_CYCLE,
)
from logger import AgentLogger
from story import generate_story, build_agent_summaries


# ---------------------------------------------------------------------------
# Shared state between simulation thread and async server
# ---------------------------------------------------------------------------

tick_queue: Queue = Queue()          # sim thread -> async broadcaster
pause_event = threading.Event()      # clear = paused, set = running
pause_event.set()                    # start unpaused
stop_event = threading.Event()       # signal simulation to shut down
speed_lock = threading.Lock()
tick_speed: float = DEFAULT_TICK_SPEED

# Gravestone roster — the world drops dead agents entirely, so the server keeps
# its own record and replays it to clients that connect later.
_dead_roster: list[dict] = []
_session_end: dict | None = None


def set_tick_speed(new_speed: float):
    global tick_speed
    with speed_lock:
        tick_speed = max(0.1, min(10.0, new_speed))


def get_tick_speed() -> float:
    with speed_lock:
        return tick_speed


def push(payload: dict):
    """Enqueue a message for broadcast to every connected client."""
    tick_queue.put(payload)


def control_state() -> dict:
    """Authoritative pause/speed state, so clients never have to guess."""
    return {
        "type": "control_state",
        "paused": not pause_event.is_set(),
        "speed": get_tick_speed(),
    }


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def serialize_grid(world) -> list:
    """Serialize the grid to a JSON-safe 2D array."""
    rows = []
    for y in range(world.height):
        row = []
        for x in range(world.width):
            tile = world.grid[y][x]
            t = {"terrain": tile.terrain}
            if tile.items:
                t["items"] = [{"type": i.type, "quantity": i.quantity} for i in tile.items]
            if tile.structure:
                t["structure"] = {"type": tile.structure.type, "builder": tile.structure.builder}
            if tile.notes:
                t["notes"] = [{"author": n.author, "content": n.content, "tick": n.tick} for n in tile.notes]
            row.append(t)
        rows.append(row)
    return rows


def serialize_agent(agent) -> dict:
    """Serialize an agent to the tick payload format from the spec."""
    archetype = agent.name  # name IS the archetype in this codebase
    return {
        "name": agent.name,
        "x": agent.x,
        "y": agent.y,
        "energy": agent.energy,
        "max_energy": MAX_ENERGY,
        "inventory": dict(agent.inventory),
        "personality_archetype": archetype,
        "private_goal": agent.private_goal,
        "last_action": None,  # filled in per-tick
        "alive": True,
        "recent_memory_preview": agent.working_memory[-3:] if agent.working_memory else [],
    }


def action_verbs(action_data: dict) -> list:
    """
    The action keys the executor will actually dispatch on.

    Not `action_data["action"]` — llm._normalize_action_response deletes that
    key whenever it was present, which is why last_action was always None.
    """
    return [k for k in action_data if k in ACTION_HANDLERS]


def build_tick_payload(world, events, structured, last_actions) -> dict:
    agents = []
    for a in world.agents:
        data = serialize_agent(a)
        data["last_action"] = last_actions.get(a.name)
        agents.append(data)
    return {
        "type": "tick",
        "tick": world.tick_count,
        "time_of_day": world.time_of_day,
        "width": world.width,
        "height": world.height,
        "grid": serialize_grid(world),
        "agents": agents,
        "events": events,
        "structured": structured,
        "relations": build_relation_edges(world),
    }


def build_init_payload(world) -> dict:
    """
    Full snapshot sent the moment a client connects.

    Without this a browser that reloads mid-tick stares at a blank canvas until
    the next tick lands, which can be a minute or more.
    """
    payload = {
        "type": "init",
        "tick": world.tick_count,
        "time_of_day": world.time_of_day,
        "width": world.width,
        "height": world.height,
        "grid": serialize_grid(world),
        "agents": [serialize_agent(a) for a in world.agents],
        "relations": build_relation_edges(world),
        "dead": list(_dead_roster),
        "ticks_per_day": TICKS_PER_DAY_CYCLE,
    }
    payload.update({k: v for k, v in control_state().items() if k != "type"})
    return payload


def build_agent_detail(agent) -> dict:
    """Full agent detail sent on demand."""
    return {
        "type": "agent_detail",
        "name": agent.name,
        "x": agent.x,
        "y": agent.y,
        "energy": agent.energy,
        "max_energy": MAX_ENERGY,
        "inventory": dict(agent.inventory),
        "personality": agent.personality,
        "private_goal": agent.private_goal,
        "working_memory": list(agent.working_memory),
        "journal": list(agent.journal),
        "beliefs": list(agent.beliefs),
        "relations": derive_relations(agent, _world_ref["world"]) if _world_ref["world"] else {},
    }


# ---------------------------------------------------------------------------
# Simulation thread
# ---------------------------------------------------------------------------

def announce_death(agent, tick: int, cause: str):
    """
    Record and broadcast a death.

    Both death paths funnel through here: starvation in the drain phase and
    combat kills inside actions._handle_death. The client used to infer deaths
    by regex-matching one English sentence, which missed every kill.
    """
    if any(d["name"] == agent.name for d in _dead_roster):
        return
    record = {
        "name": agent.name,
        "x": agent.x,
        "y": agent.y,
        "tick": tick,
        "cause": cause,
    }
    _dead_roster.append(record)
    push({"type": "agent_died", **record})


def simulation_loop(world, log: AgentLogger):
    """Run the simulation in a dedicated thread. Mirrors main.py's run()."""
    all_dead_agents: list[dict] = []

    while not stop_event.is_set():
        # Respect pause
        if not pause_event.is_set():
            time.sleep(0.1)
            continue

        # --- TICK ---
        world.tick_count += 1
        world.update_time()
        tick_events = EventSink()
        last_actions: dict[str, str] = {}

        log.log_tick_start(world.tick_count, world.time_of_day, len(world.agents))

        agents_this_tick = list(world.agents)
        random.shuffle(agents_this_tick)

        push({
            "type": "tick_start",
            "tick": world.tick_count,
            "time_of_day": world.time_of_day,
            "order": [a.name for a in agents_this_tick],
        })

        for index, agent in enumerate(agents_this_tick):
            if agent not in world.agents:
                continue

            # Read notes on current tile
            for note_event in read_notes_on_tile(agent, world):
                agent.add_to_working_memory(note_event)
                log.log_memory_update(agent.name, world.tick_count, "working_memory", note_event)

            # Build perception
            perception_text = build_perception(agent, world)
            clear_agent_pending_speech(agent)

            # Assemble prompt and call LLM
            prompt = build_prompt(agent, world, perception_text)
            log.log_prompt(agent.name, world.tick_count, prompt)

            # Announce *before* the blocking call — this is what lets the UI
            # animate through the many seconds the model takes to answer.
            push({
                "type": "agent_thinking",
                "tick": world.tick_count,
                "name": agent.name,
                "x": agent.x,
                "y": agent.y,
                "index": index,
                "total": len(agents_this_tick),
            })

            try:
                action_data = get_agent_action(SYSTEM_PROMPT, prompt)
            except SystemExit:
                raise
            except Exception as e:
                print(f"[LLM ERROR] {agent.name}: {e}")
                action_data = {"wait": {}}

            log.log_llm_response(agent.name, world.tick_count, action_data)
            verbs = action_verbs(action_data)
            last_actions[agent.name] = verbs[0] if verbs else "wait"

            # Execute action
            mark = len(tick_events.structured)
            events = execute_action(agent, action_data, world, tick_events)
            for event in events:
                agent.add_to_working_memory(event)
            log.log_action_result(agent.name, world.tick_count, action_data, events)

            # Deliver speech
            deliver_speech(agent, world, tick_events, log=log, tick=world.tick_count)

            # Update beliefs
            update_beliefs_from_tile(agent, world)
            update_beliefs_from_agents(agent, world)

            log.log_agent_state(agent, world.tick_count)

            push({
                "type": "agent_acted",
                "tick": world.tick_count,
                "name": agent.name,
                "thought": action_data.get("thought"),
                "actions": verbs,
                "action_data": {k: v for k, v in action_data.items() if k != "thought"},
                "x": agent.x,
                "y": agent.y,
                "energy": agent.energy,
                "inventory": dict(agent.inventory),
                "events": tick_events.structured[mark:],
            })

        # Track combat deaths
        known_dead = {d["name"] for d in all_dead_agents}
        for agent in agents_this_tick:
            if agent not in world.agents and agent.name not in known_dead:
                all_dead_agents.append({
                    "name": agent.name,
                    "personality": agent.personality,
                    "tick": world.tick_count,
                })
                announce_death(agent, world.tick_count, "killed")

        # Everything from here on happens after the last agent acted, so it was
        # never included in a per-agent `agent_acted` message. The tick payload
        # carries this tail so starvation deaths still reach the event log.
        tail_mark = len(tick_events.structured)

        # Passive energy drain
        dead_agents = []
        for agent in world.agents:
            drain = ENERGY_DRAIN_PER_TICK
            if agent.is_in_shelter(world):
                drain -= SHELTER_DRAIN_REDUCTION
            agent.energy -= max(1, drain)
            if agent.energy <= 0:
                sink_context(tick_events, agent, "death")
                tick_events.append(f"{agent.name} has collapsed and died!")
                sink_emit(tick_events, cause="starvation", float_text="DEAD")
                dead_agents.append(agent)

        for agent in dead_agents:
            tile = world.grid[agent.y][agent.x]
            for item_type, quantity in agent.inventory.items():
                if quantity > 0:
                    tile.items.append(Item(type=item_type, quantity=quantity))
            if agent in world.agents:
                world.agents.remove(agent)
            log.log_death(agent.name, world.tick_count)
            all_dead_agents.append({
                "name": agent.name,
                "personality": agent.personality,
                "tick": world.tick_count,
            })
            announce_death(agent, world.tick_count, "starvation")
            for survivor in world.agents:
                survivor.add_to_working_memory(f"{agent.name} has collapsed and died.")

        spawn_regrowth_food(world)

        # Enqueue tick payload for broadcast
        push(build_tick_payload(
            world, list(tick_events), tick_events.structured[tail_mark:], last_actions
        ))

        if not world.agents:
            log.log_tick_end(world.tick_count, tick_events)
            log.log_session_end(world.tick_count, "All agents perished")
            # Story generation
            summaries = build_agent_summaries(world, all_dead_agents)
            story = generate_story(log.json_path, summaries)
            if story:
                story_path = log.json_path.replace(".jsonl", "_story.txt")
                with open(story_path, "w", encoding="utf-8") as f:
                    f.write(story)
                print(f"\nStory saved to {story_path}")

            global _session_end
            _session_end = {
                "type": "session_end",
                "tick": world.tick_count,
                "reason": "All agents perished",
                "story": story,
                "cast": summaries,
            }
            push(_session_end)
            stop_event.set()
            break

        # Memory maintenance
        for agent in world.agents:
            agent.tick_journal_counter()
            maybe_compress_journal(agent, log=log, tick=world.tick_count)
            maybe_summarize_working_memory(agent, log=log, tick=world.tick_count)

        log.log_tick_end(world.tick_count, tick_events)

        time.sleep(get_tick_speed())


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Agent World")

# Store for connected clients and the world reference
clients: set[WebSocket] = set()
_world_ref: dict = {"world": None}   # mutable container so ws handler can access


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)

    # Snapshot first, so a client that connects or reloads mid-tick paints
    # immediately instead of waiting out the rest of the tick.
    world = _world_ref["world"]
    if world is not None:
        await ws.send_text(json.dumps(build_init_payload(world)))
        if _session_end is not None:
            await ws.send_text(json.dumps(_session_end))

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "pause":
                pause_event.clear()
                push(control_state())
            elif msg_type == "resume":
                pause_event.set()
                push(control_state())
            elif msg_type == "set_speed":
                speed = msg.get("speed")
                if isinstance(speed, (int, float)):
                    set_tick_speed(float(speed))
                    push(control_state())
            elif msg_type == "request_agent_detail":
                name = msg.get("name")
                world = _world_ref["world"]
                if world and name:
                    for agent in world.agents:
                        if agent.name == name:
                            await ws.send_text(json.dumps(build_agent_detail(agent)))
                            break
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


async def broadcast_loop():
    """Async task that drains tick_queue and broadcasts to all clients."""
    loop = asyncio.get_event_loop()
    while True:
        try:
            payload = await loop.run_in_executor(None, lambda: tick_queue.get(timeout=0.5))
        except Empty:
            # Keep draining after the sim stops so the final session_end (queued
            # immediately before stop_event is set) still reaches the clients.
            if stop_event.is_set():
                break
            continue

        message = json.dumps(payload)
        dead = []
        for ws in list(clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(broadcast_loop())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global tick_speed

    parser = argparse.ArgumentParser(description="Agent World — WebSocket Server")
    parser.add_argument("--agents", type=int, default=4, help="Number of agents")
    parser.add_argument("--load", type=str, default=None, help="Load from save file")
    parser.add_argument("--map", type=str, default=None, help="Load from map file")
    parser.add_argument("--speed", type=float, default=DEFAULT_TICK_SPEED, help="Seconds between ticks")
    parser.add_argument("--port", type=int, default=8080, help="HTTP/WS port")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Bind address")
    parser.add_argument("--log-dir", type=str, default="logs", help="Directory for log files")
    parser.add_argument("--ai-digest", action="store_true", help="Enable compressed log output")
    args = parser.parse_args()

    tick_speed = args.speed

    # Create world
    if args.load:
        world = load_world(args.load)
    elif args.map:
        world = load_world_from_map(args.map, args.agents)
    else:
        world = generate_world(args.agents)

    _world_ref["world"] = world
    log = AgentLogger(log_dir=args.log_dir, ai_digest=args.ai_digest)

    print(f"Starting Agent World server with {len(world.agents)} agents on port {args.port}")
    print(f"Logs: {os.path.abspath(args.log_dir)}/")

    # Mount static frontend if built
    frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
    if os.path.isdir(frontend_dist):
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
        print(f"Serving frontend from {os.path.abspath(frontend_dist)}")
    else:
        print("No frontend/dist found — only WebSocket available.")

    # Start simulation thread
    sim_thread = threading.Thread(
        target=simulation_loop,
        args=(world, log),
        daemon=True,
        name="simulation",
    )
    sim_thread.start()

    # Run uvicorn (blocks until shutdown)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
