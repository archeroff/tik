import type { Timestamp } from 'firebase/firestore';

/** A player symbol. X always starts a set (classic rules). */
export type Player = 'X' | 'O';

/** A single cell value on the 3x3 board. */
export type CellValue = Player | null;

/** Lifecycle of a single active room. */
export type Phase = 'waiting' | 'playing' | 'setEnd' | 'matchEnd';

/** Result of the current set. */
export type SetWinner = Player | 'draw' | null;

/** A server timestamp inside Firestore arrives as a `Timestamp`. */
export type FireTimestamp = Timestamp | number | null;

/**
 * A seat is "who is currently holding this symbol". `lastSeen` is a server
 * timestamp refreshed by a client-side heartbeat; when it goes stale the seat
 * is treated as free so a new player can take over.
 */
export interface Seat {
  sessionId: string;
  lastSeen: FireTimestamp;
}

/**
 * The full state of the single shared game room.
 *
 * There is exactly ONE document (`rooms/game`); no rooms, codes or usernames.
 * Every client subscribes to this document and all state changes are written
 * here inside Firestore transactions so the two players can never race.
 */
export interface GameRoom {
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
  updatedAt: FireTimestamp;
}
