import os
import sys

# Ensure we're in the right directory to import story
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from story import generate_story

log_path = "logs/session_20260915_201317.jsonl"
final_states = [
    {"name": "Ghost", "personality_archetype": "Ghost", "traits_summary": "Unseen observer", "fate": "survived", "final_energy": 50},
    {"name": "Protector", "personality_archetype": "Protector", "traits_summary": "Guardian", "fate": "survived", "final_energy": 50},
    {"name": "Predator", "personality_archetype": "Predator", "traits_summary": "Aggressive hunter", "fate": "survived", "final_energy": 50},
    {"name": "Wanderer", "personality_archetype": "Wanderer", "traits_summary": "Nomadic explorer", "fate": "survived", "final_energy": 50},
]

story = generate_story(log_path, final_states)
print("=== STORY OUTPUT ===")
print(story)
