/**
 * controls.js — Play/Pause button, Speed slider, and keyboard shortcuts.
 *
 * Sends control messages via network.js and reflects state from store.js.
 */

import { subscribe, getState } from "../store.js";
import { sendPause, sendResume, sendSetSpeed } from "../network.js";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

let btnPlayPause, btnIcon;
let speedSlider, speedValue;
let tickInfo;

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

function initControls() {
  btnPlayPause = document.getElementById("btn-play-pause");
  btnIcon      = document.getElementById("btn-pp-icon");
  speedSlider  = document.getElementById("speed-slider");
  speedValue   = document.getElementById("speed-value");
  tickInfo     = document.getElementById("tick-info");

  // Play/Pause click
  btnPlayPause.addEventListener("click", togglePause);

  // Speed slider
  speedSlider.addEventListener("input", onSpeedInput);

  // Keyboard shortcuts
  window.addEventListener("keydown", onKeyDown);

  // Subscribe to store
  subscribe("paused", onPausedChange);
  subscribe("speed", onSpeedChange);
  subscribe(["tick", "agents", "timeOfDay"], onTickChange);
  subscribe("connected", onConnectedChange);
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
  tickInfo.innerHTML =
    `<strong>Tick ${s.tick}</strong> — ${s.timeOfDay}` +
    ` — ${agentCount} agent${plural} alive`;
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
  }
}

function adjustSpeed(delta) {
  const current = getState().speed;
  const newSpeed = Math.round(Math.max(0.1, Math.min(5.0, current + delta)) * 10) / 10;
  sendSetSpeed(newSpeed);
}

export { initControls };
