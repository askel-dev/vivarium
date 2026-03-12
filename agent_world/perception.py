from config import VIEW_RANGE


_DIR_NAMES = {
    (0, -1): "north", (0, 1): "south",
    (1, 0): "east", (-1, 0): "west",
    (1, -1): "northeast", (-1, -1): "northwest",
    (1, 1): "southeast", (-1, 1): "southwest",
}


def _direction_label(dx: int, dy: int) -> str:
    if dx == 0 and dy == 0:
        return "here"
    sx = 0 if dx == 0 else (1 if dx > 0 else -1)
    sy = 0 if dy == 0 else (1 if dy > 0 else -1)
    return _DIR_NAMES.get((sx, sy), f"({dx},{dy})")


def _adjacent_movement_info(agent, world) -> str:
    """Show which adjacent directions are passable or blocked."""
    from actions import DIRECTION_OFFSETS
    parts = []
    for direction, (dx, dy) in DIRECTION_OFFSETS.items():
        nx, ny = agent.x + dx, agent.y + dy
        if not world.in_bounds(nx, ny):
            parts.append(f"  {direction}: blocked (world edge)")
        else:
            tile = world.grid[ny][nx]
            if tile.is_walkable():
                items_here = [item.type for item in tile.items]
                other = world.get_agent_at(nx, ny)
                extras = []
                if items_here:
                    extras.append(", ".join(items_here))
                if other:
                    extras.append(other.name)
                suffix = f" — contains {', '.join(extras)}" if extras else ""
                parts.append(f"  {direction}: open (grass{suffix})")
            else:
                blocker = tile.terrain if tile.terrain in ("water", "tree") else "wall"
                parts.append(f"  {direction}: blocked ({blocker})")
    return "\n".join(parts)


def build_perception(agent, world) -> str:
    lines = []
    heard_speech = getattr(agent, "_pending_speech", [])

    # Adjacent movement summary (most important for decision-making)
    lines.append("Adjacent tiles:")
    lines.append(_adjacent_movement_info(agent, world))

    # Scan view range (skip adjacent tiles since already covered above)
    for dy in range(-VIEW_RANGE, VIEW_RANGE + 1):
        for dx in range(-VIEW_RANGE, VIEW_RANGE + 1):
            if dx == 0 and dy == 0:
                continue
            dist = abs(dx) + abs(dy)
            if dist <= 1:
                continue  # already shown in adjacent tiles section
            tx, ty = agent.x + dx, agent.y + dy
            if not world.in_bounds(tx, ty):
                continue
            tile = world.grid[ty][tx]
            notable = []

            if tile.structure:
                notable.append(f"{tile.structure.type} (built by {tile.structure.builder})")
            for item in tile.items:
                qty = f" (x{item.quantity})" if item.quantity > 1 else ""
                notable.append(f"{item.type}{qty}")
            other = world.get_agent_at(tx, ty)
            if other:
                notable.append(f"{other.name}")
            if tile.notes:
                notable.append(f"a note by {tile.notes[-1].author}")

            if notable:
                direction = _direction_label(dx, dy)
                dist_str = f"{dist} tiles away"
                lines.append(f"To the {direction} ({dist_str}): {', '.join(notable)}")

    # Current tile
    tile = world.grid[agent.y][agent.x]
    on_tile = []
    if tile.structure:
        on_tile.append(f"a {tile.structure.type} (built by {tile.structure.builder})")
    for item in tile.items:
        qty = f" (x{item.quantity})" if item.quantity > 1 else ""
        on_tile.append(f"{item.type}{qty}")
    for note in tile.notes:
        on_tile.append(f"a note from {note.author}: '{note.content}'")
    if on_tile:
        lines.append(f"On your tile: {', '.join(on_tile)}")

    # Add heard speech
    for speech in heard_speech:
        lines.append(f"[Heard] {speech}")

    return "\n".join(lines) if lines else "Nothing notable nearby."


def read_notes_on_tile(agent, world) -> list[str]:
    """Returns working memory events for notes on the current tile."""
    tile = world.grid[agent.y][agent.x]
    events = []
    for note in tile.notes:
        events.append(f"I read a note from {note.author}: '{note.content}'")
    return events
