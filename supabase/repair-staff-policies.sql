-- =====================================================================
-- DroneLab — repair: school staff can see their own school again
-- =====================================================================
-- Run once, now. Idempotent, and safe to run at any time afterwards.
--
-- WHAT HAPPENED
-- -------------
-- Four policies decide what a school may see: profiles, module_progress,
-- builds and activity_log. They were fixed once, by school-role-rls-fix.sql,
-- to use is_school_staff() instead of is_teacher() — because 'school' is the
-- role a school account actually has, and a check for the literal 'teacher'
-- matches none of them.
--
-- But that was a patch applied ON TOP of the base schema, and the base schema
-- still created those policies with is_teacher(). Re-running portal-schema.sql
-- therefore silently reverted all four, and a school panel that had been
-- showing its students went back to showing none. Nothing errors when this
-- happens: an empty result looks exactly like an empty school.
--
-- The base files have been corrected so it cannot recur — is_school_staff() is
-- defined in both of them now, and every staff-scoping policy calls it. This
-- file repairs a database that was left in the reverted state.
--
-- HOW TO TELL IF YOU NEED IT
-- --------------------------
--   select policyname, qual like '%is_school_staff%' as fixed
--   from pg_policies
--   where schemaname = 'public'
--     and policyname in ('read profiles in scope', 'read progress in scope',
--                        'read builds in scope', 'read activity in scope');
--
-- Any row reading false means a school is being shown an empty roster.
-- =====================================================================

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

-- ------------------------------------------------------------ profiles
drop policy if exists "read profiles in scope" on public.profiles;
create policy "read profiles in scope" on public.profiles
  for select using (
    auth.uid() = id
    or public.is_admin()
    or (
      public.is_school_staff()
      and school_id is not null
      and school_id = public.my_school_id()
    )
  );

-- ----------------------------------------------------- module_progress
drop policy if exists "read progress in scope" on public.module_progress;
create policy "read progress in scope" on public.module_progress
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_school_staff()
      and exists (
        select 1 from public.profiles p
        where p.id = module_progress.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

-- --------------------------------------------------------------- builds
drop policy if exists "read builds in scope" on public.builds;
create policy "read builds in scope" on public.builds
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_school_staff()
      and exists (
        select 1 from public.profiles p
        where p.id = builds.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

-- --------------------------------------------------------- activity_log
drop policy if exists "read activity in scope" on public.activity_log;
create policy "read activity in scope" on public.activity_log
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_school_staff()
      and exists (
        select 1 from public.profiles p
        where p.id = activity_log.user_id
          and p.school_id is not null
          and p.school_id = public.my_school_id()
      )
    )
  );

-- ---------------------------------------------------------------------
-- An owner belongs to their own school.
-- my_school_id() reads profiles.school_id, so an owner whose profile does not
-- point at their own school resolves to NULL and sees nothing, however correct
-- the policies above are.
-- ---------------------------------------------------------------------
update public.profiles p
set school_id = s.id
from public.schools s
where s.owner_id = p.id
  and s.status = 'approved'
  and p.school_id is distinct from s.id;

-- ---------------------------------------------------------------------
-- Confirm, rather than assume.
-- ---------------------------------------------------------------------
select policyname,
       case when qual like '%is_school_staff%' then 'PASS' else 'FAIL' end as status
from pg_policies
where schemaname = 'public'
  and policyname in ('read profiles in scope', 'read progress in scope',
                     'read builds in scope', 'read activity in scope')
order by policyname;
