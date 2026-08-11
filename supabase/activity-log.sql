-- ============================================================================
-- FLIGHTS FLOWN, AND THE DAY STREAK
-- ----------------------------------------------------------------------------
-- Run this once in the Supabase SQL editor, after portal-schema.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- activity_log has been in portal-schema.sql from the start, and the student
-- panel, the teacher dashboard, the class_roster view and every exported report
-- read from it. Nothing has ever written to it. So "Flights flown" and "Day
-- streak" were not wrong numbers — they were a table with no rows, rendering as
-- zero, on every account, for ever.
--
-- WHY A FUNCTION RATHER THAN AN UPSERT FROM THE BROWSER
-- -----------------------------------------------------
-- The counts have to ACCUMULATE. PostgREST's upsert replaces a row; it cannot
-- express "add one to whatever is there". Doing it as read-then-write from the
-- client loses flights whenever two tabs are open, and there is nothing unusual
-- about a student with the simulator open twice.
--
-- `on conflict do update ... a.flights + excluded.flights` is a single atomic
-- statement, so concurrent calls add up instead of overwriting each other.
--
-- SECURITY DEFINER, BUT IT CANNOT BE ABUSED INTO MUCH
-- ---------------------------------------------------
-- The row it touches is always auth.uid()'s own — the caller supplies amounts,
-- never a user id — and a null uid does nothing. The amounts are clamped: not
-- because a student can be trusted, but because they cannot, and a fabricated
-- "9,999,999 flights" in a teacher's dashboard is a support call. The clamp is
-- per call, so it bounds the damage of one bad request rather than pretending
-- to prevent a determined one. Anyone can call this with the anon key and their
-- own token; the worst they can do is inflate their own row, which was already
-- true of every progress figure in this product.
-- ============================================================================

create or replace function public.record_activity(
  p_flights integer default 0,
  p_crashes integer default 0,
  p_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  insert into public.activity_log as a (user_id, day, flights, crashes, seconds)
  values (
    v_user,
    current_date,
    least(greatest(coalesce(p_flights, 0), 0), 100),
    least(greatest(coalesce(p_crashes, 0), 0), 100),
    least(greatest(coalesce(p_seconds, 0), 0), 3600)
  )
  on conflict (user_id, day) do update
    set flights = a.flights + excluded.flights,
        crashes = a.crashes + excluded.crashes,
        seconds = a.seconds + excluded.seconds;
end;
$$;

revoke all on function public.record_activity(integer, integer, integer) from public;
grant execute on function public.record_activity(integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Check it, as yourself, from the SQL editor:
--
--   select public.record_activity(1, 0, 42);
--   select * from public.activity_log where user_id = auth.uid();
--
-- (auth.uid() is null in the SQL editor, so that inserts nothing — which is the
--  function behaving correctly. Verify from the simulator instead: fly once,
--  then reload the student panel.)
-- ----------------------------------------------------------------------------
