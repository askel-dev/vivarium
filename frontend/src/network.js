/**
 * WebSocket client with exponential backoff reconnection.
 *
 * Connects to the backend, dispatches tick updates into the store,
 * and exposes helpers to send control messages.
 */

import { update, getState } from "./store.js";

/** @type {WebSocket|null} */
let ws = null;
let reconnectTimer = null;
let attempt = 0;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15000;
const JITTER = 0.3; // ±30 %

function getWsUrl() {
  const loc = window.location;
  // In dev (Vite proxy) the page is on :5173 and /ws is proxied.
  // In prod the page and WS share the same origin.
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/ws`;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jittered = delay * (1 + (Math.random() * 2 - 1) * JITTER);
  attempt++;
  console.log(`[ws] reconnecting in ${Math.round(jittered)} ms (attempt ${attempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, jittered);
}

function connect() {
  const url = getWsUrl();
  console.log(`[ws] connecting to ${url}`);

  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("[ws] connected");
    attempt = 0;
    update({ connected: true });
  });

  ws.addEventListener("close", () => {
    console.log("[ws] disconnected");
    ws = null;
    update({ connected: false });
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    // The close event always fires after error, so reconnect is handled there.
    ws?.close();
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case "tick": {
      const prev = getState().agents;
      const existingDead = getState().deadAgents;

      // Detect newly dead agents from events
      const deathPattern = /^(.+) has collapsed and died!$/;
      const newDead = [];
      if (msg.events) {
        for (const evt of msg.events) {
          const match = typeof evt === "string" ? evt.match(deathPattern) : null;
          if (match) {
            const deadName = match[1];
            // Avoid duplicates
            if (!existingDead.some(d => d.name === deadName) &&
                !newDead.some(d => d.name === deadName)) {
              // Find last-known position from previous tick's agents
              const lastKnown = prev.find(a => a.name === deadName);
              newDead.push({
                name: deadName,
                x: lastKnown ? lastKnown.x : 0,
                y: lastKnown ? lastKnown.y : 0,
                tick: msg.tick,
              });
            }
          }
        }
      }

      update({
        tick: msg.tick,
        timeOfDay: msg.time_of_day,
        grid: msg.grid,
        prevAgents: prev,
        agents: msg.agents,
        tickTimestamp: performance.now(),
        events: msg.events,
        deadAgents: newDead.length ? [...existingDead, ...newDead] : existingDead,
      });
      break;
    }
    case "agent_detail": {
      update({ agentDetail: msg });
      break;
    }
    default:
      console.log("[ws] unknown message type:", msg.type);
  }
}

// --- Public API: send control messages ---

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendPause() {
  send({ type: "pause" });
  update({ paused: true });
}

function sendResume() {
  send({ type: "resume" });
  update({ paused: false });
}

function sendSetSpeed(speed) {
  send({ type: "set_speed", speed });
  update({ speed });
}

function sendRequestAgentDetail(name) {
  send({ type: "request_agent_detail", name });
}

// --- Auto-request agent detail on selection ---

import { subscribe } from "./store.js";

subscribe("selectedAgent", (name) => {
  if (name) {
    sendRequestAgentDetail(name);
  }
});

export {
  connect,
  sendPause,
  sendResume,
  sendSetSpeed,
  sendRequestAgentDetail,
};
