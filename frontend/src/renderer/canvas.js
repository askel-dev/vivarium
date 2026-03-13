/**
 * Canvas Renderer — runs the requestAnimationFrame render loop,
 * completely decoupled from the WebSocket tick rate.
 *
 * Draws terrain, structures, items, agents (with interpolation),
 * floating name labels, day/night compositing, hover effects,
 * and gravestone icons for dead agents.
 */

import { getState, update } from "../store.js";
import { attach as attachCamera, applyTransform, resetTransform, screenToWorld, wasDrag } from "./camera.js";
import { getInterpolatedAgents } from "./interpolate.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE_SIZE = 32;

/** Terrain type → fill color */
const TERRAIN_COLORS = {
  grass: "#3a5a1c",
  water: "#2255aa",
  tree: "#2d4a0f",
  stone: "#888888",
};
const TERRAIN_DEFAULT = "#222222";

/** Structure type → fill color */
const STRUCTURE_COLORS = {
  shelter: "#8b6914",
  wall: "#777777",
};

/** Item type → small indicator color */
const ITEM_COLORS = {
  food: "#50fa7b",
  wood: "#c69c6d",
  stone: "#aaaaaa",
};

/**
 * Consistent palette for agents.  Colours are assigned by index so each
 * agent always gets the same hue within a session.
 */
const AGENT_PALETTE = [
  "#ff6b6b", // red
  "#48dbfb", // cyan
  "#feca57", // yellow
  "#ff9ff3", // pink
  "#54a0ff", // blue
  "#5f27cd", // purple
  "#01a3a4", // teal
  "#ee5a24", // orange
];

// ---------------------------------------------------------------------------
// Day / Night tint colors (spec §Visual Design)
// ---------------------------------------------------------------------------

const TIME_TINTS = {
  morning:   "#FFEDB3",
  midday:    "#FFFFFF",
  afternoon: "#FFB86C",
  evening:   "#8BE9FD",
  night:     "#1E1E3F",
};
const TIME_TINT_DEFAULT = "#FFFFFF";

// ---------------------------------------------------------------------------
// Archetype label colors — distinct per personality archetype
// ---------------------------------------------------------------------------

const ARCHETYPE_COLORS = {
  Builder:    "#feca57",  // warm yellow
  Protector:  "#54a0ff",  // sky blue
  Scavenger:  "#ff6b6b",  // red
  Healer:     "#50fa7b",  // green
  Explorer:   "#ff9ff3",  // pink
  Diplomat:   "#48dbfb",  // cyan
  Trickster:  "#ee5a24",  // orange
  Scholar:    "#a29bfe",  // lavender
};
const ARCHETYPE_COLOR_DEFAULT = "#cccccc";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLCanvasElement} */
let canvas;
/** @type {CanvasRenderingContext2D} */
let ctx;

/** Tracked mouse world-space position for hover detection */
let mouseWorldX = -1;
let mouseWorldY = -1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the canvas renderer and start the render loop.
 * Call once from main.js after the DOM is ready.
 */
function initCanvas() {
  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d", { alpha: false });

  // Keep canvas resolution in sync with the viewport
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Disable browser image smoothing so scaled-up pixels stay crisp
  setSmoothing(false);

  // Attach camera (pan / zoom) listeners
  attachCamera(canvas);

  // Click-to-inspect handler
  canvas.addEventListener("click", onCanvasClick);

  // Mouse move for hover detection
  canvas.addEventListener("mousemove", onCanvasMouseMove);
  canvas.addEventListener("mouseleave", () => {
    mouseWorldX = -1;
    mouseWorldY = -1;
    update({ hoveredAgent: null });
  });

  // Kick off the render loop
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function render(timestamp) {
  // Full clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0e0e1a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { grid } = getState();

  // Apply camera (pan + zoom) transform
  applyTransform(ctx);

  if (grid.length) {
    drawTerrain(grid);
    drawStructures(grid);
    drawItems(grid);
    drawNotes(grid);
    drawGravestones();
    drawAgents(timestamp);
    drawSelectionRing(timestamp);
    drawLabels(timestamp);
  }

  // Reset transform for full-canvas overlays
  resetTransform(ctx);

  // Day/night compositing overlay (screen-space)
  drawTimeOverlay();

  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw the terrain layer — a coloured rectangle per tile.
 */
function drawTerrain(grid) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const terrain = row[x].terrain;
      ctx.fillStyle = TERRAIN_COLORS[terrain] || TERRAIN_DEFAULT;
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

      // Subtle grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

/**
 * Draw structure overlays on tiles that have a `structure` property.
 */
function drawStructures(grid) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (!tile.structure) continue;

      const color = STRUCTURE_COLORS[tile.structure.type] || "#999";
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // Semi-transparent fill
      ctx.fillStyle = color + "99"; // ~60 % alpha via hex
      ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }
  }
}

/**
 * Draw small coloured dots for items sitting on tiles.
 */
function drawItems(grid) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const items = row[x].items;
      if (!items || !items.length) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // Draw up to 3 small dots for the first 3 item stacks
      for (let i = 0; i < Math.min(items.length, 3); i++) {
        const item = items[i];
        ctx.fillStyle = ITEM_COLORS[item.type] || "#ccc";
        const dotX = px + 6 + i * 10;
        const dotY = py + TILE_SIZE - 8;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Draw a small indicator for dropped notes.
 */
function drawNotes(grid) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const notes = row[x].notes;
      if (!notes || !notes.length) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // Draw a small white/yellowish rectangle to look like a piece of paper
      ctx.fillStyle = "#ffffe0";
      ctx.fillRect(px + TILE_SIZE - 12, py + 4, 8, 10);
      
      // Draw a few tiny lines inside to represent text
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(px + TILE_SIZE - 10, py + 6, 4, 1);
      ctx.fillRect(px + TILE_SIZE - 10, py + 8, 4, 1);
      ctx.fillRect(px + TILE_SIZE - 10, py + 10, 3, 1);
      
      // Border for contrast
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + TILE_SIZE - 12, py + 4, 8, 10);
    }
  }
}

// ---------------------------------------------------------------------------
// Gravestones for dead agents
// ---------------------------------------------------------------------------

/**
 * Draw a small gravestone icon at each dead agent's last known coordinates.
 */
function drawGravestones() {
  const { deadAgents } = getState();
  if (!deadAgents.length) return;

  const half = TILE_SIZE / 2;

  for (const dead of deadAgents) {
    const px = dead.x * TILE_SIZE;
    const py = dead.y * TILE_SIZE;
    const cx = px + half;
    const cy = py + half;

    // -- Gravestone body (rounded rect) --
    const stoneW = 14;
    const stoneH = 18;
    const stoneX = cx - stoneW / 2;
    const stoneY = cy - stoneH / 2 + 3; // shift down slightly

    ctx.beginPath();
    // Rounded top
    ctx.moveTo(stoneX, stoneY + stoneH);
    ctx.lineTo(stoneX, stoneY + 4);
    ctx.quadraticCurveTo(stoneX, stoneY, stoneX + 4, stoneY);
    ctx.lineTo(stoneX + stoneW - 4, stoneY);
    ctx.quadraticCurveTo(stoneX + stoneW, stoneY, stoneX + stoneW, stoneY + 4);
    ctx.lineTo(stoneX + stoneW, stoneY + stoneH);
    ctx.closePath();
    ctx.fillStyle = "#555566";
    ctx.fill();
    ctx.strokeStyle = "#333344";
    ctx.lineWidth = 1;
    ctx.stroke();

    // -- Cross on gravestone --
    ctx.strokeStyle = "#888899";
    ctx.lineWidth = 1.5;
    // Vertical bar
    ctx.beginPath();
    ctx.moveTo(cx, stoneY + 4);
    ctx.lineTo(cx, stoneY + stoneH - 3);
    ctx.stroke();
    // Horizontal bar
    ctx.beginPath();
    ctx.moveTo(cx - 4, stoneY + 8);
    ctx.lineTo(cx + 4, stoneY + 8);
    ctx.stroke();

    // -- Faint name label above gravestone --
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 6px monospace";
    ctx.fillStyle = "rgba(180, 180, 180, 0.6)";
    ctx.fillText(dead.name, cx, stoneY - 2);
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Draw agents as coloured circles at interpolated positions.
 * Hovered agents get a scale-up and glowing ring effect.
 */
function drawAgents(timestamp) {
  const interpolated = getInterpolatedAgents(timestamp);
  const half = TILE_SIZE / 2;
  const baseRadius = TILE_SIZE * 0.35;
  const { hoveredAgent } = getState();

  for (let i = 0; i < interpolated.length; i++) {
    const { x, y, agent } = interpolated[i];
    if (agent.alive === false) continue;

    const cx = x * TILE_SIZE + half;
    const cy = y * TILE_SIZE + half;
    const color = AGENT_PALETTE[i % AGENT_PALETTE.length];
    const isHovered = hoveredAgent === agent.name;
    const radius = isHovered ? baseRadius * 1.3 : baseRadius;

    // Hover glow ring (drawn first, behind the agent)
    if (isHovered) {
      const pulse = 0.5 + 0.5 * Math.sin(timestamp / 200);

      // Outer soft glow
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = color + hexAlpha(0.08 + pulse * 0.08);
      ctx.fill();

      // Bright ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color + hexAlpha(0.5 + pulse * 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Outer glow (normal)
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = color + "44";
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Border
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Labels (archetype-colored)
// ---------------------------------------------------------------------------

/**
 * Draw agent name labels above their circles, color-coded by archetype.
 */
function drawLabels(timestamp) {
  const interpolated = getInterpolatedAgents(timestamp);
  const half = TILE_SIZE / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "bold 7px monospace";

  for (let i = 0; i < interpolated.length; i++) {
    const { name, x, y, agent } = interpolated[i];
    if (agent.alive === false) continue;

    const tx = x * TILE_SIZE + half;
    const ty = y * TILE_SIZE - 4;

    // Pick color based on personality archetype
    const archetype = agent.personality_archetype || name;
    const labelColor = ARCHETYPE_COLORS[archetype] || ARCHETYPE_COLOR_DEFAULT;

    // Shadow for readability
    ctx.fillStyle = "#000";
    ctx.fillText(name, tx + 0.5, ty + 0.5);
    // Colored label
    ctx.fillStyle = labelColor;
    ctx.fillText(name, tx, ty);
  }
}

// ---------------------------------------------------------------------------
// Day / Night compositing overlay
// ---------------------------------------------------------------------------

/**
 * Draw a full-canvas tint using globalCompositeOperation = 'multiply'
 * to realistically light the scene without muddy opacity overlays.
 */
function drawTimeOverlay() {
  const { timeOfDay } = getState();
  const tint = TIME_TINTS[timeOfDay] || TIME_TINT_DEFAULT;

  // No-op for midday (white multiply = identity)
  if (tint === "#FFFFFF") return;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hover detection
// ---------------------------------------------------------------------------

/**
 * Track mouse position and update hoveredAgent in the store.
 */
function onCanvasMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const world = screenToWorld(sx, sy);
  mouseWorldX = world.x;
  mouseWorldY = world.y;

  const tileX = Math.floor(world.x / TILE_SIZE);
  const tileY = Math.floor(world.y / TILE_SIZE);

  const { agents } = getState();
  const hovered = agents.find(a => a.x === tileX && a.y === tileY && a.alive !== false);

  const currentHovered = getState().hoveredAgent;
  const newHovered = hovered ? hovered.name : null;

  // Only update store if the value actually changed (avoids thrashing)
  if (currentHovered !== newHovered) {
    update({ hoveredAgent: newHovered });
  }
}

// ---------------------------------------------------------------------------
// Click-to-inspect
// ---------------------------------------------------------------------------

/**
 * Handle canvas clicks: detect if an agent was clicked and select it.
 * Ignores clicks that were actually the end of a drag gesture.
 */
function onCanvasClick(e) {
  // Don't count drag releases as clicks
  if (wasDrag()) return;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const world = screenToWorld(sx, sy);
  const tileX = Math.floor(world.x / TILE_SIZE);
  const tileY = Math.floor(world.y / TILE_SIZE);

  const { agents } = getState();
  const clicked = agents.find(a => a.x === tileX && a.y === tileY && a.alive !== false);

  if (clicked) {
    update({ selectedAgent: clicked.name, selectedTile: { x: tileX, y: tileY } });
  } else {
    update({ selectedAgent: null, agentDetail: null, selectedTile: { x: tileX, y: tileY } });
  }
}

// ---------------------------------------------------------------------------
// Selection ring
// ---------------------------------------------------------------------------

/**
 * Draw a pulsing ring around the currently selected agent.
 */
function drawSelectionRing(timestamp) {
  const selectedName = getState().selectedAgent;
  if (!selectedName) return;

  const interpolated = getInterpolatedAgents(timestamp);
  const entry = interpolated.find(e => e.name === selectedName);
  if (!entry) return;

  const half = TILE_SIZE / 2;
  const cx = entry.x * TILE_SIZE + half;
  const cy = entry.y * TILE_SIZE + half;

  // Pulsing effect
  const pulse = 0.5 + 0.5 * Math.sin(timestamp / 300);
  const radius = TILE_SIZE * 0.45 + pulse * 2;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(139, 233, 253, ${0.5 + pulse * 0.5})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Outer glow
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(139, 233, 253, ${0.15 + pulse * 0.15})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Resizing resets context state, so re-apply smoothing pref
  setSmoothing(false);
}

function setSmoothing(enabled) {
  ctx.imageSmoothingEnabled = enabled;
}

/**
 * Convert a 0..1 alpha value to a 2-char hex string for appending to colors.
 */
function hexAlpha(a) {
  return Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, "0");
}

export { initCanvas, TILE_SIZE };
