import * as THREE from "three";

/** Bounding information derived from a loaded splat */
export interface SplatBounds {
  center: THREE.Vector3;
  radius: number;
  box: THREE.Box3;
}

/** Loading progress information */
export interface LoadProgress {
  loaded: number;
  total: number;
}

/** Viewer state exposed to React */
export interface ViewerState {
  loading: boolean;
  progress: number; // 0–1
  error: string | null;
}

// ── Walk mode / collision types ──

/** Locomotion mode */
export type LocomotionMode = "fly" | "walk";

/** Collision mesh generation state */
export type CollisionMeshState = "idle" | "generating" | "ready" | "error";

/** Progress info for collision mesh generation */
export interface CollisionMeshProgress {
  state: CollisionMeshState;
  progress: number; // 0–1
  error?: string;
}

/** Messages sent TO the collision worker */
export interface CollisionWorkerRequest {
  packedArray: Uint32Array;
  numSplats: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: number;
  densityThreshold: number;
}

/** Messages sent FROM the collision worker */
export type CollisionWorkerResponse =
  | { type: "progress"; progress: number }
  | { type: "result"; vertices: Float32Array; indices: Uint32Array }
  | { type: "error"; message: string };
