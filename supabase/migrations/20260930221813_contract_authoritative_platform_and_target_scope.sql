-- Contract authority is derived from active database assignments, never a
-- tenant role label. Shared-masterdata permission union helpers stay unchanged.
-- Latest contract RPC definitions are patched in place: same OID/signature/ACL.
begin;

create function private.gridex_contract_actor_is_active_v1(p_actor_user_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth, pg_catalog, pg_temp
as $active$
  select p_actor_user_id is not null
    and (coalesce(auth.role(),'')='service_role' or coalesce(p_actor_user_id=auth.uid(),false))
    and exists (
      select 1 from auth.users u join public.user_profiles p on p.id=u.id
      where u.id=p_actor_user_id and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
        and p.user_status='active'
    );
$active$;

create function private.gridex_contract_actor_is_global_v1(p_actor_user_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth, pg_catalog, pg_temp
as $global$
  select private.gridex_contract_actor_is_active_v1(p_actor_user_id)
    and (
      exists (
        select 1 from public.admin_users a where a.user_id=p_actor_user_id
          and coalesce(a.is_active,true)
          and public.gridex_normalize_platform_role(a.role) in ('super_admin','platform_admin')
      )
      or exists (
        select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
        where ur.user_id=p_actor_user_id and ur.company_id is null
          and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active'
          and coalesce(r.is_active,true) and r.scope='platform'
          and public.gridex_normalize_platform_role(coalesce(r.key,r.name)) in ('super_admin','platform_admin')
      )
    );
$global$;

-- Compatibility helper intentionally keeps its historical any-company
-- permission meaning. Every tenant contract caller below instead uses the
-- explicit company helper. Do not broaden the shared resolver globally.
create or replace function public.gridex_contract_actor_has_permission(p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer
set search_path = public, auth, pg_catalog, pg_temp
as $legacy$
  select private.gridex_contract_actor_is_active_v1(p_actor_user_id)
    and p_permission is not null
    and (private.gridex_contract_actor_is_global_v1(p_actor_user_id)
      or public.gridex_has_permission(p_actor_user_id,p_permission));
$legacy$;

create or replace function public.gridex_contract_actor_can_operate_company(p_actor_user_id uuid,p_company_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth, pg_catalog, pg_temp
as $membership$
  select private.gridex_contract_actor_is_active_v1(p_actor_user_id)
    and p_company_id is not null
    and exists (select 1 from public.companies c where c.id=p_company_id
      and c.status='active' and coalesce(c.is_active,true) and not coalesce(c.is_paused,false))
    and (private.gridex_contract_actor_is_global_v1(p_actor_user_id)
      or exists (select 1 from public.company_memberships m
        where m.company_id=p_company_id and m.user_id=p_actor_user_id
          and m.status='active' and coalesce(m.is_active,true)));
$membership$;

create function public.gridex_contract_actor_has_company_permission(p_actor_user_id uuid,p_company_id uuid,p_permission text)
returns boolean language sql stable security definer
set search_path = public, auth, pg_catalog, pg_temp
as $company$
  select public.gridex_contract_actor_can_operate_company(p_actor_user_id,p_company_id)
    and p_permission is not null
    and (
      private.gridex_contract_actor_is_global_v1(p_actor_user_id)
      or exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id=ur.role_id and coalesce(r.is_active,true)
        join public.role_permissions rp on rp.role_id=r.id and coalesce(rp.effect,'allow')='allow'
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=p_actor_user_id and ur.company_id=p_company_id
          and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active'
          and coalesce(p.key,p.name)=p_permission
      )
      or exists (
        select 1 from public.user_permissions up join public.permissions p on p.id=up.permission_id
        where up.user_id=p_actor_user_id and (up.company_id=p_company_id or up.company_id is null)
          and coalesce(up.is_active,true) and coalesce(up.status,'active')='active'
          and coalesce(up.effect,'allow')='allow' and coalesce(p.key,p.name)=p_permission
      )
    );
$company$;

create function public.gridex_assert_contract_company_permission(p_actor_user_id uuid,p_company_id uuid,p_permission text)
returns void language plpgsql security definer
set search_path = public, auth, pg_catalog, pg_temp
as $assert$
begin
  if not coalesce(public.gridex_contract_actor_has_company_permission(p_actor_user_id,p_company_id,p_permission),false) then
    raise exception using errcode='42501',message='contract_permission_denied:'||coalesce(p_permission,'');
  end if;
end;
$assert$;

revoke all on function private.gridex_contract_actor_is_active_v1(uuid) from public,anon,authenticated;
revoke all on function private.gridex_contract_actor_is_global_v1(uuid) from public,anon,authenticated;
revoke all on function public.gridex_contract_actor_has_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_contract_actor_can_operate_company(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_contract_actor_has_company_permission(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_assert_contract_company_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_contract_actor_has_permission(uuid,text) to service_role;
grant execute on function public.gridex_contract_actor_can_operate_company(uuid,uuid) to service_role;
grant execute on function public.gridex_contract_actor_has_company_permission(uuid,uuid,text) to service_role;
grant execute on function public.gridex_assert_contract_company_permission(uuid,uuid,text) to service_role;

-- Patch the exact current definitions rather than reintroducing obsolete July
-- definitions or public aliases. Unknown/ambiguous/missing callsites abort the
-- transaction. Existing operation-specific permission strings are preserved.
do $patch$
declare
  target record;
  proc record;
  matches integer;
  definition text;
  revised text;
  pattern text;
  replacement text;
begin
  for target in select * from (values
    ('gridex_archive_contract_product',1),('gridex_assert_contract_channel_permission',1),
    ('gridex_cleanup_unused_contract_drafts',1),('gridex_close_contract_product',1),
    ('gridex_copy_contract_offer_v1',1),('gridex_create_internal_customer_contract_v1',1),
    ('gridex_delete_unused_contract',1),('gridex_delete_unused_contract_v2',1),
    ('gridex_pause_contract_channels',1),('gridex_prepare_customer_contract_signature_request_v1',1),
    ('gridex_preview_delete_unused_contract_v2',1),('gridex_publish_contract_channel',2),
    ('gridex_publish_internal_contract_version',2),('gridex_remove_internal_contract_offer',2),
    ('gridex_remove_internal_contract_offer_v2',1),('gridex_restore_archived_contract',1),
    ('gridex_set_contract_channel_permission',1),('gridex_unpublish_contract_channel',1),
    ('gridex_upsert_internal_contract_offer',3),('gridex_upsert_internal_contract_offer_v2',1),
    ('gridex_finalize_admin_imported_signed_agreement_v1',1)
  ) as expected(name,call_count)
  loop
    select count(*) into matches from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target.name and p.prokind='f';
    if matches<>1 then raise exception 'contract_authority_patch_function_count:%:%',target.name,matches; end if;
    select p.oid,p.proacl,p.proowner,p.prosecdef,p.proconfig into strict proc
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target.name and p.prokind='f';
    definition:=pg_catalog.pg_get_functiondef(proc.oid);
    if target.name='gridex_finalize_admin_imported_signed_agreement_v1' then
      pattern:='public\.gridex_assert_contract_permission\(\s*new\.created_by\s*,';
      replacement:='public.gridex_assert_contract_company_permission(new.created_by,new.company_id,';
    else
      pattern:='public\.gridex_assert_contract_permission\(\s*p_actor_user_id\s*,';
      replacement:='public.gridex_assert_contract_company_permission(p_actor_user_id,p_company_id,';
    end if;
    select count(*) into matches from regexp_matches(definition,pattern,'g');
    if matches<>target.call_count then raise exception 'contract_authority_patch_call_count:%:%',target.name,matches; end if;
    revised:=regexp_replace(definition,pattern,replacement,'g');
    if revised=definition or revised ~ 'public\.gridex_assert_contract_permission\(' then
      raise exception 'contract_authority_patch_incomplete:%',target.name;
    end if;
    execute revised;
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=proc.oid
      and p.proacl is not distinct from proc.proacl and p.proowner=proc.proowner
      and p.prosecdef=proc.prosecdef and p.proconfig is not distinct from proc.proconfig) then
      raise exception 'contract_authority_patch_identity_or_acl_changed:%',target.name;
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and p.prosrc ~ 'public\.gridex_assert_contract_permission\(') then
    raise exception 'contract_authority_unpatched_legacy_permission_caller';
  end if;
end;
$patch$;

comment on function public.gridex_contract_actor_has_company_permission(uuid,uuid,text) is
  'Service-only exact target-company contract authority: bound active actor, active company/membership, authoritative active global role or positive company grants. Legacy NULL-company direct allow requires target membership.';
notify pgrst,'reload schema';
commit;
