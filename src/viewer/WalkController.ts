/**
 * Walk mode physics controller.
 *
 * Applies gravity, floor detection, wall collision, and step-up logic.
 * Works by post-processing the position that SparkControls already applied
 * to localFrame, constraining it to respect the collision mesh.
 */

import * as THREE from "three";
import {
  EYE_HEIGHT,
  WALK_SPEED,
  RUN_SPEED,
  GRAVITY,
  STEP_HEIGHT,
  BODY_RADIUS,
} from "../config";

export class WalkController {
  private collisionMesh: THREE.Mesh | null = null;

  /** Vertical velocity (m/s, negative = falling) */
  private velocityY = 0;

  /** Whether the player is on the ground */
  private grounded = false;

  /** Raycaster reused each frame */
  private raycaster = new THREE.Raycaster();

  /** Temp vectors */
  private _rayOrigin = new THREE.Vector3();
  private _rayDir = new THREE.Vector3();
  private _pushDir = new THREE.Vector3();

  /** Track whether Shift is held for run speed */
  private shiftHeld = false;
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftHeld = true;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftHeld = false;
  };

  constructor() {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  setCollisionMesh(mesh: THREE.Mesh): void {
    this.collisionMesh = mesh;
  }

  /**
   * Get the walk/run speed override.
   * SparkControls already moved localFrame, but at fly-mode speed.
   * We'll clamp the horizontal displacement to walk/run speed instead.
   */
  getMaxSpeed(): number {
    return this.shiftHeld ? RUN_SPEED : WALK_SPEED;
  }

  /**
   * Snap localFrame.position to the floor at the current XZ.
   * Used when switching from fly → walk mode.
   * Returns true if a floor was found.
   */
  snapToFloor(localFrame: THREE.Group): boolean {
    if (!this.collisionMesh) return false;

    const floorY = this.castFloor(localFrame.position.x, localFrame.position.z, localFrame.position.y + 5);
    if (floorY !== null) {
      localFrame.position.y = floorY + EYE_HEIGHT;
      this.velocityY = 0;
      this.grounded = true;
      return true;
    }
    return false;
  }

  /**
   * Post-process localFrame after SparkControls.update().
   *
   * @param localFrame The group that SparkControls moved
   * @param prevPosition Position BEFORE SparkControls.update() this frame
   * @param deltaTime Frame delta in seconds
   */
  update(
    localFrame: THREE.Group,
    prevPosition: THREE.Vector3,
    deltaTime: number
  ): void {
    if (!this.collisionMesh || deltaTime <= 0) return;

    // ── Clamp horizontal speed to walk/run ──
    const maxSpeed = this.getMaxSpeed();
    const dx = localFrame.position.x - prevPosition.x;
    const dz = localFrame.position.z - prevPosition.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const maxDist = maxSpeed * deltaTime;

    if (horizontalDist > maxDist && horizontalDist > 0.0001) {
      const scale = maxDist / horizontalDist;
      localFrame.position.x = prevPosition.x + dx * scale;
      localFrame.position.z = prevPosition.z + dz * scale;
    }

    // Ignore vertical input from SparkControls (Q/E) — gravity handles Y
    localFrame.position.y = prevPosition.y;

    // ── Wall collision (4 cardinal directions + diagonals) ──
    this.resolveWallCollision(localFrame);

    // ── Gravity + floor detection ──
    if (this.grounded) {
      this.velocityY = 0;
    } else {
      this.velocityY -= GRAVITY * deltaTime;
      // Terminal velocity
      if (this.velocityY < -20) this.velocityY = -20;
    }

    localFrame.position.y += this.velocityY * deltaTime;

    // Cast ray down from above eye position to find floor
    const floorY = this.castFloor(
      localFrame.position.x,
      localFrame.position.z,
      localFrame.position.y + 2 // cast from above head
    );

    if (floorY !== null) {
      const targetY = floorY + EYE_HEIGHT;

      if (localFrame.position.y <= targetY + 0.05) {
        // On or below the floor — snap up
        localFrame.position.y = targetY;
        this.velocityY = 0;
        this.grounded = true;
      } else if (localFrame.position.y > targetY + STEP_HEIGHT + EYE_HEIGHT) {
        // Well above the floor — falling
        this.grounded = false;
      } else {
        // Close to floor — grounded
        localFrame.position.y = targetY;
        this.velocityY = 0;
        this.grounded = true;
      }
    } else {
      // No floor found — keep falling
      this.grounded = false;
    }

    // ── Step-up check ──
    // If we moved horizontally and the new floor is slightly higher, step up
    if (this.grounded && horizontalDist > 0.001) {
      const aheadFloor = this.castFloor(
        localFrame.position.x,
        localFrame.position.z,
        localFrame.position.y + STEP_HEIGHT
      );
      if (aheadFloor !== null) {
        const stepTarget = aheadFloor + EYE_HEIGHT;
        const stepDelta = stepTarget - localFrame.position.y;
        if (stepDelta > 0.01 && stepDelta <= STEP_HEIGHT) {
          localFrame.position.y = stepTarget;
        }
      }
    }
  }

  /**
   * Cast a ray downward to find the floor height at (x, z).
   * @param x World X
   * @param z World Z
   * @param fromY Cast from this Y (should be above expected floor)
   * @returns The Y of the floor surface, or null if no floor found
   */
  private castFloor(x: number, z: number, fromY: number): number | null {
    if (!this.collisionMesh) return null;

    this._rayOrigin.set(x, fromY, z);
    this._rayDir.set(0, -1, 0);

    this.raycaster.set(this._rayOrigin, this._rayDir);
    this.raycaster.far = fromY + 50; // generous range

    const hits = this.raycaster.intersectObject(this.collisionMesh, false);
    if (hits.length > 0) {
      return hits[0].point.y;
    }
    return null;
  }

  /**
   * Push the player out of walls using horizontal raycasts.
   */
  private resolveWallCollision(localFrame: THREE.Group): void {
    if (!this.collisionMesh) return;

    // Cast rays at body center height (roughly waist level)
    const bodyY = localFrame.position.y - EYE_HEIGHT * 0.5;
    const checkDist = BODY_RADIUS * 1.5;

    // 8 directions: cardinal + diagonal
    const dirs: [number, number][] = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
    ];

    for (const [dirX, dirZ] of dirs) {
      this._rayOrigin.set(localFrame.position.x, bodyY, localFrame.position.z);
      this._rayDir.set(dirX, 0, dirZ).normalize();

      this.raycaster.set(this._rayOrigin, this._rayDir);
      this.raycaster.far = checkDist;

      const hits = this.raycaster.intersectObject(this.collisionMesh, false);
      if (hits.length > 0 && hits[0].distance < BODY_RADIUS) {
        // Push away from wall
        const pushDist = BODY_RADIUS - hits[0].distance + 0.01;
        this._pushDir.set(-dirX, 0, -dirZ).normalize();
        localFrame.position.x += this._pushDir.x * pushDist;
        localFrame.position.z += this._pushDir.z * pushDist;
      }
    }
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
  }
}
