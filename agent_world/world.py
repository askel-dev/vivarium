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

    # Agent archetypes
    archetypes = [
        ("Explorer", "You are curious and adventurous, always seeking new places and food. You explore systematically, picking up food as you find it and eating when your energy drops below 50."),
        ("Builder", "You are methodical and industrious. You gather food first to survive, then collect wood and stone to build shelters. You chop trees for wood and pick up stone from the ground."),
        ("Guardian", "You are protective and watchful. You gather food and resources to sustain yourself, and occasionally warn others about dangers. You speak briefly and only when useful — survival comes first."),
        ("Gatherer", "You are practical and efficient. You move toward food, pick it up, and eat when your energy is below 50. You stockpile resources and avoid wasting turns."),
        ("Wanderer", "You are restless but practical. You roam the world picking up food and resources as you go. You leave notes for others and talk when you meet someone, but never forget to eat."),
        ("Hermit", "You prefer solitude and self-sufficiency. You gather food, chop trees for wood, and build a shelter in a quiet corner. You eat when energy is low and avoid other agents."),
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
        name, personality = archetypes[i % len(archetypes)]
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
        ("Explorer", "You are curious and adventurous, always seeking new places and food. You explore systematically, picking up food as you find it and eating when your energy drops below 50."),
        ("Builder", "You are methodical and industrious. You gather food first to survive, then collect wood and stone to build shelters. You chop trees for wood and pick up stone from the ground."),
        ("Guardian", "You are protective and watchful. You gather food and resources to sustain yourself, and occasionally warn others about dangers. You speak briefly and only when useful — survival comes first."),
        ("Gatherer", "You are practical and efficient. You move toward food, pick it up, and eat when your energy is below 50. You stockpile resources and avoid wasting turns."),
    ]
    spawns = data.get("agent_spawns", [])[:num_agents]
    for i, pos in enumerate(spawns):
        name, personality = archetypes[i % len(archetypes)]
        world.agents.append(Agent(name=name, personality=personality, x=pos["x"], y=pos["y"]))

    return world
