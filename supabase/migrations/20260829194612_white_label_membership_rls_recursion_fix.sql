do $migration$
begin
  if to_regclass('public.white_label_platform_memberships') is null then
    raise notice 'white_label_platform_memberships is absent in canonical clean replay; skipping live-schema RLS recursion repair';
    return;
  end if;

  execute $ddl$
    create or replace function public.gridex_user_has_white_label_admin_membership(
      p_white_label_platform_id uuid
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, auth, pg_temp
    as $function$
      select exists (
        select 1
        from public.white_label_platform_memberships m
        where m.white_label_platform_id = p_white_label_platform_id
          and m.user_id = auth.uid()
          and m.status = 'active'
          and m.membership_role in ('owner', 'admin')
      );
    $function$
  $ddl$;

  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from public';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from anon';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from authenticated';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from service_role';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from authenticator';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from dashboard_user';
  execute 'revoke all on function public.gridex_user_has_white_label_admin_membership(uuid) from supabase_privileged_role';

  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to anon';
  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to authenticated';
  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to service_role';
  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to authenticator';
  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to dashboard_user';
  execute 'grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to supabase_privileged_role';

  execute 'drop policy if exists gridex_mp_58b83e8720a7cc8636e9 on public.white_label_platform_memberships';
  execute 'drop policy if exists gridex_mp_7dd30531ebf475d6d523 on public.white_label_platform_memberships';
  execute 'drop policy if exists gridex_mp_8af91b7b698643ab5127 on public.white_label_platform_memberships';
  execute 'drop policy if exists gridex_mp_a054754c0855bc792b09 on public.white_label_platform_memberships';
  execute 'drop policy if exists gridex_mp_c345b352cf1792ef91bf on public.white_label_platform_memberships';
  execute 'drop policy if exists gridex_mp_fd231f76e6b1834b2fb0 on public.white_label_platform_memberships';
  execute 'drop policy if exists white_label_platform_memberships_select_v2 on public.white_label_platform_memberships';

  execute $policy$
    create policy white_label_platform_memberships_select_v2
    on public.white_label_platform_memberships
    for select
    to anon, authenticated, service_role, authenticator, dashboard_user, supabase_privileged_role
    using (
      (select public.gridex_user_is_platform_admin())
      or user_id = (select auth.uid())
      or public.gridex_user_has_white_label_admin_membership(white_label_platform_id)
    )
  $policy$;
end
$migration$;
