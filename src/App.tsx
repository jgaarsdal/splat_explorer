import { useRef, useState, useCallback } from "react";
import { SplatViewer } from "./components/SplatViewer";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { ViewerUI } from "./components/ViewerUI";
import type { ViewerState, LocomotionMode, CollisionMeshProgress } from "./viewer/types";

export function App() {
  const [state, setState] = useState<ViewerState>({
    loading: true,
    progress: 0,
    error: null,
  });

  const [collisionProgress, setCollisionProgress] = useState<CollisionMeshProgress>({
    state: "idle",
    progress: 0,
  });

  const [locomotionMode, setLocomotionMode] = useState<LocomotionMode>("fly");

  const resetViewRef = useRef<(() => void) | null>(null);
  const toggleModeRef = useRef<(() => void) | null>(null);
  const toggleDebugRef = useRef<(() => void) | null>(null);

  const handleModeChange = useCallback((mode: LocomotionMode) => {
    setLocomotionMode(mode);
  }, []);

  return (
    <div className="app-root">
      <SplatViewer
        onStateChange={setState}
        onCollisionProgress={setCollisionProgress}
        onModeChange={handleModeChange}
        resetViewRef={resetViewRef}
        toggleModeRef={toggleModeRef}
        toggleDebugRef={toggleDebugRef}
      />
      <LoadingOverlay
        loading={state.loading}
        progress={state.progress}
        error={state.error}
      />
      {!state.loading && !state.error && (
        <ViewerUI
          onResetView={() => resetViewRef.current?.()}
          onToggleMode={() => toggleModeRef.current?.()}
          locomotionMode={locomotionMode}
          collisionProgress={collisionProgress}
        />
      )}
    </div>
  );
}
