-- =====================================================================
-- DroneLab — let a student say what they are stuck on
-- =====================================================================
-- Run AFTER school-approval.sql and school-role-rls-fix.sql. Idempotent.
--
-- WHY THIS EXISTS
-- ---------------
-- The school panel has always had a "May need help" figure, inferred from
-- silence: started a module, not finished it, not seen for a week. Inference is
-- a reasonable fallback, but it is not the same thing as a student saying "I
-- can't get the compass to calibrate" — and until now there was nowhere in the
-- student panel to say it. A dashboard that reports need but gives the person
-- in need no way to describe it is only half a feature.
--
-- One row per request. A student raises it, the school answers it, and it
-- closes. Deliberately not a chat: a thread needs notifications, read state and
-- moderation to work, and none of that is built. One question and one answer is
-- honest about what the product can actually deliver.
-- =====================================================================

create table if not exists public.help_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Denormalised from the profile at insert time, so a request stays with the
  -- school that received it even if the student later moves schools.
  school_id   uuid references public.schools(id) on delete set null,
  module_id   text,
  message     text not null,
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply       text,
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists help_requests_school_idx on public.help_requests (school_id, status);
create index if not exists help_requests_user_idx   on public.help_requests (user_id, created_at desc);

alter table public.help_requests enable row level security;

-- --------------------------------------------------------------- read
drop policy if exists "read help in scope" on public.help_requests;
create policy "read help in scope" on public.help_requests
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_school_staff()
      and school_id is not null
      and school_id = public.my_school_id()
    )
  );

-- ------------------------------------------------------------- create
-- Only for yourself. The school_id is checked against the profile rather than
-- trusted from the client, so a request cannot be posted into someone else's
-- school inbox.
drop policy if exists "raise own help" on public.help_requests;
create policy "raise own help" on public.help_requests
  for insert with check (
    auth.uid() = user_id
    and (
      school_id is null
      or school_id = (select p.school_id from public.profiles p where p.id = auth.uid())
    )
  );

-- ------------------------------------------------------------- update
-- A student may withdraw or reword their own request; school staff may answer
-- and close one belonging to their school.
drop policy if exists "answer help in scope" on public.help_requests;
create policy "answer help in scope" on public.help_requests
  for update using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_school_staff()
      and school_id is not null
      and school_id = public.my_school_id()
    )
  );

drop policy if exists "withdraw own help" on public.help_requests;
create policy "withdraw own help" on public.help_requests
  for delete using (auth.uid() = user_id or public.is_admin());

-- =====================================================================
-- The roster carries the request, not just the count
-- ---------------------------------------------------------------------
-- `stuck_on` (inferred) stays, because a student who has gone quiet still wants
-- noticing. `help_open` and `help_note` are what they actually said, which is
-- what a teacher will read first.
-- =====================================================================
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
group by p.id, p.full_name, p.class_code, p.school_id, s.name, s.status, r.role, p.created_at;
