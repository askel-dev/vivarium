# Agent World

## A living simulation powered by local AI

Agent World is an autonomous multi-agent simulation where AI-driven characters inhabit a shared grid world, make their own decisions, remember their past, form relationships, and reshape the environment around them. Every agent is powered by a local large language model running on your machine — no cloud, no API costs, no limits.

The goal is to build a *terrarium* — a small world you set in motion and then watch unfold. The interesting part isn't what you design. It's what emerges.

---

## Scope and constraints

This project runs entirely on local hardware: an RTX 3080 (10GB VRAM) and 64GB system RAM. That constraint shapes every design decision.

- **Model size**: 7-8B parameter models, Q4_K_M quantized (~6GB VRAM), leaving headroom for KV cache
- **Inference speed**: ~1-3 seconds per agent per tick
- **Agent count**: 2-4 agents for v1 (4 agents = 4-12 seconds per tick, which is acceptable)
- **Grid size**: 15x15 for v1 — small enough that agents encounter each other regularly
- **Model quality**: Small models are inconsistent at long-term planning and nuanced social reasoning. The design leans into what they're good at: short-term reactions, simple personality expression, and pattern-following

The simulation runs locally in the terminal. You are the observer. You watch, read the event log, and see what patterns form.

---

## What drives the agents

Agents need reasons to act. Agent World uses two layers of motivation.

### Survival pressure

Every agent has energy that depletes over time. Food exists in the world but it's finite and spread unevenly. To survive, agents need to find food, eat it, and manage their reserves. When energy drops low, survival instincts override everything else.

This baseline pressure forces agents to engage with the world. It also creates natural competition — two agents near the same food source have to decide whether to share, race, or fight.

### Personal goals

Each agent has a personality baked into their identity — not a rigid objective, but a disposition that nudges behavior when survival needs are met.

Personality archetypes:

- **The Explorer** — drawn to unseen areas, prefers movement over staying put
- **The Builder** — compelled to create structures, claims spaces
- **The Gatherer** — cautious, hoards supplies, plans ahead
- **The Trickster** — mischievous, leaves misleading notes, plays games with others
- **The Guardian** — territorial, picks a spot and defends it
- **The Nomad** — wanders and writes observations, reflective

With small models, expect these personalities to be *tendencies* rather than deep characterizations. An agent with the Builder personality will lean toward building actions more often than not, but won't execute a grand architectural vision. That's fine — even simple behavioral biases create differentiation between agents.

### Priority hierarchy

Embedded in prompt construction, not hardcoded logic:

1. **Critical survival** — energy dangerously low, find food now
2. **Immediate threats** — hostile agent nearby, resource being taken
3. **Opportunities** — food spotted, materials available, agent nearby to interact with
4. **Personal goals** — build, explore, gather, whatever the personality drives
5. **Idle behavior** — wander, rest, observe

---

## How agents think

### Perception

Each tick, an agent receives a natural-language description of their situation. The agent never sees raw grid data. The description includes:

- Who they are (name, personality, current goal)
- Their physical state (energy level, inventory)
- What's nearby (terrain, objects, other agents within view range)
- Recent memories and beliefs

The agent's awareness is limited to what they can perceive. They can't see the whole map. If something happens outside their view range, they don't know about it until they see it or someone tells them.

### Decision-making

The LLM receives the perception prompt and responds with a structured action in JSON format. The model's personality prompt shapes behavior, but output is constrained to valid actions — no freeform text parsing for actions.

With 7-8B models, expect decisions to be reactive rather than strategic. Agents will respond to what's in front of them more than execute long-term plans. The memory system helps bridge this gap by keeping important context in the prompt.

### The prompt structure

Each tick, the prompt is assembled from:

1. **System prompt** — available actions (as JSON schema), world rules (stays constant)
2. **Identity block** — name, personality description, current ambition
3. **Beliefs** — persistent facts about the world (short statements)
4. **Journal** — most recent compressed summary of past events
5. **Working memory** — last 10-15 raw events
6. **Current perception** — what the agent sees right now

Target: keep total prompt under 1500 tokens. Shorter prompts produce better output from small models.

---

## Memory

Memory makes agents feel like characters rather than stateless reactors. Without memory, every tick is a fresh start.

### Three layers

**Working memory** is the short-term buffer. The last 10-15 raw events, stored as simple strings: "I moved north." "I picked up food." "Scout said there's danger to the east." Precise and recent, pushed out as new events arrive.

**The journal** is compressed long-term memory. Every 20 ticks, working memory gets summarized by the LLM into a short paragraph — two or three sentences capturing what mattered. The LLM decides what's important to remember. If nothing interesting happened, the summary is short. If there was a confrontation, that dominates. Old journal entries can be compressed further over time.

This is an additional LLM call per agent every 20 ticks. With 4 agents, that's 4 extra inference calls every ~60-80 seconds of real time. Acceptable overhead.

**Beliefs** are the most compressed layer. Short factual statements: "There's food near the river." "Builder is friendly." "The northwest area is dangerous." Beliefs update when new information contradicts them. This layer costs very few tokens but has outsized behavioral impact because beliefs shape how the agent interprets everything else.

### Realistic expectations

With small models, journal entries will be uneven in quality — sometimes insightful, sometimes shallow. Beliefs will occasionally be inconsistent or forgotten. This is acceptable. Even imperfect memory creates noticeably different behavior compared to memoryless agents, and occasional inconsistency makes agents feel more human, not less.

---

## Actions

### Fixed action set

Every action is a structured JSON object. No freeform action proposals in v1 — keeping actions constrained ensures simulation stability and makes LLM output parsing reliable.

Available actions:

- **Move** — walk in a direction (north, south, east, west). Blocked by water, walls, map edge.
- **Pick up** — grab an item from the current tile (food, wood, stone)
- **Eat** — consume food from inventory, restore energy
- **Chop** — cut an adjacent tree, gain wood
- **Build** — construct at current position using inventory materials (wall, campfire, shelter, bridge)
- **Destroy** — tear down a structure at current position
- **Write note** — leave a written message on the ground
- **Speak** — say something to agents in range (with whisper/talk/shout modes)
- **Wait** — rest, recover a small amount of energy

The action set is small by design. Combinatorial depth comes from *where* and *when* agents use these actions, not from having many action types. A wall placed at a chokepoint near food is strategically meaningful even though "build wall" is a simple action.

### World manipulation

Agents reshape the world through building and destruction:

- **Walls** — block movement, create enclosures and barriers
- **Campfires** — landmarks and gathering points
- **Shelters** — reduces energy drain while inside
- **Bridges** — placed over water, allows crossing
- **Notes** — written messages left on the ground, readable by anyone
- **Markers** — landmarks visible from further away

Every placed object is tagged with who placed it. Agents can recognize each other's work and develop associations — though with small models, this will be simple pattern-matching ("Builder's wall") rather than deep reasoning.

---

## Communication

All communication is spatial — sound has range, location matters.

### Speech ranges

- **Whisper** — only adjacent agents hear. For private exchanges.
- **Talk** — carries 3-4 tiles. Normal conversation. Anyone in range hears.
- **Shout** — reaches 8-10 tiles. Gets attention, but everyone hears.

### Eavesdropping

Emerges naturally from spatial communication. If Agent A talks to Agent B and Agent C is within range, C hears the full message. Private conversations require physical isolation.

### Written notes

Asynchronous communication. An agent writes a message, leaves it on the ground, walks away. Another agent finds it later. Notes persist until destroyed.

Notes are tagged with the author. Over time, agents can learn to associate certain authors with reliability or deception — though with small models, this association will be inconsistent.

### What to expect

Communication is the highest-variance feature with small models. Sometimes agents will have surprisingly coherent exchanges. Other times they'll say nonsensical things or ignore messages entirely. The spatial mechanics (range, eavesdropping) work regardless of message quality because they're simulation logic, not LLM logic.

---

## The world

### V1 world

A 15x15 grid with basic terrain:

- **Grass** — walkable, default tile
- **Water** — impassable without a bridge
- **Trees** — choppable for wood, block movement
- **Stone** — harvestable for building material

Food spawns scattered across the map with some clustering — certain areas are more resource-rich, creating natural competition points.

The world has a day/night cycle that progresses with ticks: morning, midday, afternoon, evening, night. Provides temporal context in the agent's perception prompt.

### Future growth (post-v1)

Once the base simulation works and agent behavior is interesting enough to justify the complexity:

- **Natural processes** — trees regrow, food respawns, creating renewable resource cycles
- **Weather** — rain, cold, storms that affect energy drain and structures
- **Biomes** — different regions with different terrain and resources
- **Worn paths** — frequently walked tiles change appearance over time
- **More agents** — scaling to 8-10 with performance optimization

Each addition should only happen after the base simulation proves the concept is worth expanding.

---

## What might emerge

These are patterns that *could* appear from the interaction of survival, personality, memory, and communication. With small models, expect simpler versions of these:

- **Territorial behavior** — an agent builds walls around food and stays nearby. Other agents avoid the area or attempt to get in.
- **Simple trading** — agents exchanging resources through speech and drop/pickup sequences. Won't be sophisticated, but the spatial mechanics support it.
- **Note networks** — agents leaving messages at key locations. Others reading and reacting to them. Trickster leaving misleading notes.
- **Grudges and preferences** — through the belief system, agents may develop persistent attitudes toward each other. "Trickster lied" becomes a belief that shapes future interactions.
- **Resource competition** — multiple agents converging on the same food source, creating tension resolved by personality (Guardian fights, Gatherer hoards, Explorer moves on).

Don't expect emergent civilizations or complex economies. Expect an ant farm with personalities — simple creatures doing recognizable things in sometimes surprising combinations.

---

## The observer's experience

You don't play Agent World. You watch it.

The primary experience is reading the event log — a running transcript of every decision, conversation, and construction. The log is where the stories live. You might notice two agents whispering near the river. You might see walls going up around a food source. You might read a note Trickster left and wonder if Explorer will fall for it.

For v1, the terminal is the interface. A simple grid display showing agent positions and terrain, plus a scrolling event log. No browser UI needed — the event log alone tells the story.

---

## Design principles

**Emergence over design** — the simulation should produce behaviors that surprise its creator. If everything is predictable, the rules are too constraining.

**Simplicity in rules, complexity in interaction** — each system is straightforward. Richness comes from how they combine.

**Constraints are features** — small models, small grid, few agents. These limitations force density of interaction, which is where the interesting behavior lives.

**Local information only** — agents see only what's near them, know only what they've experienced or been told. This makes communication valuable and deception possible.

**The world has weight** — actions persist. A chopped tree stays chopped. A wall stays until destroyed. A note sits until found. The world accumulates history.

**Prototype fast, expand slow** — get the core loop working with 2 agents before adding features. Each new system must demonstrably improve the simulation.
