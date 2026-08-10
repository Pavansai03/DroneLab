-- =====================================================================
-- DroneLab — Supabase schema
-- =====================================================================
-- Run this once, in Supabase Studio -> SQL Editor, against your
-- self-hosted instance.
--
-- WHY IT LOOKS LIKE THIS
-- ----------------------
-- The browser holds the ANON key, and anyone can read it out of the
-- bundle. The anon key is only safe because of the Row Level Security
-- policies below — they are the actual security boundary, not the key.
-- Self-hosted Supabase creates tables with RLS *off*, so every table
-- here enables it explicitly.
--
-- A student must not be able to promote themselves to teacher, so the
-- role lives in its own table with NO insert/update/delete policy at
-- all. Only the service_role (i.e. you, in Studio) can grant teacher.
-- =====================================================================

-- ---------------------------------------------------------------- roles
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users on delete cascade,
  role    text not null default 'student' check (role in ('student', 'teacher'))
);

alter table public.user_roles enable row level security;

-- Users may read their own role and nothing else. There are deliberately
-- no INSERT/UPDATE/DELETE policies: with RLS on and no policy, those
-- operations are denied to every ordinary client.
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles
  for select using (auth.uid() = user_id);

/* A SECURITY DEFINER function is required here. If a policy on
   user_roles queried user_roles directly, RLS would recurse forever.
   SECURITY DEFINER runs as the owner and bypasses RLS, breaking the loop. */
create or replace function public.is_teacher()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'teacher'
  );
$$;

/* WHO COUNTS AS STAFF
   -------------------
   'teacher' is the original role and 'school' is what a school account gets on
   registration, so a check for the literal 'teacher' misses every real school.
   That bug cost a day once: school accounts passed the API's role check,
   reached their own dashboard, and had the DATABASE return zero rows for every
   query. Nothing errored — an empty result is indistinguishable from an empty
   school unless you already know the school is not empty.

   Defined HERE, in the base schema, and not in a patch on top of it. It was in
   a patch, and re-running this file quietly reverted every policy that depended
   on it — which is a worse failure than the one the patch fixed, because it
   comes back every time someone reapplies the schema. Anything that decides
   what school staff may see must call this. */
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

-- ------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text,
  class_code text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "student reads own profile" on public.profiles;
create policy "student reads own profile" on public.profiles
  for select using (auth.uid() = id or public.is_school_staff());

drop policy if exists "student updates own profile" on public.profiles;
create policy "student updates own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------ module progress
create table if not exists public.module_progress (
  user_id     uuid not null references auth.users on delete cascade,
  module_id   text not null,
  completed   boolean not null default false,
  tasks_done  integer not null default 0,
  tasks_total integer not null default 0,
  current_task text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, module_id)
);

alter table public.module_progress enable row level security;

drop policy if exists "read own progress" on public.module_progress;
create policy "read own progress" on public.module_progress
  for select using (auth.uid() = user_id or public.is_school_staff());

drop policy if exists "write own progress" on public.module_progress;
create policy "write own progress" on public.module_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own progress" on public.module_progress;
create policy "update own progress" on public.module_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own progress" on public.module_progress;
create policy "delete own progress" on public.module_progress
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------- saved builds
-- One saved aircraft per student, so they can resume on another machine.
create table if not exists public.builds (
  user_id    uuid primary key references auth.users on delete cascade,
  frame_id   text,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.builds enable row level security;

drop policy if exists "read own build" on public.builds;
create policy "read own build" on public.builds
  for select using (auth.uid() = user_id or public.is_school_staff());

drop policy if exists "write own build" on public.builds;
create policy "write own build" on public.builds
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own build" on public.builds;
create policy "update own build" on public.builds
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------- new sign-ups get a profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, class_code)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'class_code', '')
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------- teacher roster view
-- One row per student with their progress rolled up, for the dashboard.
-- `CREATE OR REPLACE VIEW` will fail if the existing view has columns that
-- are not present in the new definition. Drop and recreate explicitly so
-- schema deployment is repeatable and future updates do not confuse the editor.
drop view if exists public.class_roster;
create view public.class_roster
with (security_invoker = on) as
select
  p.id            as user_id,
  p.full_name,
  p.class_code,
  p.created_at,
  count(mp.module_id) filter (where mp.completed)              as modules_completed,
  max(mp.updated_at)                                           as last_active,
  (
    select mp2.module_id || ' — ' || coalesce(mp2.current_task, 'not started')
    from public.module_progress mp2
    where mp2.user_id = p.id and not mp2.completed
    order by mp2.module_id
    limit 1
  )                                                            as stuck_on
from public.profiles p
left join public.module_progress mp on mp.user_id = p.id
group by p.id, p.full_name, p.class_code, p.created_at;

/* security_invoker = on makes the view respect the querying user's RLS,
   so a student selecting from it still only ever sees their own row. */

-- =====================================================================
-- MAKE YOURSELF A TEACHER
-- ---------------------------------------------------------------------
-- Sign up through the app first, then run this in the SQL editor with
-- your own email. It cannot be done from the client by design.
--
--   insert into public.user_roles (user_id, role)
--   select id, 'teacher' from auth.users where email = 'you@school.example'
--   on conflict (user_id) do update set role = 'teacher';
-- =====================================================================
