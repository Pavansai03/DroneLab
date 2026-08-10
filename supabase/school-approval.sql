-- =====================================================================
-- DroneLab — school applications and approval
-- =====================================================================
-- Run AFTER schema.sql and portal-schema.sql. Idempotent.
--
-- WHAT CHANGES
-- ------------
-- Schools were created directly by an administrator. They are now APPLIED FOR
-- by the school itself and approved by an administrator, which means:
--
--   * a fourth role, 'school', for the account that owns a school;
--   * a status on every school — pending, approved or rejected;
--   * a join code that does not exist until approval, because a code handed out
--     before anyone vetted the school is a code that lets strangers in;
--   * students gated on holding a code from an APPROVED school.
--
-- WHY THE JOIN CODE IS NULL UNTIL APPROVAL
-- ----------------------------------------
-- It would be easier to generate the code at application time and simply not
-- show it. But then the code exists, and anything that exists can leak — a
-- backup, a log line, a careless query. Generating it at the moment of approval
-- means an unapproved school has nothing to leak.
-- =====================================================================

-- --------------------------------------------------------------- roles
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('student', 'teacher', 'school', 'admin'));

/* 'teacher' is kept so existing accounts keep working. New school accounts get
   'school'; both see the same panel, and both are scoped to one school. */
create or replace function public.is_school_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('teacher', 'school', 'admin')
  );
$$;

-- ------------------------------------------------------ school columns
alter table public.schools
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists owner_id uuid references auth.users on delete set null,
  add column if not exists applied_at timestamptz not null default now(),
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users on delete set null,
  add column if not exists decision_note text,
  add column if not exists subscription_starts_at timestamptz,
  add column if not exists subscription_ends_at timestamptz;

/* Existing rows predate approval and are already in use, so they default to
   'approved'. New applications insert 'pending' explicitly. */

-- The code is now nullable: it does not exist until an administrator approves.
alter table public.schools alter column join_code drop not null;

create index if not exists schools_status_idx on public.schools (status);
create index if not exists schools_owner_idx on public.schools (owner_id);

-- ------------------------------------------------------------ policies
drop policy if exists "read own school" on public.schools;
drop policy if exists "read schools in scope" on public.schools;
create policy "read schools in scope" on public.schools
  for select using (
    public.is_admin()
    or owner_id = auth.uid()          -- the applicant, watching for a decision
    or id = public.my_school_id()     -- members of an approved school
  );

/* Still no INSERT/UPDATE/DELETE policy. Applying for a school and deciding on
   one both go through the service role in the API, because a school must not be
   able to set its own status to 'approved' and a student must not be able to
   invent a school at all. */

-- ------------------------------------------------- the applications view
-- What an administrator reviews. Deliberately a view rather than a raw select,
-- so the panel cannot accidentally show a column it should not.
drop view if exists public.school_applications;
create view public.school_applications
with (security_invoker = on) as
select
  s.id,
  s.name,
  s.contact_email,
  s.phone,
  s.region,
  s.status,
  s.join_code,
  s.applied_at,
  s.decided_at,
  s.decision_note,
  s.subscription_starts_at,
  s.subscription_ends_at,
  s.owner_id,
  p.full_name as applicant_name,
  (select count(*) from public.profiles px where px.school_id = s.id) as member_count
from public.schools s
left join public.profiles p on p.id = s.owner_id;

-- --------------------------------------------- students must hold a code
/**
 * Whether the current user has been admitted to an approved school.
 *
 * The simulator and the student panel both gate on this. It is a function
 * rather than a column so it cannot drift out of date: revoking a school's
 * approval immediately locks out every student in it, with no backfill.
 */
create or replace function public.is_admitted()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.schools s on s.id = p.school_id
    where p.id = auth.uid() and s.status = 'approved' and s.active
  );
$$;

-- ------------------------------------------------------------ roster fix
-- class_roster gains the school's status, so a panel can tell an approved
-- school from one still waiting.
drop view if exists public.class_roster;
create view public.class_roster
with (security_invoker = on) as
select
  p.id                                            as user_id,
  p.full_name,
  p.class_code,
  p.school_id,
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
  )                                               as stuck_on
from public.profiles p
left join public.schools s        on s.id = p.school_id
left join public.user_roles r     on r.user_id = p.id
left join public.module_progress mp on mp.user_id = p.id
left join public.activity_log a   on a.user_id = p.id
group by p.id, p.full_name, p.class_code, p.school_id, s.name, s.status, r.role, p.created_at;
