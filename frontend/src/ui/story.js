/**
 * story.js — end-of-run narrative overlay.
 *
 * The generated story used to be written to a .txt next to the logs and never
 * shown. This is the payoff for a run, so it gets a proper curtain call: the
 * prose types itself out, then the cast and their fates.
 */

import { subscribe, getState } from "../store.js";
import { colorForAgent } from "../renderer/palette.js";

let overlay, titleEl, proseEl, castEl, closeBtn, subtitleEl;
let typeTimer = null;

function initStory() {
  overlay    = document.getElementById("story-overlay");
  titleEl    = document.getElementById("story-title");
  subtitleEl = document.getElementById("story-subtitle");
  proseEl    = document.getElementById("story-prose");
  castEl     = document.getElementById("story-cast");
  closeBtn   = document.getElementById("story-close");

  closeBtn.addEventListener("click", hide);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) hide();
  });

  subscribe("sessionEnd", onSessionEnd);
}

function hide() {
  overlay.classList.add("hidden");
  if (typeTimer) {
    clearInterval(typeTimer);
    typeTimer = null;
  }
}

function onSessionEnd(session) {
  if (!session) return;

  titleEl.textContent = "The world is quiet";
  subtitleEl.textContent = `${session.reason} · ${session.tick} ticks`;

  renderCast(session.cast || []);

  const story = session.story;
  if (story) {
    typeOut(String(story).trim());
  } else {
    proseEl.textContent =
      "No story was written for this run. Check that Ollama is reachable, " +
      "or set STORY_ENABLED = False in config.py to skip narration entirely.";
    proseEl.classList.add("story-empty");
  }

  overlay.classList.remove("hidden");
}

/** Progressive reveal — fast enough to read along with, skippable by clicking. */
function typeOut(text) {
  proseEl.classList.remove("story-empty");
  proseEl.textContent = "";

  let i = 0;
  const step = 3;
  if (typeTimer) clearInterval(typeTimer);

  const finish = () => {
    if (typeTimer) clearInterval(typeTimer);
    typeTimer = null;
    proseEl.textContent = text;
  };

  typeTimer = setInterval(() => {
    i += step;
    proseEl.textContent = text.slice(0, i);
    if (i >= text.length) finish();
  }, 16);

  proseEl.addEventListener("click", finish, { once: true });
}

function renderCast(cast) {
  castEl.replaceChildren();

  for (const member of cast) {
    const name = member.name || "Unknown";
    const row = document.createElement("div");
    row.className = "story-cast-row";

    const chip = document.createElement("span");
    chip.className = "story-cast-chip";
    chip.style.background = colorForAgent(name);

    const nameEl = document.createElement("span");
    nameEl.className = "story-cast-name";
    nameEl.textContent = name;
    nameEl.style.color = colorForAgent(name);

    const fate = document.createElement("span");
    fate.className = `story-cast-fate ${member.fate === "survived" ? "survived" : "died"}`;
    if (member.fate === "survived") {
      fate.textContent = "survived";
    } else if (member.death_tick != null) {
      fate.textContent = `died · tick ${member.death_tick}`;
    } else {
      fate.textContent = "died";
    }

    row.appendChild(chip);
    row.appendChild(nameEl);
    row.appendChild(fate);

    if (member.traits_summary) {
      const traits = document.createElement("div");
      traits.className = "story-cast-traits";
      traits.textContent = member.traits_summary;
      row.appendChild(traits);
    }

    castEl.appendChild(row);
  }
}

export { initStory };
