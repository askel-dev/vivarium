/**
 * Centralized Pub/Sub state manager.
 *
 * Holds all world state received from the server and local UI state.
 * Any module can subscribe to specific keys and get called when they change.
 */

const state = {
  // --- Server state (updated each tick) ---
  connected: false,
  tick: 0,
  timeOfDay: "morning",
  grid: [],
  agents: [],
  prevAgents: [],   // previous tick's agents for interpolation
  tickTimestamp: 0, // performance.now() when last tick arrived (for interpolation)
  events: [],

  // --- On-demand detail (fetched per request) ---
  agentDetail: null, // full detail for inspected agent

  // --- Local UI state ---
  paused: false,
  speed: 1.0,
  selectedAgent: null,  // agent name string
  selectedTile: null,   // {x, y} or null
  hoveredAgent: null,   // agent name string (mouse hover)
  deadAgents: [],       // [{ name, x, y, tick }] — persisted gravestones
};

/** @type {Map<string, Set<function>>} */
const listeners = new Map();

/**
 * Subscribe to changes on one or more state keys.
 * Returns an unsubscribe function.
 *
 * @param {string|string[]} keys
 * @param {function} callback - called with (newValue, key)
 */
function subscribe(keys, callback) {
  if (!Array.isArray(keys)) keys = [keys];
  for (const key of keys) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(callback);
  }
  return () => {
    for (const key of keys) {
      listeners.get(key)?.delete(callback);
    }
  };
}

/**
 * Update one or more state keys and notify subscribers.
 *
 * @param {Record<string, any>} patch - key/value pairs to merge
 */
function update(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in state)) {
      console.warn(`[store] unknown key: ${key}`);
      continue;
    }
    state[key] = value;
    const subs = listeners.get(key);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(value, key);
        } catch (err) {
          console.error(`[store] subscriber error on "${key}":`, err);
        }
      }
    }
  }
}

/**
 * Read current state (read-only reference).
 */
function getState() {
  return state;
}

export { subscribe, update, getState };
