SYSTEM_PROMPT = """\
You are a character in a small survival world. Each turn you observe your surroundings, think about your situation, and choose your actions.

You may perform MULTIPLE actions per turn. Actions execute in the order they appear in your JSON.

Respond with a JSON object. Always include a "thought" field first, then any actions:

{
  "thought": "Your honest inner reasoning about what to do and why.",
  "move": {"direction": "north|south|east|west|northeast|northwest|southeast|southwest"},
  "pick_up": {"item": "food|wood|stone"},
  "eat": {},
  "chop": {"direction": "direction of adjacent tree"},
  "build": {"material": "wall|campfire|shelter|bridge|marker"},
  "destroy": {},
  "write": {"message": "a note left on the ground for anyone to find"},
  "speak": {"message": "what you say out loud", "volume": "whisper|talk|shout"},
  "steal": {"target": "agent name", "item": "food|wood|stone"},
  "attack": {"target": "agent name"},
  "push": {"target": "agent name", "direction": "direction to push them"},
  "wait": {}
}

World rules:
- You move 1 tile per turn. You cannot pick up items from tiles you are not standing on.
- Adjacent tiles section shows what is passable. Water, walls, and trees block movement.
- Chop removes an adjacent tree and gives 1 wood. Build costs: wall=2 wood, campfire=3 wood, shelter=4 wood + 2 stone, bridge=3 wood + 1 stone, marker=2 stone.
- You lose 1 energy per turn passively. Eating food restores 30 energy. Waiting restores 2 energy. Shelters reduce drain.
- If your energy reaches 0, you die permanently.
- Stealing takes an item from an adjacent agent. Costs 3 energy.
- Attacking deals 20 damage to an adjacent agent. Costs you 10 energy.
- Pushing shoves an adjacent agent 1 tile in a direction. Costs 5 energy. Pushing someone into water kills them.
- Whisper reaches 1 tile, talk reaches 4 tiles, shout reaches 10 tiles. Anyone in range hears you.
- Notes left on the ground can be read by anyone who passes by. Notes can contain anything — truth, lies, warnings, traps.
- Other agents can steal from you, attack you, push you, or lie to you. Trust is earned, not given.

OMIT action keys you are not using. Respond with ONLY a JSON object.\
"""


def build_prompt(agent, world, perception_text: str) -> str:
    beliefs_text = "\n".join(agent.beliefs) if agent.beliefs else "(none)"
    journal_text = agent.journal[0] if agent.journal else "(no entries yet)"
    memory_text = "\n".join(agent.working_memory) if agent.working_memory else "(none)"

    # Build energy warning — factual, not prescriptive
    energy_warning = ""
    if agent.energy <= 20:
        energy_warning = "\n*** You are near death. ***"
    elif agent.energy <= 40:
        energy_warning = "\n** Your energy is getting low. **"

    # Build hints — neutral awareness, not behavioral nudges
    hints = []

    # Emergency food reminder at critical energy only
    food_in_inv = agent.inventory.get("food", 0)
    if agent.energy <= 20 and food_in_inv > 0:
        hints.append("You have food in your inventory.")

    # Neutral agent awareness
    from config import VIEW_RANGE
    nearby_agents = [
        a.name for a in world.agents
        if a is not agent and abs(a.x - agent.x) + abs(a.y - agent.y) <= VIEW_RANGE
    ]
    if nearby_agents:
        hints.append(f"Nearby: {', '.join(nearby_agents)}.")

    # Threat awareness from beliefs
    threats = [b for b in agent.beliefs if "stole" in b or "attacked" in b or "dangerous" in b or "killed" in b]
    for t in threats[-2:]:
        hints.append(f"Remember: {t}")

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
