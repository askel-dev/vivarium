/**
 * WebSocket client with exponential backoff reconnection.
 *
 * Connects to the backend, dispatches tick updates into the store,
 * and exposes helpers to send control messages.
 */

import { update, getState } from "./store.js";
import { syncAgents, noteAgentPosition, forgetAgent } from "./renderer/interpolate.js";
import { spawnFromEvents } from "./renderer/effects.js";

const MAX_THOUGHTS = 60;

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
    // Full snapshot on connect — a mid-run reload paints immediately.
    case "init": {
      syncAgents(msg.agents || []);
      update({
        tick: msg.tick,
        timeOfDay: msg.time_of_day,
        worldSize: { width: msg.width, height: msg.height },
        ticksPerDay: msg.ticks_per_day || 50,
        grid: msg.grid,
        agents: msg.agents || [],
        prevAgents: msg.agents || [],
        relations: msg.relations || [],
        deadAgents: msg.dead || [],
        paused: !!msg.paused,
        speed: typeof msg.speed === "number" ? msg.speed : getState().speed,
      });
      break;
    }

    // A tick has begun; we know the turn order before anyone has acted.
    case "tick_start": {
      update({
        tick: msg.tick,
        timeOfDay: msg.time_of_day,
        turnOrder: msg.order || [],
        turnIndex: 0,
      });
      break;
    }

    // An agent is blocked on the LLM. This is the signal that keeps the screen
    // alive through the many seconds the model takes to answer.
    case "agent_thinking": {
      update({ thinkingAgent: msg.name, turnIndex: msg.index || 0 });
      break;
    }

    // An agent's decision landed. Patch just that agent so it moves now,
    // rather than teleporting with everyone else at tick end.
    case "agent_acted": {
      const s = getState();
      const agents = s.agents.map((a) =>
        a.name === msg.name
          ? { ...a, x: msg.x, y: msg.y, energy: msg.energy,
              inventory: msg.inventory, last_action: (msg.actions || [])[0] || "wait" }
          : a
      );
      noteAgentPosition(msg.name, msg.x, msg.y);

      // Pull the spoken words out of the action payload so the renderer can
      // show a speech bubble with what was actually said.
      const speakArgs = (msg.action_data || {}).speak;
      const feed = [...s.thoughtFeed, {
        name: msg.name,
        thought: msg.thought,
        actions: msg.actions || [],
        speech: speakArgs && speakArgs.message ? String(speakArgs.message) : null,
        volume: speakArgs && speakArgs.volume ? String(speakArgs.volume) : null,
        tick: msg.tick,
        ts: performance.now(),
      }].slice(-MAX_THOUGHTS);

      spawnFromEvents(msg.events || [], agents);

      update({
        agents,
        thinkingAgent: null,
        thoughtFeed: feed,
        bubbleSeq: s.bubbleSeq + 1,
        events: msg.events || [],
      });
      break;
    }

    case "agent_died": {
      const s = getState();
      if (!s.deadAgents.some((d) => d.name === msg.name)) {
        update({
          deadAgents: [...s.deadAgents, {
            name: msg.name, x: msg.x, y: msg.y, tick: msg.tick, cause: msg.cause,
          }],
        });
      }
      forgetAgent(msg.name);
      break;
    }

    // End-of-tick reconciliation: authoritative grid, energy drain, relations.
    case "tick": {
      const prev = getState().agents;
      syncAgents(msg.agents || []);
      // `structured` here is only the post-agent tail (starvation deaths);
      // everything else already arrived with its agent_acted message.
      const tail = msg.structured || [];
      if (tail.length) spawnFromEvents(tail, msg.agents || []);
      update({
        tick: msg.tick,
        timeOfDay: msg.time_of_day,
        worldSize: { width: msg.width, height: msg.height },
        grid: msg.grid,
        prevAgents: prev,
        agents: msg.agents,
        tickTimestamp: performance.now(),
        relations: msg.relations || [],
        thinkingAgent: null,
        events: tail,
      });
      break;
    }

    case "control_state": {
      update({ paused: !!msg.paused, speed: msg.speed });
      break;
    }

    case "session_end": {
      update({ sessionEnd: msg, thinkingAgent: null });
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
