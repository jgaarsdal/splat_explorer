/**
 * Orchestrates collision mesh generation on the main thread.
 *
 * - Copies packed splat data
 * - Spawns a Web Worker for voxelization + marching cubes
 * - Creates THREE.Mesh (invisible, for raycasting) and debug wireframe
 */

import * as THREE from "three";
import type { SplatMesh } from "@sparkjsdev/spark";
import type { SplatBounds, CollisionWorkerResponse } from "./types";
import { VOXEL_SIZE, DENSITY_THRESHOLD } from "../config";

export interface CollisionMeshResult {
  /** Invisible mesh used for raycasting (floor, walls, teleport) */
  collisionMesh: THREE.Mesh;
  /** Wireframe overlay for debug visualization (F3 toggle) */
  debugMesh: THREE.LineSegments;
}

export class CollisionMeshGenerator {
  private worker: Worker | null = null;

  /**
   * Generate a collision mesh from the loaded splat.
   *
   * @param splatMesh  The loaded SplatMesh (must be initialized)
   * @param bounds     Bounding info from SplatLoader
   * @param onProgress Callback with 0–1 progress
   * @returns CollisionMeshResult with invisible collision mesh and debug wireframe
   */
  async generate(
    splatMesh: SplatMesh,
    bounds: SplatBounds,
    onProgress?: (progress: number) => void
  ): Promise<CollisionMeshResult> {
    return new Promise((resolve, reject) => {
      // Access packed splat data
      const packedSplats = (splatMesh as unknown as { packedSplats?: { packedArray: Uint32Array; numSplats: number } }).packedSplats;
      if (!packedSplats) {
        reject(new Error("SplatMesh has no packedSplats data"));
        return;
      }

      const numSplats = packedSplats.numSplats;
      if (numSplats === 0) {
        reject(new Error("SplatMesh has 0 splats"));
        return;
      }

      // Copy the packed array so we can transfer it to the worker
      const packedCopy = new Uint32Array(packedSplats.packedArray.buffer.slice(0));

      // Spawn worker using Vite's worker syntax
      this.worker = new Worker(
        new URL("./collision.worker.ts", import.meta.url),
        { type: "module" }
      );

      this.worker.onmessage = (e: MessageEvent<CollisionWorkerResponse>) => {
        const msg = e.data;

        if (msg.type === "progress") {
          onProgress?.(msg.progress);
          return;
        }

        if (msg.type === "error") {
          this.cleanup();
          reject(new Error(msg.message));
          return;
        }

        if (msg.type === "result") {
          onProgress?.(1);

          const { vertices, indices } = msg;

          if (vertices.length === 0 || indices.length === 0) {
            this.cleanup();
            reject(
              new Error(
                "Collision mesh generation produced no geometry. " +
                "Try lowering the density threshold in config."
              )
            );
            return;
          }

          // Build Three.js geometry
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(vertices, 3)
          );
          geometry.setIndex(new THREE.BufferAttribute(indices, 1));
          geometry.computeVertexNormals();
          geometry.computeBoundingSphere();

          // Invisible mesh for raycasting
          const collisionMesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              visible: false,
              side: THREE.DoubleSide,
            })
          );
          collisionMesh.name = "collisionMesh";

          // Debug wireframe
          const wireGeo = new THREE.WireframeGeometry(geometry);
          const debugMesh = new THREE.LineSegments(
            wireGeo,
            new THREE.LineBasicMaterial({
              color: 0x00ff88,
              opacity: 0.3,
              transparent: true,
              depthTest: true,
            })
          );
          debugMesh.name = "collisionDebug";
          debugMesh.visible = false; // hidden by default, F3 toggles

          console.log(
            `[CollisionMesh] Generated: ${vertices.length / 3} vertices, ${indices.length / 3} triangles`
          );

          this.cleanup();
          resolve({ collisionMesh, debugMesh });
        }
      };

      this.worker.onerror = (err) => {
        this.cleanup();
        reject(new Error(`Worker error: ${err.message}`));
      };

      // Send data to worker (transfer the copy)
      const request = {
        packedArray: packedCopy,
        numSplats,
        boundsMin: bounds.box.min.toArray() as [number, number, number],
        boundsMax: bounds.box.max.toArray() as [number, number, number],
        voxelSize: VOXEL_SIZE,
        densityThreshold: DENSITY_THRESHOLD,
      };

      this.worker.postMessage(request, [packedCopy.buffer]);
    });
  }

  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  dispose(): void {
    this.cleanup();
  }
}
