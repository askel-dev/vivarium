# 🌍 Vivarium — Agent World

A living simulation where AI-driven characters inhabit a shared grid world, make their own decisions, remember their past, and reshape the environment around them. Every agent is powered by a **local LLM** running through [Ollama](https://ollama.com) — no cloud, no API costs, no limits.

Set it in motion. Watch what emerges.

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue?logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/LLM-Ollama-orange?logo=meta&logoColor=white" alt="Ollama">
  <img src="https://img.shields.io/badge/UI-Terminal%20(Rich)-green" alt="Terminal UI">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License">
</p>

---

## ✨ Features

- **Autonomous AI Agents** — Each agent has a unique personality (Explorer, Builder, Gatherer, Trickster, Guardian, Nomad) and makes independent decisions every tick via LLM inference
- **Three-Layer Memory** — Working memory (recent events), compressed journal (LLM-summarized), and persistent beliefs give agents a sense of continuity
- **Spatial Communication** — Whisper, talk, or shout with range-based delivery. Eavesdropping emerges naturally from proximity
- **World Manipulation** — Chop trees, gather resources, build walls, shelters, campfires, bridges, and markers. Leave written notes for others to find
- **Survival Pressure** — Energy drains each tick. Food is finite and scattered. Agents must eat to survive — creating natural competition and cooperation
- **Day/Night Cycle** — Five time periods (morning → night) that shape the world's rhythm
- **Rich Terminal UI** — Color-coded grid display, scrolling event log, and agent status bars powered by the `rich` library
- **Save/Load** — Serialize full world state to JSON and resume later
- **Detailed Logging** — Session logs and optional AI-digest JSONL format for post-run analysis

---

## 🚀 Quick Start

### Prerequisites

1. **Python 3.11+**
2. **Ollama** — Install from [ollama.com](https://ollama.com)
3. Pull the model:
   ```bash
   ollama pull llama3.1:8b
   ```

### Setup

```bash
git clone https://github.com/askel-dev/vivarium.git
cd vivarium

python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install rich requests
```

### Run

You can run Vivarium in two ways:

**1. Web Interface (Recommended)**
Double-click `run.bat` or execute it in your terminal (Windows):
```cmd
.\run.bat
```
For Mac/Linux:
```bash
chmod +x run.sh
./run.sh
```

**2. Terminal World Only**
```bash
cd agent_world
python main.py
```

---

## ⚙️ Command-Line Options

| Flag | Default | Description |
|------|---------|-------------|
| `--agents N` | `4` | Number of agents to spawn |
| `--speed S` | `1.0` | Seconds between ticks |
| `--load FILE` | — | Load world state from a save file |
| `--map FILE` | — | Load from a map definition file |
| `--no-display` | — | Log-only mode (no terminal UI, faster) |
| `--log-dir DIR` | `logs` | Directory for session log files |
| `--ai-digest` | — | Enable compressed JSONL output for AI analysis |

**Examples:**

```bash
python main.py --agents 2 --speed 0.5       # Fast run with 2 agents
python main.py --load save.json              # Resume from a save
python main.py --no-display --ai-digest      # Headless with AI-friendly logs
```

---

## 🎮 Runtime Controls

| Key | Action |
|-----|--------|
| `Space` | Pause / Resume |
| `s` | Save current state to `save.json` |
| `q` | Quit |
| `+` / `-` | Speed up / slow down |

---

## 🗺️ The World

A **15×15** grid with procedurally generated terrain:

| Symbol | Terrain | Notes |
|--------|---------|-------|
| `.` | Grass | Walkable, buildable |
| `~` | Water | Impassable (unless bridged) |
| `T` | Tree | Choppable for wood |
| `^` | Stone | Harvestable |
| `f` | Food | Restores energy when eaten |

Agents can build persistent structures:

| Symbol | Structure | Cost |
|--------|-----------|------|
| `#` | Wall | 2 wood |
| `*` | Campfire | 3 wood |
| `H` | Shelter | 4 wood, 2 stone |
| `=` | Bridge | 3 wood, 1 stone |
| `!` | Marker | 2 stone |

---

## 🧠 Agent Actions

Each tick, every agent chooses **one** action:

| Action | Description |
|--------|-------------|
| `move` | Walk north/south/east/west (blocked by water, walls, trees) |
| `pick_up` | Grab food, wood, or stone from the current tile |
| `eat` | Consume food from inventory to restore energy |
| `chop` | Cut an adjacent tree, gaining wood |
| `build` | Construct a structure using inventory materials |
| `destroy` | Tear down a structure on the current tile |
| `write` | Leave a note on the ground |
| `speak` | Say something (whisper/talk/shout range) |
| `wait` | Rest and recover a small amount of energy |

---

## 🏗️ Project Structure

```
agent_world/
├── main.py           # Entry point, tick loop, CLI args
├── world.py          # Grid, terrain, world state, object placement
├── agent.py          # Agent state, inventory, energy, memory
├── actions.py        # Action definitions, validation, execution
├── perception.py     # Builds natural-language perception for each agent
├── prompts.py        # Prompt assembly, system prompt, templates
├── llm.py            # Ollama client, inference calls, JSON parsing
├── memory.py         # Working memory, journal compression, beliefs
├── communication.py  # Speech range checks, message delivery
├── display.py        # Terminal grid rendering, event log display
├── config.py         # Constants, tuning parameters
├── save_load.py      # Serialize/deserialize world state to JSON
└── logger.py         # Session logging and AI digest output
```

---

## 🔧 Configuration

All tunable parameters live in `agent_world/config.py`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| Grid size | 15×15 | World dimensions |
| Starting energy | 100 | Initial agent energy |
| Energy drain/tick | 1 | Passive energy loss |
| Food energy | +30 | Energy restored per food |
| View range | 5 | Tiles visible in each direction |
| Journal trigger | 20 ticks | When memory gets compressed |
| Talk range | 4 tiles | Normal speech radius |
| Shout range | 10 tiles | Maximum speech radius |

---

## 🧪 Hardware Requirements

Designed to run locally on consumer hardware:

- **GPU**: Any GPU with ≥6 GB VRAM (tested on RTX 3080 10 GB)
- **RAM**: 16 GB+ recommended
- **Inference speed**: ~1–3 seconds per agent per tick with a 7–8B model

---

## 📜 License

This project is open source. See [LICENSE](LICENSE) for details.
