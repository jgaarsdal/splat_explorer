/**
 * VR teleportation controller.
 *
 * - Parabolic arc from controller
 * - Landing indicator ring on collision mesh
 * - Teleport on trigger release
 * - Smooth locomotion with thumbstick (walk physics applied by WalkController)
 */

import * as THREE from "three";
import {
  TELEPORT_ARC_SEGMENTS,
  TELEPORT_ARC_VELOCITY,
  GRAVITY,
  SNAP_TURN_ANGLE,
} from "../config";

/** Teleport state machine */
type TeleportState = "idle" | "aiming" | "invalid";

export class TeleportController {
  private collisionMesh: THREE.Mesh | null = null;

  /** Current teleport state (for external UI queries) */
  getState(): TeleportState {
    return this.state;
  }

  private state: TeleportState = "idle";
  private validTarget = false;
  private targetPoint = new THREE.Vector3();

  /** The arc line */
  private arcLine: THREE.Line;
  private arcPositions: Float32Array;

  /** Landing indicator ring */
  private landingRing: THREE.Mesh;

  /** Raycaster for arc segments */
  private raycaster = new THREE.Raycaster();

  /** Track controller input state */
  private triggerPressed = false;
  private prevTriggerPressed = false;

  /** Temp vectors */
  private _segStart = new THREE.Vector3();
  private _segEnd = new THREE.Vector3();
  private _segDir = new THREE.Vector3();
  private _controllerPos = new THREE.Vector3();
  private _controllerDir = new THREE.Vector3();

  /** Parent group (added to scene) */
  readonly group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "teleportGroup";

    // Arc line geometry
    this.arcPositions = new Float32Array((TELEPORT_ARC_SEGMENTS + 1) * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.arcPositions, 3)
    );
    arcGeo.setDrawRange(0, 0);

    this.arcLine = new THREE.Line(
      arcGeo,
      new THREE.LineBasicMaterial({
        color: 0x00ff88,
        linewidth: 2,
        transparent: true,
        opacity: 0.8,
      })
    );
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.group.add(this.arcLine);

    // Landing ring
    const ringGeo = new THREE.RingGeometry(0.15, 0.25, 32);
    ringGeo.rotateX(-Math.PI / 2); // Lay flat on XZ plane
    this.landingRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthTest: true,
      })
    );
    this.landingRing.visible = false;
    this.group.add(this.landingRing);
  }

  setCollisionMesh(mesh: THREE.Mesh): void {
    this.collisionMesh = mesh;
  }

  /**
   * Update teleportation each frame.
   *
   * @param renderer The WebGL renderer (for XR session/controllers)
   * @param localFrame The camera group to teleport
   * @param camera The camera
   * @returns snap-turn delta in radians (0 if no snap turn this frame)
   */
  update(
    renderer: THREE.WebGLRenderer,
    localFrame: THREE.Group,
    _camera: THREE.Camera
  ): number {
    if (!this.collisionMesh) return 0;

    const session = renderer.xr.getSession();
    if (!session) {
      this.hideVisuals();
      return 0;
    }

    let snapTurnDelta = 0;

    // Read input from XR controllers
    const inputSources = session.inputSources;
    let rightController: XRInputSource | null = null;
    let leftController: XRInputSource | null = null;

    for (const source of inputSources) {
      if (source.handedness === "right") rightController = source;
      if (source.handedness === "left") leftController = source;
    }

    // ── Right hand: snap turn ──
    if (rightController?.gamepad) {
      const axes = rightController.gamepad.axes;
      // axes[2] = thumbstick X (left/right)
      if (axes.length >= 4) {
        const stickX = axes[2];
        // Deadzone
        if (Math.abs(stickX) > 0.6) {
          // Only trigger once per stick deflection
          if (!this._snapTurnLock) {
            this._snapTurnLock = true;
            const angle = THREE.MathUtils.degToRad(SNAP_TURN_ANGLE);
            snapTurnDelta = stickX > 0 ? -angle : angle;
          }
        } else {
          this._snapTurnLock = false;
        }
      }
    }

    // ── Left hand: teleport trigger ──
    if (leftController?.gamepad) {
      const buttons = leftController.gamepad.buttons;
      // Button 0 = trigger
      this.prevTriggerPressed = this.triggerPressed;
      this.triggerPressed = buttons.length > 0 && buttons[0].pressed;

      if (this.triggerPressed) {
        // Aiming — compute arc from left controller
        const frame = renderer.xr.getFrame();
        const refSpace = renderer.xr.getReferenceSpace();

        if (frame && refSpace && leftController.gripSpace) {
          const pose = frame.getPose(leftController.gripSpace, refSpace);
          if (pose) {
            // Controller world position and forward direction
            this._controllerPos.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z
            );
            // Apply localFrame transform to get world coords
            this._controllerPos.applyMatrix4(localFrame.matrixWorld);

            // Controller forward (negative Z in grip space)
            const q = pose.transform.orientation;
            const controllerQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
            controllerQuat.premultiply(localFrame.quaternion);
            this._controllerDir.set(0, 0, -1).applyQuaternion(controllerQuat);

            this.computeArc(this._controllerPos, this._controllerDir);
          }
        }
      } else if (this.prevTriggerPressed && !this.triggerPressed) {
        // Trigger released — teleport if valid
        if (this.validTarget) {
          this.executeTeleport(localFrame);
        }
        this.hideVisuals();
        this.state = "idle";
      } else {
        this.hideVisuals();
        this.state = "idle";
      }
    } else {
      this.hideVisuals();
    }

    return snapTurnDelta;
  }
  private _snapTurnLock = false;

  /**
   * Compute the parabolic arc and check for collision mesh intersection.
   */
  private computeArc(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const velocity = direction.clone().multiplyScalar(TELEPORT_ARC_VELOCITY);
    const dt = 0.05; // time step per segment
    this.validTarget = false;

    let hitSegment = TELEPORT_ARC_SEGMENTS;

    for (let i = 0; i <= TELEPORT_ARC_SEGMENTS; i++) {
      const t = i * dt;
      const x = origin.x + velocity.x * t;
      const y = origin.y + velocity.y * t - 0.5 * GRAVITY * t * t;
      const z = origin.z + velocity.z * t;

      this.arcPositions[i * 3] = x;
      this.arcPositions[i * 3 + 1] = y;
      this.arcPositions[i * 3 + 2] = z;

      // Check segment for collision
      if (i > 0 && !this.validTarget) {
        this._segStart.set(
          this.arcPositions[(i - 1) * 3],
          this.arcPositions[(i - 1) * 3 + 1],
          this.arcPositions[(i - 1) * 3 + 2]
        );
        this._segEnd.set(x, y, z);
        this._segDir.subVectors(this._segEnd, this._segStart);
        const segLen = this._segDir.length();
        this._segDir.normalize();

        this.raycaster.set(this._segStart, this._segDir);
        this.raycaster.far = segLen;

        const hits = this.raycaster.intersectObject(this.collisionMesh!, false);
        if (hits.length > 0) {
          // Check if the hit surface is roughly horizontal (floor-like)
          const normal = hits[0].face?.normal;
          if (normal) {
            // Transform normal to world space
            const worldNormal = normal
              .clone()
              .transformDirection(this.collisionMesh!.matrixWorld);
            const dot = worldNormal.dot(new THREE.Vector3(0, 1, 0));

            if (dot > 0.5) {
              // Floor-like surface (within ~60 degrees of up)
              this.validTarget = true;
              this.targetPoint.copy(hits[0].point);
              hitSegment = i;

              // Position landing ring
              this.landingRing.position.copy(this.targetPoint);
              this.landingRing.position.y += 0.02; // slight offset above floor
              this.landingRing.visible = true;
            }
          }
        }
      }
    }

    // Update arc visuals
    const geo = this.arcLine.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, hitSegment + 1);
    this.arcLine.visible = true;

    // Color: green if valid, red if not
    const mat = this.arcLine.material as THREE.LineBasicMaterial;
    mat.color.set(this.validTarget ? 0x00ff88 : 0xff4444);

    const ringMat = this.landingRing.material as THREE.MeshBasicMaterial;
    ringMat.color.set(this.validTarget ? 0x00ff88 : 0xff4444);

    if (!this.validTarget) {
      this.landingRing.visible = false;
    }

    this.state = this.validTarget ? "aiming" : "invalid";
  }

  /**
   * Execute the teleport: move localFrame to the target point.
   */
  private executeTeleport(localFrame: THREE.Group): void {
    // Move localFrame so feet are at targetPoint
    // In XR, the headset tracking is relative to localFrame, so
    // we move localFrame.position to the teleport target.
    // The XR system's floor-level reference handles the user's actual height.
    localFrame.position.x = this.targetPoint.x;
    localFrame.position.z = this.targetPoint.z;
    localFrame.position.y = this.targetPoint.y;
  }

  private hideVisuals(): void {
    this.arcLine.visible = false;
    this.landingRing.visible = false;
    this.validTarget = false;
  }

  dispose(): void {
    this.arcLine.geometry.dispose();
    (this.arcLine.material as THREE.Material).dispose();
    this.landingRing.geometry.dispose();
    (this.landingRing.material as THREE.Material).dispose();
  }
}
