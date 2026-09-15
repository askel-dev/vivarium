/**
 * Camera — canvas panning (click-drag), zooming (scroll wheel), and framing.
 *
 * Zoom snaps to integer scales only (1x, 2x, 3x …) to keep pixels crisp.
 * Panning is clamped so the world can never be dragged off screen, and the
 * world is framed on first load rather than sitting pinned under the HUD.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 10;

let offsetX = 0;
let offsetY = 0;
let scale = 2;

// Viewport in CSS pixels, and the world's pixel size — needed for clamping.
let viewW = 0;
let viewH = 0;
let worldW = 0;
let worldH = 0;
let framed = false;

// Drag state
let dragging = false;
let didDrag = false;  // true if the mouse moved significantly during a drag
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;

/** Reserved screen edges (inspector, roster, controls) so framing avoids them. */
let inset = { left: 0, right: 0, top: 0, bottom: 0 };

function attach(canvas) {
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
}

function setInset(next) {
  inset = { ...inset, ...next };
}

function setViewport(w, h) {
  viewW = w;
  viewH = h;
  if (worldW) clampOffsets();
}

/** Tell the camera how big the world is, in world pixels. */
function setWorldSize(w, h) {
  const changed = w !== worldW || h !== worldH;
  worldW = w;
  worldH = h;
  if (changed) framed = false;
  clampOffsets();
}

/**
 * Fit the world into the usable area (viewport minus panel insets) and centre
 * it. Runs once per world, unless `force` is passed.
 */
function frameWorld(force = false) {
  if (!worldW || !viewW) return;
  if (framed && !force) return;

  const availW = Math.max(120, viewW - inset.left - inset.right);
  const availH = Math.max(120, viewH - inset.top - inset.bottom);

  const fit = Math.min(availW / worldW, availH / worldH);
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(fit)));

  offsetX = inset.left + (availW - worldW * scale) / 2;
  offsetY = inset.top + (availH - worldH * scale) / 2;

  framed = true;
}

/** Centre the view on a world-space point (used by roster / log clicks). */
function centerOn(wx, wy) {
  const availW = Math.max(120, viewW - inset.left - inset.right);
  const availH = Math.max(120, viewH - inset.top - inset.bottom);
  offsetX = inset.left + availW / 2 - wx * scale;
  offsetY = inset.top + availH / 2 - wy * scale;
  clampOffsets();
}

/**
 * Keep the world overlapping the usable area. When the world is smaller than
 * the view it is centred on that axis instead of clamped.
 */
function clampOffsets() {
  if (!worldW || !viewW) return;

  const availW = Math.max(120, viewW - inset.left - inset.right);
  const availH = Math.max(120, viewH - inset.top - inset.bottom);
  const scaledW = worldW * scale;
  const scaledH = worldH * scale;

  if (scaledW <= availW) {
    offsetX = inset.left + (availW - scaledW) / 2;
  } else {
    const min = inset.left + availW - scaledW;
    const max = inset.left;
    offsetX = Math.min(max, Math.max(min, offsetX));
  }

  if (scaledH <= availH) {
    offsetY = inset.top + (availH - scaledH) / 2;
  } else {
    const min = inset.top + availH - scaledH;
    const max = inset.top;
    offsetY = Math.min(max, Math.max(min, offsetY));
  }
}

function onMouseDown(e) {
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
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    didDrag = true;
  }
  offsetX = dragOffsetX + dx;
  offsetY = dragOffsetY + dy;
  clampOffsets();
}

function onMouseUp() {
  dragging = false;
}

function onWheel(e) {
  e.preventDefault();

  const dir = e.deltaY < 0 ? 1 : -1;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + dir));
  if (newScale === scale) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Keep the world point under the cursor fixed.
  offsetX = mouseX - ((mouseX - offsetX) / scale) * newScale;
  offsetY = mouseY - ((mouseY - offsetY) / scale) * newScale;

  scale = newScale;
  clampOffsets();
}

function zoomBy(delta) {
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
  if (newScale === scale) return;
  // Zoom about the centre of the usable area.
  const cx = inset.left + (viewW - inset.left - inset.right) / 2;
  const cy = inset.top + (viewH - inset.top - inset.bottom) / 2;
  offsetX = cx - ((cx - offsetX) / scale) * newScale;
  offsetY = cy - ((cy - offsetY) / scale) * newScale;
  scale = newScale;
  clampOffsets();
}

function panBy(dx, dy) {
  offsetX += dx;
  offsetY += dy;
  clampOffsets();
}

/**
 * Apply the camera transform. `dpr` scales everything up for HiDPI screens so
 * the canvas backing store matches the physical pixel grid.
 */
function applyTransform(ctx, dpr = 1) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
}

function resetTransform(ctx, dpr = 1) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

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

export {
  attach, applyTransform, resetTransform, screenToWorld, getScale, wasDrag,
  setViewport, setWorldSize, setInset, frameWorld, centerOn, zoomBy, panBy,
};
