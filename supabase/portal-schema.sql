-- =====================================================================
-- DroneLab — portal schema (schools, super admin, roster)
-- =====================================================================
-- Run this AFTER schema.sql, in Supabase Studio -> SQL Editor.
-- It is idempotent: running it twice is harmless.
--
-- WHAT THIS ADDS
-- --------------
-- schema.sql gave every user a role of 'student' or 'teacher' and let a
-- teacher see every student in the database. That is fine for one class.
-- It is not fine the moment a second school exists, so this file adds:
--
--   * schools, and a school_id on every profile
--   * a third role, 'admin' — the product owner, above any school
--   * RLS rewritten so a teacher sees ONLY their own school's students
--
-- THE SECURITY MODEL, IN ONE PARAGRAPH
-- ------------------------------------
-- The browser holds the ANON key and anyone can read it out of the
-- bundle. The anon key is not a secret and never was; the RLS policies
-- below are the actual security boundary. The SERVICE ROLE key bypasses
-- RLS entirely and must never leave the Express server — it is the one
-- credential in this system that is genuinely secret.
--
-- Roles are deliberately unwritable from the client. user_roles has no
-- INSERT/UPDATE/DELETE policy at all, so promoting a student to teacher
-- can only happen through the service role, i.e. through the admin panel
-- or Studio. A student cannot promote themselves.
-- =====================================================================

-- ---------------------------------------------------------------- roles
-- schema.sql constrained role to ('student','teacher'). Widen it.
-- The existing database may already contain the newer 'school' role, so
-- allow that as well as admin.
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('student', 'teacher', 'admin', 'school'));

/* SECURITY DEFINER, like is_teacher(). A policy on user_roles that read
   user_roles directly would recurse forever; running as the owner
   bypasses RLS and breaks the loop. */
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid()),
    'student'
  );
$$;

-- -------------------------------------------------------------- schools
create table if not exists public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- What a teacher or student types when they join. Short, human, unique.
  join_code  text not null unique,
  region     text,
  created_at timestamptz not null default now(),
  active     boolean not null default true
);

alter table public.schools enable row level security;

-- ------------------------------------------------- school on the profile
alter table public.profiles
  add column if not exists school_id uuid references public.schools on delete set null;

create index if not exists profiles_school_id_idx on public.profiles (school_id);

/* Which school the current user belongs to.
   SECURITY DEFINER again: the profiles policies below need this, and a
   policy on profiles that queried profiles would recurse. */
create or replace function public.my_school_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select school_id from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------- schools policies
drop policy if exists "read own school" on public.schools;
create policy "read own school" on public.schools
  for select using (id = public.my_school_id() or public.is_admin());

/* No insert/update/delete policy. Creating and renaming schools happens
   through the service role in the admin panel — a teacher must not be
   able to invent a school, and a student must not be able to rename one. */

-- ------------------------------------------------------ profiles policies
-- Replace schema.sql's "any teacher sees every student" with school scoping.
drop policy if exists "student reads own profile" on public.profiles;
drop policy if exists "read profiles in scope" on public.profiles;
create policy "read profiles in scope" on public.profiles
  for select using (
    auth.uid() = id
    or public.is_admin()
    or (
      public.is_teacher()
      and school_id is not null
      and school_id = public.my_school_id()
    )
  );

drop policy if exists "student updates own profile" on public.profiles;
create policy "student updates own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

/* NOTE: a student CAN update their own school_id, which is how joining a
   class with a join code works. They cannot see other schools' data by
   doing so — every other policy keys off the same value, so moving
   yourself to another school shows you that school's roster only if you
   are also a teacher there, which requires the service role to grant. */

-- ----------------------------------------------- module_progress policies
drop policy if exists "read own progress" on public.module_progress;
drop policy if exists "read progress in scope" on public.module_progress;
create policy "read progress in scope" on public.module_progress
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_teacher()
      and exists (
        select 1 from public.profiles p
        where p.id = module_progress.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

drop policy if exists "delete own progress" on public.module_progress;
create policy "delete own progress" on public.module_progress
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------- builds policies
drop policy if exists "read own build" on public.builds;
drop policy if exists "read builds in scope" on public.builds;
create policy "read builds in scope" on public.builds
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_teacher()
      and exists (
        select 1 from public.profiles p
        where p.id = builds.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

-- --------------------------------------------------------- roles policies
drop policy if exists "read own role" on public.user_roles;
drop policy if exists "read roles in scope" on public.user_roles;
create policy "read roles in scope" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------- activity, for graphs
-- One row per session per day. The student panel draws a streak from this
-- and the admin panel counts active users; both would otherwise have to
-- infer activity from progress timestamps, which undercounts a student who
-- practised without completing anything.
create table if not exists public.activity_log (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null default current_date,
  flights    integer not null default 0,
  crashes    integer not null default 0,
  seconds    integer not null default 0,
  primary key (user_id, day)
);

alter table public.activity_log enable row level security;

drop policy if exists "read activity in scope" on public.activity_log;
create policy "read activity in scope" on public.activity_log
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_teacher()
      and exists (
        select 1 from public.profiles p
        where p.id = activity_log.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

drop policy if exists "write own activity" on public.activity_log;
create policy "write own activity" on public.activity_log
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own activity" on public.activity_log;
create policy "update own activity" on public.activity_log
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------ the roster
-- Rebuilt to carry school and role. security_invoker keeps RLS applying to
-- the querying user, so a student selecting from it still sees one row.
-- Use explicit drop/create instead of CREATE OR REPLACE VIEW because the
-- existing view may contain columns that the new definition omits.
drop view if exists public.class_roster;
create view public.class_roster
with (security_invoker = on) as
select
  p.id                                            as user_id,
  p.full_name,
  p.class_code,
  p.school_id,
  s.name                                          as school_name,
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
group by p.id, p.full_name, p.class_code, p.school_id, s.name, r.role, p.created_at;

-- ================================================================
-- MAKE YOURSELF THE SUPER ADMIN
-- ----------------------------------------------------------------
-- Sign up through the portal first, then run this with your own email.
-- It cannot be done from the client, by design.
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set role = 'admin';
--
-- After that, every other role grant can be done from the admin panel.
-- ================================================================
