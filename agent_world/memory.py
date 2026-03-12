from config import JOURNAL_TRIGGER, VIEW_RANGE, WORKING_MEMORY_SIZE
from llm import compress_journal
from prompts import build_journal_prompt, build_working_memory_summary_prompt


def maybe_compress_journal(agent, log=None, tick=0):
    """Trigger journal compression if threshold reached."""
    if agent.ticks_since_journal < JOURNAL_TRIGGER:
        return
    prompt = build_journal_prompt(agent)
    entry = compress_journal(prompt)
    if entry:
        agent.add_journal_entry(entry)
        if log is not None:
            log.log_journal_compression(agent.name, tick, entry)

def maybe_summarize_working_memory(agent, log=None, tick=0):
    """Summarize working memory if it reaches capacity to prevent prompt bloat."""
    if len(agent.working_memory) >= WORKING_MEMORY_SIZE:
        prompt = build_working_memory_summary_prompt(agent)
        summary = compress_journal(prompt)
        if summary:
            agent.working_memory = [summary]
            if log is not None:
                log.log_event(tick, f"{agent.name} summarized their working memory.")


def update_beliefs_from_tile(agent, world):
    """Update agent beliefs based on what's on their current tile."""
    tile = world.grid[agent.y][agent.x]

    # Check for food on tile
    has_food = any(item.type == "food" for item in tile.items)
    coord_key = f"({agent.x}, {agent.y})"
    if has_food:
        belief = f"There is food near {coord_key}."
        agent.beliefs = [
            b for b in agent.beliefs
            if f"no food at {coord_key}" not in b
        ]
        if belief not in agent.beliefs:
            agent.add_belief(belief)
    else:
        had_food_belief = any(f"food near {coord_key}" in b for b in agent.beliefs)
        if had_food_belief:
            agent.beliefs = [
                b for b in agent.beliefs
                if f"food near {coord_key}" not in b
            ]
            agent.add_belief(f"There is no food at {coord_key}.")

    # Structure discovery
    if tile.structure:
        belief = f"{tile.structure.builder} built a {tile.structure.type} near {coord_key}."
        if belief not in agent.beliefs:
            agent.add_belief(belief)


def update_beliefs_from_agents(agent, world):
    """Update beliefs when encountering other agents nearby."""
    for other in world.agents:
        if other is agent:
            continue
        dist = abs(agent.x - other.x) + abs(agent.y - other.y)
        if dist > VIEW_RANGE:
            continue
        # Check if we already have a belief about this agent
        has_belief = any(other.name in b and "is " in b for b in agent.beliefs)
        if not has_belief:
            agent.add_belief(f"{other.name} is neutral.")
