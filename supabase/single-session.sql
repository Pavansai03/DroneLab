-- =====================================================================
-- DroneLab — one signed-in device per account
-- =====================================================================
-- Run any time. Idempotent.
--
-- WHY THIS IS TWO MECHANISMS
-- --------------------------
-- GoTrue can revoke a user's other sessions when a new one is created
-- (GOTRUE_SESSIONS_SINGLE_PER_USER, set in Dokploy — see the deployment notes).
-- That is the authoritative half: it kills the old refresh token, so the old
-- device cannot renew and is signed out for good.
--
-- But it is not immediate. An access token already issued stays valid until it
-- expires — up to an hour by default — so the old device carries on working
-- until then. For a shared classroom machine, "logged out within the hour" is
-- not what anyone means by logged out.
--
-- So the API also asks, on every request, whether the calling session is still
-- the newest one for that account. This function is how it asks. Between them:
-- the API stops the old device on its very next request, and GoTrue makes sure
-- it can never come back.
--
-- SECURITY DEFINER is required — auth.sessions is not readable by anyone else,
-- and deliberately so. The function returns a single boolean about a session id
-- the caller already holds, which tells them nothing they did not know.
-- =====================================================================

create or replace function public.session_is_current(p_session uuid)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select case
    -- An unknown session id is not current. This covers a revoked session as
    -- well as a malformed one, and both should be refused.
    when not exists (select 1 from auth.sessions where id = p_session) then false
    else not exists (
      select 1
      from auth.sessions newer
      where newer.user_id = (select user_id from auth.sessions where id = p_session)
        and newer.created_at > (select created_at from auth.sessions where id = p_session)
    )
  end;
$$;

revoke all on function public.session_is_current(uuid) from public, anon, authenticated;
grant execute on function public.session_is_current(uuid) to service_role;
