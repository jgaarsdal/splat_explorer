/**
 * Per-customer configuration for the splat viewer.
 *
 * Edit this file (or set VITE_SPLAT_URL env var) to configure which
 * splat file to load and how the viewer looks.
 */

/** URL or path to the .ply / .spz splat file */
export const SPLAT_URL: string =
  import.meta.env.VITE_SPLAT_URL ?? "/splats/scene.spz";

/** Enable Level-of-Detail rendering (auto splat budget per platform) */
export const LOD_ENABLED: boolean = true;

/** Background color (CSS color string) */
export const BACKGROUND_COLOR: string =
  import.meta.env.VITE_BACKGROUND_COLOR ?? "#1a1a2e";

/** Camera field of view in degrees */
export const CAMERA_FOV: number = 60;

/** Duration of the reset-view animation in milliseconds */
export const RESET_ANIMATION_MS: number = 500;

/**
 * XR mode preference.
 * - "vrar": VR on headsets, AR fallback on phones (default — for immersive scenes)
 * - "arvr": AR preferred everywhere, VR fallback (for object splats — uses
 *           passthrough on Quest 3 and AR on phones)
 */
export const XR_MODE: "vrar" | "arvr" =
  (import.meta.env.VITE_XR_MODE as "vrar" | "arvr") ?? "vrar";

// ── Walk mode / collision mesh settings ──

/** Voxel resolution for collision mesh generation (meters) */
export const VOXEL_SIZE = 0.10;

/** Minimum number of splats in a voxel to consider it solid */
export const DENSITY_THRESHOLD = 3;

/** Player eye height above floor in meters (for web walk mode) */
export const EYE_HEIGHT = 1.80;

/** Walk speed in meters per second */
export const WALK_SPEED = 1.4;

/** Run speed in meters per second (Shift held) */
export const RUN_SPEED = 4.0;

/** Gravity acceleration in m/s² */
export const GRAVITY = 9.8;

/** Maximum step-up height in meters (stairs) */
export const STEP_HEIGHT = 0.3;

/** Player collision radius for wall detection (meters) */
export const BODY_RADIUS = 0.25;

/** VR snap-turn angle in degrees */
export const SNAP_TURN_ANGLE = 45;

/** Number of segments in the VR teleport arc */
export const TELEPORT_ARC_SEGMENTS = 30;

/** Teleport arc initial velocity (m/s) — controls arc range */
export const TELEPORT_ARC_VELOCITY = 5.0;
