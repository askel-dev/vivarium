# World
GRID_WIDTH = 15
GRID_HEIGHT = 15
TICKS_PER_DAY_CYCLE = 50        # 10 ticks per time period (5 periods)

# Agent
STARTING_ENERGY = 100
MAX_ENERGY = 120
ENERGY_DRAIN_PER_TICK = 1
ENERGY_FROM_FOOD = 30
ENERGY_FROM_WAIT = 2
SHELTER_DRAIN_REDUCTION = 1     # Reduces drain by 1 when in shelter

# Hostile actions
STEAL_ENERGY_COST = 3
ATTACK_ENERGY_COST = 10
ATTACK_DAMAGE = 20
PUSH_ENERGY_COST = 5

VIEW_RANGE = 5                  # Tiles in each direction the agent can see

# Memory
WORKING_MEMORY_SIZE = 15
JOURNAL_TRIGGER = 20            # Ticks between journal compressions
MAX_JOURNAL_ENTRIES = 5         # Keep only the 5 most recent
MAX_BELIEFS = 15

# Communication
WHISPER_RANGE = 1               # Adjacent only
TALK_RANGE = 4
SHOUT_RANGE = 10

# LLM
OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "qwen3:8b"
TEMPERATURE = 0.7
MAX_TOKENS = 256                # For action responses
SUMMARY_MAX_TOKENS = 150        # For journal compression

# Food
INITIAL_FOOD_COUNT = 20         # Food items placed at world generation
FOOD_CLUSTER_CHANCE = 0.3       # Probability food spawns near existing food (lower = more spread)
FOOD_REGROWTH_CHANCE = 0.06     # Chance per tick to spawn 1 food
MAX_FOOD_TOTAL = 35             # Maximum amount of food allowed in the world at once

# Display
DEFAULT_TICK_SPEED = 1.0        # Seconds between ticks
EVENT_LOG_SIZE = 15             # Number of events to show

# Story generation
STORY_ENABLED = True            # Set False to disable
STORY_BACKEND = "ollama"        # "ollama" = free + local | "anthropic" = paid API
STORY_MAX_TOKENS = 600          # qwen3:8b needs headroom for a ~200-word story
STORY_TEMPERATURE = 0.9         # Higher than the action model — this is prose

# Only consulted when STORY_BACKEND == "anthropic". Billed per token.
# If you switch to this, also raise STORY_MAX_TOKENS to ~2000: Opus 5 runs
# adaptive thinking by default and max_tokens covers thinking + output.
STORY_MODEL = "claude-opus-5"
