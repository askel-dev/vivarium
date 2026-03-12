import json
from world import World, Tile, Item, Structure, Note
from agent import Agent


def save_world(world: World, path: str):
    data = {
        "tick_count": world.tick_count,
        "time_of_day": world.time_of_day,
        "width": world.width,
        "height": world.height,
        "grid": [],
        "agents": [],
    }

    for y in range(world.height):
        row = []
        for x in range(world.width):
            tile = world.grid[y][x]
            td = {
                "terrain": tile.terrain,
                "items": [{"type": i.type, "quantity": i.quantity} for i in tile.items],
                "structure": {"type": tile.structure.type, "builder": tile.structure.builder} if tile.structure else None,
                "notes": [{"author": n.author, "content": n.content, "tick": n.tick} for n in tile.notes],
            }
            row.append(td)
        data["grid"].append(row)

    for agent in world.agents:
        data["agents"].append({
            "name": agent.name,
            "personality": agent.personality,
            "x": agent.x,
            "y": agent.y,
            "energy": agent.energy,
            "inventory": agent.inventory,
            "working_memory": agent.working_memory,
            "journal": agent.journal,
            "beliefs": agent.beliefs,
            "ticks_since_journal": agent.ticks_since_journal,
        })

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"[SAVE] World saved to {path}")


def load_world(path: str) -> World:
    with open(path) as f:
        data = json.load(f)

    world = World(width=data["width"], height=data["height"])
    world.tick_count = data["tick_count"]
    world.time_of_day = data["time_of_day"]
    world.grid = []

    for row_data in data["grid"]:
        row = []
        for td in row_data:
            tile = Tile(terrain=td["terrain"])
            tile.items = [Item(type=i["type"], quantity=i["quantity"]) for i in td["items"]]
            if td["structure"]:
                tile.structure = Structure(type=td["structure"]["type"], builder=td["structure"]["builder"])
            tile.notes = [Note(author=n["author"], content=n["content"], tick=n["tick"]) for n in td["notes"]]
            row.append(tile)
        world.grid.append(row)

    for ad in data["agents"]:
        agent = Agent(
            name=ad["name"],
            personality=ad["personality"],
            x=ad["x"],
            y=ad["y"],
            energy=ad["energy"],
            inventory=ad["inventory"],
            working_memory=ad["working_memory"],
            journal=ad["journal"],
            beliefs=ad["beliefs"],
            ticks_since_journal=ad["ticks_since_journal"],
        )
        world.agents.append(agent)

    print(f"[LOAD] World loaded from {path} (tick {world.tick_count})")
    return world
