# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Face Eraser** is a browser-based interactive art piece using real-time webcam pose detection to "erase" faces. It detects nose positions via MoveNet (through ml5.js) and punches holes in a gray overlay mask, revealing the underlying video feed. Audio feedback (Web Audio API sine oscillators) modulates pitch and volume based on nose position and movement speed.

## Running the Project

No build step or package manager — all dependencies load from CDN. Must be served over HTTP (not opened as a file) for webcam access:

```bash
# Python (simplest)
python -m http.server 8000

# Node
npx http-server
```

VSCode LiveServer is pre-configured on port 5501 (`.vscode/settings.json`).

## Architecture

Everything lives in two files:

- **`index.html`** — Loads p5.js v1.9.4, ml5.js v1.2.1, and `sketch.js`. No other markup.
- **`sketch.js`** — All application logic (~301 lines), structured as a standard p5.js global-mode sketch.

### `sketch.js` structure

| Lines | Section | Notes |
|-------|---------|-------|
| 1–6 | Constants | `ERASER_SIZE`, `CONFIDENCE_THRESHOLD`, video dimensions |
| 8–11 | Mobile detection | `isMobile` flag via `navigator.userAgent` / `maxTouchPoints` |
| 13–20 | State | `video`, `bodyPose`, `poses`, `gfx` (offscreen mask buffer), `started`, `modelReady` |
| 22–43 | Audio | Web Audio context + 2 `squeakers` (sine oscillators, detuned +900/+1020 Hz) |
| 45–69 | `setup()` | Creates canvas; returns early on mobile; starts webcam, initializes MoveNet, creates gray mask buffer |
| 71–73 | `windowResized()` | Resizes canvas to match window |
| 75–97 | Input | `_hitTestStart()`, `mousePressed()`, `touchStarted()` |
| 99–197 | `draw()` | Main render loop: mobile branch → splash → mirrored video → erase holes in mask → composite → audio modulation |
| 199–213 | Mobile message | `drawMobileMessage()` — shown instead of the experience on mobile |
| 215–287 | Splash screen | `drawSplash()` — retro CRT aesthetic; drawn until `started === true` |
| 289–301 | Helpers | `getNose(pose)` (returns keypoint 0), `gotPoses(results)` (ml5 callback) |

### Rendering pipeline

1. Draw mirrored webcam feed as background (cover-fit scaled to fill canvas)
2. Maintain `gfx` (offscreen p5.Graphics buffer) as a solid gray mask
3. For each detected pose with nose confidence > 0.3: use `destination-out` compositing to erase a 40px circle at the nose position
4. Composite `gfx` over the video frame

### Audio modulation

- **Frequency**: nose Y position maps 0–480px → 400–1600 Hz (top=low, bottom=high), plus speed-based offset (+25 Hz per px/frame)
- **Volume**: silent below 3px/frame movement speed; scales to max gain 0.5
- Two oscillators for two simultaneous people

### Pose detection

- Model: MoveNet (via `ml5.bodyPose`)
- Up to 2 people tracked (`maxPoses: 2`)
- Only keypoint 0 (nose) is used
- Detection starts inside the model-ready callback (not deferred)
- Detection runs continuously via `gotPoses` callback

### Mobile handling

- `isMobile` is detected at module load time via user agent and `maxTouchPoints`
- On mobile: `setup()` returns immediately after `createCanvas` (no webcam, no model)
- On mobile: `draw()` calls `drawMobileMessage()` which shows a "doesn't work on mobile" notice
