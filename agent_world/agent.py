from dataclasses import dataclass, field
from config import STARTING_ENERGY, WORKING_MEMORY_SIZE, MAX_JOURNAL_ENTRIES, MAX_BELIEFS


@dataclass
class Agent:
    name: str
    personality: str          # Archetype description (2-3 sentences)
    x: int
    y: int
    energy: int = STARTING_ENERGY
    inventory: dict = field(default_factory=lambda: {"food": 0, "wood": 0, "stone": 0})

    # Memory
    working_memory: list = field(default_factory=list)    # Last 15 raw event strings
    journal: list = field(default_factory=list)           # Compressed summaries (most recent first)
    beliefs: list = field(default_factory=list)           # Persistent factual statements (max 10)

    # Tracking
    ticks_since_journal: int = 0

    def add_to_working_memory(self, event: str):
        # Skip consecutive duplicate events (e.g., repeated "I waited and rested.")
        if self.working_memory and self.working_memory[-1] == event:
            return
        self.working_memory.append(event)
        if len(self.working_memory) > WORKING_MEMORY_SIZE:
            self.working_memory.pop(0)

    def tick_journal_counter(self):
        """Increment journal counter once per tick (called from main loop)."""
        self.ticks_since_journal += 1

    def add_belief(self, belief: str):
        # Skip exact duplicates
        if belief in self.beliefs:
            return
        # Remove contradicting beliefs about the same subject/location
        # e.g., "There is food near (3,4)" vs "There is no food at (3,4)"
        import re
        coord_match = re.search(r'\(\d+,\s*\d+\)', belief)
        if coord_match:
            coord = coord_match.group()
            # Remove old beliefs about the same coordinate with same topic
            if "food" in belief:
                self.beliefs = [b for b in self.beliefs if coord not in b or "food" not in b]
            elif "built" in belief:
                self.beliefs = [b for b in self.beliefs if coord not in b or "built" not in b]

        # Social belief replacement: remove "X is neutral." when adding a negative belief about X
        negative_keywords = ("stole", "attacked", "killed", "dangerous", "thief", "aggressive")
        if any(kw in belief for kw in negative_keywords):
            self.beliefs = [
                b for b in self.beliefs
                if "is neutral" not in b or b.split(" is neutral")[0] not in belief
            ]

        self.beliefs.append(belief)
        if len(self.beliefs) > MAX_BELIEFS:
            self.beliefs.pop(0)

    def add_journal_entry(self, entry: str):
        self.journal.insert(0, entry)
        if len(self.journal) > MAX_JOURNAL_ENTRIES:
            self.journal.pop()
        self.ticks_since_journal = 0

    def inventory_string(self) -> str:
        parts = [f"{k}: {v}" for k, v in self.inventory.items() if v > 0]
        return ", ".join(parts) if parts else "nothing"

    def is_in_shelter(self, world) -> bool:
        from world import Structure
        tile = world.grid[self.y][self.x]
        return tile.structure is not None and tile.structure.type == "shelter"
