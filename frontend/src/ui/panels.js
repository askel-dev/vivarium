/**
 * panels.js — DOM for the Inspector and Event Log panels.
 *
 * Subscribes to store changes and updates the DOM securely (textContent for
 * anything model-generated). The event log now consumes structured event
 * objects rather than prose strings, so entries can be typed, coloured,
 * filtered, and anchored back to a tile.
 */

import { subscribe, update, getState } from "../store.js";
import { colorForAgent, colorForEvent } from "../renderer/palette.js";
import { focusTile } from "../renderer/canvas.js";
import { sendRequestAgentDetail } from "../network.js";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

let inspectorEmpty, inspectorContent, inspectorTileContent;
let nameEl, posEl, energyFill, energyLabel, inventoryEl, personalityEl;
let goalEl, lastActionEl, thoughtEl, relationsEl;
let beliefsEl, memoryEl, journalEl;
let tilePosEl, tileTerrainEl, tileItemsEl, tileStructureEl, notesEl;
let eventLogBody, eventLogCount, filterBar;
let closeBtn;

const MAX_LOG_ENTRIES = 200;

/**
 * Noise filter. `move`, `wait` and `invalid` fire constantly and drown out the
 * events that actually matter, so they are off by default.
 */
const NOISY_TYPES = new Set(["move", "wait", "invalid"]);
let showNoise = false;

/** Category chips -> the event types they cover. */
const FILTERS = {
  combat:  ["attack", "steal", "push", "death"],
  speech:  ["speak", "write"],
  build:   ["build", "destroy", "chop"],
  survive: ["eat", "pick_up"],
};
const activeFilters = new Set(Object.keys(FILTERS));

/** True while the user has scrolled up to read history. */
let userScrolledUp = false;

/** Periodic refresh so beliefs/memory don't freeze at the moment of selection. */
let detailRefreshTimer = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initPanels() {
  inspectorEmpty       = document.getElementById("inspector-empty");
  inspectorContent     = document.getElementById("inspector-content");
  inspectorTileContent = document.getElementById("inspector-tile-content");
  nameEl         = document.getElementById("inspector-agent-name");
  posEl          = document.getElementById("inspector-agent-pos");
  energyFill     = document.getElementById("energy-bar-fill");
  energyLabel    = document.getElementById("energy-bar-label");
  inventoryEl    = document.getElementById("inspector-inventory");
  personalityEl  = document.getElementById("inspector-personality");
  goalEl         = document.getElementById("inspector-goal");
  lastActionEl   = document.getElementById("inspector-last-action");
  thoughtEl      = document.getElementById("inspector-thought");
  relationsEl    = document.getElementById("inspector-relations");
  beliefsEl      = document.getElementById("inspector-beliefs");
  memoryEl       = document.getElementById("inspector-memory");
  journalEl      = document.getElementById("inspector-journal");
  tilePosEl      = document.getElementById("inspector-tile-pos");
  tileTerrainEl  = document.getElementById("inspector-tile-terrain");
  tileItemsEl    = document.getElementById("inspector-tile-items");
  tileStructureEl= document.getElementById("inspector-tile-structure");
  notesEl        = document.getElementById("inspector-notes");
  closeBtn       = document.getElementById("inspector-close");

  eventLogBody  = document.getElementById("event-log-body");
  eventLogCount = document.getElementById("event-log-count");
  filterBar     = document.getElementById("event-log-filters");

  closeBtn.addEventListener("click", () => {
    update({ selectedAgent: null, agentDetail: null, selectedTile: null });
  });

  buildFilterChips();

  // Don't yank the view to the bottom while the user is reading back.
  eventLogBody.addEventListener("scroll", () => {
    const dist = eventLogBody.scrollHeight - eventLogBody.scrollTop - eventLogBody.clientHeight;
    userScrolledUp = dist > 24;
  });

  subscribe("selectedAgent", onSelectedAgentChange);
  subscribe("selectedTile", onSelectedTileChange);
  subscribe("agentDetail", onAgentDetailChange);
  subscribe("events", onEventsChange);
  subscribe("grid", onGridChange);
  subscribe("agents", onAgentsTickUpdate);
  subscribe("thoughtFeed", onThoughtFeedChange);
}

// ---------------------------------------------------------------------------
// Inspector: selection
// ---------------------------------------------------------------------------

function onSelectedAgentChange(agentName) {
  const selectedTile = getState().selectedTile;

  if (detailRefreshTimer) {
    clearInterval(detailRefreshTimer);
    detailRefreshTimer = null;
  }

  if (agentName) {
    inspectorEmpty.classList.add("hidden");
    inspectorTileContent.classList.add("hidden");
    inspectorContent.classList.remove("hidden");
    nameEl.textContent = agentName;
    nameEl.style.color = colorForAgent(agentName);
    posEl.textContent = "";
    clearDetailFields();

    // Beliefs, memory and journal change every tick; re-pull them while the
    // agent stays selected instead of leaving a stale snapshot on screen.
    detailRefreshTimer = setInterval(() => {
      const current = getState().selectedAgent;
      if (current) sendRequestAgentDetail(current);
      else clearInterval(detailRefreshTimer);
    }, 4000);
  } else if (selectedTile) {
    inspectorContent.classList.add("hidden");
    inspectorEmpty.classList.add("hidden");
    inspectorTileContent.classList.remove("hidden");
  } else {
    inspectorEmpty.classList.remove("hidden");
    inspectorContent.classList.add("hidden");
    inspectorTileContent.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Inspector: tile
// ---------------------------------------------------------------------------

function onSelectedTileChange(tile) {
  if (getState().selectedAgent) return; // agent takes precedence

  if (tile) {
    inspectorEmpty.classList.add("hidden");
    inspectorContent.classList.add("hidden");
    inspectorTileContent.classList.remove("hidden");
    tilePosEl.textContent = `(${tile.x}, ${tile.y})`;
    updateTilePanel(tile);
  } else {
    inspectorEmpty.classList.remove("hidden");
    inspectorContent.classList.add("hidden");
    inspectorTileContent.classList.add("hidden");
  }
}

function onGridChange() {
  const tile = getState().selectedTile;
  if (!tile || getState().selectedAgent) return;
  updateTilePanel(tile);
}

function updateTilePanel(tile) {
  const grid = getState().grid;
  if (!grid || !grid[tile.y] || !grid[tile.y][tile.x]) return;

  const cell = grid[tile.y][tile.x];

  // Terrain — previously the tile panel showed nothing but notes.
  tileTerrainEl.textContent = cell.terrain || "unknown";
  tileTerrainEl.className = `tile-terrain terrain-${cell.terrain}`;

  // Items.
  tileItemsEl.replaceChildren();
  if (cell.items && cell.items.length) {
    for (const item of cell.items) {
      const badge = document.createElement("span");
      badge.className = `inv-badge ${item.type}`;
      badge.textContent = `${item.type}: ${item.quantity}`;
      tileItemsEl.appendChild(badge);
    }
  } else {
    tileItemsEl.appendChild(dimText("Nothing here."));
  }

  // Structure.
  tileStructureEl.replaceChildren();
  if (cell.structure) {
    const label = document.createElement("span");
    label.className = "tile-structure";
    label.textContent = cell.structure.type;
    const by = document.createElement("span");
    by.className = "tile-structure-by";
    by.textContent = ` built by ${cell.structure.builder}`;
    by.style.color = colorForAgent(cell.structure.builder);
    tileStructureEl.appendChild(label);
    tileStructureEl.appendChild(by);
  } else {
    tileStructureEl.appendChild(dimText("No structure."));
  }

  // Notes.
  notesEl.replaceChildren();
  if (cell.notes && cell.notes.length) {
    for (const note of cell.notes) {
      const li = document.createElement("li");

      const tickSpan = document.createElement("span");
      tickSpan.className = "event-tick";
      tickSpan.textContent = `[${note.tick}] `;

      const authorSpan = document.createElement("strong");
      authorSpan.textContent = note.author;
      authorSpan.style.color = colorForAgent(note.author);

      li.appendChild(tickSpan);
      li.appendChild(authorSpan);
      li.appendChild(document.createTextNode(`: ${note.content}`));
      notesEl.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "No notes on this tile.";
    li.style.color = "var(--text-dim)";
    li.style.fontStyle = "italic";
    notesEl.appendChild(li);
  }
}

function dimText(text) {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.color = "var(--text-dim)";
  span.style.fontStyle = "italic";
  return span;
}

// ---------------------------------------------------------------------------
// Inspector: agent detail
// ---------------------------------------------------------------------------

function onAgentDetailChange(detail) {
  if (!detail) return;
  if (getState().selectedAgent !== detail.name) return;

  nameEl.textContent = detail.name;
  nameEl.style.color = colorForAgent(detail.name);
  posEl.textContent = `(${detail.x}, ${detail.y})`;

  setEnergy(detail.energy, detail.max_energy);

  inventoryEl.replaceChildren();
  for (const [type, qty] of Object.entries(detail.inventory || {})) {
    const badge = document.createElement("span");
    badge.className = `inv-badge ${type}`;
    badge.textContent = `${type}: ${qty}`;
    inventoryEl.appendChild(badge);
  }

  personalityEl.textContent = detail.personality || "—";
  // Was transmitted every tick and never displayed.
  goalEl.textContent = detail.private_goal || "—";

  renderRelations(detail.relations || {});
  renderList(beliefsEl, detail.beliefs || []);
  renderList(memoryEl, detail.working_memory || []);
  renderList(journalEl, detail.journal || []);
}

function renderRelations(relations) {
  relationsEl.replaceChildren();
  const entries = Object.entries(relations);
  if (!entries.length) {
    relationsEl.appendChild(dimText("No opinions yet."));
    return;
  }
  for (const [other, sentiment] of entries) {
    const badge = document.createElement("span");
    badge.className = `relation-badge ${sentiment}`;
    badge.textContent = other;
    badge.title = `${other}: ${sentiment}`;
    badge.style.borderColor = colorForAgent(other);
    relationsEl.appendChild(badge);
  }
}

function setEnergy(energy, maxEnergy) {
  const max = maxEnergy || 120;
  const pct = Math.max(0, Math.min(100, (energy / max) * 100));
  energyFill.style.width = `${pct}%`;
  energyLabel.textContent = `${energy} / ${max}`;
  energyFill.style.background =
    pct > 60 ? "var(--success)" : pct > 30 ? "var(--warning)" : "var(--danger)";
}

/** Live position/energy/last-action between detail fetches. */
function onAgentsTickUpdate(agents) {
  const selectedName = getState().selectedAgent;
  if (!selectedName) return;

  const agent = agents.find((a) => a.name === selectedName);
  if (!agent) return; // died — keep the panel up rather than snapping it shut

  posEl.textContent = `(${agent.x}, ${agent.y})`;
  setEnergy(agent.energy, agent.max_energy);
  lastActionEl.textContent = agent.last_action || "—";

  inventoryEl.replaceChildren();
  for (const [type, qty] of Object.entries(agent.inventory || {})) {
    const badge = document.createElement("span");
    badge.className = `inv-badge ${type}`;
    badge.textContent = `${type}: ${qty}`;
    inventoryEl.appendChild(badge);
  }
}

/** The selected agent's most recent inner monologue. */
function onThoughtFeedChange(feed) {
  const selectedName = getState().selectedAgent;
  if (!selectedName || !feed.length) return;

  for (let i = feed.length - 1; i >= 0; i--) {
    if (feed[i].name !== selectedName) continue;
    const item = feed[i];
    thoughtEl.replaceChildren();

    if (item.thought) {
      const p = document.createElement("p");
      p.className = "thought-text";
      p.textContent = item.thought;
      thoughtEl.appendChild(p);
    }
    if (item.speech) {
      const said = document.createElement("p");
      said.className = "thought-speech";
      said.textContent = `${item.volume || "talk"}: “${item.speech}”`;
      said.style.color = colorForAgent(selectedName);
      thoughtEl.appendChild(said);
    }
    if (!thoughtEl.childElementCount) {
      thoughtEl.appendChild(dimText("No thought recorded."));
    }
    lastActionEl.textContent = (item.actions || [])[0] || "—";
    return;
  }
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

function buildFilterChips() {
  for (const key of Object.keys(FILTERS)) {
    const chip = document.createElement("button");
    chip.className = "filter-chip active";
    chip.textContent = key;
    chip.dataset.filter = key;
    chip.addEventListener("click", () => {
      if (activeFilters.has(key)) {
        activeFilters.delete(key);
        chip.classList.remove("active");
      } else {
        activeFilters.add(key);
        chip.classList.add("active");
      }
      applyFilters();
    });
    filterBar.appendChild(chip);
  }

  const noiseChip = document.createElement("button");
  noiseChip.className = "filter-chip noise";
  noiseChip.textContent = "noise";
  noiseChip.title = "Show moves, waits and invalid actions";
  noiseChip.addEventListener("click", () => {
    showNoise = !showNoise;
    noiseChip.classList.toggle("active", showNoise);
    applyFilters();
  });
  filterBar.appendChild(noiseChip);
}

function categoryOf(type) {
  for (const [key, types] of Object.entries(FILTERS)) {
    if (types.includes(type)) return key;
  }
  return null;
}

function entryVisible(type) {
  if (NOISY_TYPES.has(type)) return showNoise;
  const cat = categoryOf(type);
  if (!cat) return true;
  return activeFilters.has(cat);
}

function applyFilters() {
  for (const el of eventLogBody.children) {
    el.classList.toggle("hidden", !entryVisible(el.dataset.type));
  }
  updateCount();
}

function updateCount() {
  const visible = [...eventLogBody.children].filter((el) => !el.classList.contains("hidden"));
  eventLogCount.textContent = `${visible.length} shown`;
}

function onEventsChange(events) {
  if (!events || !events.length) return;

  for (const evt of events) {
    // Tolerate a plain string, in case anything still emits prose.
    const obj = typeof evt === "string" ? { type: "misc", text: evt } : evt;
    if (!obj.text) continue;
    eventLogBody.appendChild(buildEntry(obj));
  }

  while (eventLogBody.childElementCount > MAX_LOG_ENTRIES) {
    eventLogBody.removeChild(eventLogBody.firstChild);
  }

  if (!userScrolledUp) {
    eventLogBody.scrollTop = eventLogBody.scrollHeight;
  }
  updateCount();
}

function buildEntry(evt) {
  const type = evt.type || "misc";
  const entry = document.createElement("div");
  entry.className = `event-entry type-${type}`;
  entry.dataset.type = type;
  if (!entryVisible(type)) entry.classList.add("hidden");

  const tickSpan = document.createElement("span");
  tickSpan.className = "event-tick";
  tickSpan.textContent = `[${getState().tick}]`;

  const dot = document.createElement("span");
  dot.className = "event-dot";
  dot.style.background = colorForEvent(type);
  dot.title = type;

  // Colour the actor's name inside the prose so you can scan by who did what.
  const body = document.createElement("span");
  body.className = "event-text";
  const actor = evt.actor;
  if (actor && evt.text.startsWith(actor)) {
    const nameSpan = document.createElement("strong");
    nameSpan.textContent = actor;
    nameSpan.style.color = colorForAgent(actor);
    body.appendChild(nameSpan);
    body.appendChild(document.createTextNode(evt.text.slice(actor.length)));
  } else {
    body.textContent = evt.text;
  }

  entry.appendChild(tickSpan);
  entry.appendChild(dot);
  entry.appendChild(body);

  // Click to fly the camera to where it happened.
  if (typeof evt.x === "number" && typeof evt.y === "number") {
    entry.classList.add("clickable");
    const tx = typeof evt.tx === "number" ? evt.tx : evt.x;
    const ty = typeof evt.ty === "number" ? evt.ty : evt.y;
    entry.title = `Go to (${tx}, ${ty})`;
    entry.addEventListener("click", () => {
      const stillAlive = getState().agents.some((a) => a.name === evt.actor);
      focusTile(tx, ty, stillAlive ? evt.actor : null);
    });
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearDetailFields() {
  energyFill.style.width = "0%";
  energyLabel.textContent = "";
  inventoryEl.replaceChildren();
  personalityEl.textContent = "";
  goalEl.textContent = "";
  lastActionEl.textContent = "";
  thoughtEl.replaceChildren();
  relationsEl.replaceChildren();
  beliefsEl.replaceChildren();
  memoryEl.replaceChildren();
  journalEl.replaceChildren();
}

function renderList(ulEl, items) {
  ulEl.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "—";
    li.style.color = "var(--text-dim)";
    ulEl.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ulEl.appendChild(li);
  }
}

export { initPanels };
