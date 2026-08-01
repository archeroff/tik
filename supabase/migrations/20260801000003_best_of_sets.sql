-- Configurable match length: the creator chooses best of 1/3/5/7 when
-- starting a session, stored as the number of set wins needed (target_score).
-- Existing rooms default to best of three (target_score = 2).

alter table public.room
  add column target_score integer not null default 2;

-- create_session gains a p_best_of argument (1/3/5/7). The old 1-argument
-- form is dropped; the new one defaults p_best_of to 3, so callers that only
-- pass p_session keep working unchanged.
drop function if exists public.create_session(text);

create or replace function public.create_session(p_session text, p_best_of integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_target integer;
  v_room public.room;
  v_tries integer := 0;
begin
  if p_best_of not in (1, 3, 5, 7) then
    raise exception 'Best of must be 1, 3, 5 or 7.';
  end if;
  v_target := (p_best_of + 1) / 2;

  loop
    v_code := public.random_code();
    begin
      insert into public.room (code, seat_x_session, seat_x_last_seen, current_turn, phase, set_number, target_score)
      values (v_code, p_session, public.now_epoch_ms(), 'X', 'waiting', 1, v_target)
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

-- Match end is judged against the session's chosen target_score, not a
-- hard-coded best of three.
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
    if ((v_scores->>v_score_key)::int) >= v_room.target_score then
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

grant execute on function public.create_session(text, integer) to anon, authenticated;
