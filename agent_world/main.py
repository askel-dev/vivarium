import argparse
import os
import random
import sys
import time
import threading

from world import generate_world, load_world_from_map
from actions import execute_action
from perception import build_perception, read_notes_on_tile
from prompts import build_prompt, SYSTEM_PROMPT
from llm import get_agent_action
from communication import deliver_speech, clear_pending_speech, clear_agent_pending_speech
from memory import maybe_compress_journal, maybe_summarize_working_memory, update_beliefs_from_tile, update_beliefs_from_agents
from save_load import save_world, load_world
from config import ENERGY_DRAIN_PER_TICK, SHELTER_DRAIN_REDUCTION, DEFAULT_TICK_SPEED
from logger import AgentLogger

try:
    import msvcrt
    def _kbhit():
        return msvcrt.kbhit()
    def _getch():
        return msvcrt.getch().decode("utf-8", errors="ignore")
except ImportError:
    import select
    import tty
    import termios
    def _kbhit():
        return select.select([sys.stdin], [], [], 0)[0] != []
    def _getch():
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            return sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)


def run(world, args, display_fn):
    event_log = []
    paused = False
    tick_speed = args.speed
    log = AgentLogger(log_dir=args.log_dir, ai_digest=args.ai_digest)

    while True:
        # Keyboard input
        if _kbhit():
            ch = _getch()
            if ch == " ":
                paused = not paused
                print("[PAUSED]" if paused else "[RESUMED]")
            elif ch == "s":
                save_world(world, "save.json")
            elif ch == "q":
                print("[QUIT]")
                log.log_session_end(world.tick_count, "User quit")
                break
            elif ch == "+":
                tick_speed = max(0.1, tick_speed - 0.2)
                print(f"[SPEED] {tick_speed:.1f}s/tick")
            elif ch == "-":
                tick_speed = min(10.0, tick_speed + 0.2)
                print(f"[SPEED] {tick_speed:.1f}s/tick")

        if paused:
            time.sleep(0.1)
            continue

        # --- TICK ---
        world.tick_count += 1
        world.update_time()
        tick_events = []

        log.log_tick_start(world.tick_count, world.time_of_day, len(world.agents))

        # Shuffle agent order
        agents_this_tick = list(world.agents)
        random.shuffle(agents_this_tick)

        for agent in agents_this_tick:
            if agent not in world.agents:
                continue  # may have died

            # Read notes on current tile
            for note_event in read_notes_on_tile(agent, world):
                agent.add_to_working_memory(note_event)
                log.log_memory_update(agent.name, world.tick_count, "working_memory", note_event)

            # Build perception (includes any pending heard speech)
            perception_text = build_perception(agent, world)
            # Clear this agent's pending speech now that it's been included in perception
            clear_agent_pending_speech(agent)

            # Assemble prompt and call LLM
            prompt = build_prompt(agent, world, perception_text)
            log.log_prompt(agent.name, world.tick_count, prompt)
            try:
                action_data = get_agent_action(SYSTEM_PROMPT, prompt)
            except SystemExit:
                raise
            except Exception as e:
                print(f"[LLM ERROR] {agent.name}: {e}")
                action_data = {"action": "wait"}

            log.log_llm_response(agent.name, world.tick_count, action_data)

            # Execute action
            events = execute_action(agent, action_data, world, tick_events)
            for event in events:
                agent.add_to_working_memory(event)
            log.log_action_result(agent.name, world.tick_count, action_data, events)

            # Deliver any speech (with logging)
            deliver_speech(agent, world, tick_events, log=log, tick=world.tick_count)

            # Update beliefs from tile and nearby agents
            update_beliefs_from_tile(agent, world)
            update_beliefs_from_agents(agent, world)

            # Log full agent state after their turn
            log.log_agent_state(agent, world.tick_count)

        # Passive energy drain
        dead_agents = []
        for agent in world.agents:
            drain = ENERGY_DRAIN_PER_TICK
            if agent.is_in_shelter(world):
                drain -= SHELTER_DRAIN_REDUCTION
            agent.energy -= max(1, drain)
            if agent.energy <= 0:
                tick_events.append(f"{agent.name} has collapsed and died!")
                dead_agents.append(agent)

        for agent in dead_agents:
            world.agents.remove(agent)
            log.log_death(agent.name, world.tick_count)
            # Broadcast death to all surviving agents
            for survivor in world.agents:
                survivor.add_to_working_memory(f"{agent.name} has collapsed and died.")

        if not world.agents:
            tick_events.append("All agents have perished. Simulation ended.")
            event_log.extend(tick_events)
            log.log_tick_end(world.tick_count, tick_events)
            log.log_session_end(world.tick_count, "All agents perished")
            display_fn(world, event_log, world.tick_count)
            break

        # Increment journal counter once per tick, then check compression
        for agent in world.agents:
            agent.tick_journal_counter()
            maybe_compress_journal(agent, log=log, tick=world.tick_count)
            maybe_summarize_working_memory(agent, log=log, tick=world.tick_count)

        # Add to global event log
        event_log.extend(tick_events)
        log.log_tick_end(world.tick_count, tick_events)

        # Display
        display_fn(world, event_log, world.tick_count)

        time.sleep(tick_speed)


def main():
    parser = argparse.ArgumentParser(description="Agent World Simulation")
    parser.add_argument("--agents", type=int, default=4, help="Number of agents")
    parser.add_argument("--load", type=str, default=None, help="Load from save file")
    parser.add_argument("--map", type=str, default=None, help="Load from map file")
    parser.add_argument("--speed", type=float, default=DEFAULT_TICK_SPEED, help="Seconds between ticks")
    parser.add_argument("--no-display", action="store_true", help="Log-only mode")
    parser.add_argument("--log-dir", type=str, default="logs", help="Directory for log files")
    parser.add_argument("--ai-digest", action="store_true", help="Enable highly compressed JSONL log output for AI ingestion")
    args = parser.parse_args()

    if args.load:
        world = load_world(args.load)
    elif args.map:
        world = load_world_from_map(args.map, args.agents)
    else:
        world = generate_world(args.agents)

    if args.no_display:
        from display import log_only as display_fn
    else:
        from display import render as display_fn

    print(f"Starting Agent World with {len(world.agents)} agents.")
    print(f"Logs will be written to: {os.path.abspath(args.log_dir)}/")
    print("Controls: [Space] pause/resume  [s] save  [q] quit  [+/-] speed")
    print()
    time.sleep(1)

    try:
        run(world, args, display_fn)
    except KeyboardInterrupt:
        print("\n[INTERRUPTED] Saving state...")
        save_world(world, "autosave.json")


if __name__ == "__main__":
    main()
