# Agent World — Using Logs to Improve the Simulation

## Log Files

Each session produces two files in the `logs/` directory:

- **`session_*.log`** — Human-readable, formatted log. Open in any text editor.
- **`session_*.jsonl`** — Machine-readable, one JSON object per line. Use for scripting/analysis.

Run with `--log-dir <path>` to change the output directory.

---

## What to Look For

### 1. LLM Response Quality

**Where:** Search for `LLM RESPONSE` blocks in the `.log` file.

**Problems to catch:**
- Agent returns `{"wait": {}}` repeatedly — the LLM is confused or the prompt is too complex.
- Invalid actions (look for `[INVALID]` in event summaries) — the LLM is hallucinating actions or misusing parameters.
- JSON parse failures (search for `LLM WARN` in console output) — the model isn't following the JSON-only instruction.

**How to fix:**
- If agents wait too often, simplify the prompt in `prompts.py` or give more explicit examples.
- If a specific action is consistently malformed, add an example of correct usage to `SYSTEM_PROMPT`.
- If JSON parsing fails frequently, try a different model (`config.py` → `MODEL_NAME`) or lower the temperature.

### 2. Agent Decision-Making

**Where:** Compare the `PROMPT SENT TO LLM` with the `Thought:` block and `LLM RESPONSE` actions for the same agent/tick. The `Thought` block (Chain-of-Thought) is your best debugging tool!

**Problems to catch:**
- Agent ignores visible food while starving — its `Thought` block might reveal it doesn't understand its energy level.
- Agent walks into walls repeatedly — its `Thought` block might show it failed to read the "Adjacent tiles" state.
- Agent never speaks or cooperates — personality prompt may be too vague, or it thinks survival is too critical to spend a turn talking.

**How to fix:**
- Check the `RIGHT NOW` section of the prompt. Is energy/inventory clearly visible?
- Check the `You see:` perception block. Are nearby items/agents/structures listed clearly?
- Revise personality descriptions in `world.py` agent generation to encourage specific behaviors.

### 3. Memory System Effectiveness

**Where:** Look at `STATE SNAPSHOT` blocks — specifically the `Beliefs` and `Working memory` fields.

**Problems to catch:**
- Beliefs list fills up with stale or contradictory entries (e.g., "food near (3,4)" and "no food at (3,4)" coexisting).
- Working memory is cluttered with repetitive "I waited and rested" entries.
- Journal compressions (`JOURNAL COMPRESSED`) lose critical information.

**How to fix:**
- Improve belief deduplication logic in `memory.py` → `update_beliefs_from_tile`.
- Filter out low-value events before adding to working memory (e.g., skip logging consecutive waits).
- The system automatically triggers `maybe_summarize_working_memory` when short-term memory gets full. If agents get confused by their summaries, tweak the summarization prompt.
- Tune `JOURNAL_TRIGGER` in `config.py` — too frequent = shallow summaries, too rare = long fragmented journals.
- Increase `MAX_BELIEFS` if agents forget important landmarks too fast.

### 4. Communication & Social Behavior

**Where:** Search for `SPEECH` blocks in the log.

**Problems to catch:**
- Agents shout meaningless or repetitive messages.
- Speech is never heard (check `Heard by: (nobody)`) — agents are too far apart.
- Agents don't respond to what others say — incoming speech isn't influencing decisions.

**How to fix:**
- If nobody hears speech, increase `SHOUT_RANGE`/`TALK_RANGE` in `config.py` or make the map smaller.
- If agents ignore speech, check that incoming messages appear in the `RECENT EVENTS` section of their prompt.
- If speech content is low quality, add guidance in `SYSTEM_PROMPT` about when/what to communicate.

### 5. Energy & Survival Balance

**Where:** Track `Energy:` values in `STATE SNAPSHOT` across ticks. Watch for `HAS DIED` entries.

**Problems to catch:**
- All agents die within the first 20-30 ticks — energy drains too fast or food is too scarce.
- Agents never drop below 80 energy — no survival pressure, simulation is too easy.
- Agents die despite having food in inventory — they never choose to eat.

**How to fix:**
- Adjust `ENERGY_DRAIN_PER_TICK`, `ENERGY_FROM_FOOD`, `ENERGY_FROM_WAIT` in `config.py`.
- Change `INITIAL_FOOD_COUNT` or `FOOD_CLUSTER_CHANCE` to control food availability.
- If agents don't eat, make the energy warning more prominent in the prompt (e.g., "WARNING: low energy!").

### 6. World Exploration & Building

**Where:** Follow agent positions in `STATE SNAPSHOT` and `ACTION RESULT` blocks.

**Problems to catch:**
- Agents cluster in one corner and never explore.
- Agents never build anything — they don't gather resources or don't understand build commands.
- Agents destroy each other's structures pointlessly.

**How to fix:**
- If agents don't explore, add exploration incentives to personality descriptions.
- If agents don't build, check that `BUILD_COSTS` in `actions.py` are achievable with available resources.
- If agents need more direction, add goals or hints to the prompt (e.g., "building shelter protects you at night").

---

## Quick Analysis Scripts

### Count actions per agent (PowerShell)
```powershell
Get-Content logs/session_*.jsonl | ConvertFrom-Json |
  Where-Object { $_.event -eq "action_result" } |
  Group-Object agent | Select-Object Name, Count
```

### Count actions per agent (bash + jq)
```bash
cat logs/session_*.jsonl | jq -r 'select(.event=="action_result") | .agent' | sort | uniq -c | sort -rn
```

### Find all invalid actions
```bash
cat logs/session_*.jsonl | jq 'select(.event=="action_result") | select(.results | join(" ") | test("INVALID"))'
```

### Track energy over time for a specific agent
```bash
cat logs/session_*.jsonl | jq 'select(.event=="agent_state" and .agent=="Ada") | {tick, energy}'
```

### List all speech and who heard it
```bash
cat logs/session_*.jsonl | jq 'select(.event=="speech") | {tick, speaker, message, volume, heard_by}'
```

### Count how often each action type is chosen
```bash
cat logs/session_*.jsonl | jq -r 'select(.event=="action_result") | .action_data | keys[]' | sort | uniq -c | sort -rn
```

---

## Iterative Improvement Workflow

1. **Run a session** — let it go for 50-100 ticks.
2. **Skim the `.log` file** — look for obvious problems (deaths, repeated waits, invalid actions).
3. **Run analysis scripts** — get quantitative data on action distribution, survival rates, speech frequency.
4. **Identify the biggest issue** — pick one thing to fix per iteration.
5. **Make a targeted change** — adjust config values, prompt wording, or game logic.
6. **Run again and compare** — check if the metric improved without breaking something else.

Keep old log files around to compare across versions. The JSONL format makes it easy to diff behavior between runs.
