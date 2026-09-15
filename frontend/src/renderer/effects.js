/**
 * effects.js — transient visual feedback driven by structured events.
 *
 * Floating numbers, impact flashes, build rings, theft arcs and speech ripples.
 * Everything here is short-lived and purely decorative: the renderer draws
 * whatever is alive this frame and drops the rest.
 */

import { colorForAgent, colorForEvent, hexAlpha } from "./palette.js";

const MAX_EFFECTS = 80;

/** @type {Array<object>} */
let effects = [];

function add(effect) {
  effects.push({ born: performance.now(), ...effect });
  if (effects.length > MAX_EFFECTS) {
    effects = effects.slice(-MAX_EFFECTS);
  }
}

/**
 * Translate one tick's structured events into visual effects.
 *
 * @param {Array<object>} events - structured event objects from the server
 * @param {Array<object>} agents - current agent list, to locate targets
 */
function spawnFromEvents(events, agents = []) {
  for (const evt of events) {
    if (!evt || typeof evt !== "object") continue;

    const color = colorForEvent(evt.type);
    // Hostile events carry the victim's tile in tx/ty; everything else
    // happens where the actor is standing.
    const hasTarget = typeof evt.tx === "number" && typeof evt.ty === "number";
    const x = hasTarget ? evt.tx : evt.x;
    const y = hasTarget ? evt.ty : evt.y;
    if (typeof x !== "number" || typeof y !== "number") continue;

    if (evt.float_text) {
      add({ kind: "float", x, y, text: evt.float_text, color, ttl: 1300 });
    }

    switch (evt.type) {
      case "attack":
        add({ kind: "flash", x, y, color: "#ffffff", ttl: 220 });
        add({ kind: "shake", x, y, ttl: 320 });
        break;

      case "death":
        add({ kind: "burst", x, y, color: "#ff3333", ttl: 900, particles: 10 });
        break;

      case "steal":
        if (typeof evt.x === "number") {
          add({
            kind: "arc", ttl: 700, color,
            fromX: evt.x, fromY: evt.y, toX: x, toY: y,
          });
        }
        break;

      case "push":
        add({ kind: "flash", x, y, color: "#ff79c6", ttl: 260 });
        break;

      case "build":
        add({ kind: "ring", x, y, color, ttl: 700, maxR: 1.1 });
        break;

      case "destroy":
        add({ kind: "burst", x, y, color, ttl: 600, particles: 7 });
        break;

      case "speak":
        // Ring sized to the volume's actual audible range.
        add({
          kind: "ring", x, y, ttl: 900,
          color: colorForAgent(evt.actor),
          maxR: Math.min(evt.range || 4, 10),
        });
        break;

      case "eat":
      case "pick_up":
        add({ kind: "ring", x, y, color, ttl: 450, maxR: 0.7 });
        break;

      case "write":
        add({ kind: "ring", x, y, color: "#ffffe0", ttl: 500, maxR: 0.6 });
        break;
    }
  }
}

/** Drop finished effects. Called once per frame before drawing. */
function prune(now) {
  if (!effects.length) return;
  effects = effects.filter((e) => now - e.born < e.ttl);
}

function getEffects() {
  return effects;
}

/** Per-tile shake offset, summed over any live shake effects on that tile. */
function shakeOffset(tileX, tileY, now) {
  let ox = 0;
  let oy = 0;
  for (const e of effects) {
    if (e.kind !== "shake" || e.x !== tileX || e.y !== tileY) continue;
    const t = (now - e.born) / e.ttl;
    if (t >= 1) continue;
    const amp = (1 - t) * 2.5;
    ox += Math.sin(now / 18) * amp;
    oy += Math.cos(now / 23) * amp;
  }
  return { ox, oy };
}

function clearEffects() {
  effects = [];
}

export { spawnFromEvents, prune, getEffects, shakeOffset, clearEffects, hexAlpha };
