import { useRef, useEffect, useCallback } from "react";
import { SceneManager } from "../viewer/SceneManager";
import { CameraController } from "../viewer/CameraController";
import { CollisionMeshGenerator } from "../viewer/CollisionMeshGenerator";
import { loadSplat } from "../viewer/SplatLoader";
import { SPLAT_URL, LOD_ENABLED } from "../config";
import type { ViewerState, LocomotionMode, CollisionMeshProgress } from "../viewer/types";
import type { SplatMesh } from "@sparkjsdev/spark";
import type { SplatBounds } from "../viewer/types";

interface SplatViewerProps {
  onStateChange: (state: ViewerState) => void;
  onCollisionProgress: (progress: CollisionMeshProgress) => void;
  onModeChange: (mode: LocomotionMode) => void;
  resetViewRef: React.MutableRefObject<(() => void) | null>;
  toggleModeRef: React.MutableRefObject<(() => void) | null>;
  toggleDebugRef: React.MutableRefObject<(() => void) | null>;
}

export function SplatViewer({
  onStateChange,
  onCollisionProgress,
  onModeChange,
  resetViewRef,
  toggleModeRef,
  toggleDebugRef,
}: SplatViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const collisionGenRef = useRef<CollisionMeshGenerator | null>(null);

  const init = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set up scene
    const scene = new SceneManager(canvas);
    sceneRef.current = scene;

    // Set up camera controls + XR
    const controller = new CameraController(canvas, scene.renderer);
    controllerRef.current = controller;

    // Wire up mode change callback
    controller.onModeChange = onModeChange;

    // Wire up reset view
    resetViewRef.current = () => controller.resetView(scene.localFrame);

    // Wire up mode toggle
    toggleModeRef.current = () => controller.toggleMode(scene.localFrame);

    // Report loading state
    onStateChange({ loading: true, progress: 0, error: null });

    let loadedMesh: SplatMesh | null = null;
    let loadedBounds: SplatBounds | null = null;

    try {
      const { mesh, bounds } = await loadSplat(SPLAT_URL, LOD_ENABLED, (p) => {
        onStateChange({
          loading: true,
          progress: p.total > 0 ? p.loaded / p.total : 0,
          error: null,
        });
      });

      loadedMesh = mesh;
      loadedBounds = bounds;

      // Add splat to scene
      scene.scene.add(mesh);

      // Configure movement speed
      controller.setBounds(bounds);

      // Start inside the splat at its center, elevated 2m for eye height.
      scene.localFrame.position.copy(bounds.center);
      scene.localFrame.position.y += 2.0;

      // Diagnostic logging — remove once camera positioning is confirmed working
      console.log("[SplatViewer] Bounds:", {
        center: bounds.center.toArray(),
        radius: bounds.radius,
        boxMin: bounds.box.min.toArray(),
        boxMax: bounds.box.max.toArray(),
      });
      console.log("[SplatViewer] Initial camera position:", scene.localFrame.position.toArray());
      console.log("[SplatViewer] moveSpeed:", controller.controls.fpsMovement.moveSpeed);

      onStateChange({ loading: false, progress: 1, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load splat";
      onStateChange({ loading: false, progress: 0, error: message });
      return;
    }

    // Add teleport visuals to scene
    scene.scene.add(controller.teleportController.group);

    // ── Auto-generate collision mesh in background ──
    if (loadedMesh && loadedBounds) {
      generateCollisionMesh(
        scene,
        controller,
        loadedMesh,
        loadedBounds,
        onCollisionProgress
      );
    }

    // ── Debug wireframe toggle (F3) ──
    let debugVisible = false;
    toggleDebugRef.current = () => {
      debugVisible = !debugVisible;
      const debugMesh = scene.scene.getObjectByName("collisionDebug");
      if (debugMesh) {
        debugMesh.visible = debugVisible;
      }
    };

    // Listen for F3 key
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "F3") {
        e.preventDefault();
        toggleDebugRef.current?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    // Animation loop — use setAnimationLoop for XR compatibility
    const clock = scene.spark.clock;
    let lastTime = clock.getElapsedTime();

    scene.renderer.setAnimationLoop(() => {
      const now = clock.getElapsedTime();
      const dt = now - lastTime;
      lastTime = now;

      controller.update(scene.localFrame, scene.camera, dt);
      scene.render();
    });

    // Return cleanup for the F3 listener
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onStateChange, onCollisionProgress, onModeChange, resetViewRef, toggleModeRef, toggleDebugRef]);

  useEffect(() => {
    let f3Cleanup: (() => void) | undefined;

    init().then((cleanup) => {
      f3Cleanup = cleanup;
    });

    const handleResize = () => sceneRef.current?.handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      f3Cleanup?.();
      window.removeEventListener("resize", handleResize);
      sceneRef.current?.renderer.setAnimationLoop(null);
      controllerRef.current?.dispose();
      collisionGenRef.current?.dispose();
      sceneRef.current?.dispose();
    };
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

/**
 * Generate collision mesh in background and wire it up.
 */
async function generateCollisionMesh(
  scene: SceneManager,
  controller: CameraController,
  splatMesh: SplatMesh,
  bounds: SplatBounds,
  onProgress: (progress: CollisionMeshProgress) => void
): Promise<void> {
  const generator = new CollisionMeshGenerator();

  onProgress({ state: "generating", progress: 0 });

  try {
    const result = await generator.generate(splatMesh, bounds, (p) => {
      onProgress({ state: "generating", progress: p });
    });

    // Add meshes to scene
    scene.scene.add(result.collisionMesh);
    scene.scene.add(result.debugMesh);

    // Wire collision mesh into controllers
    controller.setCollisionMesh(result.collisionMesh);

    onProgress({ state: "ready", progress: 1 });

    console.log("[SplatViewer] Collision mesh ready. Press Tab to toggle walk mode.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collision mesh generation failed";
    console.error("[SplatViewer] Collision mesh error:", message);
    onProgress({ state: "error", progress: 0, error: message });
  } finally {
    generator.dispose();
  }
}
