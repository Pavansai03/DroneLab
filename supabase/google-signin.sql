-- =====================================================================
-- DroneLab — make the new-user trigger cope with Google sign-in
-- =====================================================================
-- Run any time. Idempotent. Safe to run before or after Google is enabled.
--
-- WHY
-- ---
-- The trigger read exactly one key, `full_name`, because that is what our own
-- sign-up form writes. An OAuth provider writes whatever it likes: Google puts
-- the person's name under `name` and usually — but not dependably across GoTrue
-- versions — mirrors it to `full_name`.
--
-- When it does not, the row is created with a null name and the student turns up
-- on their school's roster as "no name set", having just signed in with an
-- account that knows perfectly well what they are called.
--
-- Reading both keys costs nothing and removes the version dependency. There is
-- deliberately NO fallback to the email local part: "pavansai03" is not a name,
-- and a visibly empty field is what prompts a student to fill it in.
-- =====================================================================

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
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),  -- our form, and Google when it mirrors
      nullif(new.raw_user_meta_data ->> 'name', '')        -- what Google actually guarantees
    ),
    nullif(new.raw_user_meta_data ->> 'class_code', '')
  )
  on conflict (id) do nothing;

  /* Everyone starts as a student. A school account is upgraded by its own
     application flow and an administrator only by another administrator, so
     there is no path here for a Google sign-in to arrive as anything else. */
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

-- ---------------------------------------------------------------------
-- Backfill: anyone who already signed in through a provider and landed
-- without a name, but whose account does carry one.
-- ---------------------------------------------------------------------
update public.profiles p
set full_name = coalesce(
  nullif(u.raw_user_meta_data ->> 'full_name', ''),
  nullif(u.raw_user_meta_data ->> 'name', '')
)
from auth.users u
where u.id = p.id
  and p.full_name is null
  and coalesce(
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(u.raw_user_meta_data ->> 'name', '')
      ) is not null;
