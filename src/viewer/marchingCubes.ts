/**
 * Marching Cubes isosurface extraction.
 *
 * Takes a 3D scalar field (density grid) and extracts a triangle mesh at
 * the given isolevel. Pure functions, no dependencies — suitable for use
 * in a Web Worker.
 */

export interface MarchingCubesResult {
  vertices: Float32Array; // xyz interleaved
  indices: Uint32Array;
}

/**
 * Run marching cubes on a 3D scalar field.
 *
 * @param field    Flat Float32Array of size gridX * gridY * gridZ.
 *                 Index = x + y * gridX + z * gridX * gridY
 * @param gridX    Number of samples along X
 * @param gridY    Number of samples along Y
 * @param gridZ    Number of samples along Z
 * @param isolevel The density threshold (surface boundary)
 * @param originX  World-space origin of the grid (min corner)
 * @param originY
 * @param originZ
 * @param cellSize Size of each voxel in world units
 */
export function marchingCubes(
  field: Float32Array,
  gridX: number,
  gridY: number,
  gridZ: number,
  isolevel: number,
  originX: number,
  originY: number,
  originZ: number,
  cellSize: number
): MarchingCubesResult {
  // Pre-allocate growing arrays (we don't know final size)
  let vertCount = 0;
  let vertCapacity = 4096;
  let verts = new Float32Array(vertCapacity * 3);

  let idxCount = 0;
  let idxCapacity = 4096;
  let idxs = new Uint32Array(idxCapacity);

  // Vertex cache for edge interpolation — avoids duplicate vertices.
  // Key: encoded edge ID → vertex index
  const vertexCache = new Map<number, number>();

  function pushVertex(x: number, y: number, z: number): number {
    if (vertCount >= vertCapacity) {
      vertCapacity *= 2;
      const newVerts = new Float32Array(vertCapacity * 3);
      newVerts.set(verts);
      verts = newVerts;
    }
    const i = vertCount * 3;
    verts[i] = x;
    verts[i + 1] = y;
    verts[i + 2] = z;
    return vertCount++;
  }

  function pushIndex(idx: number): void {
    if (idxCount >= idxCapacity) {
      idxCapacity *= 2;
      const newIdxs = new Uint32Array(idxCapacity);
      newIdxs.set(idxs);
      idxs = newIdxs;
    }
    idxs[idxCount++] = idx;
  }

  // Helpers
  const fieldIdx = (x: number, y: number, z: number) =>
    x + y * gridX + z * gridX * gridY;

  // Edge ID encodes two vertex positions uniquely
  function edgeId(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number
  ): number {
    // Pack each coordinate into 10 bits (max grid 1024), 6 coords = 60 bits
    // but JS numbers are 64-bit floats with 53 bits of integer precision.
    // Use a simpler encoding: flatten both grid indices and combine.
    const a = x0 + y0 * gridX + z0 * gridX * gridY;
    const b = x1 + y1 * gridX + z1 * gridX * gridY;
    // Always store smaller first to canonicalize
    return a < b ? a * (gridX * gridY * gridZ) + b : b * (gridX * gridY * gridZ) + a;
  }

  function interpolateEdge(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number
  ): number {
    const eid = edgeId(x0, y0, z0, x1, y1, z1);
    const cached = vertexCache.get(eid);
    if (cached !== undefined) return cached;

    let t = 0.5;
    const dv = v1 - v0;
    if (Math.abs(dv) > 1e-8) {
      t = (isolevel - v0) / dv;
      t = Math.max(0, Math.min(1, t));
    }

    const wx = originX + (x0 + t * (x1 - x0)) * cellSize;
    const wy = originY + (y0 + t * (y1 - y0)) * cellSize;
    const wz = originZ + (z0 + t * (z1 - z0)) * cellSize;

    const idx = pushVertex(wx, wy, wz);
    vertexCache.set(eid, idx);
    return idx;
  }

  // The 12 edges of a cube, specified as pairs of corner indices (0-7)
  // Corner layout:
  //   4---5      Y
  //  /|  /|      |
  // 7---6 |      +--X
  // | 0-|-1     /
  // |/  |/     Z
  // 3---2
  const edgeCorners: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], // bottom edges
    [4, 5], [5, 6], [6, 7], [7, 4], // top edges
    [0, 4], [1, 5], [2, 6], [3, 7], // vertical edges
  ];

  // Corner offsets (dx, dy, dz) for corners 0-7
  const cornerOffsets: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], // bottom: 0,1,2,3
    [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1], // top: 4,5,6,7
  ];

  // Iterate over all cells (one less than grid size in each dimension)
  const cellsX = gridX - 1;
  const cellsY = gridY - 1;
  const cellsZ = gridZ - 1;

  const cornerVals = new Float32Array(8);
  const edgeVerts = new Int32Array(12);

  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        // Get the 8 corner values
        let cubeIndex = 0;
        for (let i = 0; i < 8; i++) {
          const gx = cx + cornerOffsets[i][0];
          const gy = cy + cornerOffsets[i][1];
          const gz = cz + cornerOffsets[i][2];
          cornerVals[i] = field[fieldIdx(gx, gy, gz)];
          if (cornerVals[i] >= isolevel) {
            cubeIndex |= (1 << i);
          }
        }

        // Skip fully inside or fully outside
        if (cubeIndex === 0 || cubeIndex === 255) continue;

        const edgeBits = EDGE_TABLE[cubeIndex];
        if (edgeBits === 0) continue;

        // Interpolate vertices on active edges
        for (let e = 0; e < 12; e++) {
          if (edgeBits & (1 << e)) {
            const [c0, c1] = edgeCorners[e];
            const [dx0, dy0, dz0] = cornerOffsets[c0];
            const [dx1, dy1, dz1] = cornerOffsets[c1];
            edgeVerts[e] = interpolateEdge(
              cx + dx0, cy + dy0, cz + dz0, cornerVals[c0],
              cx + dx1, cy + dy1, cz + dz1, cornerVals[c1]
            );
          }
        }

        // Emit triangles
        const triRow = TRI_TABLE[cubeIndex];
        for (let t = 0; t < triRow.length; t += 3) {
          pushIndex(edgeVerts[triRow[t]]);
          pushIndex(edgeVerts[triRow[t + 1]]);
          pushIndex(edgeVerts[triRow[t + 2]]);
        }
      }
    }
  }

  // Trim to actual size
  return {
    vertices: verts.slice(0, vertCount * 3),
    indices: idxs.slice(0, idxCount),
  };
}

// ── Lookup tables ──
// Standard marching cubes edge table (256 entries).
// Each entry is a 12-bit mask indicating which edges are intersected.
// prettier-ignore
const EDGE_TABLE: number[] = [
  0x000,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x099,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x033,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0x0aa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x066,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0x0ff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x055,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0x0cc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0x0cc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x055,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0x0ff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x066,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0x0aa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x033,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x099,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x000
];

// Triangle table — for each of the 256 cube configurations, lists the edge
// indices that form triangles (up to 5 triangles = 15 indices). -1 terminated
// in the original, but here stored as variable-length arrays.
// prettier-ignore
const TRI_TABLE: number[][] = [
  [],
  [0,8,3],
  [0,1,9],
  [1,8,3,9,8,1],
  [1,2,10],
  [0,8,3,1,2,10],
  [9,2,10,0,2,9],
  [2,8,3,2,10,8,10,9,8],
  [3,11,2],
  [0,11,2,8,11,0],
  [1,9,0,2,3,11],
  [1,11,2,1,9,11,9,8,11],
  [3,10,1,11,10,3],
  [0,10,1,0,8,10,8,11,10],
  [3,9,0,3,11,9,11,10,9],
  [9,8,10,10,8,11],
  [4,7,8],
  [4,3,0,7,3,4],
  [0,1,9,8,4,7],
  [4,1,9,4,7,1,7,3,1],
  [1,2,10,8,4,7],
  [3,4,7,3,0,4,1,2,10],
  [9,2,10,9,0,2,8,4,7],
  [2,10,9,2,9,7,2,7,3,7,9,4],
  [8,4,7,3,11,2],
  [11,4,7,11,2,4,2,0,4],
  [9,0,1,8,4,7,2,3,11],
  [4,7,11,9,4,11,9,11,2,9,2,1],
  [3,10,1,3,11,10,7,8,4],
  [1,11,10,1,4,11,1,0,4,7,11,4],
  [4,7,8,9,0,11,9,11,10,11,0,3],
  [4,7,11,4,11,9,9,11,10],
  [9,5,4],
  [9,5,4,0,8,3],
  [0,5,4,1,5,0],
  [8,5,4,8,3,5,3,1,5],
  [1,2,10,9,5,4],
  [3,0,8,1,2,10,4,9,5],
  [5,2,10,5,4,2,4,0,2],
  [2,10,5,3,2,5,3,5,4,3,4,8],
  [9,5,4,2,3,11],
  [0,11,2,0,8,11,4,9,5],
  [0,5,4,0,1,5,2,3,11],
  [2,1,5,2,5,8,2,8,11,4,8,5],
  [10,3,11,10,1,3,9,5,4],
  [4,9,5,0,8,1,8,10,1,8,11,10],
  [5,4,0,5,0,11,5,11,10,11,0,3],
  [5,4,8,5,8,10,10,8,11],
  [9,7,8,5,7,9],
  [9,3,0,9,5,3,5,7,3],
  [0,7,8,0,1,7,1,5,7],
  [1,5,3,3,5,7],
  [9,7,8,9,5,7,10,1,2],
  [10,1,2,9,5,0,5,3,0,5,7,3],
  [8,0,2,8,2,5,8,5,7,10,5,2],
  [2,10,5,2,5,3,3,5,7],
  [7,9,5,7,8,9,3,11,2],
  [9,5,7,9,7,2,9,2,0,2,7,11],
  [2,3,11,0,1,8,1,7,8,1,5,7],
  [11,2,1,11,1,7,7,1,5],
  [9,5,8,8,5,7,10,1,3,10,3,11],
  [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],
  [11,10,5,7,11,5],
  [10,6,5],
  [0,8,3,5,10,6],
  [9,0,1,5,10,6],
  [1,8,3,1,9,8,5,10,6],
  [1,6,5,2,6,1],
  [1,6,5,1,2,6,3,0,8],
  [9,6,5,9,0,6,0,2,6],
  [5,9,8,5,8,2,5,2,6,3,2,8],
  [2,3,11,10,6,5],
  [11,0,8,11,2,0,10,6,5],
  [0,1,9,2,3,11,5,10,6],
  [5,10,6,1,9,2,9,11,2,9,8,11],
  [6,3,11,6,5,3,5,1,3],
  [0,8,11,0,11,5,0,5,1,5,11,6],
  [3,11,6,0,3,6,0,6,5,0,5,9],
  [6,5,9,6,9,11,11,9,8],
  [5,10,6,4,7,8],
  [4,3,0,4,7,3,6,5,10],
  [1,9,0,5,10,6,8,4,7],
  [10,6,5,1,9,7,1,7,3,7,9,4],
  [6,1,2,6,5,1,4,7,8],
  [1,2,5,5,2,6,3,0,4,3,4,7],
  [8,4,7,9,0,5,0,6,5,0,2,6],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
  [3,11,2,7,8,4,10,6,5],
  [5,10,6,4,7,2,4,2,0,2,7,11],
  [0,1,9,4,7,8,2,3,11,5,10,6],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],
  [8,4,7,3,11,5,3,5,1,5,11,6],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],
  [6,5,9,6,9,11,4,7,9,7,11,9],
  [10,4,9,6,4,10],
  [4,10,6,4,9,10,0,8,3],
  [10,0,1,10,6,0,6,4,0],
  [8,3,1,8,1,6,8,6,4,6,1,10],
  [1,4,9,1,2,4,2,6,4],
  [3,0,8,1,2,9,2,4,9,2,6,4],
  [0,2,4,4,2,6],
  [8,3,2,8,2,4,4,2,6],
  [10,4,9,10,6,4,11,2,3],
  [0,8,2,2,8,11,4,9,10,4,10,6],
  [3,11,2,0,1,6,0,6,4,6,1,10],
  [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
  [9,6,4,9,3,6,9,1,3,11,6,3],
  [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
  [3,11,6,3,6,0,0,6,4],
  [6,4,8,11,6,8],
  [7,10,6,7,8,10,8,9,10],
  [0,7,3,0,10,7,0,9,10,6,7,10],
  [10,6,7,1,10,7,1,7,8,1,8,0],
  [10,6,7,10,7,1,1,7,3],
  [1,2,6,1,6,8,1,8,9,8,6,7],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],
  [7,8,0,7,0,6,6,0,2],
  [7,3,2,6,7,2],
  [2,3,11,10,6,8,10,8,9,8,6,7],
  [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],
  [11,2,1,11,1,7,10,6,1,6,7,1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],
  [0,9,1,11,6,7],
  [7,8,0,7,0,6,3,11,0,11,6,0],
  [7,11,6],
  [7,6,11],
  [3,0,8,11,7,6],
  [0,1,9,11,7,6],
  [8,1,9,8,3,1,11,7,6],
  [10,1,2,6,11,7],
  [1,2,10,3,0,8,6,11,7],
  [2,9,0,2,10,9,6,11,7],
  [6,11,7,2,10,3,10,8,3,10,9,8],
  [7,2,3,6,2,7],
  [7,0,8,7,6,0,6,2,0],
  [2,7,6,2,3,7,0,1,9],
  [1,6,2,1,8,6,1,9,8,8,7,6],
  [10,7,6,10,1,7,1,3,7],
  [10,7,6,1,7,10,1,8,7,1,0,8],
  [0,3,7,0,7,10,0,10,9,6,10,7],
  [7,6,10,7,10,8,8,10,9],
  [6,8,4,11,8,6],
  [3,6,11,3,0,6,0,4,6],
  [8,6,11,8,4,6,9,0,1],
  [9,4,6,9,6,3,9,3,1,11,3,6],
  [6,8,4,6,11,8,2,10,1],
  [1,2,10,3,0,11,0,6,11,0,4,6],
  [4,11,8,4,6,11,0,2,9,2,10,9],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],
  [8,2,3,8,4,2,4,6,2],
  [0,4,2,4,6,2],
  [1,9,0,2,3,4,2,4,6,4,3,8],
  [1,9,4,1,4,2,2,4,6],
  [8,1,3,8,6,1,8,4,6,6,10,1],
  [10,1,0,10,0,6,6,0,4],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],
  [10,9,4,6,10,4],
  [4,9,5,7,6,11],
  [0,8,3,4,9,5,11,7,6],
  [5,0,1,5,4,0,7,6,11],
  [11,7,6,8,3,4,3,5,4,3,1,5],
  [9,5,4,10,1,2,7,6,11],
  [6,11,7,1,2,10,0,8,3,4,9,5],
  [7,6,11,5,4,10,4,2,10,4,0,2],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],
  [7,2,3,7,6,2,5,4,9],
  [9,5,4,0,8,6,0,6,2,6,8,7],
  [3,6,2,3,7,6,1,5,0,5,4,0],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],
  [9,5,4,10,1,6,1,7,6,1,3,7],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
  [7,6,10,7,10,8,5,4,10,4,8,10],
  [6,9,5,6,11,9,11,8,9],
  [3,6,11,0,6,3,0,5,6,0,9,5],
  [0,11,8,0,5,11,0,1,5,5,6,11],
  [6,11,3,6,3,5,5,3,1],
  [1,2,10,9,5,11,9,11,8,11,5,6],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],
  [6,11,3,6,3,5,2,10,3,10,5,3],
  [5,8,9,5,2,8,5,6,2,3,8,2],
  [9,5,6,9,6,0,0,6,2],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],
  [1,5,6,2,1,6],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],
  [10,1,0,10,0,6,9,5,0,5,6,0],
  [0,3,8,5,6,10],
  [10,5,6],
  [11,5,10,7,5,11],
  [11,5,10,11,7,5,8,3,0],
  [5,11,7,5,10,11,1,9,0],
  [10,7,5,10,11,7,9,8,1,8,3,1],
  [11,1,2,11,7,1,7,5,1],
  [0,8,3,1,2,7,1,7,5,7,2,11],
  [9,7,5,9,2,7,9,0,2,2,11,7],
  [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
  [2,5,10,2,3,5,3,7,5],
  [8,2,0,8,5,2,8,7,5,10,2,5],
  [9,0,1,5,10,3,5,3,7,3,10,2],
  [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
  [1,3,5,3,7,5],
  [0,8,7,0,7,1,1,7,5],
  [9,0,3,9,3,5,5,3,7],
  [9,8,7,5,9,7],
  [5,8,4,5,10,8,10,11,8],
  [5,0,4,5,11,0,5,10,11,11,3,0],
  [0,1,9,8,4,10,8,10,11,10,4,5],
  [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
  [2,5,1,2,8,5,2,11,8,4,5,8],
  [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],
  [9,4,5,2,11,3],
  [2,5,10,3,5,2,3,4,5,3,8,4],
  [5,10,2,5,2,4,4,2,0],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],
  [5,10,2,5,2,4,1,9,2,9,4,2],
  [8,4,5,8,5,3,3,5,1],
  [0,4,5,1,0,5],
  [8,4,5,8,5,3,9,0,5,0,3,5],
  [9,4,5],
  [4,11,7,4,9,11,9,10,11],
  [0,8,3,4,9,7,9,11,7,9,10,11],
  [1,10,11,1,11,4,1,4,0,7,4,11],
  [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
  [4,11,7,9,11,4,9,2,11,9,1,2],
  [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
  [11,7,4,11,4,2,2,4,0],
  [11,7,4,11,4,2,8,3,4,3,2,4],
  [2,9,10,2,7,9,2,3,7,7,4,9],
  [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],
  [1,10,2,8,7,4],
  [4,9,1,4,1,7,7,1,3],
  [4,9,1,4,1,7,0,8,1,8,7,1],
  [4,0,3,7,4,3],
  [4,8,7],
  [9,10,8,10,11,8],
  [3,0,9,3,9,11,11,9,10],
  [0,1,10,0,10,8,8,10,11],
  [3,1,10,11,3,10],
  [1,2,11,1,11,9,9,11,8],
  [3,0,9,3,9,11,1,2,9,2,11,9],
  [0,2,11,8,0,11],
  [3,2,11],
  [2,3,8,2,8,10,10,8,9],
  [9,10,2,0,9,2],
  [2,3,8,2,8,10,0,1,8,1,10,8],
  [1,10,2],
  [1,3,8,9,1,8],
  [0,9,1],
  [0,3,8],
  []
];
