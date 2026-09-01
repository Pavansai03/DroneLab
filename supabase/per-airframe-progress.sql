-- ============================================================================
-- PROGRESS BELONGS TO AN AIRFRAME
-- ----------------------------------------------------------------------------
-- Run this once in the Supabase SQL editor, after portal-schema.sql,
-- student-approval.sql, help-requests.sql and activity-log.sql.
--
-- WHAT WAS WRONG
-- --------------
-- `module_progress` was keyed (user_id, module_id). There are now three
-- aircraft — quadcopter, hexacopter, octocopter — and a student builds each of
-- them from Module 1. One row per module meant one course, pooled across every
-- airframe, so:
--
--   * A student who finished all three modules on a quadcopter, then switched
--     to a hexacopter, came back from the portal to find Modules 2 and 3
--     unlocked and ticked on an aircraft with nothing bolted to it. The
--     simulator keeps a separate bench per airframe; the DATABASE did not, and
--     on every sign-in it handed those ticks back.
--   * A teacher could not tell whether "3 of 3 modules" meant one aircraft
--     built three times over or three aircraft built once each.
--
-- The fix is the obvious one: the airframe is part of the key.
--
-- WHAT HAPPENS TO EXISTING ROWS
-- -----------------------------
-- A legacy row records that a module was completed but not on what. Rather than
-- guess, this reads the answer out of `builds.state`, which the simulator has
-- been writing per airframe since benches were separated: `workspaces.<frame>.
-- completedModules` says exactly which aircraft finished which module. A legacy
-- row is filed under every airframe that claims it. Only rows that nothing
-- claims fall back to a guess, and the guess is the aircraft the student had
-- open (`builds.frame_id`), which is the best evidence left.
--
-- ACTIVITY IS DIFFERENT, AND IS NOT GUESSED AT
-- --------------------------------------------
-- `activity_log` counts flights, crashes and seconds per day. Nothing anywhere
-- records which aircraft they were flown on, so historical days are filed under
-- 'unknown' rather than attributed to a copter that may never have left the
-- ground. They still count in a student's total; they are simply not claimed by
-- any one airframe. From now on every flight is recorded with the airframe that
-- flew it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. module_progress
-- ---------------------------------------------------------------------------
alter table public.module_progress add column if not exists frame_id text;

/* Mark the rows that predate this migration so they stay identifiable after the
   primary key changes. A sentinel rather than NULL, because a primary key
   column cannot be null and the key has to change before the rows can be
   exploded into one row per airframe. */
update public.module_progress set frame_id = '~legacy' where frame_id is null;

alter table public.module_progress drop constraint if exists module_progress_pkey;
alter table public.module_progress
  add constraint module_progress_pkey primary key (user_id, frame_id, module_id);

/* File each legacy row under every airframe whose saved bench claims it.
   Two sources, both written by the simulator:
     workspaces.<frame>.completedModules   the parked benches
     completedModules with frameId         the aircraft that was on the bench */
with claim as (
  select b.user_id, f.key as frame_id, (m #>> '{}') as module_id
  from public.builds b
  cross join lateral jsonb_each(
    case when jsonb_typeof(b.state -> 'workspaces') = 'object'
         then b.state -> 'workspaces' else '{}'::jsonb end
  ) f
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(f.value -> 'completedModules') = 'array'
         then f.value -> 'completedModules' else '[]'::jsonb end
  ) m
  union
  select b.user_id, coalesce(b.state ->> 'frameId', 'quad') as frame_id, (m #>> '{}') as module_id
  from public.builds b
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(b.state -> 'completedModules') = 'array'
         then b.state -> 'completedModules' else '[]'::jsonb end
  ) m
)
insert into public.module_progress
  (user_id, frame_id, module_id, completed, tasks_done, tasks_total, current_task, updated_at)
select mp.user_id, c.frame_id, mp.module_id,
       mp.completed, mp.tasks_done, mp.tasks_total, mp.current_task, mp.updated_at
from public.module_progress mp
join claim c on c.user_id = mp.user_id and c.module_id = mp.module_id
where mp.frame_id = '~legacy'
  and c.frame_id in ('quad', 'hexa', 'octo')
on conflict (user_id, frame_id, module_id) do nothing;

/* A legacy row that has now been filed against a real airframe has served its
   purpose. */
delete from public.module_progress mp
where mp.frame_id = '~legacy'
  and exists (
    select 1 from public.module_progress x
    where x.user_id = mp.user_id
      and x.module_id = mp.module_id
      and x.frame_id <> '~legacy'
  );

/* Whatever is left is unclaimed: no saved bench mentions it. The aircraft the
   student had open is the last piece of evidence available. */
update public.module_progress mp
set frame_id = coalesce(
  (select b.frame_id from public.builds b
   where b.user_id = mp.user_id and b.frame_id in ('quad', 'hexa', 'octo')),
  'quad'
)
where mp.frame_id = '~legacy';

alter table public.module_progress alter column frame_id set default 'quad';
alter table public.module_progress alter column frame_id set not null;

create index if not exists module_progress_user_frame_idx
  on public.module_progress (user_id, frame_id);

-- ---------------------------------------------------------------------------
-- 2. activity_log
-- ---------------------------------------------------------------------------
alter table public.activity_log add column if not exists frame_id text;

update public.activity_log set frame_id = 'unknown' where frame_id is null;

alter table public.activity_log drop constraint if exists activity_log_pkey;
alter table public.activity_log
  add constraint activity_log_pkey primary key (user_id, day, frame_id);

alter table public.activity_log alter column frame_id set default 'unknown';
alter table public.activity_log alter column frame_id set not null;

/* One function, four arguments, all defaulted. The three-argument version is
   dropped rather than kept alongside: two overloads that differ only by a
   defaulted parameter are ambiguous to call, and a browser still running
   yesterday's bundle resolves fine against this one — its flights land under
   'unknown', which is exactly what they are. */
drop function if exists public.record_activity(integer, integer, integer);
drop function if exists public.record_activity(integer, integer, integer, text);

create or replace function public.record_activity(
  p_flights  integer default 0,
  p_crashes  integer default 0,
  p_seconds  integer default 0,
  p_frame_id text    default 'unknown'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_frame text;
begin
  if v_user is null then
    return;
  end if;

  /* Never trust the caller's string into a grouping column. An unrecognised
     airframe becomes 'unknown' rather than creating a row nothing will ever
     read — the same clamp, in spirit, as the amounts below. */
  v_frame := case
    when p_frame_id in ('quad', 'hexa', 'octo') then p_frame_id
    else 'unknown'
  end;

  insert into public.activity_log as a (user_id, day, frame_id, flights, crashes, seconds)
  values (
    v_user,
    current_date,
    v_frame,
    least(greatest(coalesce(p_flights, 0), 0), 100),
    least(greatest(coalesce(p_crashes, 0), 0), 100),
    least(greatest(coalesce(p_seconds, 0), 0), 3600)
  )
  on conflict (user_id, day, frame_id) do update
    set flights = a.flights + excluded.flights,
        crashes = a.crashes + excluded.crashes,
        seconds = a.seconds + excluded.seconds;
end;
$$;

revoke all on function public.record_activity(integer, integer, integer, text) from public;
grant execute on function public.record_activity(integer, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. the roster
-- ---------------------------------------------------------------------------
/* TWO FIXES IN ONE VIEW.

   First, the per-airframe breakdown, carried as jsonb rather than nine more
   columns. A teacher's dashboard wants "how is this student doing on the
   hexacopter", and adding modules_quad / flights_quad / crashes_quad three
   times over is a schema change every time an airframe is added.

   Second, a join bug that has been there since the view was written.
   `module_progress` and `activity_log` were both left-joined to `profiles`,
   which is a cross product: a student with 3 progress rows and 5 logged days
   produced 15 rows, so modules_completed counted five times over and flights
   summed three times over. Nobody spotted it because the only students with
   both were the ones whose numbers looked impressively large. Both are
   aggregated in scalar subqueries now, which cannot multiply each other. */
drop view if exists public.class_roster;
create view public.class_roster
with (security_invoker = on) as
select
  p.id                                            as user_id,
  p.full_name,
  p.class_code,
  p.school_id,
  p.status                                        as student_status,
  p.joined_at,
  p.decided_at,
  s.name                                          as school_name,
  s.status                                        as school_status,
  coalesce(r.role, 'student')                     as role,
  p.created_at,
  (
    select count(*) from public.module_progress mp
    where mp.user_id = p.id and mp.completed
  )                                               as modules_completed,
  (
    select max(mp.updated_at) from public.module_progress mp
    where mp.user_id = p.id
  )                                               as last_active,
  (
    select coalesce(sum(a.flights), 0) from public.activity_log a
    where a.user_id = p.id
  )                                               as total_flights,
  (
    select coalesce(sum(a.crashes), 0) from public.activity_log a
    where a.user_id = p.id
  )                                               as total_crashes,
  (
    select mp2.module_id || ' — ' || coalesce(mp2.current_task, 'not started')
    from public.module_progress mp2
    where mp2.user_id = p.id and not mp2.completed
    order by mp2.frame_id, mp2.module_id
    limit 1
  )                                               as stuck_on,
  /* { "quad": { "modules": 3, "flights": 12, "crashes": 2, "seconds": 900,
                 "last_active": "…", "stuck_on": "…" }, … } */
  (
    select coalesce(jsonb_object_agg(t.frame_id, t.stats), '{}'::jsonb)
    from (
      select f.frame_id,
             jsonb_build_object(
               'modules', (
                 select count(*) from public.module_progress mp
                 where mp.user_id = p.id and mp.frame_id = f.frame_id and mp.completed
               ),
               'flights', (
                 select coalesce(sum(a.flights), 0) from public.activity_log a
                 where a.user_id = p.id and a.frame_id = f.frame_id
               ),
               'crashes', (
                 select coalesce(sum(a.crashes), 0) from public.activity_log a
                 where a.user_id = p.id and a.frame_id = f.frame_id
               ),
               'seconds', (
                 select coalesce(sum(a.seconds), 0) from public.activity_log a
                 where a.user_id = p.id and a.frame_id = f.frame_id
               ),
               'last_active', (
                 select max(mp.updated_at) from public.module_progress mp
                 where mp.user_id = p.id and mp.frame_id = f.frame_id
               ),
               'stuck_on', (
                 select mp.module_id || ' — ' || coalesce(mp.current_task, 'not started')
                 from public.module_progress mp
                 where mp.user_id = p.id and mp.frame_id = f.frame_id and not mp.completed
                 order by mp.module_id
                 limit 1
               )
             ) as stats
      from (values ('quad'), ('hexa'), ('octo')) as f(frame_id)
    ) t
  )                                               as per_frame,
  (
    select count(*)
    from public.help_requests h
    where h.user_id = p.id and h.status = 'open'
  )                                               as help_open,
  (
    select h.message
    from public.help_requests h
    where h.user_id = p.id and h.status = 'open'
    order by h.created_at desc
    limit 1
  )                                               as help_note,
  (
    select max(h.created_at)
    from public.help_requests h
    where h.user_id = p.id and h.status = 'open'
  )                                               as help_since
from public.profiles p
left join public.schools s    on s.id = p.school_id
left join public.user_roles r on r.user_id = p.id;

-- ----------------------------------------------------------------------------
-- Check it:
--
--   select frame_id, count(*) from public.module_progress group by frame_id;
--   select user_id, per_frame from public.class_roster limit 5;
--
-- Nothing should remain under '~legacy'.
-- ----------------------------------------------------------------------------
