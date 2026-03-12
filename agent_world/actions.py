from world import Item, Structure, Note

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
    
    # Check each known action type
    action_handlers = {
        "move": _move,
        "pick_up": _pick_up,
        "eat": _eat,
        "chop": _chop,
        "build": _build,
        "destroy": _destroy,
        "write": _write,
        "speak": _speak,
        "wait": _wait,
    }
    
    acted = False
    for action_key, data in action_data.items():
        if action_key in action_handlers:
            handler = action_handlers[action_key]
            acted = True
            
            # If the value is a dict, use it. Some actions like 'eat', 'wait', 'destroy' might just have {} or no meaningful data.
            # But the LLM often provides a dict.
            data_dict = data if isinstance(data, dict) else {}
            
            if action_key == "wait":
                event = handler(agent, event_log)
            else:
                event = handler(agent, data_dict, world, event_log)
            events.append(event)
            
    # Fallback if no valid actions were found
    if not acted:
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
    agent.x, agent.y = nx, ny
    event = f"I moved {direction}."
    event_log.append(f"{agent.name} moved {direction} to ({nx}, {ny}).")
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
    agent.energy = min(agent.energy + ENERGY_FROM_FOOD, MAX_ENERGY)
    event = f"I ate food. Energy: {agent.energy}/100."
    event_log.append(f"{agent.name} ate food. Energy now {agent.energy}.")
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
    return event


def _speak(agent, data, world, event_log):
    message = data.get("message", "").strip()[:100]
    volume = data.get("volume", "talk")
    if volume not in ("whisper", "talk", "shout"):
        volume = "talk"
    if not message:
        event_log.append(f"[INVALID] {agent.name} tried to speak empty message.")
        return _wait(agent, event_log)
    # Speech delivery happens in communication.py; here we just log
    event = f"I {volume}ed: '{message}'."
    event_log.append(f"{agent.name} {volume}s: '{message}'.")
    # Store speech on agent for communication module to deliver
    agent._pending_speech_out = (message, volume)
    return event


def _wait(agent, event_log):
    from config import ENERGY_FROM_WAIT, MAX_ENERGY
    agent.energy = min(agent.energy + ENERGY_FROM_WAIT, MAX_ENERGY)
    event = "I waited and rested."
    return event
