-- Sessions: every room now lives behind its own join code.
--
-- A player lands on a home screen and either creates a new session (which
-- generates a code and seats the creator as X) or joins an existing one with
-- the code (seated as O). Rooms are now keyed by `code` instead of the single
-- hard-coded id = 1.
--
-- Best-of-three with alternating symbols: the creator (seat_x) plays X on
-- odd-numbered sets and O on even ones; the joiner (seat_o) takes the other.
-- X always starts a set, so the "X starts first" rule alternates between the
-- two players as sets progress. Scores are tracked per seat (scores.X =
-- creator's wins, scores.O = joiner's wins).

alter table public.room
  add column code text,
  add column set_number integer not null default 1;

-- Migrate the existing single room (id = 1) so nothing is lost. This runs
-- BEFORE the primary key is dropped: the room publishes Realtime updates, so
-- it must keep a replica identity (its primary key) for the UPDATE to be legal.
update public.room set code = 'AAAAAA' where code is null;

alter table public.room alter column code set not null;

-- Room is now keyed by `code`; the fixed id = 1 column is retired.
alter table public.room
  drop constraint if exists room_pkey,
  drop column if exists id,
  add constraint room_pkey primary key (code);

-- The pre-session functions are replaced below by code-keyed versions.
drop function if exists public.claim_seat(text);
drop function if exists public.ensure_game_started();
drop function if exists public.record_move(text, text, integer);
drop function if exists public.advance_next_set();
drop function if exists public.restart_match();
drop function if exists public.heartbeat(text, text);

-- ---------------------------------------------------------------------------
-- New helpers
-- ---------------------------------------------------------------------------

-- A 6-character share code using an unambiguous alphabet (no 0/O, 1/I).
create or replace function public.random_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 6);
$$;

-- ---------------------------------------------------------------------------
-- Session functions
-- ---------------------------------------------------------------------------

-- Creates a brand-new session: generates a code and seats the creator as X.
create or replace function public.create_session(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_room public.room;
  v_tries integer := 0;
begin
  loop
    v_code := public.random_code();
    begin
      insert into public.room (code, seat_x_session, seat_x_last_seen, current_turn, phase, set_number)
      values (v_code, p_session, public.now_epoch_ms(), 'X', 'waiting', 1)
      returning * into v_room;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 10 then
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object('code', v_code, 'room', to_jsonb(v_room));
end;
$$;

-- Joins an existing session with its code. The joiner takes the free/stale
-- seat; if both seats are gone the session restarts fresh. The game starts the
-- moment both players are present.
create or replace function public.join_session(p_code text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.room;
  v_claimed boolean := false;
begin
  select * into v_room from public.room where code = p_code for update;
  if not found then
    raise exception 'Session not found.';
  end if;

  if v_room.seat_x_session = p_session then
    update public.room set seat_x_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where code = p_code;
    v_claimed := true;
  elsif v_room.seat_o_session = p_session then
    update public.room set seat_o_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where code = p_code;
    v_claimed := true;
  elsif public.is_seat_stale(v_room.seat_x_last_seen) and public.is_seat_stale(v_room.seat_o_last_seen) then
    update public.room
    set seat_x_session = p_session,
        seat_x_last_seen = public.now_epoch_ms(),
        seat_o_session = null,
        seat_o_last_seen = null,
        board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
        current_turn = 'X',
        scores = '{"X":0,"O":0}'::jsonb,
        phase = 'waiting',
        set_winner = null,
        match_winner = null,
        move_count = 0,
        set_number = 1,
        updated_at = public.now_epoch_ms()
    where code = p_code;
    v_claimed := true;
  elsif public.is_seat_stale(v_room.seat_x_last_seen) then
    update public.room set seat_x_session = p_session, seat_x_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where code = p_code;
    v_claimed := true;
  elsif public.is_seat_stale(v_room.seat_o_last_seen) then
    update public.room set seat_o_session = p_session, seat_o_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where code = p_code;
    v_claimed := true;
  else
    raise exception 'Session is full.';
  end if;

  -- Start the game the moment both players are present.
  update public.room
  set phase = 'playing', updated_at = public.now_epoch_ms()
  where code = p_code
    and phase = 'waiting'
    and not public.is_seat_stale(seat_x_last_seen)
    and not public.is_seat_stale(seat_o_last_seen);

  select * into v_room from public.room where code = p_code;
  return jsonb_build_object('claimed', v_claimed, 'room', to_jsonb(v_room));
end;
$$;

-- Flips the session to 'playing' once both seats are held. Idempotent.
create or replace function public.ensure_game_started(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room
  set phase = 'playing', updated_at = public.now_epoch_ms()
  where code = p_code
    and phase = 'waiting'
    and not public.is_seat_stale(seat_x_last_seen)
    and not public.is_seat_stale(seat_o_last_seen);
end;
$$;

-- Records one move, re-validating every rule against the locked row. The
-- mover's symbol for the current set is derived from which seat they hold and
-- the set number, so a client can never pass a wrong symbol.
create or replace function public.record_move(p_code text, p_session text, p_cell integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.room;
  v_symbol text;
  v_score_key text;
  v_opp_last_seen bigint;
  v_board jsonb;
  v_result text;
  v_scores jsonb;
  v_next_turn text;
begin
  select * into v_room from public.room where code = p_code for update;
  if not found then
    raise exception 'Room not found.';
  end if;

  if v_room.phase <> 'playing' then
    raise exception 'The set is not in progress.';
  end if;

  if v_room.seat_x_session = p_session then
    v_symbol := case when v_room.set_number % 2 = 1 then 'X' else 'O' end;
    v_score_key := 'X';
    v_opp_last_seen := v_room.seat_o_last_seen;
  elsif v_room.seat_o_session = p_session then
    v_symbol := case when v_room.set_number % 2 = 1 then 'O' else 'X' end;
    v_score_key := 'O';
    v_opp_last_seen := v_room.seat_x_last_seen;
  else
    raise exception 'Player is not seated.';
  end if;

  if v_room.current_turn <> v_symbol then
    raise exception 'It is not this player''s turn.';
  end if;
  if public.is_seat_stale(v_opp_last_seen) then
    raise exception 'Opponent disconnected.';
  end if;
  if p_cell < 0 or p_cell > 8 then
    raise exception 'Cell is out of range.';
  end if;
  if v_room.board->>p_cell is not null then
    raise exception 'Cell is already taken.';
  end if;

  v_board := jsonb_set(v_room.board, array[p_cell::text], to_jsonb(v_symbol));
  v_result := public.evaluate_board(v_board);
  v_scores := v_room.scores;
  v_next_turn := case when v_symbol = 'X' then 'O' else 'X' end;

  if v_result = 'draw' then
    update public.room
    set board = v_board,
        phase = 'setEnd',
        set_winner = 'draw',
        current_turn = v_room.current_turn,
        move_count = v_room.move_count + 1,
        updated_at = public.now_epoch_ms()
    where code = p_code;
  elsif v_result = 'X' or v_result = 'O' then
    v_scores := jsonb_set(v_scores, array[v_score_key], to_jsonb(((v_scores->>v_score_key)::int) + 1));
    if ((v_scores->>v_score_key)::int) >= 2 then
      update public.room
      set board = v_board,
          scores = v_scores,
          phase = 'matchEnd',
          set_winner = v_result,
          match_winner = v_result,
          current_turn = v_room.current_turn,
          move_count = v_room.move_count + 1,
          updated_at = public.now_epoch_ms()
      where code = p_code;
    else
      update public.room
      set board = v_board,
          scores = v_scores,
          phase = 'setEnd',
          set_winner = v_result,
          current_turn = v_room.current_turn,
          move_count = v_room.move_count + 1,
          updated_at = public.now_epoch_ms()
      where code = p_code;
    end if;
  else
    update public.room
    set board = v_board,
        current_turn = v_next_turn,
        move_count = v_room.move_count + 1,
        updated_at = public.now_epoch_ms()
    where code = p_code;
  end if;
end;
$$;

-- Starts the next set after a finished one; scores are kept. The set number
-- advances, which flips which player plays X.
create or replace function public.advance_next_set(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room
  set board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
      current_turn = 'X',
      phase = 'playing',
      set_winner = null,
      move_count = 0,
      set_number = set_number + 1,
      updated_at = public.now_epoch_ms()
  where code = p_code and phase = 'setEnd';
end;
$$;

-- Restarts the whole match: board + scores reset, back to set 1.
create or replace function public.restart_match(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room
  set board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
      current_turn = 'X',
      scores = '{"X":0,"O":0}'::jsonb,
      phase = 'playing',
      set_winner = null,
      match_winner = null,
      move_count = 0,
      set_number = 1,
      updated_at = public.now_epoch_ms()
  where code = p_code and phase = 'matchEnd';
end;
$$;

-- Client heartbeat: keeps the caller's seat alive (3 s interval).
create or replace function public.heartbeat(p_code text, p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room set seat_x_last_seen = public.now_epoch_ms() where code = p_code and seat_x_session = p_session;
  if not found then
    update public.room set seat_o_last_seen = public.now_epoch_ms() where code = p_code and seat_o_session = p_session;
  end if;
end;
$$;

-- Test convenience: wipes every session.
create or replace function public.reset_room()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Supabase blocks DELETE without a WHERE clause, so filter on the key.
  delete from public.room where code is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

grant execute on function public.create_session(text) to anon, authenticated;
grant execute on function public.join_session(text, text) to anon, authenticated;
grant execute on function public.ensure_game_started(text) to anon, authenticated;
grant execute on function public.record_move(text, text, integer) to anon, authenticated;
grant execute on function public.advance_next_set(text) to anon, authenticated;
grant execute on function public.restart_match(text) to anon, authenticated;
grant execute on function public.heartbeat(text, text) to anon, authenticated;
grant execute on function public.reset_room() to anon, authenticated;
