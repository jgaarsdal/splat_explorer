import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import type { SplatBounds, LoadProgress } from "./types";

/**
 * Loads a splat file and computes its bounding information.
 */
export async function loadSplat(
  url: string,
  lod: boolean,
  onProgress?: (progress: LoadProgress) => void
): Promise<{ mesh: SplatMesh; bounds: SplatBounds }> {
  const mesh = new SplatMesh({
    url,
    lod,
    onProgress: (event: ProgressEvent) => {
      if (onProgress && event.lengthComputable) {
        onProgress({ loaded: event.loaded, total: event.total });
      }
    },
  });

  // Wait for loading and decoding to finish
  await mesh.initialized;

  // Compute bounds from splat centers
  const box = mesh.getBoundingBox(true);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  return {
    mesh,
    bounds: {
      center,
      radius: sphere.radius,
      box,
    },
  };
}
