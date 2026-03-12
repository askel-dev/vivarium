# Agent World - Proposed Improvements based on Log Analysis

After thoroughly analyzing the session logs (`session_20260312_195447.log` and `.jsonl`), I have identified several architectural and prompt-engineering improvements that will enhance agent behavior, reduce costs, and make the system much more efficient.

## 1. Implement Chain-of-Thought (CoT) Prompting
**Observation:** Currently, agents are strictly instructed: `"Respond with ONLY a JSON object. No other text."` The expected JSON schema only contains the action itself (e.g., `{"action": "pick_up", "item": "food"}`). 
**Issue:** This inherently prevents the LLM from reasoning about its situation before acting. Without reasoning tokens, the agents act purely on reactive instinct and often make suboptimal decisions. To debug agent behavior, developers have no idea *why* an agent did what it did.
**Improvement:** Update the expected JSON schema to require a `"thought"` or `"reasoning"` field *before* the action field.
```json
{
  "thought": "I am at 40 energy. I should eat now so I don't die. After that, I'll talk to the Wanderer.",
  "action": "eat"
}
```

## 2. Address the "Action Bottleneck" (Allow Multiple Actions)
**Observation:** The prompt states: `"You must choose ONE action each turn."`
**Issue:** Agents frequently receive hints like `"Hint: Nearby agents: Wanderer. Consider speaking to them."` However, because they must maintain their survival loop (moving and picking up food), they often ignore social interactions entirely because they cannot sacrifice a turn just to talk.
**Improvement:** Allow agents to perform multiple diverse actions per turn. For instance, an agent should be able to `move` and `speak` simultaneously.
Change the expected output format to support concurrent actions, e.g.:
```json
{
  "thought": "I will move north to grab the food and politely greet Guardian as I pass.",
  "move": {"direction": "north"},
  "speak": {"message": "Hello!", "volume": "talk"}
}
```

## 3. Reduce Prompt Context Bloat (Prompt Caching / Refactoring)
**Observation:** For every agent on every tick, the entire rulebook (`"Rules: - Check Adjacent tiles... Chop an adjacent tree..."`) is resent in the user prompt.
**Issue:** This leads to massive files sizes for logs, exorbitant token costs, and slower inference times as the simulation grows.
**Improvement:**
- Move all static instructions (Rules, World Description, Available Actions) into the **System Prompt**.
- Keep only the dynamic state (Time, Energy, Inventory, Perception, Memory) in the **User Message**.
- If the LLM provider supports Prompt Caching, this configuration maximizes cache hits because the system prompt will remain identical across ticks and agents.

## 4. Implement Working Memory Summarization
**Observation:** The `working_memory` list is growing unboundedly with repetitive actions (`["I moved north.", "I picked up food.", "I moved north.", "I moved north."]`).
**Issue:** Over long runs, this will blow up the prompt context window and distract the agent with irrelevant, overly detailed past steps.
**Improvement:** Implement a memory rolling/summarization mechanic. Once `working_memory` reaches N items (e.g., 10), summarize them into a single string (e.g., `"I spent the morning traveling north and collecting food."`) and flush the granular steps. Keep `recent_events` as an immediate short-term queue.

## 5. Optimize Log Formatting Constraints
**Observation:** The `session_*.log` human-readable file redundantly prints out the full `PROMPT SENT TO LLM` including the static rules for every tick.
**Improvement:** Only log the dynamic variables (`STATE SNAPSHOT`, `ACTION RESULT`, `REASONING`). You can log the system rules exactly once at the top of the log file. This will make the `.log` files immensely easier for a human to read.
