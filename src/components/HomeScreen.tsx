import { useState, type FormEvent } from 'react';
import type { GameRoomState } from '../hooks/useGameRoom';

/**
 * Landing screen: create a brand-new session (which generates a shareable
 * code) or join a friend's session with its code.
 */
export function HomeScreen({ game }: { game: GameRoomState }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [bestOf, setBestOf] = useState(3);

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    game.create(bestOf);
  };

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    game.join(joinCode);
  };

  return (
    <div className="screen">
      <p className="screen__text">
        Start a new game and share the code, or join a friend’s game with theirs.
      </p>

      {game.error && (
        <p className="home__error" role="alert">
          {game.error}
        </p>
      )}

      <div className="home__buttons">
        {!showCreate && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={game.busy}
            onClick={() => setShowCreate(true)}
          >
            New game
          </button>
        )}

        {!showJoin && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={game.busy}
            onClick={() => setShowJoin(true)}
          >
            Join game
          </button>
        )}
      </div>

      {showCreate && (
        <form className="home__create" onSubmit={submitCreate}>
          <label className="home__bestof">
            Best of
            <select
              className="home__select"
              value={bestOf}
              disabled={game.busy}
              onChange={(e) => setBestOf(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={7}>7</option>
            </select>
          </label>
          <button type="submit" className="btn btn--primary" disabled={game.busy}>
            {game.busy ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {showJoin && (
        <form className="home__join" onSubmit={submitJoin}>
          <input
            className="home__input"
            type="text"
            autoFocus
            maxLength={6}
            placeholder="CODE"
            aria-label="Session code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={game.busy || joinCode.trim().length === 0}
          >
            {game.busy ? 'Joining…' : 'Join'}
          </button>
        </form>
      )}
    </div>
  );
}
