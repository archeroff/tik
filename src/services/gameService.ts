import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { DISCONNECT_TIMEOUT_MS } from '../game/engine';
import { getClient } from '../supabase/client';
import type { CellValue, GameRoom, Phase, Player, Seat, SetWinner } from '../types';

/**
 * THE SYNCHRONIZATION LAYER
 * ------------------------
 *
 * Every game session lives in its own row of the Supabase `room` table,
 * identified by a short shareable code. The creator generates the code (and
 * becomes X); the opponent joins with it (becomes O). Each connected client
 * reads its session's row and subscribes to Postgres changes (Realtime), so
 * any change written by one player is pushed to the other within a few hundred
 * milliseconds — no page refresh.
 *
 *   presence   -> `seat_x` / `seat_o` columns holding { session, lastSeen }.
 *                 Each seated client refreshes its own `lastSeen` with a 3 s
 *                 heartbeat (server epoch ms). A seat whose heartbeat is older
 *                 than `DISCONNECT_TIMEOUT_MS` is considered empty.
 *   session    -> `create_session` generates a code and seats the creator;
 *                 `join_session` seats the opponent (or re-seats the creator).
 *                 The game flips to `playing` the moment both seats are held.
 *   moves      -> every move goes through the `record_move` database function,
 *                 which re-validates the full game rules (phase, turn, empty
 *                 cell, opponent present) under a row lock, so two players can
 *                 never corrupt the state even if they click at the same
 *                 moment. All mutations are SECURITY DEFINER functions; the
 *                 table itself is select-only to anonymous clients.
 *   match flow -> the same function advances scores, set phase and match
 *                 phase, so all clients always converge on one truth. Best of
 *                 three: the creator plays X on odd sets and O on even ones.
 */

let serverTimeOffsetMs: number | null = null;
let syncPromise: Promise<number> | null = null;

/**
 * Estimates the difference between the Supabase server clock and this
 * browser's clock (`serverNow - Date.now()`), cached after the first call.
 *
 * The database writes heartbeat timestamps using its own clock, so comparing
 * them against `Date.now()` directly is only correct when the two clocks agree
 * (they often drift, e.g. a browser on a machine whose clock is slightly off).
 * Every staleness decision in the UI goes through this aligned clock instead.
 */
export function getServerTimeOffset(): Promise<number> {
  if (serverTimeOffsetMs !== null) return Promise.resolve(serverTimeOffsetMs);
  if (!syncPromise) {
    syncPromise = (async () => {
      const sentAt = Date.now();
      const { data, error } = await getClient().rpc('now_epoch_ms');
      if (error) throw new Error(error.message);
      serverTimeOffsetMs = (data as number) - (sentAt + Date.now()) / 2;
      return serverTimeOffsetMs;
    })();
  }
  return syncPromise;
}

/** Maps a single `room` row from Postgres to the app's `GameRoom` shape. */
interface RoomRow {
  code: string;
  seat_x_session: string | null;
  seat_x_last_seen: number | null;
  seat_o_session: string | null;
  seat_o_last_seen: number | null;
  board: (string | null)[];
  current_turn: string;
  scores: { X: number; O: number };
  phase: string;
  set_winner: string | null;
  match_winner: string | null;
  move_count: number;
  set_number: number;
  target_score: number;
  updated_at: number | null;
}

function mapRow(row: RoomRow): GameRoom {
  return {
    code: row.code,
    seatX: row.seat_x_session ? { sessionId: row.seat_x_session, lastSeen: row.seat_x_last_seen } : null,
    seatO: row.seat_o_session ? { sessionId: row.seat_o_session, lastSeen: row.seat_o_last_seen } : null,
    board: row.board as CellValue[],
    currentTurn: row.current_turn as Player,
    scores: row.scores,
    phase: row.phase as Phase,
    setWinner: row.set_winner as SetWinner,
    matchWinner: row.match_winner as Player | null,
    moveCount: row.move_count,
    setNumber: row.set_number,
    targetScore: row.target_score,
    updatedAt: row.updated_at,
  };
}

/** Server timestamps already arrive as epoch milliseconds. */
export function toMillis(value: number | null): number {
  return value ?? 0;
}

/** True when the seat is empty or its heartbeat is older than the timeout. */
export function isSeatStale(seat: Seat | null | undefined, now: number): boolean {
  if (!seat) return true;
  return now - toMillis(seat.lastSeen) > DISCONNECT_TIMEOUT_MS;
}

export type RoomListener = (room: GameRoom | null) => void;
export type RoomErrorListener = (error: Error) => void;

/**
 * Subscribes to realtime updates of one session's row. `onNext` is called
 * once immediately with the current state and again on every change. Returns
 * an unsubscribe function.
 */
export function listenToRoom(
  code: string,
  onNext: RoomListener,
  onError: RoomErrorListener,
): () => void {
  const supabase = getClient();
  let lastUpdatedAt = -1;
  let disposed = false;

  const apply = (row: RoomRow | null) => {
    if (disposed) return;
    if (!row) {
      onNext(null);
      return;
    }
    // Guard against out-of-order delivery (initial fetch racing a change).
    if ((row.updated_at ?? 0) < lastUpdatedAt) return;
    lastUpdatedAt = row.updated_at ?? 0;
    onNext(mapRow(row));
  };

  const channel = supabase
    .channel(`room-realtime-${code}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room', filter: `code=eq.${code}` },
      (payload: RealtimePostgresChangesPayload<RoomRow>) => {
        apply((payload.new as RoomRow) ?? null);
      },
    )
    .subscribe();

  supabase
    .from('room')
    .select('*')
    .eq('code', code)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(new Error(error.message));
        return;
      }
      apply((data as RoomRow) ?? null);
    });

  return () => {
    disposed = true;
    supabase.removeChannel(channel).catch(() => {});
  };
}

export interface CreateSessionResult {
  code: string;
  room: GameRoom;
}

/**
 * Creates a brand-new session. The database generates a shareable code, seats
 * this client as the creator (X) and records how many sets are needed to win
 * the match. `bestOf` must be 1, 3, 5 or 7 (defaults to 3).
 */
export async function createSession(sessionId: string, bestOf = 3): Promise<CreateSessionResult> {
  const { data, error } = await getClient().rpc('create_session', {
    p_session: sessionId,
    p_best_of: bestOf,
  });
  if (error) throw new Error(error.message);
  return { code: data.code as string, room: mapRow(data.room as RoomRow) };
}

export interface JoinSessionResult {
  claimed: boolean;
  room: GameRoom;
}

/**
 * Joins an existing session by its code, taking the free/stale seat (usually
 * O). Throws when the session does not exist or both seats are taken.
 */
export async function joinSession(code: string, sessionId: string): Promise<JoinSessionResult> {
  const { data, error } = await getClient().rpc('join_session', { p_code: code, p_session: sessionId });
  if (error) throw new Error(error.message);
  return {
    claimed: Boolean(data?.claimed),
    room: mapRow(data.room as RoomRow),
  };
}

/**
 * Flips the session from `waiting` to `playing` as soon as both seats are
 * held. Idempotent and safe to call from every client.
 */
export async function ensureGameStarted(code: string): Promise<void> {
  const { error } = await getClient().rpc('ensure_game_started', { p_code: code });
  if (error) throw new Error(error.message);
}

/**
 * Records one move. The `record_move` database function re-validates every
 * rule against the latest committed state under a row lock and derives the
 * mover's symbol from their seat + the set number, so a move can never be made
 * out of turn, on a taken cell, after the set/match ended, or against a
 * disconnected opponent.
 */
export async function recordMove(code: string, sessionId: string, index: number): Promise<void> {
  const { error } = await getClient().rpc('record_move', {
    p_code: code,
    p_session: sessionId,
    p_cell: index,
  });
  if (error) throw new Error(error.message);
}

/** Resets the board after a set ends and advances the set number; scores are kept. */
export async function advanceToNextSet(code: string): Promise<void> {
  const { error } = await getClient().rpc('advance_next_set', { p_code: code });
  if (error) throw new Error(error.message);
}

/**
 * Restarts the whole match. Resets board + scores back to set 1 but keeps the
 * two connected players seated.
 */
export async function restartMatch(code: string): Promise<void> {
  const { error } = await getClient().rpc('restart_match', { p_code: code });
  if (error) throw new Error(error.message);
}

/** Refreshes this player's seat heartbeat so their seat is not reclaimed. */
export async function sendHeartbeat(code: string, sessionId: string): Promise<void> {
  const { error } = await getClient().rpc('heartbeat', { p_code: code, p_session: sessionId });
  if (error) throw new Error(error.message);
}
