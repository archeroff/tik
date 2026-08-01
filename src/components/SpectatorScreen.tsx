/** Full-screen message for any visitor beyond the two active players. */
export function SpectatorScreen() {
  return (
    <div className="screen">
      <div className="card">
        <p className="card__title">Game already started.</p>
        <p className="card__sub">Please wait until the current match is finished.</p>
      </div>
    </div>
  );
}
