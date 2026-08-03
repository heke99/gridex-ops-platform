-- Make duplicate-primary tenant website client repair match the canonical
-- audit_logs contract. This replaces the previously deployed function body only.

create or replace function public.gridex_repair_duplicate_primary_website_client_v1(
  p_company_id uuid,
  p_environment text,
  p_keep_client_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_environment text := coalesce(nullif(trim(p_environment),''), 'production');
  v_paused_ids uuid[];
  v_request_id text := gen_random_uuid()::text;
begin
  if p_company_id is null or p_keep_client_id is null or p_actor_user_id is null then
    raise exception using errcode='22023', message='DUPLICATE_CLIENT_REPAIR_INPUT_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='DUPLICATE_CLIENT_REPAIR_REASON_REQUIRED';
  end if;

  perform 1 from public.integration_api_clients keep_client
  where keep_client.id=p_keep_client_id and keep_client.company_id=p_company_id
    and keep_client.profile_key='tenant_website' and keep_client.status='active'
    and keep_client.deleted_at is null
    and coalesce(nullif(keep_client.metadata->>'environment',''),'production')=v_environment
  for update;
  if not found then
    raise exception using errcode='P0002', message='PRIMARY_TENANT_WEBSITE_CLIENT_NOT_FOUND';
  end if;

  with paused as (
    update public.integration_api_clients duplicate_client
       set status='paused',launch_ready=false,
           launch_blockers=coalesce(duplicate_client.launch_blockers,'[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
                  'code','duplicate_primary_client_repaired',
                  'kept_client_id',p_keep_client_id,'reason',trim(p_reason))),
           metadata=coalesce(duplicate_client.metadata,'{}'::jsonb)
             || jsonb_build_object(
                  'primary',false,'duplicate_repair_kept_client_id',p_keep_client_id,
                  'duplicate_repair_actor_user_id',p_actor_user_id,
                  'duplicate_repair_reason',trim(p_reason),'duplicate_repaired_at',now()),
           updated_at=now()
     where duplicate_client.company_id=p_company_id
       and duplicate_client.id<>p_keep_client_id
       and duplicate_client.profile_key='tenant_website'
       and duplicate_client.status='active' and duplicate_client.deleted_at is null
       and coalesce(nullif(duplicate_client.metadata->>'environment',''),'production')=v_environment
     returning duplicate_client.id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into v_paused_ids from paused;

  update public.integration_api_clients
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'primary',true,'environment',v_environment,
           'duplicate_repair_actor_user_id',p_actor_user_id,
           'duplicate_repair_reason',trim(p_reason),'duplicate_repaired_at',now()),
         updated_at=now()
   where id=p_keep_client_id;

  insert into public.audit_logs(
    company_id,actor_user_id,actor_type,entity_type,entity_id,
    resource_type,resource_id,action,previous_status,new_status,
    old_values,new_values,metadata,request_id,correlation_id
  ) values (
    p_company_id,p_actor_user_id,'user','integration_api_client',p_keep_client_id::text,
    'integration_api_client',p_keep_client_id::text,'api_client.duplicate_primary_repaired',
    'duplicate_active_primary','single_active_primary',
    jsonb_build_object('active_client_ids',to_jsonb(array_append(v_paused_ids,p_keep_client_id))),
    jsonb_build_object('kept_client_id',p_keep_client_id,'paused_client_ids',to_jsonb(v_paused_ids)),
    jsonb_build_object('environment',v_environment,'reason',trim(p_reason)),
    v_request_id,v_request_id
  );

  return jsonb_build_object('company_id',p_company_id,'environment',v_environment,
    'kept_client_id',p_keep_client_id,'paused_client_ids',to_jsonb(v_paused_ids),
    'request_id',v_request_id);
end;
$$;

revoke all on function public.gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)
  to service_role;
