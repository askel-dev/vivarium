/**
 * terrain.js — procedural tile texture, cached on an offscreen canvas.
 *
 * The static layers (terrain, structures, notes) used to be re-filled and
 * re-stroked every animation frame. They change only when the world changes, so
 * they are painted once into a buffer and blitted thereafter.
 *
 * All variation is a deterministic hash of (x, y), so a tile looks identical
 * across frames and across reloads — no shimmer, no per-frame randomness.
 */

import {
  TERRAIN_COLORS, TERRAIN_DEFAULT,
  STRUCTURE_COLORS, STRUCTURE_DEFAULT,
} from "./palette.js";

let buffer = null;
let bufCtx = null;
let signature = "";

/** Cheap deterministic hash -> 0..1 */
function noise(x, y, salt = 0) {
  let h = x * 374761393 + y * 668265263 + salt * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

/** Shift a #rrggbb by a signed amount per channel. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

/**
 * A signature that changes only when something static changed, so we know
 * when to repaint the buffer. Agents and items are deliberately excluded —
 * items are drawn live on top.
 */
function gridSignature(grid) {
  let s = `${grid.length}x${grid[0] ? grid[0].length : 0}`;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const t = grid[y][x];
      s += t.terrain[0];
      if (t.structure) s += `S${t.structure.type[0]}`;
      if (t.notes && t.notes.length) s += `N${t.notes.length}`;
    }
  }
  return s;
}

function drawGrassTile(ctx, px, py, size, x, y) {
  const base = TERRAIN_COLORS.grass;
  ctx.fillStyle = shade(base, Math.round(noise(x, y) * 14) - 7);
  ctx.fillRect(px, py, size, size);

  // A few blades, placed deterministically.
  ctx.fillStyle = shade(base, 22);
  for (let i = 0; i < 3; i++) {
    const bx = px + noise(x, y, i + 1) * (size - 3);
    const by = py + noise(x, y, i + 9) * (size - 4);
    ctx.fillRect(Math.floor(bx), Math.floor(by), 1, 2);
  }
}

function drawWaterTile(ctx, px, py, size, x, y) {
  const base = TERRAIN_COLORS.water;
  ctx.fillStyle = shade(base, Math.round(noise(x, y) * 16) - 8);
  ctx.fillRect(px, py, size, size);
  // Static ripple lines; the animated highlight is drawn live in canvas.js.
  ctx.fillStyle = shade(base, 26);
  for (let i = 0; i < 2; i++) {
    const wy = py + 6 + i * 11 + noise(x, y, i) * 4;
    ctx.fillRect(px + 3, Math.floor(wy), size - 10, 1);
  }
}

function drawStoneTile(ctx, px, py, size, x, y) {
  const base = TERRAIN_COLORS.stone;
  ctx.fillStyle = shade(base, Math.round(noise(x, y) * 18) - 9);
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = shade(base, -22);
  for (let i = 0; i < 4; i++) {
    const sx = px + noise(x, y, i + 3) * (size - 4);
    const sy = py + noise(x, y, i + 17) * (size - 4);
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
  }
}

function drawTreeTile(ctx, px, py, size, x, y) {
  // Ground under the tree reads as grass, then a trunk and canopy on top,
  // so a forest no longer looks like flat dark squares.
  drawGrassTile(ctx, px, py, size, x, y);

  const cx = px + size / 2;
  const trunkW = Math.max(2, size * 0.12);
  ctx.fillStyle = "#4a3322";
  ctx.fillRect(cx - trunkW / 2, py + size * 0.55, trunkW, size * 0.35);

  const canopy = TERRAIN_COLORS.tree;
  const r = size * 0.3;
  const cy = py + size * 0.45;
  ctx.fillStyle = shade(canopy, Math.round(noise(x, y, 5) * 16) - 8);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Offset highlight lobe for a bit of volume.
  ctx.fillStyle = shade(canopy, 20);
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawStructure(ctx, px, py, size, type) {
  const color = STRUCTURE_COLORS[type] || STRUCTURE_DEFAULT;
  const pad = 3;
  const inner = size - pad * 2;

  switch (type) {
    case "wall":
      // Brick courses.
      ctx.fillStyle = color;
      ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(px + 1, py + (size / 4) * i);
        ctx.lineTo(px + size - 1, py + (size / 4) * i);
        ctx.stroke();
      }
      break;

    case "campfire": {
      ctx.strokeStyle = "#5a3a22";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + pad + 2, py + size - pad - 2);
      ctx.lineTo(px + size - pad - 2, py + size - pad - 6);
      ctx.moveTo(px + size - pad - 2, py + size - pad - 2);
      ctx.lineTo(px + pad + 2, py + size - pad - 6);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px + size / 2, py + pad + 2);
      ctx.lineTo(px + size / 2 + 5, py + size - pad - 6);
      ctx.lineTo(px + size / 2 - 5, py + size - pad - 6);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "shelter":
      // Pitched roof.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px + size / 2, py + pad);
      ctx.lineTo(px + size - pad, py + size * 0.55);
      ctx.lineTo(px + pad, py + size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(px + pad + 3, py + size * 0.55, inner - 6, size * 0.3);
      break;

    case "bridge":
      ctx.fillStyle = color;
      ctx.fillRect(px, py + size * 0.2, size, size * 0.6);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(px + (size / 5) * i, py + size * 0.2);
        ctx.lineTo(px + (size / 5) * i, py + size * 0.8);
        ctx.stroke();
      }
      break;

    case "marker":
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px + size / 2, py + pad);
      ctx.lineTo(px + size - pad - 2, py + size - pad);
      ctx.lineTo(px + pad + 2, py + size - pad);
      ctx.closePath();
      ctx.fill();
      break;

    default:
      ctx.fillStyle = color + "99";
      ctx.fillRect(px + pad, py + pad, inner, inner);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + pad, py + pad, inner, inner);
  }
}

function drawNote(ctx, px, py, size) {
  const w = 8;
  const h = 10;
  const nx = px + size - w - 4;
  const ny = py + 4;
  ctx.fillStyle = "#ffffe0";
  ctx.fillRect(nx, ny, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(nx + 2, ny + 2, 4, 1);
  ctx.fillRect(nx + 2, ny + 4, 4, 1);
  ctx.fillRect(nx + 2, ny + 6, 3, 1);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(nx, ny, w, h);
}

/**
 * Return an offscreen canvas holding the static world layers, repainting it
 * only when the grid actually changed.
 */
function getTerrainBuffer(grid, tileSize) {
  if (!grid.length) return null;

  const h = grid.length;
  const w = grid[0].length;
  const sig = `${tileSize}|${gridSignature(grid)}`;
  if (buffer && signature === sig) return buffer;

  if (!buffer) {
    buffer = document.createElement("canvas");
    bufCtx = buffer.getContext("2d");
  }
  buffer.width = w * tileSize;
  buffer.height = h * tileSize;
  bufCtx.clearRect(0, 0, buffer.width, buffer.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = grid[y][x];
      const px = x * tileSize;
      const py = y * tileSize;

      switch (tile.terrain) {
        case "water": drawWaterTile(bufCtx, px, py, tileSize, x, y); break;
        case "tree":  drawTreeTile(bufCtx, px, py, tileSize, x, y); break;
        case "stone": drawStoneTile(bufCtx, px, py, tileSize, x, y); break;
        case "grass": drawGrassTile(bufCtx, px, py, tileSize, x, y); break;
        default:
          bufCtx.fillStyle = TERRAIN_COLORS[tile.terrain] || TERRAIN_DEFAULT;
          bufCtx.fillRect(px, py, tileSize, tileSize);
      }

      if (tile.structure) drawStructure(bufCtx, px, py, tileSize, tile.structure.type);
      if (tile.notes && tile.notes.length) drawNote(bufCtx, px, py, tileSize);
    }
  }

  // One grid overlay pass rather than 225 strokeRect calls per frame.
  bufCtx.strokeStyle = "rgba(255,255,255,0.035)";
  bufCtx.lineWidth = 1;
  bufCtx.beginPath();
  for (let x = 0; x <= w; x++) {
    bufCtx.moveTo(x * tileSize + 0.5, 0);
    bufCtx.lineTo(x * tileSize + 0.5, h * tileSize);
  }
  for (let y = 0; y <= h; y++) {
    bufCtx.moveTo(0, y * tileSize + 0.5);
    bufCtx.lineTo(w * tileSize, y * tileSize + 0.5);
  }
  bufCtx.stroke();

  signature = sig;
  return buffer;
}

export { getTerrainBuffer, noise, shade };
