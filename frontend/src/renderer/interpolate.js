/**
 * Interpolation — smoothly slides agents from their previous positions
 * to their current positions using an easing function.
 *
 * Uses store.prevAgents / store.agents / store.tickTimestamp.
 */

import { getState } from "../store.js";

const LERP_DURATION_MS = 300;

/**
 * Ease-out cubic: decelerates toward the end for a natural slide.
 */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * Return interpolated agent positions for the current frame.
 *
 * @param {number} now - current timestamp from requestAnimationFrame
 * @returns {Array<{name: string, x: number, y: number, agent: object}>}
 */
function getInterpolatedAgents(now) {
  const { agents, prevAgents, tickTimestamp } = getState();
  if (!agents.length) return [];

  const elapsed = now - tickTimestamp;
  const t = Math.min(elapsed / LERP_DURATION_MS, 1);
  const eased = easeOutCubic(t);

  // Build a lookup of previous positions by name
  const prevMap = new Map();
  for (const a of prevAgents) {
    prevMap.set(a.name, a);
  }

  return agents.map((agent) => {
    const prev = prevMap.get(agent.name);
    let x = agent.x;
    let y = agent.y;

    if (prev) {
      x = prev.x + (agent.x - prev.x) * eased;
      y = prev.y + (agent.y - prev.y) * eased;
    }

    return { name: agent.name, x, y, agent };
  });
}

export { getInterpolatedAgents };
