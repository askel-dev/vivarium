/**
 * Camera — handles canvas panning (click-drag) and zooming (scroll wheel).
 *
 * Zoom snaps to integer scales only (1x, 2x, 3x …) to keep pixels crisp.
 * Exposes a transform that the renderer applies before drawing.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 8;

let offsetX = 0;
let offsetY = 0;
let scale = 2;

// Drag state
let dragging = false;
let didDrag = false;  // true if the mouse moved significantly during a drag
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;

/**
 * Attach mouse/wheel listeners to the given canvas element.
 */
function attach(canvas) {
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
}

function onMouseDown(e) {
  // Only left button
  if (e.button !== 0) return;
  dragging = true;
  didDrag = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOffsetX = offsetX;
  dragOffsetY = offsetY;
}

function onMouseMove(e) {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  // Only count as a real drag if mouse moved more than 4 pixels
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    didDrag = true;
  }
  offsetX = dragOffsetX + dx;
  offsetY = dragOffsetY + dy;
}

function onMouseUp() {
  dragging = false;
}

function onWheel(e) {
  e.preventDefault();

  // Determine zoom direction
  const dir = e.deltaY < 0 ? 1 : -1;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + dir));
  if (newScale === scale) return;

  // Zoom toward mouse pointer position
  const rect = e.target.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Adjust offset so the world point under the cursor stays fixed
  offsetX = mouseX - ((mouseX - offsetX) / scale) * newScale;
  offsetY = mouseY - ((mouseY - offsetY) / scale) * newScale;

  scale = newScale;
}

/**
 * Apply the camera transform to the given 2D context.
 * Call this at the start of each frame, after clearRect.
 */
function applyTransform(ctx) {
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
}

/**
 * Reset the transform back to identity (for HUD / overlay drawing).
 */
function resetTransform(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Convert a screen-space point to world-space coordinates.
 */
function screenToWorld(sx, sy) {
  return {
    x: (sx - offsetX) / scale,
    y: (sy - offsetY) / scale,
  };
}

function getScale() {
  return scale;
}

function wasDrag() {
  return didDrag;
}

export { attach, applyTransform, resetTransform, screenToWorld, getScale, wasDrag };
