/**
 * Interpolation — smoothly slides agents between tiles.
 *
 * Agents now move one at a time, as each `agent_acted` message arrives during a
 * tick, rather than all at once at tick end. So motion is tracked per agent on
 * its own clock instead of off a single global tick timestamp.
 */

import { getState } from "../store.js";

const LERP_DURATION_MS = 260;

/** @type {Map<string, {fromX:number, fromY:number, toX:number, toY:number, start:number}>} */
const motion = new Map();

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Where an agent is being drawn right now, mid-slide included. */
function currentPos(name, now) {
  const m = motion.get(name);
  if (!m) return null;
  const t = Math.min((now - m.start) / LERP_DURATION_MS, 1);
  const e = easeOutCubic(t);
  return {
    x: m.fromX + (m.toX - m.fromX) * e,
    y: m.fromY + (m.toY - m.fromY) * e,
    moving: t < 1,
    // Direction of travel, for the squash-and-stretch on the sprite.
    dx: m.toX - m.fromX,
    dy: m.toY - m.fromY,
  };
}

/**
 * Record a new destination for one agent. Starts a fresh slide from wherever
 * the agent is currently being drawn, so interrupting a slide looks continuous.
 */
function noteAgentPosition(name, x, y, now = performance.now()) {
  const existing = motion.get(name);
  if (!existing) {
    motion.set(name, { fromX: x, fromY: y, toX: x, toY: y, start: now });
    return;
  }
  if (existing.toX === x && existing.toY === y) return;

  const pos = currentPos(name, now);
  motion.set(name, {
    fromX: pos ? pos.x : x,
    fromY: pos ? pos.y : y,
    toX: x,
    toY: y,
    start: now,
  });
}

/** Bulk sync from a full snapshot (init / tick). */
function syncAgents(agents, now = performance.now()) {
  const live = new Set();
  for (const a of agents) {
    live.add(a.name);
    noteAgentPosition(a.name, a.x, a.y, now);
  }
  for (const name of [...motion.keys()]) {
    if (!live.has(name)) motion.delete(name);
  }
}

function forgetAgent(name) {
  motion.delete(name);
}

/**
 * Interpolated positions for the current frame.
 * @returns {Array<{name:string, x:number, y:number, dx:number, dy:number, moving:boolean, agent:object}>}
 */
function getInterpolatedAgents(now) {
  const { agents } = getState();
  if (!agents.length) return [];

  return agents.map((agent) => {
    const pos = currentPos(agent.name, now);
    return {
      name: agent.name,
      x: pos ? pos.x : agent.x,
      y: pos ? pos.y : agent.y,
      dx: pos ? pos.dx : 0,
      dy: pos ? pos.dy : 0,
      moving: pos ? pos.moving : false,
      agent,
    };
  });
}

export { getInterpolatedAgents, noteAgentPosition, syncAgents, forgetAgent };
