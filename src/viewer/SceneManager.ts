import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { BACKGROUND_COLOR, CAMERA_FOV } from "../config";

/**
 * Sets up the Three.js renderer, scene, camera, SparkRenderer, and localFrame.
 *
 * The localFrame is a Group that parents the camera — SparkControls moves the
 * localFrame, not the camera directly. This is required for WebXR support where
 * the XR system controls camera orientation within the local reference frame.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly spark: SparkRenderer;
  readonly localFrame: THREE.Group;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    // WebGL renderer — antialias off for splat performance
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Note: renderer.xr.enabled is set by SparkXr internally, only when XR
    // is actually supported. Do NOT set it here — doing so causes flickering
    // on non-XR platforms by putting Three.js into its XR rendering path.

    // Scene with configurable background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);

    // Perspective camera
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      canvas.clientWidth / canvas.clientHeight,
      0.01,
      1000
    );
    this.camera.position.set(0, 0, 0);

    // Local reference frame — camera is parented to this
    this.localFrame = new THREE.Group();
    this.localFrame.add(this.camera);
    this.scene.add(this.localFrame);

    // SparkRenderer — extends THREE.Mesh, added to scene
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      enableLod: true,
    });
    this.scene.add(this.spark);

    // Initial size
    this.handleResize();
  }

  handleResize(): void {
    if (this.disposed) return;
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.spark.dispose();
    this.renderer.dispose();
  }
}
