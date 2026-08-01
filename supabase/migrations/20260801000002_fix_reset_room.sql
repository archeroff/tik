-- Follow-up for live DBs where 20260801000001_sessions.sql already applied:
-- Supabase's "DELETE requires a WHERE clause" guard rejects the DELETE in
-- reset_room(), so redefine it with an explicit predicate. Idempotent.
create or replace function public.reset_room()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.room where code is not null;
end;
$$;
