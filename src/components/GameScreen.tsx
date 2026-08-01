import { useEffect, useState } from 'react';
import { creatorSymbol, joinerSymbol } from '../game/engine';
import type { GameRoomState } from '../hooks/useGameRoom';
import { Board } from './Board';
import { Overlay } from './Overlay';
import { PlayerCard } from './PlayerCard';
import { StatusBar } from './StatusBar';

/**
 * The full in-game screen: room code, scoreboard (with the current-set
 * symbols), status line, board and state overlays. The symbols each player
 * shows alternate between sets (best of three).
 */
export function GameScreen({ game }: { game: GameRoomState }) {
  const { phase, scores, opponentDisconnected, setWinner, matchWinner, setNumber } = game;

  const creatorSym = creatorSymbol(setNumber);
  const joinerSym = joinerSymbol(setNumber);

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

  const creatorTurn = phase === 'playing' && game.currentTurn === creatorSym;
  const joinerTurn = phase === 'playing' && game.currentTurn === joinerSym;

  return (
    <div className="game">
      <div className="game__code">
        Room <code className="room-code">{game.code}</code>
      </div>

      <div className="players">
        <PlayerCard
          symbol={creatorSym}
          score={scores.X}
          isMe={game.isCreator}
          isCurrentTurn={creatorTurn}
          disconnected={!game.isCreator && opponentDisconnected}
        />
        <div className="players__vs" aria-hidden="true">
          vs
        </div>
        <PlayerCard
          symbol={joinerSym}
          score={scores.O}
          isMe={game.isJoiner}
          isCurrentTurn={joinerTurn}
          disconnected={!game.isJoiner && opponentDisconnected}
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
                ? 'The game is paused. It resumes as soon as someone joins with this code.'
                : 'Share this code with your opponent to start the game.'}
            </p>
          </Overlay>
        )}

        {phase === 'setEnd' && (
          <Overlay tone={setWinner === 'draw' ? 'info' : 'success'}>
            <p className="overlay__title">
              {setWinner === 'draw' ? 'Draw!' : `Player ${setWinner} wins this set!`}
            </p>
            <p className="overlay__score">
              {scores.X} : {scores.O}
            </p>
            <button type="button" className="btn btn--primary" onClick={game.nextSet}>
              Next Set
            </button>
          </Overlay>
        )}

        {phase === 'matchEnd' && (
          <Overlay tone="success">
            <p className="overlay__title">Player {matchWinner} wins the match!</p>
            <p className="overlay__score">
              {scores.X} : {scores.O}
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
