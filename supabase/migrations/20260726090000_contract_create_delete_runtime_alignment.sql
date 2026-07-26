-- Align the runtime contract page, server actions and database RPC permissions.
-- Also make safe deletion self-heal incomplete canonical mapping for unused legacy drafts.

begin;

create or replace function public.gridex_contract_actor_has_permission(
  p_actor_user_id uuid,
  p_permission text
) returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select p_actor_user_id is not null
    and (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
    and (
      exists(
        select 1
        from public.admin_users au
        where au.user_id=p_actor_user_id
          and coalesce(au.is_active,true)
          and lower(coalesce(au.role,'')) in (
            'super_admin','superadmin','platform_superadmin','platform_admin'
          )
      )
      or exists(
        select 1
        from public.user_roles ur
        left join public.roles r on r.id=ur.role_id
        where ur.user_id=p_actor_user_id
          and coalesce(ur.status,'active')='active'
          and coalesce(ur.is_active,true)
          and lower(coalesce(ur.role,r.key,r.name,'')) in (
            'super_admin','superadmin','platform_superadmin','platform_admin'
          )
      )
      or public.gridex_has_permission(p_actor_user_id,p_permission)
    )
$$;

-- Keep persisted role permissions aligned with the explicit contract permissions.
-- The platform roles receive the complete contract lifecycle; pricing managers
-- can create/edit/version drafts but cannot publish, delete, archive or close them.
insert into public.role_permissions(
  role_id,
  role_key,
  permission_id,
  permission_key,
  effect
)
select
  r.id,
  r.key,
  p.id,
  p.key,
  'allow'
from public.roles r
join public.permissions p on p.key in (
  'contracts.create',
  'contracts.edit_draft',
  'contracts.create_version',
  'contracts.publish',
  'contracts.pause',
  'contracts.archive',
  'contracts.delete_unused',
  'contracts.close',
  'pricing.write',
  'pricing.publish'
)
where lower(coalesce(r.key,r.name,'')) in (
  'super_admin','superadmin','platform_superadmin','platform_admin'
)
and not exists (
  select 1
  from public.role_permissions rp
  where (rp.role_id=r.id or lower(coalesce(rp.role_key,''))=lower(coalesce(r.key,r.name,'')))
    and (rp.permission_id=p.id or rp.permission_key=p.key)
    and coalesce(rp.effect,'allow')='allow'
);

insert into public.role_permissions(
  role_id,
  role_key,
  permission_id,
  permission_key,
  effect
)
select
  r.id,
  r.key,
  p.id,
  p.key,
  'allow'
from public.roles r
join public.permissions p on p.key in (
  'contracts.create',
  'contracts.edit_draft',
  'contracts.create_version',
  'pricing.write'
)
where lower(coalesce(r.key,r.name,'')) in ('pricing_manager','contract_manager')
and not exists (
  select 1
  from public.role_permissions rp
  where (rp.role_id=r.id or lower(coalesce(rp.role_key,''))=lower(coalesce(r.key,r.name,'')))
    and (rp.permission_id=p.id or rp.permission_key=p.key)
    and coalesce(rp.effect,'allow')='allow'
);

create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,
  p_offer_id uuid,
  p_mode text default 'archive',
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_preview jsonb;
  v_synced_version_id uuid;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(
      p_company_id,
      p_offer_id,
      p_actor_user_id
    );
  elsif p_mode='safe_delete' then
    perform public.gridex_assert_contract_permission(
      p_actor_user_id,
      'contracts.delete_unused'
    );

    v_preview:=public.gridex_preview_delete_unused_contract(
      p_company_id,
      p_offer_id
    );

    -- Old drafts can be commercially unused but still lack the canonical
    -- product/version mapping introduced by later migrations. Repair that
    -- technical mapping inside the same transaction, then run the complete
    -- dependency preview again. Business history is never repaired away.
    if not coalesce((v_preview->>'can_delete')::boolean,false)
       and not coalesce((v_preview->>'has_business_usage')::boolean,false)
       and coalesce(v_preview->'reason_codes','[]'::jsonb) ? 'INCOMPLETE_CANONICAL_MAPPING' then
      v_synced_version_id:=public.gridex_sync_internal_offer_to_canonical(p_offer_id);
      if v_synced_version_id is not null then
        v_preview:=public.gridex_preview_delete_unused_contract(
          p_company_id,
          p_offer_id
        );
      end if;
    end if;

    if coalesce((v_preview->>'can_delete')::boolean,false) then
      return public.gridex_delete_unused_contract(
        p_company_id,
        p_offer_id,
        p_actor_user_id
      );
    end if;

    return jsonb_build_object(
      'ok',false,
      'changed',false,
      'mode','blocked',
      'code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','archive'),
      'delete_preview',v_preview
    );
  end if;

  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

revoke all on function public.gridex_contract_actor_has_permission(uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_contract_actor_has_permission(uuid,text)
  to service_role;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  to authenticated,service_role;

comment on function public.gridex_contract_actor_has_permission(uuid,text) is
  'Canonical contract permission gate aligned with the platform_admin role used by the admin contracts page.';
comment on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid) is
  'Archives or safely deletes an unused contract graph; repairs incomplete canonical mapping for unused legacy drafts before the final dependency gate.';

commit;
