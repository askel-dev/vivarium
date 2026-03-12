/**
 * Entry point — bootstraps the network connection, UI panels,
 * controls, and the canvas renderer.
 */

import { subscribe, getState } from "./store.js";
import { connect } from "./network.js";
import { initCanvas } from "./renderer/canvas.js";
import { initPanels } from "./ui/panels.js";
import { initControls } from "./ui/controls.js";
import "../style.css";

// Boot everything
initPanels();
initControls();
connect();
initCanvas();
