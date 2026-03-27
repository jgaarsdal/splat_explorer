import { useState } from "react";
import type { LocomotionMode, CollisionMeshProgress } from "../viewer/types";

interface ViewerUIProps {
  onResetView: () => void;
  onToggleMode: () => void;
  locomotionMode: LocomotionMode;
  collisionProgress: CollisionMeshProgress;
}

const CONTROLS_HELP = [
  { key: "WASD", action: "Move" },
  { key: "Q / E", action: "Move up / down (fly mode)" },
  { key: "Shift", action: "Speed up / run" },
  { key: "Ctrl", action: "Slow down" },
  { key: "Mouse drag", action: "Look around" },
  { key: "Right-drag", action: "Pan" },
  { key: "Scroll", action: "Move forward/back" },
  { key: "Touch drag", action: "Look around" },
  { key: "Pinch", action: "Zoom" },
  { key: "Tab", action: "Toggle fly / walk mode" },
  { key: "F3", action: "Toggle collision mesh debug" },
];

export function ViewerUI({
  onResetView,
  onToggleMode,
  locomotionMode,
  collisionProgress,
}: ViewerUIProps) {
  const [showHelp, setShowHelp] = useState(false);

  const collisionReady = collisionProgress.state === "ready";
  const collisionGenerating = collisionProgress.state === "generating";

  return (
    <>
      <div className="viewer-ui-buttons">
        <button
          className="viewer-btn"
          onClick={onResetView}
          title="Reset view"
          aria-label="Reset view"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 3V1L6 4l4 3V5a5 5 0 110 10 5 5 0 01-4.9-4H3.1A7 7 0 1010 3z"
              fill="currentColor"
            />
          </svg>
        </button>

        {/* Walk/Fly toggle — only visible when collision mesh is ready */}
        {collisionReady && (
          <button
            className={`viewer-btn mode-toggle ${locomotionMode === "walk" ? "mode-walk" : "mode-fly"}`}
            onClick={onToggleMode}
            title={`Switch to ${locomotionMode === "fly" ? "walk" : "fly"} mode (Tab)`}
            aria-label={`Switch to ${locomotionMode === "fly" ? "walk" : "fly"} mode`}
          >
            {locomotionMode === "fly" ? (
              // Bird / fly icon
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M2 8c3-3 6-2 8 0s5 3 8 0c-1 4-4 5-8 3S5 12 2 8z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              // Walking person icon
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="3.5" r="2" fill="currentColor" />
                <path
                  d="M8 7h4l2 5h-2l-1-3-1 3-2 5H6l2-5L7 9z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        )}

        <button
          className="viewer-btn"
          onClick={() => setShowHelp(!showHelp)}
          title="Controls help"
          aria-label="Controls help"
        >
          ?
        </button>
      </div>

      {/* Mode indicator (bottom-left) */}
      {collisionReady && (
        <div className="mode-indicator">
          {locomotionMode === "fly" ? "FLY" : "WALK"}
        </div>
      )}

      {/* Collision mesh generation toast (bottom-center) */}
      {collisionGenerating && (
        <div className="collision-toast">
          <div className="collision-toast-spinner" />
          <span>
            Generating nav mesh... {Math.round(collisionProgress.progress * 100)}%
          </span>
          <div className="collision-toast-bar">
            <div
              className="collision-toast-fill"
              style={{ width: `${collisionProgress.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Collision mesh error */}
      {collisionProgress.state === "error" && (
        <div className="collision-toast collision-toast-error">
          Nav mesh failed: {collisionProgress.error}
        </div>
      )}

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Controls</h3>
            <table>
              <tbody>
                {CONTROLS_HELP.map(({ key, action }) => (
                  <tr key={key}>
                    <td className="help-key">{key}</td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="help-close"
              onClick={() => setShowHelp(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
