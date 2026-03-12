# Story Generation — End-of-Run Narrative Summary

## Overview

After a simulation ends (all agents dead or user quits), generate a short, high-quality narrative summary of what happened. The story is written by a more capable model (Anthropic API via Claude Sonnet) since the local 8B model lacks the creative writing quality we want.

This is a single API call at the end of a run — not a per-tick cost.

---

## Setup

### Dependencies

Add `anthropic` to requirements:
```
pip install anthropic
```

### API key

Read from environment variable `ANTHROPIC_API_KEY`. If not set, skip story generation gracefully and print a message telling the user they can set it to enable story generation.

### Config additions (config.py)

```python
# Story generation
STORY_MODEL = "claude-sonnet-4-20250514"
STORY_ENABLED = True  # Set False to disable
STORY_MAX_TOKENS = 400
```

---

## Event filtering

Don't send the entire event log. Filter to only the events that matter narratively.

### High-priority events (always include)
- Agent deaths
- Attacks, steals, pushes (all hostile actions)
- Speech (all volumes)
- Witnessing hostile actions ("I saw X attack Y")
- Agent killing another agent

### Medium-priority events (include if space allows)
- Building structures
- Writing notes
- Journal compression summaries (these are already narratively condensed)
- First time two agents are near each other (first encounter)

### Low-priority events (exclude)
- Movement
- Picking up items
- Eating
- Waiting
- Chopping trees
- Routine belief updates

### Implementation

Filter the JSONL event log (already written by `logger.py`) by event type. Keep approximately 30-50 events max. If there are more high-priority events than that, keep the most recent ones plus all deaths.

```python
HIGH_PRIORITY = {"death", "speech", "attack", "steal", "push", "kill_witness"}
MEDIUM_PRIORITY = {"build", "write_note", "journal_compression"}

def filter_events_for_story(events: list[dict]) -> list[dict]:
    high = [e for e in events if e.get("event") in HIGH_PRIORITY]
    medium = [e for e in events if e.get("event") in MEDIUM_PRIORITY]
    
    # Always keep all high priority
    filtered = high
    
    # Add medium until we hit ~50 events
    remaining = 50 - len(filtered)
    if remaining > 0:
        filtered.extend(medium[:remaining])
    
    # Sort chronologically
    filtered.sort(key=lambda e: e.get("tick", 0))
    return filtered
```

Note: you'll need to tag hostile action events more specifically in `logger.py` or `actions.py` so they're filterable. Currently they're all logged as `"action_result"`. Either:
- Add a sub-type field to action_result events: `"action_type": "steal"` 
- Or filter by scanning the `results` text for keywords like "stole", "attacked", "pushed"

The keyword scanning approach is simpler and doesn't require changing the logger.

---

## Narration prompt

```
You are a literary narrator. Write a short story (under 200 words) about what happened in a small survival world. 

Write it as a narrative — atmospheric, character-driven, with dramatic tension. This is a story, not a summary or a report. Use vivid language. Pick the single most compelling thread (a betrayal, a rivalry, a desperate last stand, an unlikely alliance) and build the story around it. You don't need to mention every event — focus on what makes the best story.

Past tense, third person. No dialogue tags like "he said" — weave speech naturally into the narrative or paraphrase it.

The characters:
{character_block}

What happened:
{event_block}
```

### Character block format

One line per agent. Include personality archetype (not the full prompt), randomized traits summary, and fate.

```
Scavenger — a ruthless opportunist who lies and steals to survive. Panics early, holds grudges, avoids others. Died at tick 67.
Protector — a naive idealist who trusts too easily and hates thieves. Calm under pressure, forgiving, social. Survived (energy: 34).
```

Keep each character description to one sentence of personality + one sentence of traits + fate. The narrator doesn't need the full personality prompt — just enough to voice them correctly.

### Event block format

Convert filtered events to simple readable lines. Strip JSON structure, make them human-readable:

```
Tick 12: Scavenger stole food from Wanderer.
Tick 12: Protector saw Scavenger steal from Wanderer.
Tick 15: Protector shouts: "Scavenger is a thief! Stay away from them!"
Tick 23: Scavenger whispers to Schemer: "Help me take Protector's food."
Tick 31: Scavenger attacked Protector. Protector lost 20 energy.
Tick 32: Protector attacked Scavenger. Scavenger lost 20 energy.
Tick 45: Warden built a wall at (7, 3).
Tick 67: Scavenger has died.
```

---

## Implementation

### New file: `story.py`

```python
import os
from config import STORY_MODEL, STORY_MAX_TOKENS, STORY_ENABLED


def generate_story(world, event_log_path: str, agents_final_state: list[dict]) -> str | None:
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
        print("[STORY] Set ANTHROPIC_API_KEY environment variable to enable story generation.")
        return None
    
    # 1. Load and filter events from JSONL log
    # 2. Build character block and event block
    # 3. Call Anthropic API
    # 4. Return the story text
    ...
```

### Integration point: `main.py`

After the simulation ends (after `log.log_session_end`), call story generation:

```python
# After simulation loop ends
story = generate_story(world, log.json_path, build_agent_summaries(world))
if story:
    story_path = log.json_path.replace(".jsonl", "_story.txt")
    with open(story_path, "w") as f:
        f.write(story)
    print(f"\n{'='*50}")
    print("THE STORY OF THIS WORLD")
    print(f"{'='*50}\n")
    print(story)
    print(f"\nSaved to {story_path}")
```

### Tracking agent fate

You need to track which agents died and when, including agents already removed from `world.agents`. Options:
- Keep a `dead_agents` list in the main loop (simplest — you already have `dead_agents` in the tick loop, just persist it)
- Or scan the JSONL log for death events after the simulation

The first approach is simpler. Keep a running list:

```python
all_agents_fate = {}  # name -> {"died": bool, "tick": int, "personality": str, ...}
```

Update it when agents die, and fill in survivors at the end.

---

## Output

The story gets:
1. Printed to terminal after the simulation ends (with a nice header)
2. Saved to `logs/session_*_story.txt` alongside the other log files

---

## Example output

What a good 200-word story might look like (for reference, not a template):

> The world was quiet when it began. Six strangers on a grid of grass and water, each driven by something different — hunger, ambition, fear.
>
> It was Scavenger who drew first blood. On the twelfth morning, she slipped behind Wanderer and took his last food. Protector saw it happen. Within minutes, his voice carried across the valley: *Scavenger is a thief.*
>
> The accusation split the world in two. Warden, already stacking walls in the north, sealed his territory tighter. Ghost vanished into the southern marshes. But Schemer — Schemer listened when Scavenger came whispering with a proposition.
>
> The alliance was short-lived. When Protector cornered Scavenger near the river on the thirty-first day, the fight cost them both dearly. Schemer watched from three tiles away and did nothing.
>
> Scavenger died on a Tuesday. Energy spent, inventory empty, curled against a wall that Warden had built to keep her out. No one mourned her.
>
> Protector survived, but barely — 34 energy and a belief list full of names he'd never trust again. Warden still patrolled his walls. Ghost was never seen.
>
> The notes Scavenger left near the river were all lies.

---

## Notes for Claude Code

- This is a self-contained feature. The only files that need changes are: new `story.py`, minor additions to `main.py` (call story generation at end), and `config.py` (new constants).
- Don't modify the existing logger or event system. Read from the JSONL file that's already being written.
- Graceful degradation: if no API key, if the API call fails, if events are empty — handle all of these cleanly. The simulation should never crash because story generation failed.
- The Anthropic Python SDK uses: `from anthropic import Anthropic` then `client = Anthropic(api_key=key)` then `client.messages.create(model=..., max_tokens=..., messages=[...])`.
