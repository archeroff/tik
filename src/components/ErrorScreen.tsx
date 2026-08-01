interface ErrorScreenProps {
  message: string | null;
  onRetry: () => void;
}

/** Shown when the realtime connection drops — the in-app offline splash. */
export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <div className="screen">
      <div className="card">
        <p className="card__title">You’re offline</p>
        <p className="card__sub">
          This game needs a live connection to your opponent. {message ?? 'Connection lost.'}{' '}
          Reconnect to jump back in.
        </p>
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          Reconnect
        </button>
      </div>
    </div>
  );
}
