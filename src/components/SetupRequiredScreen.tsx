/** Shown when Supabase environment variables have not been configured yet. */
export function SetupRequiredScreen() {
  return (
    <div className="screen">
      <div className="card">
        <p className="card__title">Backend not configured</p>
        <p className="card__sub">
          Copy <code>.env.example</code> to <code>.env</code>, add your Supabase project’s{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then run{' '}
          <code>npm run dev</code>.
        </p>
        <a
          className="btn btn--primary"
          href="https://supabase.com/docs/guides/getting-started/quickstarts/reactjs"
          target="_blank"
          rel="noreferrer"
        >
          Supabase setup guide
        </a>
      </div>
    </div>
  );
}
