import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { DISCONNECT_TIMEOUT_MS, MATCH_WINS, createInitialRoom, emptyBoard, evaluateBoard, other } from '../game/engine';
import type { FireTimestamp, GameRoom, Phase, Player, Seat, SetWinner } from '../types';

/**
 * THE SYNCHRONIZATION LAYER
 * ------------------------
 *
 * There is exactly ONE game room for the whole app, backed by a single
 * Firestore document at `rooms/game`. Every connected client subscribes to
 * that document with a realtime listener, so any change written by one player
 * is pushed to the other within a few hundred milliseconds — no page refresh,
 * no room codes.
 *
 *   presence   -> two `seat` fields holding { sessionId, lastSeen }. Each
 *                 seated client refreshes its own `lastSeen` on a 3s heartbeat
 *                 (server timestamp). A seat whose heartbeat is older than
 *                 `DISCONNECT_TIMEOUT_MS` is considered empty.
 *   seating    -> a client claims the first free/stale seat inside a
 *                 transaction. If BOTH seats are gone the room is reset to a
 *                 brand-new `waiting` room (the waiting room only reopens when
 *                 both players are gone). Otherwise the board/score state is
 *                 preserved and the joiner simply becomes the missing player.
 *   moves      -> every move is a Firestore transaction that re-validates the
 *                 full game rules (phase, turn, empty cell, opponent present)
 *                 before writing, so two players can never corrupt the state
 *                 even if they click at the same moment.
 *   match flow -> the same transaction advances scores, set phase and match
 *                 phase, so all clients always converge on one truth.
 */

const ROOM_PATH = 'rooms/game';

/** Guards against calling into Firestore before it is configured. */
function getDb() {
  if (!db) throw new Error('Firebase is not configured.');
  return db;
}

/** Resolves the room document lazily so the module can load without config. */
function getRoomRef() {
  return doc(getDb(), ROOM_PATH);
}

/** Converts a Firestore server timestamp (or raw ms) into milliseconds. */
export function toMillis(value: FireTimestamp): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return (value as Timestamp).toMillis();
}

/** True when the seat is empty or its heartbeat is older than the timeout. */
export function isSeatStale(seat: Seat | null | undefined, now: number): boolean {
  if (!seat) return true;
  return now - toMillis(seat.lastSeen) > DISCONNECT_TIMEOUT_MS;
}

export type RoomListener = (room: GameRoom | null) => void;
export type RoomErrorListener = (error: Error) => void;

/**
 * Subscribes to realtime updates of the single room document. `onNext` is
 * called immediately with the current state and again on every change.
 */
export function listenToRoom(onNext: RoomListener, onError: RoomErrorListener): () => void {
  return onSnapshot(
    getRoomRef(),
    {
      next: (snapshot) => onNext(snapshot.exists() ? (snapshot.data() as GameRoom) : null),
      error: (err) => onError(err as Error),
    },
  );
}

export interface ClaimResult {
  claimed: boolean;
  symbol: Player | null;
}

/**
 * Attempts to seat the given session on the room.
 *
 * Rules applied atomically:
 *  1. If the session already holds a seat (e.g. a page refresh), refresh it.
 *  2. If both seats are gone, reset the room to a fresh waiting room and take X.
 *  3. Otherwise take the first free/stale seat (X preferred).
 *  4. Otherwise the room is full -> spectator, rejected.
 */
export async function claimSeat(sessionId: string): Promise<ClaimResult> {
  return runTransaction(getDb(), async (tx) => {
    const ref = getRoomRef();
    const snapshot = await tx.get(ref);
    const room = snapshot.exists() ? (snapshot.data() as GameRoom) : null;
    const now = Date.now();

    if (room) {
      if (room.seatX?.sessionId === sessionId) {
        tx.update(ref, { 'seatX.lastSeen': serverTimestamp() });
        return { claimed: true, symbol: 'X' };
      }
      if (room.seatO?.sessionId === sessionId) {
        tx.update(ref, { 'seatO.lastSeen': serverTimestamp() });
        return { claimed: true, symbol: 'O' };
      }
    }

    const xFree = isSeatStale(room?.seatX, now);
    const oFree = isSeatStale(room?.seatO, now);

    if (xFree && oFree) {
      // Both players disconnected: the waiting room reopens.
      tx.set(ref, {
        ...createInitialRoom(sessionId),
        updatedAt: serverTimestamp(),
      });
      return { claimed: true, symbol: 'X' };
    }

    if (xFree) {
      tx.update(ref, { seatX: { sessionId, lastSeen: serverTimestamp() } });
      return { claimed: true, symbol: 'X' };
    }

    if (oFree) {
      tx.update(ref, { seatO: { sessionId, lastSeen: serverTimestamp() } });
      return { claimed: true, symbol: 'O' };
    }

    return { claimed: false, symbol: null };
  });
}

/**
 * Flips the room from `waiting` to `playing` as soon as both seats are held.
 *
 * This is deliberately NOT a transaction: it only ever moves the phase forward
 * to `playing`, and every client writing the same value is idempotent. Using a
 * plain conditional update avoids needless conflicts with the seat heartbeats
 * that churn the document every few seconds.
 */
export async function ensureGameStarted(): Promise<void> {
  const ref = getRoomRef();
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;
  const room = snapshot.data() as GameRoom;
  const now = Date.now();
  const bothPresent = !isSeatStale(room.seatX, now) && !isSeatStale(room.seatO, now);
  if (bothPresent && room.phase === 'waiting') {
    await updateDoc(ref, { phase: 'playing', updatedAt: serverTimestamp() });
  }
}

/**
 * Records one move. The transaction re-validates every rule against the latest
 * committed state so a move can never be made out of turn, on a taken cell,
 * after the set/match ended, or against a disconnected opponent.
 */
export async function recordMove(sessionId: string, symbol: Player, index: number): Promise<void> {
  await runTransaction(getDb(), async (tx) => {
    const ref = getRoomRef();
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = snapshot.data() as GameRoom;
    const now = Date.now();

    if (room.phase !== 'playing') throw new Error('The set is not in progress.');
    if (room.currentTurn !== symbol) throw new Error("It is not this player's turn.");
    if (room.seatX?.sessionId !== sessionId && room.seatO?.sessionId !== sessionId) {
      throw new Error('Player is not seated.');
    }
    const opponentSeat = symbol === 'X' ? room.seatO : room.seatX;
    if (isSeatStale(opponentSeat, now)) throw new Error('Opponent disconnected.');
    if (room.board[index] !== null) throw new Error('Cell is already taken.');

    const board = [...room.board];
    board[index] = symbol;

    const result = evaluateBoard(board);
    const scores = { ...room.scores };

    let phase: Phase = room.phase;
    let setWinner: SetWinner = result.winner;
    let matchWinner: Player | null = room.matchWinner;

    if (result.winner === 'draw') {
      // A drawn set awards no point; the match simply continues.
      phase = 'setEnd';
    } else if (result.winner === 'X' || result.winner === 'O') {
      scores[result.winner] += 1;
      if (scores[result.winner] >= MATCH_WINS) {
        phase = 'matchEnd';
        matchWinner = result.winner;
      } else {
        phase = 'setEnd';
      }
    }

    tx.update(ref, {
      board,
      scores,
      phase,
      setWinner,
      matchWinner,
      currentTurn: result.winner ? room.currentTurn : other(symbol),
      moveCount: room.moveCount + 1,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Resets the board after a set ends; scores are intentionally kept. */
export async function advanceToNextSet(): Promise<void> {
  await runTransaction(getDb(), async (tx) => {
    const ref = getRoomRef();
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = snapshot.data() as GameRoom;
    if (room.phase !== 'setEnd') throw new Error('No finished set to advance from.');

    tx.update(ref, {
      board: emptyBoard(),
      currentTurn: 'X',
      phase: 'playing',
      setWinner: null,
      moveCount: 0,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Restarts the whole match. Resets board + scores but keeps the two connected
 * players seated, so the waiting room does not reopen.
 */
export async function restartMatch(): Promise<void> {
  await runTransaction(getDb(), async (tx) => {
    const ref = getRoomRef();
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error('Room not found.');
    const room = snapshot.data() as GameRoom;
    if (room.phase !== 'matchEnd') throw new Error('No finished match to restart.');

    tx.update(ref, {
      board: emptyBoard(),
      currentTurn: 'X',
      scores: { X: 0, O: 0 },
      phase: 'playing',
      setWinner: null,
      matchWinner: null,
      moveCount: 0,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Refreshes this player's seat heartbeat so their seat is not reclaimed. */
export function sendHeartbeat(symbol: Player): Promise<void> {
  return updateDoc(getRoomRef(), { [`seat${symbol}.lastSeen`]: serverTimestamp() });
}
