import { useEffect, useState } from 'react';
import type { GameRoomState } from '../hooks/useGameRoom';
import { Board } from './Board';
import { Overlay } from './Overlay';
import { PlayerCard } from './PlayerCard';
import { StatusBar } from './StatusBar';

/** The full in-game screen: scoreboard, status line, board and state overlays. */
export function GameScreen({ game }: { game: GameRoomState }) {
  const { phase, mySymbol, opponentSymbol, scores, opponentDisconnected, setWinner, matchWinner } = game;

  // Transient "Let's get started!" banner whenever a fresh match enters play
  // (0-0 score, no moves yet). It shows for a few seconds or until the first
  // move, whichever comes first — so both players always see it.
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (phase === 'playing' && game.moveCount === 0 && scores.X === 0 && scores.O === 0) {
      setShowWelcome(true);
      const timer = setTimeout(() => setShowWelcome(false), 4000);
      return () => clearTimeout(timer);
    }
    setShowWelcome(false);
  }, [phase, game.moveCount, scores.X, scores.O]);

  const xIsTurn = phase === 'playing' && game.currentTurn === 'X';
  const oIsTurn = phase === 'playing' && game.currentTurn === 'O';

  return (
    <div className="game">
      <div className="players">
        <PlayerCard
          symbol="X"
          score={scores.X}
          isMe={mySymbol === 'X'}
          isCurrentTurn={xIsTurn}
          disconnected={opponentSymbol === 'X' && opponentDisconnected}
        />
        <div className="players__vs" aria-hidden="true">
          vs
        </div>
        <PlayerCard
          symbol="O"
          score={scores.O}
          isMe={mySymbol === 'O'}
          isCurrentTurn={oIsTurn}
          disconnected={opponentSymbol === 'O' && opponentDisconnected}
        />
      </div>

      <StatusBar game={game} showWelcome={showWelcome} />

      <div className="board-wrap">
        <Board board={game.board} winningLine={game.winningLine} enabled={game.canMove} onCellClick={game.makeMove} />

        {(phase === 'waiting' || opponentDisconnected) && (
          <Overlay tone="info">
            <p className="overlay__title">
              {opponentDisconnected ? 'Opponent disconnected.' : 'Waiting for opponent…'}
            </p>
            <p className="overlay__sub">
              {opponentDisconnected
                ? 'The game is paused. It resumes as soon as a player joins.'
                : 'The game starts as soon as a second player joins.'}
            </p>
          </Overlay>
        )}

        {phase === 'setEnd' && (
          <Overlay tone={setWinner === 'draw' ? 'info' : 'success'}>
            <p className="overlay__title">
              {setWinner === 'draw' ? 'Draw!' : `Player ${setWinner} wins this set!`}
            </p>
            <p className="overlay__score">
              X {scores.X} : {scores.O} O
            </p>
            <button type="button" className="btn btn--primary" onClick={game.nextSet}>
              Next Set
            </button>
          </Overlay>
        )}

        {phase === 'matchEnd' && (
          <Overlay tone="success">
            <p className="overlay__title">🏆 Player {matchWinner} wins the match!</p>
            <p className="overlay__score">
              X {scores.X} : {scores.O} O
            </p>
            <button type="button" className="btn btn--primary" onClick={game.restartMatch}>
              Restart Match
            </button>
          </Overlay>
        )}
      </div>
    </div>
  );
}
