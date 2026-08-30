-- Forward-only hardening of OUTBOUND-001 to the canonical outbound_requests schema.
-- Typed clean-replay schema exposes company/customer/site/metering_point links,
-- but not supplier_switch_request_id/switch_request_id/customer_contract_id/contract_id.
-- Switch/contract cross-tenant checks remain covered by OPS-001 and EDIEL-001.

do $hotfix$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.run_tenant_integrity_audit(uuid,text,uuid)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'tenant_integrity_outbound_schema_safe_missing_function';
  end if;

  if position('tenant_integrity_outbound_schema_safe' in v_definition) > 0 then
    return;
  end if;

  if position('o.supplier_switch_request_id' in v_definition) = 0
     and position('o.switch_request_id' in v_definition) = 0
     and position('o.customer_contract_id' in v_definition) = 0
     and position('o.contract_id' in v_definition) = 0 then
    return;
  end if;

  v_old := $old$
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OUTBOUND-001',coalesce(o.company_id,c.company_id), 'outbound_request',o.id,r.severity,r.title,
             'Outbound request tenant disagrees with one or more linked business entities.',
             md5('OUTBOUND-001:'||o.id::text),
             jsonb_build_object('outbound_company_id',o.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'switch_company_id',sw.company_id,'contract_company_id',cc.company_id,'customer_id',o.customer_id,'site_id',coalesce(o.customer_site_id,o.site_id),'metering_point_id',o.metering_point_id)
      from public.outbound_requests o
      join public.customers c on c.id=o.customer_id
      left join public.customer_sites s on s.id=coalesce(o.customer_site_id,o.site_id)
      left join public.metering_points mp on mp.id=o.metering_point_id
      left join public.supplier_switch_requests sw on sw.id=coalesce(o.supplier_switch_request_id,o.switch_request_id)
      left join public.customer_contracts cc on cc.id=coalesce(o.customer_contract_id,o.contract_id)
      join public.tenant_integrity_rule_registry r on r.rule_key='OUTBOUND-001' and r.is_enabled
      where (
          o.company_id is distinct from c.company_id
          or (s.id is not null and o.company_id is distinct from s.company_id)
          or (mp.id is not null and o.company_id is distinct from mp.company_id)
          or (sw.id is not null and o.company_id is distinct from sw.company_id)
          or (cc.id is not null and o.company_id is distinct from cc.company_id)
          or (o.customer_site_id is not null and o.site_id is not null and o.customer_site_id<>o.site_id)
        )
        and (p_company_id is null or o.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or sw.company_id=p_company_id or cc.company_id=p_company_id);
$old$;

  v_new := $new$
      -- tenant_integrity_outbound_schema_safe
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OUTBOUND-001',coalesce(o.company_id,c.company_id), 'outbound_request',o.id,r.severity,r.title,
             'Outbound request tenant disagrees with one or more linked business entities.',
             md5('OUTBOUND-001:'||o.id::text),
             jsonb_build_object('outbound_company_id',o.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'customer_id',o.customer_id,'site_id',coalesce(o.customer_site_id,o.site_id),'metering_point_id',o.metering_point_id)
      from public.outbound_requests o
      join public.customers c on c.id=o.customer_id
      left join public.customer_sites s on s.id=coalesce(o.customer_site_id,o.site_id)
      left join public.metering_points mp on mp.id=o.metering_point_id
      join public.tenant_integrity_rule_registry r on r.rule_key='OUTBOUND-001' and r.is_enabled
      where (
          o.company_id is distinct from c.company_id
          or (s.id is not null and o.company_id is distinct from s.company_id)
          or (mp.id is not null and o.company_id is distinct from mp.company_id)
          or (mp.id is not null and mp.customer_id is not null and o.customer_id is distinct from mp.customer_id)
          or (o.customer_site_id is not null and o.site_id is not null and o.customer_site_id<>o.site_id)
        )
        and (p_company_id is null or o.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id);
$new$;

  if position(v_old in v_definition) = 0 then
    raise exception 'tenant_integrity_outbound_schema_safe_target_missing';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end
$hotfix$;

revoke all on function public.run_tenant_integrity_audit(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.run_tenant_integrity_audit(uuid,text,uuid) to service_role;
