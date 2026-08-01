import type { GameRoomState } from '../hooks/useGameRoom';

interface StatusBarProps {
  game: GameRoomState;
  showWelcome: boolean;
}

/** The single line of copy under the scoreboard explaining the current state. */
export function StatusBar({ game, showWelcome }: StatusBarProps) {
  let text: string;
  let dim = false;

  if (game.opponentDisconnected) {
    text = 'Opponent disconnected. Waiting for opponent…';
    dim = true;
  } else if (showWelcome) {
    text = 'Let’s get started!';
  } else if (game.phase === 'waiting') {
    text = 'Waiting for opponent…';
    dim = true;
  } else if (game.phase === 'playing') {
    text = `Player ${game.currentTurn}’s turn`;
  } else if (game.phase === 'setEnd') {
    text = game.setWinner === 'draw' ? 'Draw!' : `Player ${game.setWinner} wins this set!`;
  } else {
    text = `Player ${game.matchWinner} wins the match!`;
  }

  return <p className={dim ? 'status status--dim' : 'status'}>{text}</p>;
}
