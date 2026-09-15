/**
 * Canvas Renderer — runs the requestAnimationFrame render loop,
 * completely decoupled from the WebSocket tick rate.
 *
 * Layers, back to front:
 *   terrain buffer -> items -> relation overlay -> gravestones -> agents
 *   -> effects -> bubbles -> labels -> lighting -> vignette
 */

import { getState, update, subscribe } from "../store.js";
import {
  attach as attachCamera, applyTransform, resetTransform, screenToWorld,
  getScale, wasDrag, setViewport, setWorldSize, frameWorld, centerOn, setInset,
} from "./camera.js";
import { getInterpolatedAgents } from "./interpolate.js";
import { getTerrainBuffer, noise } from "./terrain.js";
import { prune, getEffects, shakeOffset } from "./effects.js";
import {
  ITEM_COLORS, RELATION_COLORS, colorForAgent, hexAlpha,
} from "./palette.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE_SIZE = 32;

/** How long a thought/speech bubble stays up after its agent acted. */
const BUBBLE_TTL_MS = 5200;
const BUBBLE_FADE_MS = 600;
const MAX_BUBBLE_CHARS = 90;

/**
 * Day/night tints, interpolated rather than hard-stepped so dusk actually
 * falls instead of snapping.
 */
const TIME_TINTS = {
  morning:   [255, 237, 179],
  midday:    [255, 255, 255],
  afternoon: [255, 184, 108],
  evening:   [139, 130, 200],
  night:     [ 40,  44, 110],
};
const TIME_ORDER = ["morning", "midday", "afternoon", "evening", "night"];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLCanvasElement} */
let canvas;
/** @type {CanvasRenderingContext2D} */
let ctx;
let dpr = 1;

let mouseScreenX = -1;
let mouseScreenY = -1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function initCanvas() {
  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d", { alpha: false });

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  attachCamera(canvas);
  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("mousemove", onCanvasMouseMove);
  canvas.addEventListener("mouseleave", () => {
    mouseScreenX = -1;
    mouseScreenY = -1;
    update({ hoveredAgent: null });
  });

  // Frame the world as soon as we learn how big it is.
  subscribe("worldSize", (size) => {
    if (!size) return;
    setWorldSize(size.width * TILE_SIZE, size.height * TILE_SIZE);
    frameWorld();
  });

  requestAnimationFrame(render);
}

/** Pan the camera to a tile and select whoever is standing there. */
function focusTile(x, y, agentName = null) {
  centerOn(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
  if (agentName) {
    update({ selectedAgent: agentName, selectedTile: { x, y } });
  } else {
    update({ selectedTile: { x, y } });
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function render(timestamp) {
  const state = getState();
  const { grid } = state;

  prune(timestamp);

  // Clear in device pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b0b14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (grid.length) {
    const agentsNow = getInterpolatedAgents(timestamp);

    applyTransform(ctx, dpr);
    drawTerrainLayer(grid, timestamp);
    drawItems(grid);
    if (state.showRelations) drawRelations(agentsNow, state.relations);
    drawGravestones(state.deadAgents);
    drawAgents(agentsNow, timestamp, state);
    drawSelectionRing(agentsNow, timestamp, state.selectedAgent);
    drawEffects(timestamp);
    drawLabels(agentsNow);
    drawBubbles(agentsNow, timestamp, state);

    resetTransform(ctx, dpr);
    drawLighting(state, grid);
  }

  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Static layers
// ---------------------------------------------------------------------------

function drawTerrainLayer(grid, timestamp) {
  const buffer = getTerrainBuffer(grid, TILE_SIZE);
  if (buffer) ctx.drawImage(buffer, 0, 0);

  // Animated water highlight, drawn live on top of the cached buffer.
  ctx.save();
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x].terrain !== "water") continue;
      const phase = noise(x, y) * Math.PI * 2;
      const shimmer = 0.5 + 0.5 * Math.sin(timestamp / 900 + phase);
      ctx.fillStyle = `rgba(150, 200, 255, ${0.05 + shimmer * 0.09})`;
      const wy = y * TILE_SIZE + 8 + shimmer * 10;
      ctx.fillRect(x * TILE_SIZE + 4, wy, TILE_SIZE - 12, 2);
    }
  }
  ctx.restore();
}

function drawItems(grid) {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const items = grid[y][x].items;
      if (!items || !items.length) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      for (let i = 0; i < Math.min(items.length, 3); i++) {
        const item = items[i];
        const color = ITEM_COLORS[item.type] || "#ccc";
        const dotX = px + 7 + i * 9;
        const dotY = py + TILE_SIZE - 7;

        // Soft glow so loose resources read at a glance.
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color + "33";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(dotX, dotY, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (item.quantity > 1) {
          ctx.font = "bold 6px monospace";
          ctx.fillStyle = "#000";
          ctx.textAlign = "center";
          ctx.fillText(String(item.quantity), dotX, dotY + 2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Social overlay
// ---------------------------------------------------------------------------

function drawRelations(agentsNow, relations) {
  if (!relations || !relations.length) return;

  const pos = new Map();
  for (const a of agentsNow) {
    pos.set(a.name, {
      x: a.x * TILE_SIZE + TILE_SIZE / 2,
      y: a.y * TILE_SIZE + TILE_SIZE / 2,
    });
  }

  ctx.save();
  for (const edge of relations) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;

    const color = RELATION_COLORS[edge.sentiment];
    if (!color) continue;

    ctx.strokeStyle = color + hexAlpha(edge.sentiment === "hostile" ? 0.6 : 0.4);
    ctx.lineWidth = edge.sentiment === "hostile" ? 1.8 : 1.2;
    ctx.setLineDash(edge.sentiment === "wary" ? [3, 3] : []);

    // Bow the line so A->B and B->A don't overlap into one stroke.
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const nx = -(to.y - from.y);
    const ny = to.x - from.x;
    const len = Math.hypot(nx, ny) || 1;
    const bow = 10;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mx + (nx / len) * bow, my + (ny / len) * bow, to.x, to.y);
    ctx.stroke();

    // Arrowhead at the target end so direction of feeling is readable.
    const ang = Math.atan2(to.y - my, to.x - mx);
    ctx.fillStyle = color + hexAlpha(0.7);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - Math.cos(ang - 0.4) * 7, to.y - Math.sin(ang - 0.4) * 7);
    ctx.lineTo(to.x - Math.cos(ang + 0.4) * 7, to.y - Math.sin(ang + 0.4) * 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Gravestones
// ---------------------------------------------------------------------------

function drawGravestones(deadAgents) {
  if (!deadAgents || !deadAgents.length) return;
  const half = TILE_SIZE / 2;

  for (const dead of deadAgents) {
    const cx = dead.x * TILE_SIZE + half;
    const cy = dead.y * TILE_SIZE + half;

    const stoneW = 14;
    const stoneH = 18;
    const stoneX = cx - stoneW / 2;
    const stoneY = cy - stoneH / 2 + 3;

    // Ground shadow.
    ctx.beginPath();
    ctx.ellipse(cx, stoneY + stoneH, 8, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();

    ctx.beginPath();
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

    ctx.strokeStyle = "#888899";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, stoneY + 4);
    ctx.lineTo(cx, stoneY + stoneH - 3);
    ctx.moveTo(cx - 4, stoneY + 8);
    ctx.lineTo(cx + 4, stoneY + 8);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 6px monospace";
    ctx.fillStyle = "rgba(180, 180, 180, 0.65)";
    ctx.fillText(dead.name, cx, stoneY - 2);
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function drawAgents(agentsNow, timestamp, state) {
  const half = TILE_SIZE / 2;
  const baseRadius = TILE_SIZE * 0.33;
  const { hoveredAgent, thinkingAgent } = state;

  for (const entry of agentsNow) {
    const { x, y, agent, dx, dy, moving } = entry;
    if (agent.alive === false) continue;

    const shake = shakeOffset(agent.x, agent.y, timestamp);
    const cx = x * TILE_SIZE + half + shake.ox;
    const cy = y * TILE_SIZE + half + shake.oy;

    const color = colorForAgent(agent.name);
    const isHovered = hoveredAgent === agent.name;
    const isThinking = thinkingAgent === agent.name;

    // Idle bob, phase-offset per agent so they don't pulse in lockstep.
    const bobPhase = agent.name.length * 0.7;
    const bob = moving ? 0 : Math.sin(timestamp / 520 + bobPhase) * 0.9;

    // Squash toward the direction of travel.
    const speed = Math.hypot(dx, dy);
    const stretch = moving && speed > 0 ? 1.12 : 1;
    const squash = moving && speed > 0 ? 0.9 : 1;

    const radius = (isHovered ? baseRadius * 1.25 : baseRadius);

    // Ground shadow — anchors the agent to the tile.
    ctx.beginPath();
    ctx.ellipse(cx, cy + radius * 0.85, radius * 0.75, radius * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fill();

    const drawY = cy + bob;

    if (isThinking) {
      // Pulsing halo while the model is deciding — the clearest signal that
      // something is happening during a long, otherwise-static pause.
      const pulse = 0.5 + 0.5 * Math.sin(timestamp / 260);
      ctx.beginPath();
      ctx.arc(cx, drawY, radius + 5 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = color + hexAlpha(0.10 + pulse * 0.12);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, drawY, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = color + hexAlpha(0.45 + pulse * 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (isHovered) {
      const pulse = 0.5 + 0.5 * Math.sin(timestamp / 200);
      ctx.beginPath();
      ctx.arc(cx, drawY, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = color + hexAlpha(0.08 + pulse * 0.08);
      ctx.fill();
    }

    // Body.
    ctx.save();
    ctx.translate(cx, drawY);
    if (Math.abs(dx) > Math.abs(dy)) {
      ctx.scale(stretch, squash);
    } else if (speed > 0) {
      ctx.scale(squash, stretch);
    }
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = color + "3a";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner highlight for a bit of dimension.
    ctx.beginPath();
    ctx.arc(-radius * 0.28, -radius * 0.3, radius * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();
    ctx.restore();

    drawEnergyArc(cx, drawY, radius + 4, agent);
  }
}

/**
 * Thin arc around each agent showing energy, so starvation is visible without
 * opening the inspector.
 */
function drawEnergyArc(cx, cy, radius, agent) {
  const max = agent.max_energy || 120;
  const pct = Math.max(0, Math.min(1, (agent.energy ?? max) / max));

  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const color = pct > 0.5 ? "#50fa7b" : pct > 0.25 ? "#f1fa8c" : "#ff5555";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Flash the ring when energy is critical.
  if (pct < 0.2) {
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    ctx.strokeStyle = `rgba(255,85,85,${0.25 + blink * 0.4})`;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }
}

function drawLabels(agentsNow) {
  const half = TILE_SIZE / 2;
  const scale = getScale();
  // Keep labels legible at every zoom instead of shrinking with the world.
  const fontPx = Math.max(6, Math.min(9, 16 / scale));

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = `bold ${fontPx}px 'JetBrains Mono', monospace`;

  for (const { name, x, y, agent } of agentsNow) {
    if (agent.alive === false) continue;
    const tx = x * TILE_SIZE + half;
    const ty = y * TILE_SIZE - 3;

    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillText(name, tx + 0.6, ty + 0.6);
    ctx.fillStyle = colorForAgent(agent.name);
    ctx.fillText(name, tx, ty);
  }
}

function drawSelectionRing(agentsNow, timestamp, selectedName) {
  if (!selectedName) return;
  const entry = agentsNow.find((e) => e.name === selectedName);
  if (!entry) return;

  const half = TILE_SIZE / 2;
  const cx = entry.x * TILE_SIZE + half;
  const cy = entry.y * TILE_SIZE + half;

  const pulse = 0.5 + 0.5 * Math.sin(timestamp / 300);
  const radius = TILE_SIZE * 0.48 + pulse * 2;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(139, 233, 253, ${0.55 + pulse * 0.45})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(139, 233, 253, ${0.15 + pulse * 0.15})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function drawEffects(timestamp) {
  const effects = getEffects();
  if (!effects.length) return;
  const half = TILE_SIZE / 2;
  const scale = getScale();

  for (const e of effects) {
    const t = (timestamp - e.born) / e.ttl;
    if (t >= 1) continue;
    const fade = 1 - t;

    switch (e.kind) {
      case "float": {
        const fontPx = Math.max(7, Math.min(12, 20 / scale));
        ctx.font = `bold ${fontPx}px 'JetBrains Mono', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fx = e.x * TILE_SIZE + half;
        const fy = e.y * TILE_SIZE + half - 12 - t * 20;
        ctx.fillStyle = `rgba(0,0,0,${fade * 0.8})`;
        ctx.fillText(e.text, fx + 0.8, fy + 0.8);
        ctx.fillStyle = e.color + hexAlpha(fade);
        ctx.fillText(e.text, fx, fy);
        break;
      }

      case "flash": {
        ctx.fillStyle = e.color + hexAlpha(fade * 0.55);
        ctx.fillRect(e.x * TILE_SIZE, e.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        break;
      }

      case "ring": {
        const r = (e.maxR || 1) * TILE_SIZE * t;
        ctx.beginPath();
        ctx.arc(e.x * TILE_SIZE + half, e.y * TILE_SIZE + half, r, 0, Math.PI * 2);
        ctx.strokeStyle = e.color + hexAlpha(fade * 0.7);
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }

      case "burst": {
        const n = e.particles || 8;
        for (let i = 0; i < n; i++) {
          const ang = (Math.PI * 2 * i) / n;
          const dist = t * TILE_SIZE * 0.9;
          const px = e.x * TILE_SIZE + half + Math.cos(ang) * dist;
          const py = e.y * TILE_SIZE + half + Math.sin(ang) * dist;
          ctx.beginPath();
          ctx.arc(px, py, 2.5 * fade, 0, Math.PI * 2);
          ctx.fillStyle = e.color + hexAlpha(fade);
          ctx.fill();
        }
        break;
      }

      case "arc": {
        // The stolen goods travelling from victim to thief.
        const fx = e.fromX * TILE_SIZE + half;
        const fy = e.fromY * TILE_SIZE + half;
        const tx = e.toX * TILE_SIZE + half;
        const ty = e.toY * TILE_SIZE + half;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = e.color + hexAlpha(fade * 0.6);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        const px = tx + (fx - tx) * t;
        const py = ty + (fy - ty) * t - Math.sin(t * Math.PI) * 10;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = e.color + hexAlpha(fade);
        ctx.fill();
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Thought / speech bubbles
// ---------------------------------------------------------------------------

function truncate(text, max = MAX_BUBBLE_CHARS) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/**
 * Draws the agent's inner reasoning above its head. This is the single most
 * interesting thing the simulation produces and it previously never left the
 * backend's log file.
 */
function drawBubbles(agentsNow, timestamp, state) {
  const half = TILE_SIZE / 2;
  const scale = getScale();
  const fontPx = Math.max(5.5, Math.min(8, 13 / scale));

  // Latest feed entry per agent, if still fresh.
  const latest = new Map();
  for (const item of state.thoughtFeed) {
    if (timestamp - item.ts < BUBBLE_TTL_MS) latest.set(item.name, item);
  }

  // Taken screen rows, so stacked bubbles nudge instead of overlapping.
  const placed = [];

  for (const { name, x, y, agent } of agentsNow) {
    if (agent.alive === false) continue;

    const isThinking = state.thinkingAgent === name;
    const item = latest.get(name);
    if (!isThinking && !item) continue;

    const isSpeech = !isThinking && item && item.speech;
    const raw = isThinking
      ? "…"
      : truncate(isSpeech ? item.speech : (item.thought || ""), MAX_BUBBLE_CHARS);
    if (!raw) continue;

    const age = item ? timestamp - item.ts : 0;
    const alpha = isThinking
      ? 1
      : Math.max(0, Math.min(1, (BUBBLE_TTL_MS - age) / BUBBLE_FADE_MS));
    if (alpha <= 0) continue;

    ctx.font = `${isSpeech ? "bold " : ""}${fontPx}px 'JetBrains Mono', monospace`;

    const maxChars = isThinking ? 3 : 26;
    const lines = isThinking ? ["●●●"] : wrapText(raw, maxChars);
    const lineH = fontPx * 1.45;
    const padX = 5;
    const padY = 4;

    let boxW = 0;
    for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width);
    boxW += padX * 2;
    const boxH = lines.length * lineH + padY * 2;

    const cx = x * TILE_SIZE + half;
    let boxY = y * TILE_SIZE - 14 - boxH;
    const boxX = cx - boxW / 2;

    // Nudge upward if this bubble would sit on top of one already placed.
    for (const p of placed) {
      const overlapX = boxX < p.x + p.w && boxX + boxW > p.x;
      const overlapY = boxY < p.y + p.h && boxY + boxH > p.y;
      if (overlapX && overlapY) boxY = p.y - boxH - 4;
    }
    placed.push({ x: boxX, y: boxY, w: boxW, h: boxH });

    const color = colorForAgent(name);

    // Bubble body.
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 4);
    ctx.fillStyle = isSpeech
      ? `rgba(14, 20, 40, ${0.92 * alpha})`
      : `rgba(10, 12, 24, ${0.82 * alpha})`;
    ctx.fill();

    // Speech gets a solid border weighted by volume; thoughts stay soft.
    if (isSpeech) {
      const weight = item.volume === "shout" ? 2 : item.volume === "whisper" ? 0.6 : 1.2;
      ctx.strokeStyle = color + hexAlpha(alpha * (item.volume === "whisper" ? 0.4 : 0.9));
      ctx.lineWidth = weight;
    } else {
      ctx.strokeStyle = color + hexAlpha(alpha * 0.35);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 2]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Tail pointing at the agent.
    ctx.beginPath();
    ctx.moveTo(cx - 3, boxY + boxH);
    ctx.lineTo(cx + 3, boxY + boxH);
    ctx.lineTo(cx, boxY + boxH + 5);
    ctx.closePath();
    ctx.fillStyle = isSpeech
      ? `rgba(14, 20, 40, ${0.92 * alpha})`
      : `rgba(10, 12, 24, ${0.82 * alpha})`;
    ctx.fill();

    // Text.
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = isSpeech
      ? color + hexAlpha(alpha)
      : `rgba(200, 208, 226, ${alpha * 0.92})`;
    lines.forEach((line, i) => {
      ctx.fillText(line, boxX + padX, boxY + padY + i * lineH);
    });
  }
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/** Smoothly blend between the current period's tint and the next one. */
function currentTint(state) {
  const idx = TIME_ORDER.indexOf(state.timeOfDay);
  if (idx < 0) return TIME_TINTS.midday;

  const perDay = state.ticksPerDay || 50;
  const perPeriod = perDay / TIME_ORDER.length;
  const within = (state.tick % perDay) % perPeriod;
  const t = perPeriod > 0 ? within / perPeriod : 0;

  const from = TIME_TINTS[TIME_ORDER[idx]];
  const to = TIME_TINTS[TIME_ORDER[(idx + 1) % TIME_ORDER.length]];
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function drawLighting(state, grid) {
  const [r, g, b] = currentTint(state);

  // Skip the multiply pass when it would be a no-op (pure white).
  if (!(r > 250 && g > 250 && b > 250)) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();
  }

  // Campfires push warm light back through the night tint.
  const darkness = 1 - (r + g + b) / 765;
  if (darkness > 0.12 && grid.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    applyTransform(ctx, dpr);
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const s = grid[y][x].structure;
        if (!s || s.type !== "campfire") continue;
        const cx = x * TILE_SIZE + TILE_SIZE / 2;
        const cy = y * TILE_SIZE + TILE_SIZE / 2;
        const flicker = 0.85 + 0.15 * Math.sin(performance.now() / 130 + x + y);
        const radius = TILE_SIZE * 2.6 * flicker;
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
        grad.addColorStop(0, `rgba(255, 170, 70, ${0.42 * darkness * flicker})`);
        grad.addColorStop(1, "rgba(255, 140, 40, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    resetTransform(ctx, dpr);
    ctx.restore();
  }

  // Vignette.
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(0,0,0,${0.3 + darkness * 0.3})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function agentAtScreen(sx, sy) {
  const world = screenToWorld(sx, sy);
  const tileX = Math.floor(world.x / TILE_SIZE);
  const tileY = Math.floor(world.y / TILE_SIZE);
  const { agents } = getState();
  return {
    tileX,
    tileY,
    agent: agents.find((a) => a.x === tileX && a.y === tileY && a.alive !== false),
  };
}

function onCanvasMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  mouseScreenX = e.clientX - rect.left;
  mouseScreenY = e.clientY - rect.top;

  const { agent } = agentAtScreen(mouseScreenX, mouseScreenY);
  const newHovered = agent ? agent.name : null;
  if (getState().hoveredAgent !== newHovered) {
    update({ hoveredAgent: newHovered });
  }
  canvas.style.cursor = newHovered ? "pointer" : "default";
}

function onCanvasClick(e) {
  if (wasDrag()) return;

  const rect = canvas.getBoundingClientRect();
  const { tileX, tileY, agent } = agentAtScreen(e.clientX - rect.left, e.clientY - rect.top);

  if (agent) {
    update({ selectedAgent: agent.name, selectedTile: { x: tileX, y: tileY } });
  } else {
    update({ selectedAgent: null, agentDetail: null, selectedTile: { x: tileX, y: tileY } });
  }
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Backing store in device pixels, CSS box in layout pixels — without this
  // the whole world is soft on any HiDPI display.
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.imageSmoothingEnabled = false;

  setViewport(w, h);
  // Keep the world clear of the fixed panels when framing.
  const narrow = w <= 900;
  setInset({
    left: narrow ? 0 : 216,
    right: narrow ? 0 : 320,
    top: 0,
    bottom: 48 + (narrow ? 0 : 150),
  });
  frameWorld();
}

export { initCanvas, focusTile, TILE_SIZE };
