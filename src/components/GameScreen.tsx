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

  // The stored match winner is the symbol of the final set; translate it to
  // the viewer's own seat so the overlay can speak directly to them.
  const mySymbol = game.isCreator ? creatorSym : joinerSym;
  const matchWon = matchWinner === mySymbol;

  // "You" always sits on the left, the opponent on the right — whichever seat
  // each side holds, regardless of the current-set symbols.
  const meCard = game.isCreator
    ? { symbol: creatorSym, score: scores.X, turn: creatorTurn }
    : { symbol: joinerSym, score: scores.O, turn: joinerTurn };
  const themCard = game.isCreator
    ? { symbol: joinerSym, score: scores.O, turn: joinerTurn }
    : { symbol: creatorSym, score: scores.X, turn: creatorTurn };

  return (
    <div className="game">
      <div className="game__code">
        Room <code className="room-code">{game.code}</code>
      </div>

      <div className="players">
        <PlayerCard
          symbol={meCard.symbol}
          score={meCard.score}
          isMe
          isCurrentTurn={meCard.turn}
          disconnected={false}
        />
        <div className="players__vs" aria-hidden="true">
          vs
        </div>
        <PlayerCard
          symbol={themCard.symbol}
          score={themCard.score}
          isMe={false}
          isCurrentTurn={themCard.turn}
          disconnected={opponentDisconnected}
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
          <Overlay tone={matchWon ? 'success' : 'info'}>
            <p className="overlay__title">{matchWon ? 'You won the match!' : 'You lost the match!'}</p>
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
