# Splat Explorer

A 3D Gaussian Splat viewer with walk mode, collision physics, and WebXR support. Built with React, Three.js, and [Spark 2.0](https://github.com/sparkjsdev/spark).

## Features

- **Gaussian Splat rendering** with on-the-fly Level-of-Detail (LoD) via Spark 2.0
- **Fly mode** — free camera with WASD/QE, mouse look, scroll, touch, and gamepad
- **Walk mode** — gravity, floor snap, wall collision, and step-up from auto-generated collision mesh
- **Collision mesh generation** — extracts splat positions in a Web Worker, voxelizes, and runs marching cubes to produce a walkable surface
- **WebXR** — VR and AR support with teleportation (parabolic arc + landing ring), smooth locomotion, and snap turn
- **Configurable** — splat URL, background color, XR mode, walk physics, and more via `src/config.ts` or environment variables
- **Static deployable** — builds to a static `dist/` folder, no server runtime needed

## Tech Stack

| Layer | Library | Version |
|-------|---------|---------|
| UI | React | 19 |
| Language | TypeScript | 5.7+ |
| Bundler | Vite | 4.5 |
| 3D | Three.js | 0.180.0 |
| Splats | @sparkjsdev/spark | 2.0.0-preview |

## Getting Started

### Prerequisites

- Node.js 16.14+ and npm

### Setup

```bash
git clone https://github.com/jgaarsdal/splat_explorer.git
cd splat_explorer
npm install
```

### Add a splat file

Place your `.spz`, `.ply`, or `.splat` file in `public/splats/`:

```bash
cp /path/to/your/scene.spz public/splats/scene.spz
```

The default config expects `public/splats/scene.spz`. To change the path, edit `SPLAT_URL` in `src/config.ts` or set the `VITE_SPLAT_URL` environment variable.

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`. Hot-reloads on file changes.

### Production build

```bash
npm run build
npm run preview   # preview the build locally
```

Output goes to `dist/`.

## Configuration

Settings live in `src/config.ts`. Key options can also be set via environment variables:

| Setting | Env var | Default | Description |
|---------|---------|---------|-------------|
| `SPLAT_URL` | `VITE_SPLAT_URL` | `/splats/scene.spz` | Path or URL to the splat file |
| `BACKGROUND_COLOR` | `VITE_BACKGROUND_COLOR` | `#1a1a2e` | Scene background color |
| `XR_MODE` | `VITE_XR_MODE` | `vrar` | `"vrar"` (VR preferred) or `"arvr"` (AR preferred) |
| `LOD_ENABLED` | — | `true` | Enable Level-of-Detail rendering |
| `VOXEL_SIZE` | — | `0.10` | Collision mesh voxel resolution (meters) |
| `EYE_HEIGHT` | — | `1.80` | Player eye height in walk mode (meters) |
| `WALK_SPEED` | — | `1.4` | Walk speed (m/s) |
| `RUN_SPEED` | — | `4.0` | Run speed with Shift held (m/s) |
| `SNAP_TURN_ANGLE` | — | `45` | VR snap turn degrees |

## Controls

### Keyboard & Mouse

| Input | Action |
|-------|--------|
| W / Up | Move forward |
| S / Down | Move backward |
| A / Left | Strafe left |
| D / Right | Strafe right |
| Q | Move up (fly) |
| E | Move down (fly) |
| Shift | Run (walk mode) / speed up (fly mode) |
| Ctrl | Slow down |
| Mouse drag | Look around |
| Right-drag | Pan |
| Scroll wheel | Move forward/back |
| Tab | Toggle fly/walk mode |
| F3 | Toggle collision mesh debug wireframe |
| R | Reset camera to start position |
| ? | Toggle help overlay |

### VR Controllers

| Input | Action |
|-------|--------|
| Left stick | Smooth locomotion |
| Right stick left/right | Snap turn (45 degrees) |
| Left trigger | Teleport (hold to aim, release to teleport) |

### Touch

| Input | Action |
|-------|--------|
| One finger drag | Look around |
| Two finger drag | Pan |
| Pinch | Zoom |

## Architecture

```
src/
  config.ts                   # All configuration constants
  main.tsx                    # React entry point
  App.tsx                     # Root component, state management
  components/
    SplatViewer.tsx            # Main viewer: init, load, animation loop
    ViewerUI.tsx               # UI overlay: controls, mode toggle, toasts
    LoadingOverlay.tsx         # Loading spinner and progress bar
  viewer/
    SceneManager.ts            # WebGLRenderer, Scene, Camera, SparkRenderer
    SplatLoader.ts             # SplatMesh creation with LoD, bounds computation
    CameraController.ts        # SparkControls + SparkXr + mode switching
    WalkController.ts          # Walk physics: gravity, floor/wall raycasting
    TeleportController.ts      # VR teleport: parabolic arc, snap turn
    CollisionMeshGenerator.ts  # Orchestrator: spawns worker, creates meshes
    collision.worker.ts        # Web Worker: voxelize + marching cubes
    marchingCubes.ts           # Marching cubes algorithm with lookup tables
    types.ts                   # Shared TypeScript interfaces
  styles/
    index.css                  # All styles
```

### How collision mesh generation works

1. After the splat loads, the packed splat data buffer is copied and sent to a Web Worker
2. The worker decodes half-float center positions from the packed array
3. Centers are voxelized into a 3D density grid (default 10cm resolution)
4. A 3x3x3 box blur smooths the density field
5. Marching cubes extracts an isosurface at the density threshold
6. Vertex and index arrays are transferred back to the main thread
7. An invisible `THREE.Mesh` is created for raycasting (walk physics) and a wireframe `THREE.LineSegments` for debug visualization (F3)

Generation runs in the background — you can fly around while it builds. A progress toast shows status. Walk mode becomes available once the mesh is ready.

## Hosting Notes

This app uses Web Workers with ES modules, which require the following HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are configured automatically in Vite's dev and preview servers. For production hosting (Nginx, Cloudflare Pages, Vercel, etc.), ensure these headers are set on all responses.

## License

[MIT](https://opensource.org/licenses/MIT)
