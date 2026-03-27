/**
 * Web Worker: generates a collision mesh from packed splat data.
 *
 * Pipeline:
 * 1. Decode splat centers from half-float packed data
 * 2. Build 3D voxel density grid
 * 3. Run marching cubes to extract surface mesh
 * 4. Transfer result back to main thread
 */

import { marchingCubes } from "./marchingCubes";
import type {
  CollisionWorkerRequest,
  CollisionWorkerResponse,
} from "./types";

// ── Half-float decoding (IEEE 754 binary16) ──
function fromHalf(h: number): number {
  const sign = (h >>> 15) & 1;
  const exp = (h >>> 10) & 0x1f;
  const frac = h & 0x3ff;

  if (exp === 0) {
    // Subnormal or zero
    return (sign ? -1 : 1) * (frac / 1024) * Math.pow(2, -14);
  }
  if (exp === 31) {
    // Inf or NaN
    return frac === 0 ? (sign ? -Infinity : Infinity) : NaN;
  }
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

function post(msg: CollisionWorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
}

self.onmessage = (e: MessageEvent<CollisionWorkerRequest>) => {
  try {
    const {
      packedArray,
      numSplats,
      boundsMin,
      boundsMax,
      voxelSize,
      densityThreshold,
    } = e.data;

    // ── Step 1: Decode splat centers ──
    // PackedSplats layout: 4 Uint32 words per splat
    // word1 bits [0:15] = centerX (float16), bits [16:31] = centerY (float16)
    // word2 bits [0:15] = centerZ (float16)
    post({ type: "progress", progress: 0.05 });

    const centers = new Float32Array(numSplats * 3);
    for (let i = 0; i < numSplats; i++) {
      const base = i * 4;
      const word1 = packedArray[base + 1];
      const word2 = packedArray[base + 2];
      centers[i * 3] = fromHalf(word1 & 0xffff); // x
      centers[i * 3 + 1] = fromHalf(word1 >>> 16); // y
      centers[i * 3 + 2] = fromHalf(word2 & 0xffff); // z
    }

    post({ type: "progress", progress: 0.3 });

    // ── Step 2: Build voxel density grid ──
    // Expand bounds slightly to avoid edge artifacts
    const margin = voxelSize * 2;
    const minX = boundsMin[0] - margin;
    const minY = boundsMin[1] - margin;
    const minZ = boundsMin[2] - margin;
    const maxX = boundsMax[0] + margin;
    const maxY = boundsMax[1] + margin;
    const maxZ = boundsMax[2] + margin;

    const gridX = Math.ceil((maxX - minX) / voxelSize) + 1;
    const gridY = Math.ceil((maxY - minY) / voxelSize) + 1;
    const gridZ = Math.ceil((maxZ - minZ) / voxelSize) + 1;

    const totalVoxels = gridX * gridY * gridZ;

    // Safety check — prevent absurd allocations
    if (totalVoxels > 50_000_000) {
      post({
        type: "error",
        message: `Voxel grid too large: ${gridX}x${gridY}x${gridZ} = ${totalVoxels} voxels. Try a larger voxel size.`,
      });
      return;
    }

    const field = new Float32Array(totalVoxels);

    // Accumulate splat centers into voxel grid
    const invVoxel = 1 / voxelSize;
    for (let i = 0; i < numSplats; i++) {
      const cx = centers[i * 3];
      const cy = centers[i * 3 + 1];
      const cz = centers[i * 3 + 2];

      const gx = Math.floor((cx - minX) * invVoxel);
      const gy = Math.floor((cy - minY) * invVoxel);
      const gz = Math.floor((cz - minZ) * invVoxel);

      if (gx >= 0 && gx < gridX && gy >= 0 && gy < gridY && gz >= 0 && gz < gridZ) {
        field[gx + gy * gridX + gz * gridX * gridY] += 1;
      }
    }

    post({ type: "progress", progress: 0.6 });

    // ── Step 3: Gaussian blur pass (3x3x3 box blur) ──
    // Smooths the density field to produce a cleaner surface
    const blurred = new Float32Array(totalVoxels);
    for (let z = 1; z < gridZ - 1; z++) {
      for (let y = 1; y < gridY - 1; y++) {
        for (let x = 1; x < gridX - 1; x++) {
          let sum = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                sum += field[(x + dx) + (y + dy) * gridX + (z + dz) * gridX * gridY];
              }
            }
          }
          blurred[x + y * gridX + z * gridX * gridY] = sum / 27;
        }
      }
    }

    post({ type: "progress", progress: 0.75 });

    // ── Step 4: Marching cubes ──
    const result = marchingCubes(
      blurred,
      gridX,
      gridY,
      gridZ,
      densityThreshold,
      minX,
      minY,
      minZ,
      voxelSize
    );

    post({ type: "progress", progress: 0.95 });

    // Transfer arrays (zero-copy)
    post(
      {
        type: "result",
        vertices: result.vertices,
        indices: result.indices,
      },
      [result.vertices.buffer, result.indices.buffer]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", message });
  }
};
