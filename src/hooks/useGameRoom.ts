import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HEARTBEAT_INTERVAL_MS,
  SESSION_STORAGE_KEY,
  TICK_INTERVAL_MS,
  creatorSymbol,
  emptyBoard,
  evaluateBoard,
  joinerSymbol,
} from '../game/engine';
import {
  advanceToNextSet,
  createSession,
  ensureGameStarted,
  getServerTimeOffset,
  isSeatStale,
  joinSession,
  listenToRoom,
  recordMove,
  restartMatch as restartMatchService,
  sendHeartbeat,
} from '../services/gameService';
import type { GameRoom, Player } from '../types';

export const SESSION_CODE_KEY = 'tic-tac-toe-session-code';

export type GameStatus = 'loading' | 'connected' | 'error';
export type Screen = 'home' | 'game';

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
 * Central hook that binds the React app to a game session.
 *
 * Responsibilities:
 *  - home screen: create a new session (generates a code) or join one,
 *  - subscribe to the realtime room snapshot for the active code,
 *  - keep the seat alive with a heartbeat,
 *  - detect a disconnected opponent,
 *  - expose actions (move / next set / restart) guarded by game rules,
 *  - alternate which player plays X between sets (best of three).
 */
export function useGameRoom() {
  const [sessionId] = useState<string>(getOrCreateSessionId);
  const [screen, setScreen] = useState<Screen>('home');
  const [code, setCode] = useState<string | null>(null);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  // Alignment between the browser clock and the Supabase server clock, so the
  // staleness checks below compare like with like (server writes its heartbeat
  // timestamps using its own clock).
  useEffect(() => {
    let cancelled = false;
    getServerTimeOffset()
      .then((offset) => {
        if (!cancelled) setServerOffset(offset);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Local clock aligned to the server, used to judge heartbeat staleness
  // without extra reads.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + serverOffset), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [serverOffset]);

  const persistCode = (next: string) => {
    try {
      sessionStorage.setItem(SESSION_CODE_KEY, next);
    } catch {
      // storage unavailable — the code just isn't remembered across reloads
    }
  };

  // Resume a session from the last visit, so a refresh keeps the seat.
  useEffect(() => {
    let cancelled = false;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(SESSION_CODE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return;

    joinSession(stored, sessionId)
      .then(({ room: resumed }) => {
        if (cancelled) return;
        setCode(stored);
        setRoom(resumed);
        setScreen('game');
      })
      .catch(() => {
        // The session no longer exists; start fresh from the home screen.
        try {
          sessionStorage.removeItem(SESSION_CODE_KEY);
        } catch {
          // ignore
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Realtime subscription to the session's room row.
  useEffect(() => {
    if (!code) return;
    return listenToRoom(
      code,
      (data) => {
        if (data) {
          setRoom(data);
          setRoomError(null);
        } else {
          setRoom(null);
          setRoomError('Session no longer exists.');
        }
      },
      (err) => {
        setRoomError(err.message);
      },
    );
  }, [code]);

  /** Creates a brand-new session; the creator plays X and starts first. */
  const create = useCallback(
    async (bestOf = 3) => {
      setBusy(true);
      setRoomError(null);
      try {
        const { code: created, room: fresh } = await createSession(sessionId, bestOf);
        persistCode(created);
        setCode(created);
        setRoom(fresh);
        setScreen('game');
      } catch (e) {
        setRoomError(e instanceof Error ? e.message : 'Could not create the session.');
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  /** Joins an existing session using its code. */
  const join = useCallback(
    async (rawCode: string) => {
      const next = rawCode.trim().toUpperCase();
      if (!next) return;
      setBusy(true);
      setRoomError(null);
      try {
        const { room: joined } = await joinSession(next, sessionId);
        persistCode(next);
        setCode(next);
        setRoom(joined);
        setScreen('game');
      } catch (e) {
        setRoomError(e instanceof Error ? e.message : 'Could not join the session.');
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  // Which seat, if any, belongs to this session.
  const isCreator = room?.seatX?.sessionId === sessionId;
  const isJoiner = room?.seatO?.sessionId === sessionId;

  // The symbol this session plays in the current set (alternates per set).
  const setNumber = room?.setNumber ?? 1;
  const bestOf = room ? room.targetScore * 2 - 1 : 3;
  const mySymbol = useMemo<Player | null>(() => {
    if (isCreator) return creatorSymbol(setNumber);
    if (isJoiner) return joinerSymbol(setNumber);
    return null;
  }, [isCreator, isJoiner, setNumber]);

  const opponentSymbol: Player | null =
    mySymbol === 'X' ? 'O' : mySymbol === 'O' ? 'X' : null;

  const opponentSeat = isCreator ? room?.seatO : isJoiner ? room?.seatX : null;

  // Heartbeat: keeps our seat alive so we are not reclaimed while playing.
  useEffect(() => {
    if (!code || !mySymbol) return;
    const beat = () => {
      sendHeartbeat(code, sessionId).catch(() => {});
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [code, sessionId, mySymbol]);

  // Transition the session from "waiting" to "playing" once both seats are
  // held (join_session already does this atomically; this is a safety net).
  useEffect(() => {
    if (!code || !mySymbol || !room) return;
    if (room.phase !== 'waiting') return;
    if (isSeatStale(room.seatX, now) || isSeatStale(room.seatO, now)) return;
    ensureGameStarted(code).catch(() => {});
  }, [code, mySymbol, room, now]);

  const opponentDisconnected =
    !!mySymbol && !!room && room.phase !== 'waiting' && isSeatStale(opponentSeat, now);

  const status: GameStatus = roomError ? 'error' : code && room ? 'connected' : 'loading';

  const canMove =
    status === 'connected' &&
    !!room &&
    !!mySymbol &&
    room.phase === 'playing' &&
    room.currentTurn === mySymbol &&
    !opponentDisconnected;

  const makeMove = useCallback(
    (index: number) => {
      if (!canMove || !room || !mySymbol || !code) return;
      if (room.board[index] !== null) return;
      recordMove(code, sessionId, index).catch(() => {
        // The transaction may reject the move (e.g. a racing click from the
        // opponent); the snapshot will converge, so failing silently is safe.
      });
    },
    [canMove, room, mySymbol, code, sessionId],
  );

  const nextSet = useCallback(() => {
    if (code) advanceToNextSet(code).catch(() => {});
  }, [code]);

  const restartMatch = useCallback(() => {
    if (code) restartMatchService(code).catch(() => {});
  }, [code]);

  const retry = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    screen,
    busy,
    code,
    create,
    join,
    status,
    error: roomError,
    room,
    sessionId,
    isCreator,
    isJoiner,
    setNumber,
    bestOf,
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
