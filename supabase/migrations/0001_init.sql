-- Tic-Tac-Toe room state + server-authoritative game functions.
--
-- There is exactly ONE shared game room (a single row) so all connected
-- players converge on one truth. Clients read the row and subscribe to
-- Postgres changes (Realtime); every mutation goes through a SECURITY
-- DEFINER function so the game rules can never be corrupted by racing writes.
--
-- Apply this file in your Supabase project:
--   Supabase Dashboard -> SQL Editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Room table
-- ---------------------------------------------------------------------------

create table if not exists public.room (
  id integer primary key default 1 check (id = 1),
  seat_x_session text,
  seat_x_last_seen bigint,
  seat_o_session text,
  seat_o_last_seen bigint,
  board jsonb not null default '[null,null,null,null,null,null,null,null,null]'::jsonb,
  current_turn text not null default 'X' check (current_turn in ('X', 'O')),
  scores jsonb not null default '{"X":0,"O":0}'::jsonb,
  phase text not null default 'waiting' check (phase in ('waiting', 'playing', 'setEnd', 'matchEnd')),
  set_winner text,
  match_winner text,
  move_count integer not null default 0,
  updated_at bigint
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Server-side "now" in epoch milliseconds, comparable with Date.now() in the
-- browser (small clock skew is irrelevant against the 12 s disconnect timeout).
-- `now()` is transaction-stable, so all writes within one function share the
-- same timestamp.
create or replace function public.now_epoch_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$;

-- A seat is free when empty, never heartbeated, or offline for > 12 s.
create or replace function public.is_seat_stale(ts bigint)
returns boolean
language sql
stable
as $$
  select ts is null or ts < (select public.now_epoch_ms()) - 12000;
$$;

-- Evaluates a 9-element board jsonb and returns the winner ('X' / 'O'),
-- 'draw', or null while the set is still open.
create or replace function public.evaluate_board(b jsonb)
returns text
language plpgsql
immutable
as $$
declare
  cell text;
  draw boolean := true;
begin
  if b->>0 is not null and b->>0 = b->>1 and b->>1 = b->>2 then return b->>0; end if;
  if b->>3 is not null and b->>3 = b->>4 and b->>4 = b->>5 then return b->>3; end if;
  if b->>6 is not null and b->>6 = b->>7 and b->>7 = b->>8 then return b->>6; end if;
  if b->>0 is not null and b->>0 = b->>3 and b->>3 = b->>6 then return b->>0; end if;
  if b->>1 is not null and b->>1 = b->>4 and b->>4 = b->>7 then return b->>1; end if;
  if b->>2 is not null and b->>2 = b->>5 and b->>5 = b->>8 then return b->>2; end if;
  if b->>0 is not null and b->>0 = b->>4 and b->>4 = b->>8 then return b->>0; end if;
  if b->>2 is not null and b->>2 = b->>4 and b->>4 = b->>6 then return b->>2; end if;

  for i in 0..8 loop
    if b->>i is null then
      draw := false;
      exit;
    end if;
  end loop;

  if draw then return 'draw'; end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Game functions
--
-- All of them are SECURITY DEFINER (run as the table owner) and take a row
-- lock, so concurrent claims/moves serialize in the database. Clients may only
-- SELECT the row directly; every mutation goes through these functions.
-- ---------------------------------------------------------------------------

create or replace function public.claim_seat(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.room;
  v_claimed boolean := false;
  v_symbol text := null;
begin
  insert into public.room (id) values (1) on conflict (id) do nothing;

  select * into v_room from public.room where id = 1 for update;

  if v_room.seat_x_session = p_session then
    update public.room set seat_x_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where id = 1;
    v_claimed := true;
    v_symbol := 'X';
  elsif v_room.seat_o_session = p_session then
    update public.room set seat_o_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where id = 1;
    v_claimed := true;
    v_symbol := 'O';
  elsif public.is_seat_stale(v_room.seat_x_last_seen) and public.is_seat_stale(v_room.seat_o_last_seen) then
    -- Both players are gone: the waiting room reopens and the joiner is X.
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
        updated_at = public.now_epoch_ms()
    where id = 1;
    v_claimed := true;
    v_symbol := 'X';
  elsif public.is_seat_stale(v_room.seat_x_last_seen) then
    update public.room set seat_x_session = p_session, seat_x_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where id = 1;
    v_claimed := true;
    v_symbol := 'X';
  elsif public.is_seat_stale(v_room.seat_o_last_seen) then
    update public.room set seat_o_session = p_session, seat_o_last_seen = public.now_epoch_ms(), updated_at = public.now_epoch_ms() where id = 1;
    v_claimed := true;
    v_symbol := 'O';
  end if;

  select * into v_room from public.room where id = 1;
  return jsonb_build_object('claimed', v_claimed, 'symbol', v_symbol, 'room', to_jsonb(v_room));
end;
$$;

-- Flips the room to 'playing' once both seats are held. Idempotent.
create or replace function public.ensure_game_started()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room
  set phase = 'playing', updated_at = public.now_epoch_ms()
  where id = 1
    and phase = 'waiting'
    and not public.is_seat_stale(seat_x_last_seen)
    and not public.is_seat_stale(seat_o_last_seen);
end;
$$;

-- Records one move, re-validating every rule against the locked row.
create or replace function public.record_move(p_session text, p_symbol text, p_cell integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.room;
  v_board jsonb;
  v_result text;
  v_scores jsonb;
  v_next_turn text;
begin
  select * into v_room from public.room where id = 1 for update;
  if not found then
    raise exception 'Room not found.';
  end if;

  if v_room.phase <> 'playing' then
    raise exception 'The set is not in progress.';
  end if;
  if v_room.current_turn <> p_symbol then
    raise exception 'It is not this player''s turn.';
  end if;
  if v_room.seat_x_session <> p_session and v_room.seat_o_session <> p_session then
    raise exception 'Player is not seated.';
  end if;
  if p_symbol = 'X' and public.is_seat_stale(v_room.seat_o_last_seen) then
    raise exception 'Opponent disconnected.';
  end if;
  if p_symbol = 'O' and public.is_seat_stale(v_room.seat_x_last_seen) then
    raise exception 'Opponent disconnected.';
  end if;
  if p_cell < 0 or p_cell > 8 then
    raise exception 'Cell is out of range.';
  end if;
  if v_room.board->>p_cell is not null then
    raise exception 'Cell is already taken.';
  end if;

  v_board := jsonb_set(v_room.board, array[p_cell::text], to_jsonb(p_symbol));
  v_result := public.evaluate_board(v_board);
  v_scores := v_room.scores;
  v_next_turn := case when p_symbol = 'X' then 'O' else 'X' end;

  if v_result = 'draw' then
    update public.room
    set board = v_board,
        phase = 'setEnd',
        set_winner = 'draw',
        current_turn = v_room.current_turn,
        move_count = v_room.move_count + 1,
        updated_at = public.now_epoch_ms()
    where id = 1;
  elsif v_result = 'X' or v_result = 'O' then
    v_scores := jsonb_set(v_scores, array[v_result], to_jsonb(((v_scores->>v_result)::int) + 1));
    if ((v_scores->>v_result)::int) >= 2 then
      update public.room
      set board = v_board,
          scores = v_scores,
          phase = 'matchEnd',
          set_winner = v_result,
          match_winner = v_result,
          current_turn = v_room.current_turn,
          move_count = v_room.move_count + 1,
          updated_at = public.now_epoch_ms()
      where id = 1;
    else
      update public.room
      set board = v_board,
          scores = v_scores,
          phase = 'setEnd',
          set_winner = v_result,
          current_turn = v_room.current_turn,
          move_count = v_room.move_count + 1,
          updated_at = public.now_epoch_ms()
      where id = 1;
    end if;
  else
    update public.room
    set board = v_board,
        current_turn = v_next_turn,
        move_count = v_room.move_count + 1,
        updated_at = public.now_epoch_ms()
    where id = 1;
  end if;
end;
$$;

-- Starts the next set after a finished one; scores are kept.
create or replace function public.advance_next_set()
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
      updated_at = public.now_epoch_ms()
  where id = 1 and phase = 'setEnd';
end;
$$;

-- Restarts the whole match: board + scores reset, players keep their seats.
create or replace function public.restart_match()
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
      updated_at = public.now_epoch_ms()
  where id = 1 and phase = 'matchEnd';
end;
$$;

-- Client heartbeat: keeps the caller's seat alive (3 s interval).
create or replace function public.heartbeat(p_session text, p_symbol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_symbol = 'X' and exists (select 1 from public.room where id = 1 and seat_x_session = p_session) then
    update public.room set seat_x_last_seen = public.now_epoch_ms() where id = 1;
  elsif p_symbol = 'O' and exists (select 1 from public.room where id = 1 and seat_o_session = p_session) then
    update public.room set seat_o_last_seen = public.now_epoch_ms() where id = 1;
  end if;
end;
$$;

-- Test convenience: resets the room to a brand-new waiting state.
create or replace function public.reset_room()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.room (id) values (1) on conflict (id) do nothing;
  update public.room
  set seat_x_session = null,
      seat_x_last_seen = null,
      seat_o_session = null,
      seat_o_last_seen = null,
      board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
      current_turn = 'X',
      scores = '{"X":0,"O":0}'::jsonb,
      phase = 'waiting',
      set_winner = null,
      match_winner = null,
      move_count = 0,
      updated_at = public.now_epoch_ms()
  where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.room enable row level security;

-- Anonymous clients may read the room (initial load + Realtime delivery).
create policy "room select"
  on public.room for select
  using (true);

-- No direct insert/update/delete policies: every mutation goes through the
-- SECURITY DEFINER functions above.
revoke all on table public.room from anon, authenticated;
grant select on table public.room to anon;

grant execute on function public.claim_seat(text) to anon, authenticated;
grant execute on function public.ensure_game_started() to anon, authenticated;
grant execute on function public.record_move(text, text, integer) to anon, authenticated;
grant execute on function public.advance_next_set() to anon, authenticated;
grant execute on function public.restart_match() to anon, authenticated;
grant execute on function public.heartbeat(text, text) to anon, authenticated;
grant execute on function public.reset_room() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Publish every change to the room row so all clients converge instantly.
-- (Guard for the newer Supabase realtime architecture where the publication
-- may not exist / is not needed.)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.room;
  end if;
end $$;
