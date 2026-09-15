/**
 * controls.js — Play/Pause button, Speed slider, and keyboard shortcuts.
 *
 * Sends control messages via network.js and reflects state from store.js.
 */

import { subscribe, getState, update } from "../store.js";
import { sendPause, sendResume, sendSetSpeed } from "../network.js";
import { panBy, zoomBy, frameWorld } from "../renderer/camera.js";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

let btnPlayPause, btnIcon;
let speedSlider, speedValue;
let tickInfo, btnRelations;

/** Emoji for each period of the day cycle. */
const TIME_ICONS = {
  morning: "🌅",
  midday: "☀️",
  afternoon: "🌤️",
  evening: "🌆",
  night: "🌙",
};

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

function initControls() {
  btnPlayPause = document.getElementById("btn-play-pause");
  btnIcon      = document.getElementById("btn-pp-icon");
  speedSlider  = document.getElementById("speed-slider");
  speedValue   = document.getElementById("speed-value");
  tickInfo     = document.getElementById("tick-info");
  btnRelations = document.getElementById("btn-relations");

  // Play/Pause click
  btnPlayPause.addEventListener("click", togglePause);

  // Speed slider
  speedSlider.addEventListener("input", onSpeedInput);

  // Social overlay toggle
  btnRelations.addEventListener("click", toggleRelations);

  // Keyboard shortcuts
  window.addEventListener("keydown", onKeyDown);

  // Subscribe to store
  subscribe("paused", onPausedChange);
  subscribe("speed", onSpeedChange);
  subscribe(["tick", "agents", "timeOfDay", "thinkingAgent"], onTickChange);
  subscribe("connected", onConnectedChange);
  subscribe("showRelations", onRelationsChange);
}

function toggleRelations() {
  update({ showRelations: !getState().showRelations });
}

function onRelationsChange(on) {
  btnRelations.classList.toggle("active", on);
  btnRelations.title = on ? "Hide relationships (R)" : "Show relationships (R)";
}

// ---------------------------------------------------------------------------
// Play / Pause
// ---------------------------------------------------------------------------

function togglePause() {
  const { paused } = getState();
  if (paused) {
    sendResume();
  } else {
    sendPause();
  }
}

function onPausedChange(paused) {
  btnIcon.textContent = paused ? "▶" : "⏸";
  btnPlayPause.title = paused ? "Resume (Space)" : "Pause (Space)";
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

function onSpeedInput() {
  const val = parseFloat(speedSlider.value);
  sendSetSpeed(val);
}

function onSpeedChange(speed) {
  speedSlider.value = speed;
  speedValue.textContent = `${speed.toFixed(1)}×`;
}

// ---------------------------------------------------------------------------
// Tick display
// ---------------------------------------------------------------------------

function onTickChange() {
  const s = getState();
  const agentCount = s.agents.length;
  const plural = agentCount !== 1 ? "s" : "";
  const perDay = s.ticksPerDay || 50;
  const day = Math.floor(s.tick / perDay) + 1;
  const icon = TIME_ICONS[s.timeOfDay] || "";

  // Built with DOM nodes rather than innerHTML — agent names reach this string.
  tickInfo.replaceChildren();

  const tickEl = document.createElement("strong");
  tickEl.textContent = `Tick ${s.tick}`;
  tickInfo.appendChild(tickEl);

  tickInfo.appendChild(document.createTextNode(
    ` · Day ${day} ${icon} ${s.timeOfDay} · ${agentCount} agent${plural} alive`
  ));

  // Show who the simulation is currently waiting on — a tick can take a minute.
  if (s.thinkingAgent) {
    const waiting = document.createElement("span");
    waiting.className = "tick-thinking";
    waiting.textContent = ` · ${s.thinkingAgent} is thinking…`;
    tickInfo.appendChild(waiting);
  }
}

function onConnectedChange(connected) {
  // Update status indicator
  const statusEl = document.getElementById("status");
  statusEl.textContent = connected ? "Connected" : "Reconnecting…";
  statusEl.className = connected ? "connected" : "disconnected";
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  // Don't capture if user is typing in an input
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      togglePause();
      break;
    case "Equal":      // + key
    case "NumpadAdd":
      e.preventDefault();
      adjustSpeed(0.5);
      break;
    case "Minus":      // - key
    case "NumpadSubtract":
      e.preventDefault();
      adjustSpeed(-0.5);
      break;
    case "KeyR":
      e.preventDefault();
      toggleRelations();
      break;
    case "KeyF":
      e.preventDefault();
      frameWorld(true);   // re-centre and fit
      break;
    case "BracketRight":
      e.preventDefault();
      zoomBy(1);
      break;
    case "BracketLeft":
      e.preventDefault();
      zoomBy(-1);
      break;
    case "ArrowUp":    e.preventDefault(); panBy(0, 60); break;
    case "ArrowDown":  e.preventDefault(); panBy(0, -60); break;
    case "ArrowLeft":  e.preventDefault(); panBy(60, 0); break;
    case "ArrowRight": e.preventDefault(); panBy(-60, 0); break;
  }
}

function adjustSpeed(delta) {
  const current = getState().speed;
  const newSpeed = Math.round(Math.max(0.1, Math.min(5.0, current + delta)) * 10) / 10;
  sendSetSpeed(newSpeed);
}

export { initControls };
