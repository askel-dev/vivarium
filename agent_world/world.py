import random
import json
from dataclasses import dataclass, field
from config import GRID_WIDTH, GRID_HEIGHT, INITIAL_FOOD_COUNT, FOOD_CLUSTER_CHANCE


@dataclass
class Item:
    type: str             # "food", "wood", "stone"
    quantity: int = 1


@dataclass
class Structure:
    type: str             # "wall", "campfire", "shelter", "bridge", "marker"
    builder: str          # Agent name who built it


@dataclass
class Note:
    author: str           # Agent name
    content: str          # The written message
    tick: int             # When it was written


@dataclass
class Tile:
    terrain: str = "grass"        # "grass", "water", "tree", "stone"
    items: list = field(default_factory=list)
    structure: Structure | None = None
    notes: list = field(default_factory=list)

    def is_walkable(self) -> bool:
        if self.terrain == "water":
            return self.structure is not None and self.structure.type == "bridge"
        if self.terrain == "tree":
            return False
        if self.structure is not None and self.structure.type == "wall":
            return False
        return True


@dataclass
class World:
    width: int = GRID_WIDTH
    height: int = GRID_HEIGHT
    grid: list = field(default_factory=list)
    agents: list = field(default_factory=list)
    tick_count: int = 0
    time_of_day: str = "morning"

    def get_time_of_day(self) -> str:
        from config import TICKS_PER_DAY_CYCLE
        period = (self.tick_count % TICKS_PER_DAY_CYCLE) // (TICKS_PER_DAY_CYCLE // 5)
        return ["morning", "midday", "afternoon", "evening", "night"][period]

    def update_time(self):
        self.time_of_day = self.get_time_of_day()

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def get_tile(self, x: int, y: int) -> Tile | None:
        if self.in_bounds(x, y):
            return self.grid[y][x]
        return None

    def get_agent_at(self, x: int, y: int):
        for agent in self.agents:
            if agent.x == x and agent.y == y:
                return agent
        return None


def _random_walk(grid, start_x, start_y, steps, terrain, width, height):
    x, y = start_x, start_y
    placed = []
    directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
    for _ in range(steps):
        if 0 <= x < width and 0 <= y < height:
            grid[y][x].terrain = terrain
            placed.append((x, y))
        dx, dy = random.choice(directions)
        x = max(0, min(width - 1, x + dx))
        y = max(0, min(height - 1, y + dy))
    return placed


def _generate_traits() -> str:
    """Generate randomized personality trait modifiers."""
    desperation = random.choice([
        "You panic when energy drops below 60 — survival overrides everything.",
        "You stay composed until energy drops below 35, then become reckless.",
        "You remain calm even at critically low energy. You'd rather die than compromise your values.",
    ])
    grudge = random.choice([
        "You don't hold grudges. People change.",
        "You remember who wronged you and avoid them, but don't seek revenge.",
        "You never forget a wrong. Revenge is a promise.",
    ])
    social = random.choice([
        "You seek conversation and company. Being alone makes you uneasy.",
        "You interact when it makes sense but don't seek others out.",
        "You prefer solitude. Other agents are unpredictable and dangerous.",
    ])
    honesty = random.choice([
        "You always tell the truth. Your word is your reputation.",
        "You tell the truth when convenient and lie when it serves you.",
        "You lie freely. Your notes and speech are calculated to manipulate.",
    ])
    return f"{desperation} {grudge} {social} {honesty}"


def generate_world(num_agents: int = 4) -> World:
    from agent import Agent

    world = World()
    world.grid = [[Tile() for _ in range(GRID_WIDTH)] for _ in range(GRID_HEIGHT)]

    # Place water bodies (1-2 small bodies of 3-6 tiles)
    for _ in range(random.randint(1, 2)):
        sx = random.randint(1, GRID_WIDTH - 2)
        sy = random.randint(1, GRID_HEIGHT - 2)
        _random_walk(world.grid, sx, sy, random.randint(3, 6), "water", GRID_WIDTH, GRID_HEIGHT)

    # Place trees (15-25) with slight clustering
    tree_count = random.randint(15, 25)
    placed_trees = []
    for _ in range(tree_count):
        if placed_trees and random.random() < 0.4:
            bx, by = random.choice(placed_trees)
            x = max(0, min(GRID_WIDTH - 1, bx + random.randint(-2, 2)))
            y = max(0, min(GRID_HEIGHT - 1, by + random.randint(-2, 2)))
        else:
            x, y = random.randint(0, GRID_WIDTH - 1), random.randint(0, GRID_HEIGHT - 1)
        if world.grid[y][x].terrain == "grass":
            world.grid[y][x].terrain = "tree"
            placed_trees.append((x, y))

    # Place stone items on grass tiles (5-10), with retry to hit target count
    stone_target = random.randint(5, 10)
    placed_stone = 0
    for _ in range(stone_target * 3):  # retry up to 3x to hit target
        if placed_stone >= stone_target:
            break
        x, y = random.randint(0, GRID_WIDTH - 1), random.randint(0, GRID_HEIGHT - 1)
        if world.grid[y][x].terrain == "grass":
            world.grid[y][x].items.append(Item(type="stone", quantity=1))
            placed_stone += 1

    # Place food with clustering, with retry to hit target count
    placed_food = []
    for _ in range(INITIAL_FOOD_COUNT * 3):  # retry up to 3x to hit target
        if len(placed_food) >= INITIAL_FOOD_COUNT:
            break
        if placed_food and random.random() < FOOD_CLUSTER_CHANCE:
            bx, by = random.choice(placed_food)
            x = max(0, min(GRID_WIDTH - 1, bx + random.randint(-2, 2)))
            y = max(0, min(GRID_HEIGHT - 1, by + random.randint(-2, 2)))
        else:
            x, y = random.randint(0, GRID_WIDTH - 1), random.randint(0, GRID_HEIGHT - 1)
        if world.grid[y][x].terrain == "grass":
            world.grid[y][x].items.append(Item(type="food", quantity=1))
            placed_food.append((x, y))

    # Agent archetypes — value-driven personalities, not action instructions
    archetypes = [
        ("Scavenger", "You survive by any means necessary. You take what you need — food from the ground, items from others. You avoid fights when possible because they cost energy, but desperation makes you dangerous. You lie when it benefits you."),
        ("Warden", "You claimed this land. Everything in your sight is your territory. You build walls, patrol, and challenge trespassers. You warn before attacking, and you follow through on threats. You hoard resources and remember every slight."),
        ("Wanderer", "You are restless. Staying still makes you anxious. You move constantly, leave honest notes about what you find, and talk to those you meet. You avoid conflict — you'd rather push someone aside and run than fight. Freedom matters most."),
        ("Schemer", "Information is your weapon. You watch, listen, and remember. You leave notes that mix truth and lies. You whisper secrets to stir distrust between others. You avoid direct confrontation — you'd rather others fight while you collect the scraps."),
        ("Protector", "You believe in fairness. You share information honestly and warn others about dangers. You hate thieves and liars — you confront them and warn others. You don't start violence but you finish it. You trust easily at first, but betrayal is permanent."),
        ("Predator", "Other agents are resources. You attack when you have the energy advantage. You steal from the weak. You push agents away from food. You are not mindless — you pick targets carefully, prefer isolated prey, and avoid those who fought back."),
        ("Ghost", "You do not want to be found. You move at edges, avoid others, never shout, leave no notes. If cornered, you push them away. If they persist, you attack — not from aggression but from fear. You remember every agent you've seen and avoid those locations."),
    ]
    random.shuffle(archetypes)

    # Spawn agents on grass tiles at least 3 apart
    spawn_positions = []
    attempts = 0
    while len(spawn_positions) < num_agents and attempts < 1000:
        attempts += 1
        x, y = random.randint(1, GRID_WIDTH - 2), random.randint(1, GRID_HEIGHT - 2)
        if world.grid[y][x].terrain != "grass":
            continue
        if all(abs(x - sx) + abs(y - sy) >= 3 for sx, sy in spawn_positions):
            spawn_positions.append((x, y))

    for i, (x, y) in enumerate(spawn_positions):
        name, base_personality = archetypes[i % len(archetypes)]
        traits = _generate_traits()
        personality = f"{base_personality}\n\n{traits}"
        agent = Agent(name=name, personality=personality, x=x, y=y)
        world.agents.append(agent)

    return world


def load_world_from_map(map_path: str, num_agents: int = 4) -> World:
    from agent import Agent
    with open(map_path) as f:
        data = json.load(f)

    world = World(width=data["width"], height=data["height"])
    world.grid = [[Tile() for _ in range(data["width"])] for _ in range(data["height"])]

    for y, row in enumerate(data["terrain"]):
        for x, t in enumerate(row):
            world.grid[y][x].terrain = t

    for item_data in data.get("items", []):
        world.grid[item_data["y"]][item_data["x"]].items.append(
            Item(type=item_data["type"], quantity=item_data.get("quantity", 1))
        )

    archetypes = [
        ("Scavenger", "You survive by any means necessary. You take what you need — food from the ground, items from others. You avoid fights when possible because they cost energy, but desperation makes you dangerous. You lie when it benefits you."),
        ("Warden", "You claimed this land. Everything in your sight is your territory. You build walls, patrol, and challenge trespassers. You warn before attacking, and you follow through on threats. You hoard resources and remember every slight."),
        ("Wanderer", "You are restless. Staying still makes you anxious. You move constantly, leave honest notes about what you find, and talk to those you meet. You avoid conflict — you'd rather push someone aside and run than fight. Freedom matters most."),
        ("Schemer", "Information is your weapon. You watch, listen, and remember. You leave notes that mix truth and lies. You whisper secrets to stir distrust between others. You avoid direct confrontation — you'd rather others fight while you collect the scraps."),
        ("Protector", "You believe in fairness. You share information honestly and warn others about dangers. You hate thieves and liars — you confront them and warn others. You don't start violence but you finish it. You trust easily at first, but betrayal is permanent."),
        ("Predator", "Other agents are resources. You attack when you have the energy advantage. You steal from the weak. You push agents away from food. You are not mindless — you pick targets carefully, prefer isolated prey, and avoid those who fought back."),
        ("Ghost", "You do not want to be found. You move at edges, avoid others, never shout, leave no notes. If cornered, you push them away. If they persist, you attack — not from aggression but from fear. You remember every agent you've seen and avoid those locations."),
    ]
    random.shuffle(archetypes)
    spawns = data.get("agent_spawns", [])[:num_agents]
    for i, pos in enumerate(spawns):
        name, base_personality = archetypes[i % len(archetypes)]
        traits = _generate_traits()
        personality = f"{base_personality}\n\n{traits}"
        world.agents.append(Agent(name=name, personality=personality, x=pos["x"], y=pos["y"]))

    return world
