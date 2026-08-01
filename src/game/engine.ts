import type { CellValue, Player, SetWinner } from '../types';

/** Best-of-three match: first player to win this many sets takes the match. */
export const MATCH_WINS = 2;

/** Milliseconds between heartbeat writes while seated. */
export const HEARTBEAT_INTERVAL_MS = 3_000;

/**
 * A seat is considered dead when no heartbeat was received for this long.
 * Players on mobile browsers can be throttled for a few seconds when their
 * tab is backgrounded, so this is deliberately ~4 heartbeats of slack.
 */
export const DISCONNECT_TIMEOUT_MS = 12_000;

/** How often the client re-evaluates staleness / retries a seat claim. */
export const TICK_INTERVAL_MS = 1_500;

/** localStorage/sessionStorage key for the persisted player session. */
export const SESSION_STORAGE_KEY = 'tic-tac-toe-session-id';

/** The eight winning lines on a 3x3 board. */
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // rows
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // columns
  [0, 4, 8],
  [2, 4, 6], // diagonals
];

export function other(player: Player): Player {
  return player === 'X' ? 'O' : 'X';
}

/**
 * The symbol the creator (the player who created the session, i.e. seat X)
 * plays in a given 1-based set. Best-of-three: X on odd sets, O on even sets,
 * so the "X starts first" advantage alternates between the two players.
 */
export function creatorSymbol(setNumber: number): Player {
  return setNumber % 2 === 1 ? 'X' : 'O';
}

/** The symbol the joiner (seat O) plays in a given set. */
export function joinerSymbol(setNumber: number): Player {
  return other(creatorSymbol(setNumber));
}

export function emptyBoard(): CellValue[] {
  return Array<CellValue>(9).fill(null);
}

export interface BoardResult {
  winner: SetWinner;
  /** Cells that form the winning line (empty when draw / no winner yet). */
  line: number[];
}

/**
 * Pure evaluation of a board. Returns the winner ('X' | 'O'), 'draw' when the
 * board is full without a winner, or null while the set is still in progress.
 */
export function evaluateBoard(board: CellValue[]): BoardResult {
  for (const [a, b, c] of LINES) {
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) {
      return { winner: mark as Player, line: [a, b, c] };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { winner: 'draw', line: [] };
  }
  return { winner: null, line: [] };
}
