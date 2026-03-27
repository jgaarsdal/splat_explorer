interface LoadingOverlayProps {
  loading: boolean;
  progress: number;
  error: string | null;
}

export function LoadingOverlay({ loading, progress, error }: LoadingOverlayProps) {
  if (!loading && !error) return null;

  return (
    <div className="loading-overlay">
      {error ? (
        <div className="loading-error">
          <div className="loading-error-icon">!</div>
          <p>{error}</p>
        </div>
      ) : (
        <div className="loading-content">
          <div className="loading-spinner" />
          <p className="loading-text">
            {progress > 0
              ? `Loading... ${Math.round(progress * 100)}%`
              : "Loading..."}
          </p>
          {progress > 0 && (
            <div className="loading-bar-track">
              <div
                className="loading-bar-fill"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
