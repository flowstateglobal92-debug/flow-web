-- ============================================================================
-- 0028 · admin@flowstate.com is a super admin
--
-- One-off data change. Same effect as
--   npm run admin:promote -- admin@flowstate.com
-- the account is moved to the live workspace, made active, given the
-- super_admin role, and any ban on its login is cleared.
--
-- Create the account first: Authentication → Users → Add user, with
-- "Auto confirm" ticked. If it doesn't exist yet this file changes nothing,
-- so replaying the full 0001 → 0028 sequence on a fresh project still works.
-- Idempotent: running it twice is the same as running it once.
--
-- Run from the SQL editor or `supabase db push` (both run as the table owner,
-- which private.guard_profiles lets through).
-- Requires: 0027
-- ============================================================================

do $$
declare
  v_email constant text := 'admin@flowstate.com';
  v_id    uuid;
  v_name  text;
begin
  select u.id,
         nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), '')
    into v_id, v_name
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_id is null then
    raise notice 'No account for % yet. Create it in Authentication → Users, then run 0028 again.', v_email;
    return;
  end if;

  -- A banned login can't sign in, whatever its role says.
  update auth.users
     set banned_until = null
   where id = v_id
     and banned_until is not null;

  -- handle_new_user normally creates the profile; insert it here in case the
  -- account was made before that trigger existed.
  insert into public.profiles (id, email, full_name, role, workspace, is_active, permissions)
  values (v_id, v_email, v_name, 'super_admin', 'live', true, '{}')
  on conflict (id) do update
    set role        = 'super_admin',
        workspace   = 'live',
        is_active   = true,
        permissions = '{}';
end;
$$;

-- Shows the result in the SQL editor. No row means the account doesn't exist.
select p.email, p.role, p.workspace, p.is_active, u.banned_until
from public.profiles p
join auth.users u on u.id = p.id
where lower(p.email) = 'admin@flowstate.com';
