/** A player symbol. X always starts a set (classic rules). */
export type Player = 'X' | 'O';

/** A single cell value on the 3x3 board. */
export type CellValue = Player | null;

/** Lifecycle of a single active room. */
export type Phase = 'waiting' | 'playing' | 'setEnd' | 'matchEnd';

/** Result of the current set. */
export type SetWinner = Player | 'draw' | null;

/**
 * A server timestamp in epoch milliseconds, written by the database so the
 * browser can compare it directly with `Date.now()`.
 */
export type EpochMs = number | null;

/**
 * A seat is "who is currently holding this symbol". `lastSeen` is refreshed by
 * a client-side heartbeat; when it goes stale the seat is treated as free so a
 * new player can take over.
 */
export interface Seat {
  sessionId: string | null;
  lastSeen: EpochMs;
}

/**
 * The full state of one game session, identified by its shareable `code`.
 *
 * The creator (seat X) generates the code; the opponent joins with it (seat O).
 * Every client subscribed to that row receives all state changes, which are
 * applied inside server-authoritative database functions so the two players
 * can never race.
 *
 * Best-of-three with alternating symbols: the creator plays X on odd-numbered
 * sets and O on even ones (the joiner takes the other). `scores.X` counts the
 * creator's set wins and `scores.O` the joiner's, regardless of the symbol
 * either plays in the current set.
 */
export interface GameRoom {
  code: string;
  seatX: Seat | null;
  seatO: Seat | null;
  /** Length-9 array: board[row * 3 + col]. */
  board: CellValue[];
  currentTurn: Player;
  scores: Record<Player, number>;
  phase: Phase;
  setWinner: SetWinner;
  matchWinner: Player | null;
  moveCount: number;
  /** 1-based number of the current set; drives which player plays X. */
  setNumber: number;
  updatedAt: EpochMs;
}
