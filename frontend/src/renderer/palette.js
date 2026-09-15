/**
 * palette.js — the single source of truth for agent and world colours.
 *
 * Previously the canvas picked agent colours by array index, so every agent's
 * hue reshuffled the moment one died, and the archetype table was keyed on
 * names the backend never produces. Colours are now derived from the agent's
 * name, which is stable for the life of the world.
 */

/** The seven archetypes world.py actually generates. */
const ARCHETYPE_COLORS = {
  Scavenger: "#ff6b6b", // red — desperate forager
  Warden:    "#54a0ff", // blue — keeper of order
  Wanderer:  "#feca57", // yellow — restless traveller
  Schemer:   "#bd93f9", // purple — plotter
  Protector: "#50fa7b", // green — shield
  Predator:  "#ee5a24", // orange — hunter
  Ghost:     "#a4b0be", // pale grey — the quiet one
};

/** Fallback ramp for any name not in the table above. */
const FALLBACK_PALETTE = [
  "#48dbfb", "#ff9ff3", "#01a3a4", "#f1fa8c", "#ff79c6", "#8be9fd",
];

/** Terrain type -> base fill colour. */
const TERRAIN_COLORS = {
  grass: "#3a5a1c",
  water: "#1e4a94",
  tree:  "#2d4a0f",
  stone: "#7c7c88",
};
const TERRAIN_DEFAULT = "#222222";

/** All five buildable structures (BUILD_COSTS in actions.py). */
const STRUCTURE_COLORS = {
  wall:     "#8d8d96",
  campfire: "#ff8c42",
  shelter:  "#b5822e",
  bridge:   "#9c6b3f",
  marker:   "#c9b6e4",
};
const STRUCTURE_DEFAULT = "#999999";

const ITEM_COLORS = {
  food:  "#50fa7b",
  wood:  "#c69c6d",
  stone: "#cdcdd6",
};

/** Event type -> colour, shared by the canvas floaters and the event log. */
const EVENT_COLORS = {
  attack:  "#ff5555",
  steal:   "#ffb86c",
  push:    "#ff79c6",
  death:   "#ff3333",
  speak:   "#8be9fd",
  build:   "#f1fa8c",
  destroy: "#ff8c42",
  write:   "#ffffe0",
  eat:     "#50fa7b",
  pick_up: "#50fa7b",
  chop:    "#c69c6d",
  move:    "#8892a6",
  wait:    "#6b7280",
  invalid: "#5a6070",
};
const EVENT_COLOR_DEFAULT = "#8892a6";

/** Sentiment -> colour for the social overlay. */
const RELATION_COLORS = {
  hostile:  "#ff5555",
  wary:     "#ffb86c",
  positive: "#50fa7b",
};

/** Deterministic hash so a name always maps to the same fallback hue. */
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Stable colour for an agent, by name.
 * @param {string} name
 */
function colorForAgent(name) {
  if (!name) return EVENT_COLOR_DEFAULT;
  if (ARCHETYPE_COLORS[name]) return ARCHETYPE_COLORS[name];
  return FALLBACK_PALETTE[hashName(name) % FALLBACK_PALETTE.length];
}

function colorForEvent(type) {
  return EVENT_COLORS[type] || EVENT_COLOR_DEFAULT;
}

/** Convert a 0..1 alpha to a 2-char hex suffix for appending to a #rrggbb. */
function hexAlpha(a) {
  return Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, "0");
}

export {
  ARCHETYPE_COLORS,
  TERRAIN_COLORS,
  TERRAIN_DEFAULT,
  STRUCTURE_COLORS,
  STRUCTURE_DEFAULT,
  ITEM_COLORS,
  EVENT_COLORS,
  RELATION_COLORS,
  colorForAgent,
  colorForEvent,
  hashName,
  hexAlpha,
};
