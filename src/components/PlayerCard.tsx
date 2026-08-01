import type { Player } from '../types';

interface PlayerCardProps {
  symbol: Player;
  score: number;
  isMe: boolean;
  isCurrentTurn: boolean;
  disconnected: boolean;
}

export function PlayerCard({
  symbol,
  score,
  isMe,
  isCurrentTurn,
  disconnected,
}: PlayerCardProps) {
  const classes = [
    'player-card',
    `player-card--${symbol.toLowerCase()}`,
    isCurrentTurn ? 'player-card--turn' : '',
  ].join(' ');

  return (
    <div className={classes}>
      <div className="player-card__symbol" aria-hidden="true">
        {symbol}
      </div>
      <div className="player-card__score" aria-label={`Player ${symbol} score`}>
        {score}
      </div>
      <div className="player-card__meta">
        {isMe ? 'You' : 'Opponent'}
        {disconnected && <span className="player-card__offline"> · disconnected</span>}
      </div>
    </div>
  );
}
