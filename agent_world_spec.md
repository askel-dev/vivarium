# Agent World — Technical Specification (v1)

This is the buildable spec. Everything here should be implementable with no ambiguity.

---

## Tech stack

- **Language**: Python 3.11+
- **LLM serving**: Ollama (simplest local setup, supports structured JSON output)
- **Model**: Llama 3 8B Instruct, Q4_K_M quantization (or Mistral 7B Instruct as fallback)
- **Output format**: JSON mode via Ollama's `format: "json"` parameter
- **Terminal UI**: `rich` library for grid display and colored event log
- **Data persistence**: JSON files for save/load (no database needed at this scale)
- **No external dependencies beyond**: `requests` (Ollama HTTP API), `rich` (terminal UI), standard library

---

## Project structure

```
agent_world/
├── main.py              # Entry point, tick loop, CLI args
├── world.py             # Grid, terrain, world state, object placement
├── agent.py             # Agent state, inventory, energy, memory
├── actions.py           # Action definitions, validation, execution
├── perception.py        # Builds natural-language perception for each agent
├── prompts.py           # Prompt assembly, system prompt, templates
├── llm.py               # Ollama client, inference calls, JSON parsing
├── memory.py            # Working memory, journal compression, beliefs
├── communication.py     # Speech range checks, message delivery
├── display.py           # Terminal grid rendering, event log display
├── config.py            # Constants, tuning parameters
├── save_load.py         # Serialize/deserialize world state to JSON
└── maps/
    └── default.json     # Default 15x15 map layout
```

---

## Data models

### Grid / World

```python
@dataclass
class Tile:
    terrain: str          # "grass", "water", "tree", "stone"
    items: list[Item]     # Items on this tile
    structure: Structure | None  # Built structure (wall, campfire, etc.)
    notes: list[Note]     # Written notes left here

@dataclass
class Item:
    type: str             # "food", "wood", "stone"
    quantity: int

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
class World:
    width: int            # 15
    height: int           # 15
    grid: list[list[Tile]]
    agents: list[Agent]
    tick_count: int
    time_of_day: str      # "morning", "midday", "afternoon", "evening", "night"
```

### Agent

```python
@dataclass
class Agent:
    name: str
    personality: str          # Archetype description (2-3 sentences)
    x: int
    y: int
    energy: int               # 0-100
    inventory: dict[str, int] # {"food": 2, "wood": 5, "stone": 1}

    # Memory
    working_memory: list[str]     # Last 15 raw event strings
    journal: list[str]            # Compressed summaries (most recent first)
    beliefs: list[str]            # Persistent factual statements (max 10)

    # Tracking
    ticks_since_journal: int      # Counter for journal compression trigger
```

---

## Constants (config.py)

```python
# World
GRID_WIDTH = 15
GRID_HEIGHT = 15
TICKS_PER_DAY_CYCLE = 50        # 10 ticks per time period (5 periods)

# Agent
STARTING_ENERGY = 80
MAX_ENERGY = 100
ENERGY_DRAIN_PER_TICK = 2
ENERGY_FROM_FOOD = 25
ENERGY_FROM_WAIT = 3
SHELTER_DRAIN_REDUCTION = 1     # Reduces drain by 1 when in shelter
VIEW_RANGE = 5                  # Tiles in each direction the agent can see

# Memory
WORKING_MEMORY_SIZE = 15
JOURNAL_TRIGGER = 20            # Ticks between journal compressions
MAX_JOURNAL_ENTRIES = 5         # Keep only the 5 most recent
MAX_BELIEFS = 10

# Communication
WHISPER_RANGE = 1               # Adjacent only
TALK_RANGE = 4
SHOUT_RANGE = 10

# LLM
OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "llama3:8b-instruct-q4_K_M"
TEMPERATURE = 0.7
MAX_TOKENS = 256                # For action responses
SUMMARY_MAX_TOKENS = 150        # For journal compression

# Food
INITIAL_FOOD_COUNT = 20         # Food items placed at world generation
FOOD_CLUSTER_CHANCE = 0.4       # Probability food spawns near existing food
```

---

## Action definitions

Each action the LLM can choose, with its JSON schema, validation rules, and execution logic.

### JSON schema (included in system prompt)

```json
{
  "action": "<action_type>",
  "direction": "<north|south|east|west>",
  "item": "<item_type>",
  "material": "<structure_type>",
  "message": "<text>",
  "volume": "<whisper|talk|shout>"
}
```

Only relevant fields are required per action. The LLM returns one JSON object per tick.

### Action table

| Action   | Required fields          | Validation                                      | Effect                                         |
|----------|--------------------------|------------------------------------------------|-------------------------------------------------|
| move     | direction                | Target tile is in bounds, walkable (not water/wall/tree unless bridge over water) | Agent moves to target tile |
| pick_up  | item                     | Item of that type exists on agent's current tile | Item removed from tile, added to inventory      |
| eat      | —                        | Agent has food in inventory                      | food -= 1, energy += ENERGY_FROM_FOOD (capped)  |
| chop     | direction                | Adjacent tile in that direction contains a tree  | Tree becomes grass, agent gains 1 wood          |
| build    | material                 | Agent has required resources, current tile is grass and empty of structures | Structure placed, resources deducted |
| destroy  | —                        | Structure exists on current tile                 | Structure removed, no resources returned         |
| write    | message                  | message is non-empty, max 100 chars              | Note placed on current tile                      |
| speak    | message, volume          | message is non-empty, max 100 chars              | Message delivered to all agents in range          |
| wait     | —                        | Always valid                                     | Agent gains ENERGY_FROM_WAIT energy              |

### Build costs

| Structure | Cost           |
|-----------|----------------|
| wall      | 2 wood         |
| campfire  | 3 wood         |
| shelter   | 4 wood, 2 stone|
| bridge    | 3 wood, 1 stone|
| marker    | 2 stone        |

### Invalid action handling

If the LLM returns an invalid action (bad JSON, impossible action, missing fields):
1. Log the failure to the event log (for debugging)
2. Default to `wait` — the agent stands still and recovers a bit of energy
3. Do NOT retry the LLM call — it wastes compute and often produces the same error

---

## Tick loop (main.py)

The core simulation loop, executed once per tick:

```
for each tick:
    1. Update time of day
    2. For each agent (sequential — one LLM at a time):
        a. Build perception text (perception.py)
        b. Assemble full prompt (prompts.py)
        c. Call LLM, get JSON response (llm.py)
        d. Parse and validate action (actions.py)
        e. Execute action, update world state (actions.py)
        f. Generate event description string
        g. Add event to agent's working memory
        h. Add event to global event log
        i. Deliver any speech to agents in range (communication.py)
    3. Apply passive effects:
        a. Drain energy for all agents (reduced if in shelter)
        b. Check for agent death (energy <= 0)
    4. Check journal triggers:
        a. For each agent: if ticks_since_journal >= JOURNAL_TRIGGER, compress
    5. Render display (display.py)
    6. Brief pause for readability (0.5-1 second, configurable)
```

### Agent ordering

Each tick, randomize the order agents act in. This prevents first-mover advantage and adds unpredictability.

### Agent death

When energy hits 0, the agent "collapses." For v1: the agent is removed from the simulation and a log entry records their death. Their structures and notes remain. Simple and dramatic.

---

## Prompt templates (prompts.py)

### System prompt (constant across all agents and ticks)

```
You are a character in a small world. You must choose ONE action each turn.

Respond with a JSON object. Available actions:

{"action": "move", "direction": "north|south|east|west"}
{"action": "pick_up", "item": "food|wood|stone"}
{"action": "eat"}
{"action": "chop", "direction": "north|south|east|west"}
{"action": "build", "material": "wall|campfire|shelter|bridge|marker"}
{"action": "destroy"}
{"action": "write", "message": "your message here"}
{"action": "speak", "message": "what you say", "volume": "whisper|talk|shout"}
{"action": "wait"}

Rules:
- You can only move to grass tiles or bridges. Water, walls, and trees block movement.
- You can only pick up items on your current tile.
- You can only chop trees adjacent to you.
- Building requires materials in your inventory and an empty grass tile.
- You lose energy each turn. Eating food restores energy. Waiting restores a little.
- If your energy reaches 0, you die.
- You can only see things within 5 tiles of your position.

Respond with ONLY a JSON object. No other text.
```

### Per-tick prompt assembly

```
[System prompt]

--- WHO YOU ARE ---
You are {name}. {personality}

--- YOUR BELIEFS ---
{belief_1}
{belief_2}
...

--- YOUR JOURNAL ---
{most_recent_journal_entry}

--- RECENT EVENTS ---
{working_memory_event_1}
{working_memory_event_2}
...

--- RIGHT NOW ---
Position: ({x}, {y})
Energy: {energy}/100
Inventory: {inventory_string}
Time: {time_of_day}

You see:
{perception_text}

What do you do?
```

### Token budget estimate

| Section | Estimated tokens |
|---------|-----------------|
| System prompt | ~250 |
| Identity | ~80 |
| Beliefs (10 max) | ~100 |
| Journal (1 entry) | ~60 |
| Working memory (15 events) | ~200 |
| Current perception | ~200 |
| **Total** | **~890** |

Well under the 1500 token target. Room to grow.

---

## Perception (perception.py)

Generates the "You see:" text for an agent based on their position and VIEW_RANGE.

### What gets included

Scan all tiles within VIEW_RANGE of the agent. For each tile that contains something notable, generate a line:

```
To the north (2 tiles): a tree
To the northeast (3 tiles): grass with food (x2)
Adjacent to the east: Builder, standing near a wall
To the south (4 tiles): water
On your tile: a campfire (built by Guardian), a note by Trickster
```

### Rules

- Only include tiles that have something other than empty grass
- Use relative directions and distances, not coordinates
- Name other agents if visible
- Include note content only if the agent is on the same tile as the note
- Include speech heard this tick (from communication system)

### Direction calculation

Convert (dx, dy) offsets to compass directions:
- Pure cardinal: north, south, east, west
- Diagonals: northeast, northwest, southeast, southwest
- Distance: Manhattan distance for simplicity

---

## Memory system (memory.py)

### Working memory

A simple list of strings, capped at WORKING_MEMORY_SIZE. New events are appended. When the list exceeds the cap, the oldest entries are removed.

Event strings are written in first person from the agent's perspective:
- "I moved north."
- "I picked up food."
- "I built a wall."
- "Builder said: 'Stay away from my area.'"
- "I read a note from Trickster: 'Food to the east!' "
- "I tried to move south but the path was blocked by water."

### Journal compression

Triggered when `ticks_since_journal >= JOURNAL_TRIGGER`.

**Compression prompt** (sent to LLM):

```
You are {name}. Summarize your recent experiences in 2-3 sentences.
Focus on: important events, other agents you met, locations of resources, any plans.

Recent events:
{working_memory_contents}

Previous journal entry:
{last_journal_entry_or_none}

Write your summary:
```

The LLM response becomes the new journal entry. Prepend to the journal list. If journal exceeds MAX_JOURNAL_ENTRIES, drop the oldest. Reset `ticks_since_journal` to 0.

### Belief updates

Beliefs are updated by the simulation logic, not by the LLM. This keeps them reliable:

- **Food discovered**: Add "There is food near ({x}, {y})." Remove contradicting belief if exists.
- **Food gone**: Update "There is no food at ({x}, {y})." when agent arrives and finds nothing.
- **Agent encountered**: Add "{Name} is {friendly/hostile/neutral}." based on interaction outcome.
- **Structure found**: Add "{Name} built a {structure} near ({x}, {y})."
- **Speech received**: If another agent shares information, add it as a belief.

Beliefs are capped at MAX_BELIEFS. When full, the oldest belief is dropped to make room for a new one.

---

## Communication (communication.py)

### Speech delivery

When an agent speaks:
1. Determine range based on volume (whisper=1, talk=4, shout=10)
2. Find all other agents within that Manhattan distance
3. For each agent in range:
   - Add to their working memory: `"{speaker} {volume}s: '{message}'"` (e.g., "Builder whispers: 'I need wood.'")
4. Log to global event log

### Note reading

When an agent is on a tile with notes and the perception is being built:
- Include each note's content and author in the perception text
- Add to working memory: `"I read a note from {author}: '{content}'"`

---

## LLM integration (llm.py)

### Ollama API call

```python
import requests

def get_agent_action(prompt: str) -> dict:
    response = requests.post(f"{OLLAMA_URL}/api/generate", json={
        "model": MODEL_NAME,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": TEMPERATURE,
            "num_predict": MAX_TOKENS,
        }
    })
    result = response.json()
    return json.loads(result["response"])
```

### Error handling

- If Ollama is unreachable: print error, exit gracefully
- If JSON parsing fails: log the raw response, return `{"action": "wait"}`
- If the response contains fields not in the schema: ignore extra fields, use what's valid
- If required fields are missing: return `{"action": "wait"}`

### Journal compression call

Same function but with `SUMMARY_MAX_TOKENS` and no JSON format requirement — the journal entry is plain text.

```python
def compress_journal(prompt: str) -> str:
    response = requests.post(f"{OLLAMA_URL}/api/generate", json={
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.5,  # Lower temp for summaries
            "num_predict": SUMMARY_MAX_TOKENS,
        }
    })
    return response.json()["response"].strip()
```

---

## World generation (world.py)

### Default map generation

1. Fill 15x15 grid with grass
2. Place water: create 1-2 small water bodies (3-6 connected water tiles each) using random walk
3. Place trees: scatter 15-25 trees randomly on grass tiles, with slight clustering
4. Place stone: scatter 5-10 stone deposits on grass tiles
5. Place food: scatter INITIAL_FOOD_COUNT food items, with clustering (FOOD_CLUSTER_CHANCE)
6. Place agents: spawn on random grass tiles, at least 3 tiles apart from each other

### Map serialization

The default map can be saved as `maps/default.json` and loaded on startup. Format:

```json
{
  "width": 15,
  "height": 15,
  "terrain": [["grass", "grass", "tree", ...], ...],
  "items": [{"x": 3, "y": 7, "type": "food", "quantity": 1}, ...],
  "agent_spawns": [{"x": 2, "y": 2}, {"x": 12, "y": 12}, ...]
}
```

---

## Terminal display (display.py)

Using the `rich` library for colored terminal output.

### Grid display

A 15x15 character grid rendered each tick:

| Symbol | Meaning | Color |
|--------|---------|-------|
| `.`    | Grass   | Green |
| `~`    | Water   | Blue  |
| `T`    | Tree    | Dark green |
| `^`    | Stone   | Gray  |
| `#`    | Wall    | White |
| `*`    | Campfire| Yellow |
| `H`    | Shelter | Brown |
| `=`    | Bridge  | Cyan  |
| `!`    | Marker  | Magenta |
| `f`    | Food    | Red   |
| First letter of name | Agent | Bright white, bold |

When an agent is on the same tile as another object, the agent takes display priority.

### Event log

Below the grid, show the last 10-15 events in a scrolling log:

```
[Tick 47 | Midday]
  Explorer moved north.
  Builder built a wall at (8, 6).
  Guardian says: "Stay back!"
  Gatherer picked up food.
```

Color-code by agent name for readability.

### Layout

```
┌─────────────────────────────┐
│  . . T . . . . ~ ~ . . . . │
│  . . . . f . . ~ . . T . . │
│  . E . . . . . . . . . . . │
│  . . . . # # . . . . . f . │
│  ... (15x15 grid) ...       │
└─────────────────────────────┘

[Tick 47 | Midday]
  Explorer moved north.
  Builder built a wall at (8, 6).
  Guardian shouts: "Stay back!"
  Gatherer picked up food.

Agents:
  Explorer  ♥ 72  | food: 1, wood: 0
  Builder   ♥ 55  | food: 0, wood: 3
  Guardian  ♥ 88  | food: 2, wood: 1
  Gatherer  ♥ 41  | food: 4, wood: 0
```

---

## CLI interface (main.py)

### Command line arguments

```
python main.py                    # Run with defaults (4 agents, new world)
python main.py --agents 2         # Run with 2 agents
python main.py --load save.json   # Load from save file
python main.py --speed 2.0        # Seconds between ticks (default 1.0)
python main.py --no-display       # Log-only mode (faster, good for long runs)
```

### Runtime controls

During simulation, accept keyboard input:
- **Space** — pause/resume
- **s** — save current state to JSON
- **q** — quit
- **+/-** — adjust tick speed

---

## Build order

### Phase 1: Core loop (get something running)

1. `config.py` — all constants
2. `world.py` — Tile, Item, Structure, Note, World dataclasses + grid generation
3. `agent.py` — Agent dataclass with basic state (no memory yet)
4. `llm.py` — Ollama client with JSON mode
5. `prompts.py` — system prompt + basic per-tick prompt (identity + perception only)
6. `perception.py` — generate "You see:" text from grid state
7. `actions.py` — parse JSON, validate, execute (move, pick_up, eat, wait only)
8. `main.py` — tick loop with 2 agents, print events to stdout

**Milestone**: Two agents walking around, eating food, printing their actions to the terminal.

### Phase 2: Full action set

9. Add remaining actions to `actions.py`: chop, build, destroy, write, speak
10. `communication.py` — speech delivery with range
11. Update `perception.py` to include structures, notes, other agents' speech

**Milestone**: Agents can build, chop trees, leave notes, and talk to each other.

### Phase 3: Memory

12. `memory.py` — working memory buffer (event strings, capped list)
13. Add journal compression (LLM summarization call)
14. Add belief system (simulation-driven updates)
15. Update `prompts.py` to include beliefs, journal, working memory in prompt

**Milestone**: Agents remember past events and have persistent beliefs about the world.

### Phase 4: Display

16. `display.py` — rich-based grid rendering + event log + agent status
17. Update `main.py` for keyboard controls (pause, save, quit)
18. `save_load.py` — JSON serialization of full world state

**Milestone**: Full terminal UI with grid, event log, agent status, and save/load.

### Phase 5: Polish

19. Add agent death (energy <= 0)
20. Add day/night cycle to perception text
21. Tune constants (energy drain, food amounts, view range) through playtesting
22. Add `--agents` and `--speed` CLI args
23. Create 2-3 interesting preset maps

**Milestone**: Complete v1, ready for extended observation runs.

---

## Verification plan

### Manual testing at each phase

- **Phase 1**: Run with 2 agents, verify they move and eat. Check LLM returns valid JSON. Verify invalid actions fall back to wait.
- **Phase 2**: Verify building costs resources. Verify speech reaches correct agents. Verify notes persist and are readable.
- **Phase 3**: Verify working memory caps at 15 events. Verify journal compression fires every 20 ticks. Verify beliefs appear in prompt.
- **Phase 4**: Verify grid renders correctly. Verify save/load round-trips without data loss.
- **Phase 5**: Verify agent dies at 0 energy. Run for 200+ ticks and watch for interesting behavior.

### Quick smoke test

After each phase, run 50 ticks and check:
1. No crashes
2. No infinite loops (agents doing the same invalid action repeatedly)
3. Event log looks reasonable (agents doing varied actions)
4. World state is consistent (no items appearing from nowhere, no duplicate structures)

---

## Prerequisites

Before starting development:

1. Install Ollama: https://ollama.com
2. Pull the model: `ollama pull llama3:8b-instruct-q4_K_M`
3. Verify it runs: `ollama run llama3:8b-instruct-q4_K_M "Say hello in JSON format"`
4. Create a Python venv: `python -m venv venv && source venv/bin/activate`
5. Install dependencies: `pip install rich requests`
