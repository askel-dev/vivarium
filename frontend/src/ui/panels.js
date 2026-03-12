/**
 * panels.js — DOM manipulation for the Inspector and Event Log panels.
 *
 * Subscribes to store changes and updates the DOM securely
 * (using textContent for user-generated strings to prevent XSS).
 */

import { subscribe, update, getState } from "../store.js";

// ---------------------------------------------------------------------------
// DOM references (cached once on init)
// ---------------------------------------------------------------------------

let inspectorEl, inspectorEmpty, inspectorContent;
let nameEl, posEl, energyFill, energyLabel, inventoryEl, personalityEl;
let beliefsEl, memoryEl, journalEl;
let eventLogBody, eventLogCount;
let closeBtn;

// Track total events for the counter
let totalEventCount = 0;

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

function initPanels() {
  // Inspector
  inspectorEl      = document.getElementById("inspector");
  inspectorEmpty   = document.getElementById("inspector-empty");
  inspectorContent = document.getElementById("inspector-content");
  nameEl           = document.getElementById("inspector-agent-name");
  posEl            = document.getElementById("inspector-agent-pos");
  energyFill       = document.getElementById("energy-bar-fill");
  energyLabel      = document.getElementById("energy-bar-label");
  inventoryEl      = document.getElementById("inspector-inventory");
  personalityEl    = document.getElementById("inspector-personality");
  beliefsEl        = document.getElementById("inspector-beliefs");
  memoryEl         = document.getElementById("inspector-memory");
  journalEl        = document.getElementById("inspector-journal");
  closeBtn         = document.getElementById("inspector-close");

  // Event Log
  eventLogBody  = document.getElementById("event-log-body");
  eventLogCount = document.getElementById("event-log-count");

  // Close button deselects agent
  closeBtn.addEventListener("click", () => {
    update({ selectedAgent: null, agentDetail: null });
  });

  // Subscribe to store
  subscribe("selectedAgent", onSelectedAgentChange);
  subscribe("agentDetail", onAgentDetailChange);
  subscribe("events", onEventsChange);

  // Also update inspector position/energy from tick data if an agent is selected
  subscribe("agents", onAgentsTickUpdate);
}

// ---------------------------------------------------------------------------
// Inspector: selection state
// ---------------------------------------------------------------------------

function onSelectedAgentChange(agentName) {
  if (agentName) {
    inspectorEmpty.classList.add("hidden");
    inspectorContent.classList.remove("hidden");
    // Show name immediately, rest fills in when detail arrives
    nameEl.textContent = agentName;
    posEl.textContent = "";
    // Clear stale detail fields
    clearDetailFields();
  } else {
    inspectorEmpty.classList.remove("hidden");
    inspectorContent.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Inspector: full detail from server
// ---------------------------------------------------------------------------

function onAgentDetailChange(detail) {
  if (!detail) return;

  nameEl.textContent = detail.name;
  posEl.textContent = `(${detail.x}, ${detail.y})`;

  // Energy bar
  const maxE = detail.max_energy || 100;
  const pct = Math.max(0, Math.min(100, (detail.energy / maxE) * 100));
  energyFill.style.width = `${pct}%`;
  energyLabel.textContent = `${detail.energy} / ${maxE}`;

  // Color-code energy bar
  if (pct > 60) {
    energyFill.style.background = "var(--success)";
  } else if (pct > 30) {
    energyFill.style.background = "var(--warning)";
  } else {
    energyFill.style.background = "var(--danger)";
  }

  // Inventory badges
  inventoryEl.innerHTML = "";
  const inv = detail.inventory || {};
  for (const [type, qty] of Object.entries(inv)) {
    const badge = document.createElement("span");
    badge.className = `inv-badge ${type}`;
    badge.textContent = `${type}: ${qty}`;
    inventoryEl.appendChild(badge);
  }

  // Personality
  personalityEl.textContent = detail.personality || "—";

  // Beliefs
  renderList(beliefsEl, detail.beliefs || []);

  // Working Memory
  renderList(memoryEl, detail.working_memory || []);

  // Journal
  renderList(journalEl, detail.journal || []);
}

/**
 * When we receive a tick while an agent is selected, update the energy/position
 * in real-time without waiting for a full detail request.
 */
function onAgentsTickUpdate(agents) {
  const selectedName = getState().selectedAgent;
  if (!selectedName) return;

  const agent = agents.find(a => a.name === selectedName);
  if (!agent) {
    // Agent may have died
    update({ selectedAgent: null, agentDetail: null });
    return;
  }

  // Update position
  posEl.textContent = `(${agent.x}, ${agent.y})`;

  // Update energy bar from tick data
  const maxE = agent.max_energy || 100;
  const pct = Math.max(0, Math.min(100, (agent.energy / maxE) * 100));
  energyFill.style.width = `${pct}%`;
  energyLabel.textContent = `${agent.energy} / ${maxE}`;

  if (pct > 60) {
    energyFill.style.background = "var(--success)";
  } else if (pct > 30) {
    energyFill.style.background = "var(--warning)";
  } else {
    energyFill.style.background = "var(--danger)";
  }
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

function onEventsChange(events) {
  if (!events || !events.length) return;

  const tick = getState().tick;

  for (const evt of events) {
    const entry = document.createElement("div");
    entry.className = "event-entry";

    const tickSpan = document.createElement("span");
    tickSpan.className = "event-tick";
    tickSpan.textContent = `[${tick}]`;

    const textNode = document.createTextNode(` ${evt}`);

    entry.appendChild(tickSpan);
    entry.appendChild(textNode);
    eventLogBody.appendChild(entry);
    totalEventCount++;
  }

  // Cap at 150 entries
  while (eventLogBody.childElementCount > 150) {
    eventLogBody.removeChild(eventLogBody.firstChild);
  }

  // Auto-scroll to bottom
  eventLogBody.scrollTop = eventLogBody.scrollHeight;

  // Update counter
  eventLogCount.textContent = `${eventLogBody.childElementCount} events`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearDetailFields() {
  energyFill.style.width = "0%";
  energyLabel.textContent = "";
  inventoryEl.innerHTML = "";
  personalityEl.textContent = "";
  beliefsEl.innerHTML = "";
  memoryEl.innerHTML = "";
  journalEl.innerHTML = "";
}

/**
 * Render an array of strings as <li> elements (using textContent for safety).
 */
function renderList(ulEl, items) {
  ulEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ulEl.appendChild(li);
  }
}

export { initPanels };
