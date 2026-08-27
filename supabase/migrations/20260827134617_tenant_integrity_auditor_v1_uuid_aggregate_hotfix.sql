do $hotfix$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.run_tenant_integrity_audit(uuid,text,uuid)'::regprocedure)
    into v_definition;

  if position('min(tep.id)' in v_definition)>0 then
    v_definition := replace(v_definition, 'min(tep.id)', 'min(tep.id::text)::uuid');
    execute v_definition;
  elsif position('min(tep.id::text)::uuid' in v_definition)=0 then
    raise exception 'tenant_integrity_uuid_aggregate_target_missing';
  end if;
end
$hotfix$;

revoke all on function public.run_tenant_integrity_audit(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.run_tenant_integrity_audit(uuid,text,uuid) to service_role;
