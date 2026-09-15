/**
 * Entry point — bootstraps the network connection, UI panels,
 * controls, and the canvas renderer.
 */

import { connect } from "./network.js";
import { initCanvas } from "./renderer/canvas.js";
import { initPanels } from "./ui/panels.js";
import { initControls } from "./ui/controls.js";
import { initRoster } from "./ui/roster.js";
import { initStory } from "./ui/story.js";
import "../style.css";

// Canvas first: panels and roster call focusTile on it.
initCanvas();
initPanels();
initRoster();
initControls();
initStory();
connect();
