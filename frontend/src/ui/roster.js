/**
 * roster.js — the left-hand agent rail.
 *
 * One card per agent, so the whole cast is visible at once instead of one at a
 * time through the inspector. The card of the agent currently waiting on the
 * model is highlighted, which makes the turn order visibly sweep down the rail
 * as a tick plays out.
 */

import { subscribe, update, getState } from "../store.js";
import { colorForAgent } from "../renderer/palette.js";
import { focusTile } from "../renderer/canvas.js";

let rosterEl, rosterBody, rosterCount;

/** @type {Map<string, object>} cached card nodes, keyed by agent name */
const cards = new Map();

function initRoster() {
  rosterEl = document.getElementById("roster");
  rosterBody = document.getElementById("roster-body");
  rosterCount = document.getElementById("roster-count");

  subscribe(["agents", "deadAgents"], rebuild);
  subscribe("thinkingAgent", onThinkingChange);
  subscribe("selectedAgent", onSelectionChange);
  subscribe("thoughtFeed", onFeedChange);
}

// ---------------------------------------------------------------------------
// Card construction
// ---------------------------------------------------------------------------

function buildCard(name) {
  const color = colorForAgent(name);

  const el = document.createElement("div");
  el.className = "roster-card";
  el.dataset.name = name;

  const chip = document.createElement("span");
  chip.className = "roster-chip";
  chip.style.background = color;

  const main = document.createElement("div");
  main.className = "roster-main";

  const nameRow = document.createElement("div");
  nameRow.className = "roster-name-row";

  const nameEl = document.createElement("span");
  nameEl.className = "roster-name";
  nameEl.textContent = name;
  nameEl.style.color = color;

  const energyText = document.createElement("span");
  energyText.className = "roster-energy-text";

  nameRow.appendChild(nameEl);
  nameRow.appendChild(energyText);

  const bar = document.createElement("div");
  bar.className = "roster-bar";
  const fill = document.createElement("div");
  fill.className = "roster-bar-fill";
  bar.appendChild(fill);

  const status = document.createElement("div");
  status.className = "roster-status";

  const inv = document.createElement("div");
  inv.className = "roster-inv";

  main.appendChild(nameRow);
  main.appendChild(bar);
  main.appendChild(inv);
  main.appendChild(status);

  el.appendChild(chip);
  el.appendChild(main);

  el.addEventListener("click", () => {
    const agent = getState().agents.find((a) => a.name === name);
    if (agent) {
      focusTile(agent.x, agent.y, name);
    } else {
      const dead = getState().deadAgents.find((d) => d.name === name);
      if (dead) focusTile(dead.x, dead.y);
    }
  });

  const node = { el, fill, energyText, status, inv };
  cards.set(name, node);
  return node;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

function rebuild() {
  const { agents, deadAgents, selectedAgent, thinkingAgent } = getState();
  if (!rosterBody) return;

  const seen = new Set();
  const fragment = document.createDocumentFragment();

  for (const agent of agents) {
    seen.add(agent.name);
    const node = cards.get(agent.name) || buildCard(agent.name);
    // Set the thinking class first: applyLiveState reads it to decide whether
    // it may overwrite the status line.
    node.el.classList.toggle("thinking", thinkingAgent === agent.name);
    node.el.classList.remove("dead");
    node.el.classList.toggle("selected", selectedAgent === agent.name);
    applyLiveState(node, agent);
    fragment.appendChild(node.el);
  }

  for (const dead of deadAgents) {
    if (seen.has(dead.name)) continue;
    seen.add(dead.name);
    const node = cards.get(dead.name) || buildCard(dead.name);
    node.el.classList.add("dead");
    node.el.classList.remove("thinking", "selected");
    node.fill.style.width = "0%";
    node.energyText.textContent = "";
    node.inv.textContent = "";
    node.status.textContent =
      dead.cause === "starvation"
        ? `starved · tick ${dead.tick}`
        : `killed · tick ${dead.tick}`;
    fragment.appendChild(node.el);
  }

  rosterBody.replaceChildren(fragment);

  const aliveCount = agents.length;
  const deadCount = [...seen].length - aliveCount;
  rosterCount.textContent = deadCount
    ? `${aliveCount} alive · ${deadCount} lost`
    : `${aliveCount} alive`;
}

function applyLiveState(node, agent) {
  const max = agent.max_energy || 120;
  const pct = Math.max(0, Math.min(100, (agent.energy / max) * 100));

  node.fill.style.width = `${pct}%`;
  node.fill.style.background =
    pct > 50 ? "var(--success)" : pct > 25 ? "var(--warning)" : "var(--danger)";
  node.energyText.textContent = String(agent.energy);
  node.energyText.style.color =
    pct > 50 ? "var(--text-dim)" : pct > 25 ? "var(--warning)" : "var(--danger)";

  // Inventory, only what the agent actually carries.
  node.inv.replaceChildren();
  for (const [type, qty] of Object.entries(agent.inventory || {})) {
    if (!qty) continue;
    const badge = document.createElement("span");
    badge.className = `roster-inv-badge ${type}`;
    badge.textContent = `${type[0].toUpperCase()}${qty}`;
    badge.title = `${type}: ${qty}`;
    node.inv.appendChild(badge);
  }

  if (!node.el.classList.contains("thinking")) {
    node.status.textContent = agent.last_action ? `${agent.last_action}` : "waiting…";
    node.status.classList.remove("is-thinking");
  }
}

function onThinkingChange(name) {
  for (const [cardName, node] of cards) {
    const active = cardName === name;
    node.el.classList.toggle("thinking", active);
    if (active) {
      node.status.textContent = "thinking…";
      node.status.classList.add("is-thinking");
      // Keep the acting agent in view during a long run.
      node.el.scrollIntoView({ block: "nearest" });
    } else {
      node.status.classList.remove("is-thinking");
    }
  }
}

function onSelectionChange(name) {
  for (const [cardName, node] of cards) {
    node.el.classList.toggle("selected", cardName === name);
  }
}

/** Show the most recent action verb once an agent has acted. */
function onFeedChange(feed) {
  if (!feed.length) return;
  const last = feed[feed.length - 1];
  const node = cards.get(last.name);
  if (!node) return;
  const verb = (last.actions || [])[0] || "wait";
  node.status.textContent = last.speech ? `said something` : verb;
  node.status.classList.remove("is-thinking");
}

export { initRoster };
