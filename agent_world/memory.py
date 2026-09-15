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
        # Only add neutral belief if we have NO beliefs about this agent at all
        has_belief = any(other.name in b for b in agent.beliefs)
        if not has_belief:
            agent.add_belief(f"{other.name} is neutral.")


# ---------------------------------------------------------------------------
# Social relations
# ---------------------------------------------------------------------------

# Beliefs about other agents are free-text, but they are written by a small
# fixed set of call sites (actions._steal, _attack, _handle_death,
# _notify_witnesses, update_beliefs_from_agents), so keyword classification is
# reliable here rather than a guess at arbitrary prose.
_HOSTILE_MARKERS = (
    "killed", "attacked me", "stole from me", "thief",
    "dangerous", "is aggressive", "pushed me",
)
_WARY_MARKERS = ("saw", "witnessed", "lied", "cannot be trusted", "untrustworthy")
_POSITIVE_MARKERS = ("helped me", "gave me", "shared", "saved me", "ally", "trust")


def classify_belief(text: str) -> str | None:
    """Classify one belief string as a sentiment toward another agent."""
    low = text.lower()
    if any(m in low for m in _HOSTILE_MARKERS):
        return "hostile"
    if any(m in low for m in _POSITIVE_MARKERS):
        return "positive"
    if any(m in low for m in _WARY_MARKERS):
        return "wary"
    if "is neutral" in low:
        return "neutral"
    return None


def derive_relations(agent, world) -> dict:
    """
    Derive {other_agent_name: sentiment} from this agent's beliefs.

    Hostile outranks wary outranks positive outranks neutral, so a single
    betrayal isn't washed out by later neutral observations.
    """
    rank = {"neutral": 0, "positive": 1, "wary": 2, "hostile": 3}
    names = [a.name for a in world.agents if a.name != agent.name]
    relations: dict[str, str] = {}

    for belief in agent.beliefs:
        for other in names:
            if other not in belief:
                continue
            sentiment = classify_belief(belief)
            if sentiment is None:
                continue
            current = relations.get(other)
            if current is None or rank[sentiment] > rank[current]:
                relations[other] = sentiment

    return relations


def build_relation_edges(world) -> list:
    """World-level edge list for the frontend's social overlay."""
    edges = []
    for agent in world.agents:
        for other, sentiment in derive_relations(agent, world).items():
            if sentiment == "neutral":
                continue
            edges.append({"from": agent.name, "to": other, "sentiment": sentiment})
    return edges
