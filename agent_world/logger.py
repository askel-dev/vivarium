"""
Agent World Logger — records everything agents do, say, and think.

Logs are written to the `logs/` directory with timestamped filenames.
Each tick is clearly delimited, and every agent's prompt, LLM response,
action, speech, memory updates, and beliefs are captured.
"""

import json
import os
import time
from datetime import datetime


class AgentLogger:
    def __init__(self, log_dir="logs"):
        self.log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_path = os.path.join(log_dir, f"session_{timestamp}.log")
        self.json_path = os.path.join(log_dir, f"session_{timestamp}.jsonl")
        self._write_header()

    def _write_header(self):
        with open(self.log_path, "w", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write(f"  AGENT WORLD SESSION LOG — {datetime.now().isoformat()}\n")
            f.write("=" * 80 + "\n\n")

    def _append(self, text: str):
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(text)

    def _append_json(self, record: dict):
        with open(self.json_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # ------------------------------------------------------------------
    # Public API — call these from the main loop
    # ------------------------------------------------------------------

    def log_tick_start(self, tick: int, time_of_day: str, agent_count: int):
        self._append(f"\n{'=' * 80}\n")
        self._append(f"  TICK {tick}  |  Time: {time_of_day}  |  Agents alive: {agent_count}\n")
        self._append(f"{'=' * 80}\n")
        self._append_json({
            "event": "tick_start",
            "tick": tick,
            "time_of_day": time_of_day,
            "agents_alive": agent_count,
            "wall_clock": time.time(),
        })

    def log_prompt(self, agent_name: str, tick: int, prompt: str):
        self._append(f"\n--- {agent_name} | PROMPT SENT TO LLM ---\n")
        self._append(prompt + "\n")
        self._append_json({
            "event": "prompt",
            "tick": tick,
            "agent": agent_name,
            "prompt": prompt,
        })

    def log_llm_response(self, agent_name: str, tick: int, action_data: dict):
        self._append(f"\n--- {agent_name} | LLM RESPONSE ---\n")
        if "thought" in action_data:
            self._append(f"  Thought: {action_data['thought']}\n")
        
        # Log all action keys except thought
        for k, v in action_data.items():
            if k != "thought":
                self._append(f"  {k}: {v}\n")
                
        self._append_json({
            "event": "llm_response",
            "tick": tick,
            "agent": agent_name,
            "action_data": action_data,
        })

    def log_action_result(self, agent_name: str, tick: int, action_data: dict, results: list):
        self._append(f"\n--- {agent_name} | ACTION RESULT ---\n")
        for res in results:
            self._append(f"  Result: {res}\n")
            
        self._append_json({
            "event": "action_result",
            "tick": tick,
            "agent": agent_name,
            "action_data": action_data,
            "results": results,
        })

    def log_speech(self, speaker: str, tick: int, message: str, volume: str, heard_by: list):
        self._append(f"\n--- {speaker} | SPEECH ({volume}) ---\n")
        self._append(f"  \"{message}\"\n")
        self._append(f"  Heard by: {', '.join(heard_by) if heard_by else '(nobody)'}\n")
        self._append_json({
            "event": "speech",
            "tick": tick,
            "speaker": speaker,
            "volume": volume,
            "message": message,
            "heard_by": heard_by,
        })

    def log_memory_update(self, agent_name: str, tick: int, memory_type: str, content: str):
        """memory_type: 'working_memory', 'belief', 'journal'"""
        self._append(f"  [{agent_name}] +{memory_type}: {content}\n")
        self._append_json({
            "event": "memory_update",
            "tick": tick,
            "agent": agent_name,
            "memory_type": memory_type,
            "content": content,
        })

    def log_agent_state(self, agent, tick: int):
        self._append(f"\n--- {agent.name} | STATE SNAPSHOT ---\n")
        self._append(f"  Position: ({agent.x}, {agent.y})\n")
        self._append(f"  Energy:   {agent.energy}\n")
        self._append(f"  Inventory: {agent.inventory_string()}\n")
        self._append(f"  Beliefs:  {agent.beliefs}\n")
        self._append(f"  Working memory ({len(agent.working_memory)} items):\n")
        for wm in agent.working_memory:
            self._append(f"    - {wm}\n")
        self._append_json({
            "event": "agent_state",
            "tick": tick,
            "agent": agent.name,
            "x": agent.x,
            "y": agent.y,
            "energy": agent.energy,
            "inventory": dict(agent.inventory),
            "beliefs": list(agent.beliefs),
            "working_memory": list(agent.working_memory),
            "journal": list(agent.journal),
        })

    def log_death(self, agent_name: str, tick: int):
        self._append(f"\n  *** {agent_name} HAS DIED ***\n")
        self._append_json({
            "event": "death",
            "tick": tick,
            "agent": agent_name,
        })

    def log_journal_compression(self, agent_name: str, tick: int, summary: str):
        self._append(f"\n--- {agent_name} | JOURNAL COMPRESSED ---\n")
        self._append(f"  Summary: {summary}\n")
        self._append_json({
            "event": "journal_compression",
            "tick": tick,
            "agent": agent_name,
            "summary": summary,
        })

    def log_event(self, tick: int, message: str):
        self._append(f"  [EVENT] {message}\n")
        self._append_json({
            "event": "misc",
            "tick": tick,
            "message": message,
        })

    def log_tick_end(self, tick: int, events: list):
        self._append(f"\n--- TICK {tick} EVENTS SUMMARY ---\n")
        for e in events:
            self._append(f"  • {e}\n")
        self._append_json({
            "event": "tick_end",
            "tick": tick,
            "events": events,
        })

    def log_session_end(self, tick: int, reason: str):
        self._append(f"\n{'=' * 80}\n")
        self._append(f"  SESSION ENDED at tick {tick}: {reason}\n")
        self._append(f"{'=' * 80}\n")
        self._append_json({
            "event": "session_end",
            "tick": tick,
            "reason": reason,
        })


# Global singleton — import and use from anywhere
logger = AgentLogger()
