/** Shown when Firebase environment variables have not been configured yet. */
export function SetupRequiredScreen() {
  return (
    <div className="screen">
      <div className="card">
        <p className="card__title">Backend not configured</p>
        <p className="card__sub">
          Copy <code>.env.example</code> to <code>.env</code>, add your Firebase project’s{' '}
          <code>VITE_FIREBASE_API_KEY</code> and <code>VITE_FIREBASE_PROJECT_ID</code>, then run{' '}
          <code>npm run dev</code>.
        </p>
        <a
          className="btn btn--primary"
          href="https://firebase.google.com/docs/web/setup"
          target="_blank"
          rel="noreferrer"
        >
          Firebase setup guide
        </a>
      </div>
    </div>
  );
}
