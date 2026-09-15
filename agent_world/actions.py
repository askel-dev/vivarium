from world import Item, Structure, Note
from config import STEAL_ENERGY_COST, ATTACK_ENERGY_COST, ATTACK_DAMAGE, PUSH_ENERGY_COST, VIEW_RANGE


# ---------------------------------------------------------------------------
# Structured event channel
# ---------------------------------------------------------------------------

class EventSink(list):
    """
    A list of third-person prose event strings that *also* records a structured
    object for each one.

    Handlers keep calling ``event_log.append(prose)`` exactly as before, so the
    terminal runner and the logger are unaffected.  The sink tags each string
    with whatever context ``execute_action`` set for the action in flight, which
    gives the frontend typed events without anyone regex-parsing English prose.
    """

    def __init__(self, *args):
        super().__init__(*args)
        self.structured = []
        self._agent = None
        self._type = "misc"

    def set_context(self, agent, action_type):
        self._agent = agent
        self._type = action_type

    def append(self, prose):
        super().append(prose)
        # Position is read at append time, so a `move` event carries the tile the
        # agent ended up on — which is where the camera and floaters want to go.
        evt = {
            "type": "invalid" if prose.startswith("[INVALID]") else self._type,
            "actor": self._agent.name if self._agent else None,
            "x": self._agent.x if self._agent else None,
            "y": self._agent.y if self._agent else None,
            "text": prose,
        }
        self.structured.append(evt)
        return evt

    def record(self, **fields):
        """Record a structured event that has no prose line of its own."""
        self.structured.append(fields)
        return fields

    def emit(self, **fields):
        """Enrich the most recently recorded structured event."""
        if self.structured:
            self.structured[-1].update(fields)


def sink_context(event_log, agent, action_type):
    """Set the sink's action context. No-op for a plain list."""
    if isinstance(event_log, EventSink):
        event_log.set_context(agent, action_type)


def sink_emit(event_log, **fields):
    """Enrich the last structured event. No-op for a plain list."""
    if isinstance(event_log, EventSink):
        event_log.emit(**fields)


def sink_record(event_log, **fields):
    """Record a standalone structured event. No-op for a plain list."""
    if isinstance(event_log, EventSink):
        event_log.record(**fields)


# Build costs: {material: {resource: amount}}
BUILD_COSTS = {
    "wall":     {"wood": 2},
    "campfire": {"wood": 3},
    "shelter":  {"wood": 4, "stone": 2},
    "bridge":   {"wood": 3, "stone": 1},
    "marker":   {"stone": 2},
}

DIRECTION_OFFSETS = {
    "north": (0, -1),
    "south": (0, 1),
    "east":  (1, 0),
    "west":  (-1, 0),
    "northeast": (1, -1),
    "northwest": (-1, -1),
    "southeast": (1, 1),
    "southwest": (-1, 1),
}


def _apply_direction(x, y, direction):
    dx, dy = DIRECTION_OFFSETS[direction]
    return x + dx, y + dy


def execute_action(agent, action_data: dict, world, event_log: list) -> list:
    """Validate and execute multiple actions from a single response. Returns a list of event strings."""
    events = []
    is_sink = isinstance(event_log, EventSink)

    acted = False
    for action_key, data in action_data.items():
        if action_key in ACTION_HANDLERS:
            handler = ACTION_HANDLERS[action_key]
            acted = True

            # If the value is a dict, use it. Some actions like 'eat', 'wait', 'destroy' might just have {} or no meaningful data.
            # But the LLM often provides a dict.
            data_dict = data if isinstance(data, dict) else {}

            sink_context(event_log, agent, action_key)
            before = len(event_log.structured) if is_sink else 0

            if action_key == "wait":
                event = handler(agent, event_log)
            else:
                event = handler(agent, data_dict, world, event_log)
            events.append(event)

            # Some handlers succeed without writing a third-person line (wait
            # and a few no-ops). Synthesise one so every action is visible.
            # `speak` is excluded: communication.deliver_speech emits the real
            # event moments later, and two entries would double-log it.
            if is_sink and action_key != "speak" and len(event_log.structured) == before:
                event_log.record(
                    type=action_key,
                    actor=agent.name,
                    x=agent.x,
                    y=agent.y,
                    text=f"{agent.name}: {event}",
                    quiet=True,
                )

    # Fallback if no valid actions were found
    if not acted:
        sink_context(event_log, agent, "invalid")
        event_log.append(f"[INVALID] {agent.name} provided no valid actions, defaulting to wait.")
        events.append(_wait(agent, event_log))

    return events


def _move(agent, data, world, event_log):
    direction = data.get("direction", "")
    if direction not in DIRECTION_OFFSETS:
        event_log.append(f"[INVALID] {agent.name} bad move direction '{direction}', defaulting to wait.")
        return _wait(agent, event_log)
    nx, ny = _apply_direction(agent.x, agent.y, direction)
    if not world.in_bounds(nx, ny):
        event = f"I tried to move {direction} but hit the world boundary."
        event_log.append(f"{agent.name} tried to move {direction} but hit the boundary.")
        return event
    tile = world.grid[ny][nx]
    if not tile.is_walkable():
        event = f"I tried to move {direction} but the path was blocked by {tile.terrain or 'a structure'}."
        event_log.append(f"{agent.name} tried to move {direction} but was blocked.")
        return event
    occupant = world.get_agent_at(nx, ny)
    if occupant:
        event = f"I tried to move {direction} but {occupant.name} was already there."
        event_log.append(f"{agent.name} tried to move {direction} but {occupant.name} was in the way.")
        return event
    agent.x, agent.y = nx, ny
    event = f"I moved {direction}."
    event_log.append(f"{agent.name} moved {direction} to ({nx}, {ny}).")
    sink_emit(event_log, direction=direction, quiet=True)
    return event


def _pick_up(agent, data, world, event_log):
    item_type = data.get("item", "")
    tile = world.grid[agent.y][agent.x]
    for item in tile.items:
        if item.type == item_type:
            tile.items.remove(item)
            agent.inventory[item_type] = agent.inventory.get(item_type, 0) + item.quantity
            event = f"I picked up {item.type}."
            event_log.append(f"{agent.name} picked up {item.type} at ({agent.x}, {agent.y}).")
            sink_emit(event_log, item=item.type, float_text=f"+{item.type}")
            # Update belief: food location
            if item_type == "food":
                agent.add_belief(f"There is food near ({agent.x}, {agent.y}).")
            return event
    event = f"I tried to pick up {item_type} but there was none here."
    event_log.append(f"[INVALID] {agent.name} tried to pick up {item_type} but none at ({agent.x}, {agent.y}).")
    return event


def _eat(agent, data, world, event_log):
    from config import ENERGY_FROM_FOOD, MAX_ENERGY
    if agent.inventory.get("food", 0) <= 0:
        event = "I tried to eat but had no food."
        event_log.append(f"[INVALID] {agent.name} tried to eat but has no food.")
        return event
    agent.inventory["food"] -= 1
    before = agent.energy
    agent.energy = min(agent.energy + ENERGY_FROM_FOOD, MAX_ENERGY)
    event = f"I ate food. Energy: {agent.energy}/100."
    event_log.append(f"{agent.name} ate food. Energy now {agent.energy}.")
    sink_emit(event_log, delta={"energy": agent.energy - before},
              float_text=f"+{agent.energy - before}")
    return event


def _chop(agent, data, world, event_log):
    direction = data.get("direction", "")
    if direction not in DIRECTION_OFFSETS:
        event_log.append(f"[INVALID] {agent.name} bad chop direction.")
        return _wait(agent, event_log)
    tx, ty = _apply_direction(agent.x, agent.y, direction)
    if not world.in_bounds(tx, ty):
        event = f"I tried to chop {direction} but nothing is there."
        return event
    tile = world.grid[ty][tx]
    if tile.terrain != "tree":
        event = f"I tried to chop {direction} but there's no tree there."
        event_log.append(f"[INVALID] {agent.name} tried to chop {direction} but no tree at ({tx}, {ty}).")
        return event
    tile.terrain = "grass"
    agent.inventory["wood"] = agent.inventory.get("wood", 0) + 1
    event = f"I chopped a tree to the {direction} and got 1 wood."
    event_log.append(f"{agent.name} chopped a tree at ({tx}, {ty}). Got 1 wood.")
    sink_emit(event_log, tx=tx, ty=ty, float_text="+wood")
    return event


def _build(agent, data, world, event_log):
    material = data.get("material", "")
    if material not in BUILD_COSTS:
        event_log.append(f"[INVALID] {agent.name} tried to build unknown structure '{material}'.")
        return _wait(agent, event_log)
    tile = world.grid[agent.y][agent.x]
    if tile.terrain != "grass":
        event = f"I tried to build a {material} but the tile is not grass."
        event_log.append(f"[INVALID] {agent.name} can't build on {tile.terrain}.")
        return event
    if tile.structure is not None:
        event = f"I tried to build a {material} but there's already a {tile.structure.type} here."
        event_log.append(f"[INVALID] {agent.name} can't build, structure exists.")
        return event
    costs = BUILD_COSTS[material]
    for resource, amount in costs.items():
        if agent.inventory.get(resource, 0) < amount:
            event = f"I tried to build a {material} but need {amount} {resource}."
            event_log.append(f"[INVALID] {agent.name} lacks resources for {material}.")
            return event
    for resource, amount in costs.items():
        agent.inventory[resource] -= amount
    tile.structure = Structure(type=material, builder=agent.name)
    agent.add_belief(f"I built a {material} at ({agent.x}, {agent.y}).")
    event = f"I built a {material} at ({agent.x}, {agent.y})."
    event_log.append(f"{agent.name} built a {material} at ({agent.x}, {agent.y}).")
    sink_emit(event_log, material=material)
    return event


def _destroy(agent, data, world, event_log):
    tile = world.grid[agent.y][agent.x]
    if tile.structure is None:
        event = "I tried to destroy a structure but there's nothing here."
        event_log.append(f"[INVALID] {agent.name} tried to destroy but no structure at ({agent.x}, {agent.y}).")
        return event
    old = tile.structure.type
    tile.structure = None
    event = f"I destroyed the {old} at ({agent.x}, {agent.y})."
    event_log.append(f"{agent.name} destroyed a {old} at ({agent.x}, {agent.y}).")
    sink_emit(event_log, material=old)
    return event


def _write(agent, data, world, event_log):
    message = data.get("message", "").strip()[:100]
    if not message:
        event_log.append(f"[INVALID] {agent.name} tried to write an empty note.")
        return _wait(agent, event_log)
    tile = world.grid[agent.y][agent.x]
    tile.notes.append(Note(author=agent.name, content=message, tick=world.tick_count))
    event = f"I wrote a note: '{message}'."
    event_log.append(f"{agent.name} wrote a note at ({agent.x}, {agent.y}).")
    sink_emit(event_log, message=message)
    return event


def _speak(agent, data, world, event_log):
    message = data.get("message", "").strip()
    volume = data.get("volume", "talk")
    if volume not in ("whisper", "talk", "shout"):
        volume = "talk"
    if not message:
        event_log.append(f"[INVALID] {agent.name} tried to speak empty message.")
        return _wait(agent, event_log)
    # Speech delivery happens in communication.py
    event = f"I {volume}ed: '{message}'."
    # Store speech on agent for communication module to deliver
    agent._pending_speech_out = (message, volume)
    return event


def _wait(agent, event_log):
    from config import ENERGY_FROM_WAIT, MAX_ENERGY
    agent.energy = min(agent.energy + ENERGY_FROM_WAIT, MAX_ENERGY)
    event = "I waited and rested."
    return event


# --- Hostile action helpers ---

def _find_adjacent_agent(agent, target_name, world):
    """Find a named agent adjacent (Manhattan distance 1) to the actor."""
    for other in world.agents:
        if other.name == target_name and other is not agent:
            dist = abs(other.x - agent.x) + abs(other.y - agent.y)
            if dist <= 1:
                return other
    return None


def _notify_witnesses(actor, victim, action_verb, world):
    """Notify nearby agents who can see a hostile action."""
    for witness in world.agents:
        if witness is actor or witness is victim:
            continue
        dist = abs(witness.x - actor.x) + abs(witness.y - actor.y)
        if dist <= VIEW_RANGE:
            witness.add_to_working_memory(f"I saw {actor.name} {action_verb} {victim.name}!")
            witness.add_belief(f"{actor.name} is aggressive.")


def _handle_death(victim, killer, world, event_log, cause="attack"):
    """Handle agent death from hostile action. Drops inventory on tile."""
    # Drop inventory on victim's tile
    tile = world.grid[victim.y][victim.x]
    for item_type, quantity in victim.inventory.items():
        if quantity > 0:
            tile.items.append(Item(type=item_type, quantity=quantity))

    # Killer memory
    if cause == "drowning":
        killer.add_to_working_memory(f"I pushed {victim.name} into the water. They drowned.")
        killer.add_belief(f"I killed {victim.name} by drowning.")
    else:
        killer.add_to_working_memory(f"I killed {victim.name}.")
        killer.add_belief(f"I killed {victim.name}.")

    # Witness kill beliefs
    for witness in world.agents:
        if witness is killer or witness is victim:
            continue
        dist = abs(witness.x - killer.x) + abs(witness.y - killer.y)
        if dist <= VIEW_RANGE:
            witness.add_to_working_memory(f"I saw {killer.name} kill {victim.name}!")
            witness.add_belief(f"{killer.name} killed {victim.name}.")

    # Remove from world
    vx, vy = victim.x, victim.y
    victim.energy = 0
    if victim in world.agents:
        world.agents.remove(victim)

    event_log.append(f"{victim.name} has been killed by {killer.name}!")
    # Override the attacker's action context — this is a death, and it belongs
    # to the victim's tile so the gravestone and skull burst land correctly.
    sink_emit(
        event_log,
        type="death",
        actor=victim.name,
        killer=killer.name,
        cause=cause,
        x=vx,
        y=vy,
        float_text="DEAD",
    )


# --- Hostile actions ---

def _steal(agent, data, world, event_log):
    target_name = data.get("target", "")
    item_type = data.get("item", "")

    if item_type not in ("food", "wood", "stone"):
        event_log.append(f"[INVALID] {agent.name} tried to steal unknown item '{item_type}'.")
        return _wait(agent, event_log)

    target = _find_adjacent_agent(agent, target_name, world)
    if target is None:
        event = f"I tried to steal from {target_name} but they are not adjacent."
        event_log.append(f"[INVALID] {agent.name} tried to steal from {target_name} — not adjacent.")
        return event

    if target.inventory.get(item_type, 0) <= 0:
        event = f"I tried to steal {item_type} from {target_name} but they don't have any."
        event_log.append(f"[INVALID] {agent.name} tried to steal {item_type} from {target_name} — none in inventory.")
        return event

    # Execute
    agent.energy -= STEAL_ENERGY_COST
    target.inventory[item_type] -= 1
    agent.inventory[item_type] = agent.inventory.get(item_type, 0) + 1

    # Memory events
    target.add_to_working_memory(f"{agent.name} stole {item_type} from me!")
    target.add_belief(f"{agent.name} stole from me. They are a thief.")

    # Witness system
    _notify_witnesses(agent, target, "steal from", world)

    event = f"I stole {item_type} from {target_name}."
    event_log.append(f"{agent.name} stole {item_type} from {target_name}.")
    sink_emit(event_log, target=target_name, tx=target.x, ty=target.y,
              item=item_type, float_text=f"-{item_type}")
    return event


def _attack(agent, data, world, event_log):
    target_name = data.get("target", "")

    target = _find_adjacent_agent(agent, target_name, world)
    if target is None:
        event = f"I tried to attack {target_name} but they are not adjacent."
        event_log.append(f"[INVALID] {agent.name} tried to attack {target_name} — not adjacent.")
        return event

    # Execute
    agent.energy -= ATTACK_ENERGY_COST
    target.energy -= ATTACK_DAMAGE

    # Memory events
    target.add_to_working_memory(f"{agent.name} attacked me! I lost energy.")
    target.add_belief(f"{agent.name} attacked me. They are dangerous.")

    # Witness system
    _notify_witnesses(agent, target, "attack", world)

    # Check for kill
    if target.energy <= 0:
        _handle_death(target, agent, world, event_log)
        event = f"I attacked {target_name} and killed them."
        return event

    event = f"I attacked {target_name}. They look weakened."
    event_log.append(f"{agent.name} attacked {target_name}. {target_name} lost {ATTACK_DAMAGE} energy.")
    sink_emit(event_log, target=target_name, tx=target.x, ty=target.y,
              delta={"energy": -ATTACK_DAMAGE}, float_text=f"-{ATTACK_DAMAGE}")
    return event


def _push(agent, data, world, event_log):
    target_name = data.get("target", "")
    direction = data.get("direction", "")

    if direction not in DIRECTION_OFFSETS:
        event_log.append(f"[INVALID] {agent.name} bad push direction '{direction}'.")
        return _wait(agent, event_log)

    target = _find_adjacent_agent(agent, target_name, world)
    if target is None:
        event = f"I tried to push {target_name} but they are not adjacent."
        event_log.append(f"[INVALID] {agent.name} tried to push {target_name} — not adjacent.")
        return event

    nx, ny = _apply_direction(target.x, target.y, direction)
    if not world.in_bounds(nx, ny):
        event = f"I tried to push {target_name} {direction} but it's out of bounds."
        event_log.append(f"[INVALID] {agent.name} tried to push {target_name} out of bounds.")
        return event

    # Execute — costs energy regardless of outcome
    agent.energy -= PUSH_ENERGY_COST
    dest_tile = world.grid[ny][nx]

    # Check for drowning (water tile without bridge)
    if dest_tile.terrain == "water" and (dest_tile.structure is None or dest_tile.structure.type != "bridge"):
        target.add_to_working_memory(f"{agent.name} pushed me into the water!")
        _handle_death(target, agent, world, event_log, cause="drowning")
        _notify_witnesses(agent, target, "push into the water", world)
        event = f"I pushed {target_name} into the water. They drowned."
        return event

    # Check if destination is walkable
    if not dest_tile.is_walkable():
        event = f"I tried to push {target_name} {direction} but the path is blocked."
        event_log.append(f"[INVALID] {agent.name} tried to push {target_name} into blocked tile.")
        return event

    # Check for agent collision
    occupant = world.get_agent_at(nx, ny)
    if occupant:
        event = f"I tried to push {target_name} {direction} but {occupant.name} is in the way."
        event_log.append(f"[INVALID] {agent.name} tried to push {target_name} into {occupant.name}.")
        return event

    # Normal push
    target.x, target.y = nx, ny
    target.add_to_working_memory(f"{agent.name} pushed me {direction}!")
    _notify_witnesses(agent, target, "push", world)

    event = f"I pushed {target_name} {direction}."
    event_log.append(f"{agent.name} pushed {target_name} {direction}.")
    sink_emit(event_log, target=target_name, tx=nx, ty=ny, direction=direction)
    return event


# Dispatch table — also imported by main_server.py so the server and the
# executor agree on exactly which response keys count as actions.
ACTION_HANDLERS = {
    "move": _move,
    "pick_up": _pick_up,
    "eat": _eat,
    "chop": _chop,
    "build": _build,
    "destroy": _destroy,
    "write": _write,
    "speak": _speak,
    "wait": _wait,
    "steal": _steal,
    "attack": _attack,
    "push": _push,
}
