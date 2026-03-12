"""
Story generation — produces a narrative summary at the end of a simulation run.
Uses the Anthropic API (Claude Sonnet) for high-quality creative writing.
"""

import json
import os
import re

from config import STORY_MODEL, STORY_MAX_TOKENS, STORY_ENABLED

# Event types worth including in the narrative
HIGH_PRIORITY = {"death", "speech", "attack", "steal", "push", "kill_witness"}
MEDIUM_PRIORITY = {"build", "write_note", "journal_compression"}

# Keywords in action_result events that indicate hostile actions
HOSTILE_KEYWORDS = {"stole", "attacked", "pushed", "killed", "steal", "attack", "push"}

NARRATION_PROMPT = """\
You are a literary narrator. Write a short story (under 200 words) about what happened in a small survival world.

Write it as a narrative — atmospheric, character-driven, with dramatic tension. This is a story, not a summary or a report. Use vivid language. Pick the single most compelling thread (a betrayal, a rivalry, a desperate last stand, an unlikely alliance) and build the story around it. You don't need to mention every event — focus on what makes the best story.

Past tense, third person. No dialogue tags like "he said" — weave speech naturally into the narrative or paraphrase it.

The characters:
{character_block}

What happened:
{event_block}"""


def _classify_action_result(event: dict) -> str | None:
    """Check if an action_result event contains a hostile action by scanning text."""
    results_text = " ".join(str(r) for r in event.get("results", []))
    action_data = event.get("action_data", {})
    action_type = action_data.get("action", "")

    if action_type in ("steal", "attack", "push"):
        return action_type
    for keyword in HOSTILE_KEYWORDS:
        if keyword in results_text.lower():
            return keyword
    return None


def _load_events(event_log_path: str) -> list[dict]:
    """Load all events from the JSONL log file."""
    events = []
    with open(event_log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return events


def filter_events_for_story(events: list[dict]) -> list[dict]:
    """Filter events down to the narratively interesting ones."""
    high = []
    medium = []

    for e in events:
        event_type = e.get("event", "")

        if event_type in HIGH_PRIORITY:
            high.append(e)
        elif event_type in MEDIUM_PRIORITY:
            medium.append(e)
        elif event_type == "action_result":
            hostile = _classify_action_result(e)
            if hostile:
                e["_hostile_type"] = hostile
                high.append(e)

    filtered = high[:]

    remaining = 50 - len(filtered)
    if remaining > 0:
        filtered.extend(medium[:remaining])

    filtered.sort(key=lambda e: e.get("tick", 0))
    return filtered


def _format_event(e: dict) -> str:
    """Convert a single event dict into a human-readable line."""
    tick = e.get("tick", "?")
    event_type = e.get("event", "")

    if event_type == "death":
        return f"Tick {tick}: {e.get('agent', '?')} has died."

    if event_type == "speech":
        volume = e.get("volume", "says")
        speaker = e.get("speaker", "?")
        message = e.get("message", "")
        return f"Tick {tick}: {speaker} {volume}s: \"{message}\""

    if event_type == "journal_compression":
        return f"Tick {tick}: {e.get('agent', '?')} reflects: \"{e.get('summary', '')}\""

    if event_type == "action_result":
        agent = e.get("agent", "?")
        results = e.get("results", [])
        results_text = "; ".join(str(r) for r in results)
        return f"Tick {tick}: {agent} — {results_text}"

    if event_type == "build":
        agent = e.get("agent", "?")
        return f"Tick {tick}: {agent} built a structure."

    if event_type == "write_note":
        agent = e.get("agent", "?")
        return f"Tick {tick}: {agent} left a note."

    # Fallback
    agent = e.get("agent", e.get("speaker", "?"))
    return f"Tick {tick}: [{event_type}] {agent}"


def _build_character_block(agents_final_state: list[dict]) -> str:
    """Build the character description block for the narration prompt."""
    lines = []
    for a in agents_final_state:
        name = a["name"]
        archetype = a.get("personality_archetype", "unknown")
        traits = a.get("traits_summary", "")
        fate = a.get("fate", "unknown")

        if fate == "died":
            fate_str = f"Died at tick {a.get('death_tick', '?')}."
        else:
            fate_str = f"Survived (energy: {a.get('final_energy', '?')})."

        line = f"{name} — {archetype}. {traits} {fate_str}"
        lines.append(line)

    return "\n".join(lines)


def _build_event_block(filtered_events: list[dict]) -> str:
    """Build the event block for the narration prompt."""
    return "\n".join(_format_event(e) for e in filtered_events)


def generate_story(event_log_path: str, agents_final_state: list[dict]) -> str | None:
    """
    Generate a narrative summary of the simulation.

    agents_final_state: list of dicts with keys:
        name, personality_archetype, traits_summary, fate ("survived" or "died"),
        death_tick (if died), final_energy (if survived)
    """
    if not STORY_ENABLED:
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n[STORY] Set ANTHROPIC_API_KEY environment variable to enable end-of-run story generation.")
        return None

    # Load and filter events
    events = _load_events(event_log_path)
    filtered = filter_events_for_story(events)

    if not filtered:
        print("[STORY] No narratively interesting events found. Skipping story generation.")
        return None

    # Build prompt
    character_block = _build_character_block(agents_final_state)
    event_block = _build_event_block(filtered)
    prompt_text = NARRATION_PROMPT.format(
        character_block=character_block,
        event_block=event_block,
    )

    # Call Anthropic API
    try:
        from anthropic import Anthropic

        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model=STORY_MODEL,
            max_tokens=STORY_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt_text}],
        )
        return response.content[0].text
    except Exception as e:
        print(f"[STORY] API call failed: {e}")
        return None


def build_agent_summaries(world, dead_agents_record: list[dict]) -> list[dict]:
    """
    Build the agents_final_state list from world state and dead agent records.

    dead_agents_record: list of dicts with keys: name, personality, tick
    """
    summaries = []

    # Dead agents
    for record in dead_agents_record:
        personality_text = record["personality"]
        # First sentence is the archetype description
        archetype = personality_text.split(".")[0] + "." if "." in personality_text else personality_text
        # Traits are after the double newline
        traits = personality_text.split("\n\n", 1)[1] if "\n\n" in personality_text else ""

        summaries.append({
            "name": record["name"],
            "personality_archetype": archetype,
            "traits_summary": traits,
            "fate": "died",
            "death_tick": record["tick"],
        })

    # Surviving agents
    for agent in world.agents:
        archetype = agent.personality.split(".")[0] + "." if "." in agent.personality else agent.personality
        traits = agent.personality.split("\n\n", 1)[1] if "\n\n" in agent.personality else ""

        summaries.append({
            "name": agent.name,
            "personality_archetype": archetype,
            "traits_summary": traits,
            "fate": "survived",
            "final_energy": agent.energy,
        })

    return summaries
