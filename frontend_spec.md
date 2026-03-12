# Vivarium — Web Frontend Spec

## Overview

Replace the terminal display with a browser-based pixel art frontend. The Python simulation runs as a backend server, pushing world state over WebSocket each tick. The browser renders the world on an HTML Canvas using a pixel art tileset, with interactive controls and agent inspection panels.

The terminal display (`display.py`) stays available as a fallback via `--no-display` or `--terminal` flags.

---

## Architecture

**CRITICAL:** The simulation relies on synchronous LLM calls taking 1-3 seconds. To prevent blocking the ASGI event loop (which would cause WebSockets to timeout and disconnect), the simulation loop **must** run in a separate thread, communicating state to the async FastAPI server via a queue or thread-safe shared object.

```text
┌─────────────────┐                        ┌──────────────────────┐
│  Python Backend │                        │   Browser Frontend   │
│                 │                        │                      │
│ ┌─────────────┐ │   WebSocket (JSON)     │  Canvas Renderer     │
│ │ FastAPI/WS  │ │ ◄────────────────────► │  UI Controls         │
│ └──────┬──────┘ │   State & Controls     │  Agent Inspector     │
│        │ Async  │                        └──────────────────────┘
│ ┌──────┴──────┐ │
│ │ Simulation  │ │
│ │ Loop Thread │ │
│ └─────────────┘ │
└─────────────────┘
```

### Communication protocol

**Server → Client (each tick):**
```json
{
  "type": "tick",
  "tick": 47,
  "time_of_day": "midday",
  "grid": [ ... ],
  "agents": [
    {
      "name": "Scavenger",
      "x": 5, "y": 8,
      "energy": 62,
      "max_energy": 120,
      "inventory": {"food": 2, "wood": 1, "stone": 0},
      "personality_archetype": "Scavenger",
      "last_action": "steal",
      "alive": true,
      "recent_memory_preview": ["I stole food...", "Protector shouted..."] // Truncated to prevent bloat
    }
  ],
  "events": [ ... ]
}
```

*Note: Full agent beliefs, thoughts, and complete memories are fetched ON DEMAND via `request_agent_detail` to save bandwidth.*

**Client → Server:**
```json
{"type": "pause"}
{"type": "resume"}
{"type": "set_speed", "speed": 1.5}
{"type": "request_agent_detail", "name": "Scavenger"}
```

---

## Backend Changes

### New file: `main_server.py`

A separate entry point that runs the simulation with a FastAPI/WebSocket server.

```bash
python main_server.py --agents 4 --port 8080
```

1. **FastAPI App**: Handles static routing and WebSocket connections.
2. **Simulation Thread**: Starts the `World` loop in a background `threading.Thread`.
3. **State Broadcaster**: An `asyncio` task that reads from a thread-safe Queue populated by the Simulation Thread and pushes JSON updates to all active WebSocket clients.
4. **Control Receiver**: Translates WebSocket messages into thread-safe flags (e.g., threading Events for pause/resume) for the Simulation Thread.

### Dependencies
```bash
pip install fastapi uvicorn websockets
```

---

## Frontend Structure

We will use **Vite** for the frontend build tools. It provides Hot Module Replacement (HMR) during development and compiles to lightweight raw assets for production.

```
frontend/
├── index.html           # Main page, canvas + UI layout
├── public/              # Static assets copied directly
│   └── assets/          # Tilesets, agent sprites
├── src/
│   ├── main.js          # Entry point, Vite integration
│   ├── store.js         # Centralized state (PubSub for UI updates)
│   ├── network.js       # WebSocket logic & Auto-reconnect
│   ├── renderer/
│   │   ├── canvas.js    # Render loop manager
│   │   ├── camera.js    # Pan/zoom handling
│   │   └── interpolate.js # Smooth agent movements
│   └── ui/
│       ├── panels.js    # Inspector and Event Log DOM updates
│       └── controls.js  # Play/Pause/Speed buttons
├── style.css            # Dark theme, CSS variables
└── package.json         # Vite scripts
```

---

## Visual Design

### Style
Dark background, pixel art rendered at integer scale. CSS `image-rendering: pixelated;` is required on the canvas.

### Tile Size
32x32 pixels, scaled 2x or 3x depending on screen size. The camera should strictly snap to integer zoom levels to preserve pixel crispness.

### Day / Night Cycle (Compositing)
To avoid muddy overlays, the time-of-day coloring will use Canvas `globalCompositeOperation = "multiply"` (or overlay). This realistically tints the scene where colors blend multiplicatively, instead of just washing out the contrast with opacity.
- Morning: `#FFEDB3` (Warm pale yellow)
- Midday: `#FFFFFF` (No tint)
- Afternoon: `#FFB86C` (Warm amber)
- Evening: `#8BE9FD` (Cool cyan/purple edge)
- Night: `#1E1E3F` (Deep navy blue)

---

## Canvas Renderer (`src/renderer/canvas.js`)

### Render Loop
Independent from the simulation tick using `requestAnimationFrame`.

```javascript
function render(timestamp) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Terrain layer
    drawTerrain(store.state.grid);
    
    // 2. Objects layer
    drawObjects(store.state.grid);
    
    // 3. Agents layer (with interpolation logic)
    drawAgents(store.state.agents, timestamp);
    
    // 4. Overlays & UI
    drawSelection(store.state.selectedTile);
    drawTimeOverlay(store.state.timeOfDay);
    drawAgentLabels(store.state.agents);
    
    requestAnimationFrame(render);
}
```

### Agent Interpolation
Calculate smoothly eased positions over a fixed duration (e.g., 300ms) comparing `store.state.prevAgents` to `store.state.agents`.

---

## UI Layout & Interaction

### Theme
Dark navy (`#1a1a2e`). UI components are standard HTML elements overlaid on top of the Canvas. We will use vanilla DOM manipulation driven by `state` changes emitted from `store.js`.

### Client Reliability
The WebSocket client (`network.js`) must feature exponential backoff reconnection. If disconnected, UI shows a "Reconnecting..." overlay and the simulation canvas pauses. 

### Click & Hover Interactions
- **Tile Click**: Highlights tile. Dispatches `selectTile` action to store. Inspector updates.
- **Agent Click**: Dispatches `selectAgent` action. `network.js` fires `request_agent_detail` to the server to fetch full logs, thoughts, and beliefs. Panel updates when response arrives.
- **Keyboard**: Space to pause, +/- for speed adjustment, Drag to Pan Canvas.

---

## Build Order

### Phase 1: Backend WebSocket & Threading
1. Scaffold FastAPI and WebSocket endpoints.
2. Refactor Simulation run-loop into a separate `threading.Thread`.
3. Broadcast dummy tick JSON every few seconds to test event loop stability.

### Phase 2: Frontend Scaffolding
4. Initialize Vite (`npm create vite@latest frontend -- --template vanilla`).
5. Set up `network.js` (WebSocket + Reconnection).
6. Hook up the centralized `store.js` to react to WS messages.

### Phase 3: Canvas Engine
7. Render the basic grid using simple colors (Rectangles).
8. Implement Camera (drag and zoom).
9. Map Spritesheets (Terrain, Agents).
10. Add interpolation to agent movement.

### Phase 4: UI & Interactivity
11. Build HTML UI Panels (Inspector, Event Log, Controls).
12. Wire UI panels to listen to the `store.js`.
13. Implement Click-to-Inspect and the `request_agent_detail` WS round-trip.

### Phase 5: Visual Polish
14. Add `multiply` composite blending for Day/Night cycle.
15. Add hover states, floating texts, and death animations/gravestones.
