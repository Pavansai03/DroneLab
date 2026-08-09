-- =====================================================================
-- DroneLab — students are approved too, and approvals can be revoked
-- =====================================================================
-- Run AFTER school-approval.sql, school-role-rls-fix.sql and
-- help-requests.sql. Idempotent.
--
-- WHAT CHANGES
-- ------------
-- 1. A join code no longer admits a student on its own. Entering a valid code
--    puts them in front of an administrator, who decides.
-- 2. Both decisions are reversible. A school or a student can be rejected after
--    being approved, and access ends the moment that is recorded.
-- 3. Every decision carries its time, so a list can say when rather than only
--    what.
--
-- WHY GATE THE CODE
-- -----------------
-- A join code travels: it is circulated to a class, and from there to a group
-- chat, and from there anywhere. It is a convenience, not a credential. Making
-- it a request for admission rather than admission itself means a leaked code
-- costs an administrator one click, instead of costing them a stranger inside a
-- school's roster.
-- =====================================================================

alter table public.profiles
  -- 'approved' by default so nobody already using the product is locked out by
  -- this migration. The join route sets 'pending' explicitly for new arrivals.
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists joined_at timestamptz,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decision_note text;

create index if not exists profiles_status_idx on public.profiles (status, school_id);

-- ---------------------------------------------------------------------
-- Existing students keep their access, and their record says when it was
-- granted rather than leaving the column null and unexplained.
-- ---------------------------------------------------------------------
update public.profiles
set decided_at = coalesce(decided_at, created_at),
    joined_at = coalesce(joined_at, created_at)
where school_id is not null and status = 'approved';

-- =====================================================================
-- Only an administrator may decide
-- ---------------------------------------------------------------------
-- A student can already update their own profile — that is how they set their
-- name and class. Without this, nothing stopped them setting their own status
-- to 'approved', which would make the whole gate decorative. The trigger below
-- is the enforcement; it runs regardless of which client or route did the
-- update, so there is no path around it.
-- =====================================================================
create or replace function public.guard_profile_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at
     or new.decided_by is distinct from old.decided_by then
    /* auth.uid() is null for the service_role, which is the API server acting
       on an administrator's behalf — it has already checked the caller's role
       before it gets here, and its key never leaves the server. Everything else
       is a browser holding the anon key, and a browser must prove it is an
       administrator. Without the null case this would block the very route
       that does the approving. */
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Only an administrator can change an approval status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_status on public.profiles;
create trigger profiles_guard_status
  before update on public.profiles
  for each row execute function public.guard_profile_status();

-- =====================================================================
-- The roster carries the decision
-- =====================================================================
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
  count(mp.module_id) filter (where mp.completed) as modules_completed,
  max(mp.updated_at)                              as last_active,
  coalesce(sum(a.flights), 0)                     as total_flights,
  coalesce(sum(a.crashes), 0)                     as total_crashes,
  (
    select mp2.module_id || ' — ' || coalesce(mp2.current_task, 'not started')
    from public.module_progress mp2
    where mp2.user_id = p.id and not mp2.completed
    order by mp2.module_id
    limit 1
  )                                               as stuck_on,
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
left join public.schools s        on s.id = p.school_id
left join public.user_roles r     on r.user_id = p.id
left join public.module_progress mp on mp.user_id = p.id
left join public.activity_log a   on a.user_id = p.id
group by p.id, p.full_name, p.class_code, p.school_id, p.status, p.joined_at,
         p.decided_at, s.name, s.status, r.role, p.created_at;

-- =====================================================================
-- An administrator can see a student who has not been approved yet
-- ---------------------------------------------------------------------
-- is_admin() already covers this in the existing policy. A school's own staff
-- deliberately still see their pending students: knowing that four of your
-- pupils are waiting on an administrator is exactly the sort of thing a school
-- needs to see, and they can do nothing about it but ask.
-- =====================================================================
