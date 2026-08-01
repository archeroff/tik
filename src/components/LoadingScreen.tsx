export function LoadingScreen() {
  return (
    <div className="screen">
      <div className="spinner" aria-hidden="true" />
      <p className="screen__text">Connecting…</p>
    </div>
  );
}
