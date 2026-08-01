import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  HEARTBEAT_INTERVAL_MS,
  SESSION_STORAGE_KEY,
  TICK_INTERVAL_MS,
  emptyBoard,
  evaluateBoard,
} from '../game/engine';
import {
  advanceToNextSet,
  claimSeat,
  ensureGameStarted,
  isSeatStale,
  listenToRoom,
  recordMove,
  restartMatch as restartMatchService,
  sendHeartbeat,
} from '../services/gameService';
import type { GameRoom, Player } from '../types';

export type GameStatus = 'loading' | 'connected' | 'spectator' | 'error';

/** sessionStorage (not localStorage) so a refresh keeps the seat but a new tab becomes a new visitor. */
function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Central hook that binds the React app to the Firestore room.
 *
 * Responsibilities:
 *  - subscribe to the realtime room snapshot,
 *  - claim a seat (or report being a spectator),
 *  - keep the seat alive with a heartbeat,
 *  - detect a disconnected opponent,
 *  - expose actions (move / next set / restart) guarded by game rules.
 */
export function useGameRoom() {
  const [sessionId] = useState<string>(getOrCreateSessionId);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [claimResolved, setClaimResolved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [claimTick, bumpClaimTick] = useReducer((x: number) => x + 1, 0);
  const claimingRef = useRef(false);

  // Local clock used to judge heartbeat staleness without extra reads.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Realtime subscription to the single room document.
  useEffect(() => {
    return listenToRoom(
      (data) => {
        setRoom(data);
        setRoomError(null);
      },
      (err) => {
        setRoomError(err.message);
      },
    );
  }, []);

  // Which symbol, if any, belongs to this session.
  const mySymbol = useMemo<Player | null>(() => {
    if (!room) return null;
    if (room.seatX?.sessionId === sessionId) return 'X';
    if (room.seatO?.sessionId === sessionId) return 'O';
    return null;
  }, [room, sessionId]);

  const opponentSymbol: Player = mySymbol === 'X' ? 'O' : 'X';

  const opponentSeat = mySymbol === 'X' ? room?.seatO : room?.seatX;

  // Once both seats look occupied there is no point hammering the server with
  // claim attempts — a spectator only retries when a seat frees up.
  const seatsLookFull = !!room && !isSeatStale(room.seatX, now) && !isSeatStale(room.seatO, now);

  // Seat claim. Runs whenever this client is not seated: on first connect it
  // takes the first free seat; as a spectator it keeps polling so it can jump
  // in the moment a seat frees up (after a disconnect or a finished match).
  useEffect(() => {
    if (mySymbol || claimingRef.current) return;
    if (claimResolved && seatsLookFull) return;

    let cancelled = false;
    claimingRef.current = true;

    claimSeat(sessionId)
      .then(() => {
        // Even if this attempt was superseded (StrictMode remount), record that
        // a claim completed so the status is never stuck on "connecting".
        setClaimResolved(true);
        void cancelled;
      })
      .catch(() => {
        // Transient failure (e.g. offline); the next tick retries.
      })
      .finally(() => {
        claimingRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [room, mySymbol, sessionId, claimTick, seatsLookFull, claimResolved]);

  // Retry claim attempts periodically while still unseated.
  useEffect(() => {
    if (mySymbol) return;
    const id = setInterval(bumpClaimTick, TICK_INTERVAL_MS * 2);
    return () => clearInterval(id);
  }, [mySymbol]);

  // Heartbeat: keeps our seat alive so we are not reclaimed while playing.
  useEffect(() => {
    if (!mySymbol) return;
    const beat = () => {
      sendHeartbeat(sessionId, mySymbol).catch(() => {});
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mySymbol, sessionId]);

  const bothSeatsPresent =
    !!room && !isSeatStale(room.seatX, now) && !isSeatStale(room.seatO, now);

  // Transition the room from "waiting" to "playing" once both seats are held.
  useEffect(() => {
    if (!mySymbol || !room) return;
    if (room.phase !== 'waiting' || !bothSeatsPresent) return;
    ensureGameStarted().catch(() => {});
  }, [mySymbol, room, bothSeatsPresent]);

  const opponentDisconnected =
    !!mySymbol && !!room && room.phase !== 'waiting' && isSeatStale(opponentSeat, now);

  const status: GameStatus = roomError
    ? 'error'
    : mySymbol
      ? 'connected'
      : !room || !claimResolved
        ? 'loading'
        : 'spectator';

  const canMove =
    status === 'connected' &&
    !!room &&
    room.phase === 'playing' &&
    room.currentTurn === mySymbol &&
    !opponentDisconnected;

  const makeMove = useCallback(
    (index: number) => {
      if (!canMove || !room || !mySymbol) return;
      if (room.board[index] !== null) return;
      recordMove(sessionId, mySymbol, index).catch(() => {
        // The transaction may reject the move (e.g. a racing click from the
        // opponent); the snapshot will converge, so failing silently is safe.
      });
    },
    [canMove, room, mySymbol, sessionId],
  );

  const nextSet = useCallback(() => {
    advanceToNextSet().catch(() => {});
  }, []);

  const restartMatch = useCallback(() => {
    restartMatchService().catch(() => {});
  }, []);

  const retry = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    status,
    error: roomError,
    room,
    mySymbol,
    opponentSymbol,
    opponentDisconnected,
    phase: room?.phase ?? 'waiting',
    board: room?.board ?? emptyBoard(),
    currentTurn: room?.currentTurn ?? 'X',
    scores: room?.scores ?? { X: 0, O: 0 },
    setWinner: room?.setWinner ?? null,
    matchWinner: room?.matchWinner ?? null,
    moveCount: room?.moveCount ?? 0,
    winningLine: room ? evaluateBoard(room.board).line : [],
    canMove,
    makeMove,
    nextSet,
    restartMatch,
    retry,
  };
}

export type GameRoomState = ReturnType<typeof useGameRoom>;
