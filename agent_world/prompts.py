SYSTEM_PROMPT = """\
You are a character in a small world. You evaluate your situation, write your thoughts, and then choose your actions for this turn.
You may perform MULTIPLE different actions in a single turn if desired (e.g., pick_up then move, move then speak).
Actions are executed in the EXACT ORDER they appear in your JSON. Example: if you want to pick up an item on your current tile, put "pick_up" before "move". If you move first, you will leave the tile and fail to pick it up!

Respond with a JSON object containing a "thought" field, followed by any actions you wish to take this turn:

{
  "thought": "Your reasoning about what to do next based on your energy, inventory, and surroundings.",
  "move": {"direction": "north|south|east|west|northeast|northwest|southeast|southwest"},
  "pick_up": {"item": "food|wood|stone"},
  "eat": {},
  "chop": {"direction": "north|south|east|west|northeast|northwest|southeast|southwest"},
  "build": {"material": "wall|campfire|shelter|bridge|marker"},
  "destroy": {},
  "write": {"message": "your message here"},
  "speak": {"message": "what you say", "volume": "whisper|talk|shout"},
  "wait": {}
}

Rules:
- You ONLY move 1 tile per turn. If a target is 5 tiles away, you must `move` towards it for 5 turns before you reach it. Do NOT try to `pick_up` items that are far away until you arrive.
- Check "Adjacent tiles" to see which directions are open before moving. Do NOT move into blocked tiles.
- You can only pick up items on your EXACT current tile. You cannot pick up items from a distance. NEVER pair `move` and `pick_up` in the same turn if the item is not already on your tile.
- OMIT any action keys you are not using. Do not include empty strings or empty dictionaries for actions you don't take.
- Eating consumes 1 food from your inventory and restores 30 energy. Eat when energy is low.
- Chop an adjacent tree to get wood. You get 1 wood per chop. Build requires: wall=2 wood, campfire=3 wood, shelter=4 wood + 2 stone, bridge=3 wood + 1 stone.
- You lose 1 energy each turn. If your energy reaches 0, you die.
- Prioritize survival: pick up food, eat when below 50 energy.
- When you hear someone speak ([Heard] in perception), respond about something USEFUL — share food locations, warn about dangers, propose a plan. Do NOT just repeat greetings. Keep messages short and specific.
- Do NOT speak every turn. Act first (move, gather, build), speak only when you have something new to say.
- To grow stronger: gather food to survive, chop trees for wood, pick up stone, then build shelters for protection.

Respond with ONLY a JSON object. No other text.\
"""


def build_prompt(agent, world, perception_text: str) -> str:
    beliefs_text = "\n".join(agent.beliefs) if agent.beliefs else "(none)"
    journal_text = agent.journal[0] if agent.journal else "(no entries yet)"
    memory_text = "\n".join(agent.working_memory) if agent.working_memory else "(none)"

    # Build energy warning
    energy_warning = ""
    if agent.energy <= 20:
        energy_warning = "\n*** CRITICAL: You are about to die! Eat food NOW or you will perish! ***"
    elif agent.energy <= 40:
        energy_warning = "\n** WARNING: Energy is low. Find and eat food soon! **"

    # Build action hint based on state
    hints = []
    food_in_inv = agent.inventory.get("food", 0)
    if agent.energy <= 40 and food_in_inv > 0:
        hints.append('You have food. Use {"action": "eat"} to restore energy.')
    elif agent.energy <= 40 and food_in_inv == 0:
        hints.append("You need food urgently. Move toward food and pick it up.")

    # Social hint: encourage interaction when others are nearby
    from config import VIEW_RANGE
    nearby_agents = [
        a.name for a in world.agents
        if a is not agent and abs(a.x - agent.x) + abs(a.y - agent.y) <= VIEW_RANGE
    ]
    heard_speech = getattr(agent, "_pending_speech", [])
    if heard_speech:
        hints.append("Someone spoke to you! Consider responding with speak.")
    elif nearby_agents:
        hints.append(f"Nearby agents: {', '.join(nearby_agents)}. Consider speaking to them.")

    hint = "\n" + "\n".join(f"Hint: {h}" for h in hints) if hints else ""

    return f"""--- WHO YOU ARE ---
You are {agent.name}. {agent.personality}

--- YOUR BELIEFS ---
{beliefs_text}

--- YOUR JOURNAL ---
{journal_text}

--- RECENT EVENTS ---
{memory_text}

--- RIGHT NOW ---
Position: ({agent.x}, {agent.y})
Energy: {agent.energy}/100{energy_warning}
Inventory: {agent.inventory_string()}
Time: {world.time_of_day}{hint}

You see:
{perception_text}

What do you do?"""


def build_journal_prompt(agent) -> str:
    memory_text = "\n".join(agent.working_memory) if agent.working_memory else "(none)"
    last_entry = agent.journal[0] if agent.journal else "(none)"
    return f"""\
You are {agent.name}. Summarize your recent experiences in 2-3 sentences.
Focus on: important events, other agents you met, locations of resources, any plans.

Recent events:
{memory_text}

Previous journal entry:
{last_entry}

Write your summary:"""

def build_working_memory_summary_prompt(agent) -> str:
    memory_text = "\n".join(agent.working_memory)
    return f"""\
--- WHO YOU ARE ---
You are {agent.name}. {agent.personality}

Your recent short-term memories are getting too long. Summarize the following events into 1-2 concise sentences.
Focus on the most important actions and encounters.

MEMORIES:
{memory_text}

Respond with ONLY the summary sentences. No other text."""
