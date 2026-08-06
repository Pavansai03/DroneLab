-- =====================================================================
-- DroneLab — let the 'school' role actually see its own school
-- =====================================================================
-- Run AFTER school-approval.sql. Idempotent.
--
-- THE BUG THIS FIXES
-- ------------------
-- school-approval.sql introduced the 'school' role and an is_school_staff()
-- helper that recognises it — but every policy was still calling is_teacher(),
-- which matches only the literal role 'teacher'.
--
-- So a school account passed the API's role check, reached its own dashboard,
-- and then had the DATABASE return zero rows for every query. The panel loaded
-- and reported "0 students" for a school that had two. Nothing errored, which is
-- what made it hard to see: an empty result is indistinguishable from an empty
-- school unless you already know the school is not empty.
--
-- Every policy below now routes through is_school_staff(), which covers
-- 'teacher' (legacy), 'school' (current) and 'admin'.
-- =====================================================================

-- ------------------------------------------------------ profiles
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

-- ----------------------------------------------- module_progress
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

-- --------------------------------------------------------- builds
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

-- --------------------------------------------------- activity_log
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

-- =====================================================================
-- A school's owner belongs to their own school
-- ---------------------------------------------------------------------
-- my_school_id() reads profiles.school_id, so an owner whose profile does not
-- point at their own school resolves to NULL and sees nothing — even with every
-- policy above correct. Approval sets this going forward; this backfills the
-- schools approved before it did.
-- =====================================================================
update public.profiles p
set school_id = s.id
from public.schools s
where s.owner_id = p.id
  and s.status = 'approved'
  and p.school_id is distinct from s.id;
