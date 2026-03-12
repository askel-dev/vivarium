import os
import sys
from io import StringIO

from rich.console import Console, Group
from rich.text import Text

# Enable VT100 escape sequences on Windows 10+ (avoids cls flash)
if sys.platform == "win32":
    os.system("")

console = Console()

# Agent colors (cycling)
AGENT_COLORS = ["bright_white", "bright_cyan", "bright_yellow", "bright_magenta", "bright_green", "bright_red"]

TERRAIN_SYMBOLS = {
    "grass": (".", "green"),
    "water": ("~", "blue"),
    "tree":  ("T", "dark_green"),
    "stone": ("^", "bright_black"),
}

STRUCTURE_SYMBOLS = {
    "wall":     ("#", "white"),
    "campfire": ("*", "yellow"),
    "shelter":  ("H", "dark_orange"),
    "bridge":   ("=", "cyan"),
    "marker":   ("!", "magenta"),
}

TIME_COLORS = {
    "morning": "bright_cyan",
    "midday": "bright_yellow",
    "afternoon": "yellow",
    "evening": "magenta",
    "night": "blue"
}

def _agent_color(agent, all_agents):
    idx = all_agents.index(agent) % len(AGENT_COLORS)
    return AGENT_COLORS[idx]


def render(world, event_log: list, tick: int, show_profiles: bool = False):
    all_agents = world.agents
    agent_map = {(a.x, a.y): a for a in all_agents}

    parts = []

    time_color = TIME_COLORS.get(world.time_of_day, "white")
    time_str = f"[{time_color}]{world.time_of_day.capitalize()}[/{time_color}]"

    # Header
    parts.append(Text.from_markup(
        f"[bold]Agent World[/bold]  [dim]Tick {tick} | [/dim]{time_str}"
    ))

    if show_profiles:
        parts.append(Text(""))
        parts.append(Text.from_markup("[bold]Agent Profiles[/bold]"))
        parts.append(Text("─" * 50))
        for agent in all_agents:
            color = _agent_color(agent, all_agents)
            parts.append(Text.from_markup(f"[{color}][bold]{agent.name}[/bold][/{color}]"))
            parts.append(Text(f"  {agent.personality}"))
            parts.append(Text(""))
        parts.append(Text("─" * 50))
        parts.append(Text.from_markup("[dim]Press 'p' to return to map view[/dim]"))
    else:
        # Grid top border
        parts.append(Text("┌" + "─" * (world.width * 2 + 1) + "┐"))

        # Build grid rows
        for y in range(world.height):
            row = Text("│ ")
            for x in range(world.width):
                tile = world.grid[y][x]
                agent = agent_map.get((x, y))
                if agent:
                    color = _agent_color(agent, all_agents)
                    row.append(agent.name[0], style=f"bold {color}")
                elif tile.structure:
                    sym, color = STRUCTURE_SYMBOLS.get(tile.structure.type, ("?", "white"))
                    row.append(sym, style=color)
                elif any(item.type == "food" for item in tile.items):
                    row.append("f", style="red")
                elif any(item.type == "wood" for item in tile.items):
                    row.append("w", style="dark_orange")
                elif any(item.type == "stone" for item in tile.items):
                    row.append("s", style="bright_black")
                elif tile.notes:
                    row.append("n", style="bright_blue")
                else:
                    sym, color = TERRAIN_SYMBOLS.get(tile.terrain, ("?", "white"))
                    row.append(sym, style=color)
                row.append(" ")
            row.append("│")
            parts.append(row)

        # Grid bottom border
        parts.append(Text("└" + "─" * (world.width * 2 + 1) + "┘"))
        parts.append(Text(""))

        # Event log
        parts.append(Text.from_markup(
            f"[bold dim][Tick {tick} | [/bold dim]{time_str}[bold dim]][/bold dim]"
        ))
        
        # Highlight items
        item_colors = {
            "food": "red",
            "wood": "dark_orange",
            "stone": "bright_black"
        }
        
        for entry in event_log[-15:]:
            styled_entry = entry
            # Colorize agents
            for agent in all_agents:
                if agent.name in styled_entry:
                    color = _agent_color(agent, all_agents)
                    styled_entry = styled_entry.replace(agent.name, f"[bold {color}]{agent.name}[/bold {color}]")
            
            # Colorize structure symbols
            for struct, (sym, color) in STRUCTURE_SYMBOLS.items():
                if struct in styled_entry:
                    styled_entry = styled_entry.replace(struct, f"[{color}]{struct}[/{color}]")
                    
            # Colorize items
            for item, color in item_colors.items():
                if item in styled_entry:
                    styled_entry = styled_entry.replace(item, f"[{color}]{item}[/{color}]")
                    
            if "stole" in styled_entry or "attacked" in styled_entry or "pushed" in styled_entry:
                styled_entry = f"[bold bright_red]{styled_entry}[/bold bright_red]"
            elif "died" in styled_entry or "perished" in styled_entry or "drowned" in styled_entry or "killed" in styled_entry:
                styled_entry = f"[bold red]{styled_entry}[/bold red]"
                
            parts.append(Text.from_markup(f"  {styled_entry}"))
        parts.append(Text(""))

        # Agent status
        parts.append(Text.from_markup("[bold]Agents:[/bold]"))
        for agent in all_agents:
            color = _agent_color(agent, all_agents)
            energy_color = "green" if agent.energy > 70 else "yellow" if agent.energy > 30 else "red"
            energy_bar = "♥" * (agent.energy // 10) + "·" * (10 - agent.energy // 10)
            inv = agent.inventory_string()
            parts.append(Text.from_markup(
                f"  [{color}]{agent.name:<12}[/{color}] "
                f"[{energy_color}]{energy_bar}[/{energy_color}] {agent.energy:3}/100  |  {inv}"
            ))
        parts.append(Text(""))

    # Render entire frame to buffer, then blast to screen in one write
    buf = StringIO()
    buf_console = Console(file=buf, force_terminal=True, width=console.width)
    buf_console.print(Group(*parts))
    frame = buf.getvalue()

    # Move cursor to home + clear screen via VT100 (no cls flash)
    sys.stdout.write("\033[H\033[2J")
    sys.stdout.write(frame)
    sys.stdout.flush()


def log_only(world, event_log: list, tick: int, show_profiles: bool = False):
    """Simple text output for --no-display mode."""
    print(f"\n[Tick {tick} | {world.time_of_day}]")
    for entry in event_log[-5:]:
        print(f"  {entry}")
