\set ON_ERROR_STOP on
begin;

-- This script is deliberately read-only. Run it against the exact production
-- database after all migrations, then store the signed output as
-- LIVE_TENANT_INTEGRITY certification evidence.
do $$
declare
  t text;
  missing text[] := '{}'::text[];
  critical text[] := array[
    'customers','customer_sites','metering_points','customer_contracts',
    'ediel_messages','ediel_outbox','metering_values','billing_underlays',
    'customer_invoices','grid_owner_information_requests','manual_email_outbox'
  ];
begin
  foreach t in array critical loop
    if to_regclass('public.'||t) is null then
      missing := array_append(missing,t||':relation_missing');
    elsif not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relrowsecurity and c.relforcerowsecurity
    ) then
      missing := array_append(missing,t||':rls_or_force_rls_missing');
    end if;
  end loop;
  if cardinality(missing)>0 then
    raise exception 'live_tenant_integrity_failed:%',array_to_string(missing,',');
  end if;
end $$;

-- No tenant-owned operational root may be global.
do $$
declare v_count bigint;
begin
  select count(*) into v_count from public.ediel_messages where company_id is null;
  if v_count>0 then raise exception 'tenantless_ediel_messages:%',v_count; end if;
  select count(*) into v_count from public.ediel_outbox where company_id is null;
  if v_count>0 then raise exception 'tenantless_ediel_outbox:%',v_count; end if;
  select count(*) into v_count from public.billing_underlays where company_id is null;
  if v_count>0 then raise exception 'tenantless_billing_underlays:%',v_count; end if;
end $$;

-- The canonical runtime capability gate and tenant-protection functions must be exact.
do $$
declare v_fingerprint text; v_ready boolean; v_blockers text[];
begin
  select schema_fingerprint,is_ready,blocking_issues into v_fingerprint,v_ready,v_blockers
  from public.gridex_runtime_schema_capabilities_v3;
  if not coalesce(v_ready,false) or v_fingerprint !~ '^[a-f0-9]{64}$' or cardinality(coalesce(v_blockers,'{}'::text[]))>0 then
    raise exception 'runtime_schema_gate_not_ready:%:%:%',v_fingerprint,v_ready,v_blockers;
  end if;
  if to_regprocedure('public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date)') is null then
    raise exception 'canonical_rule_pack_resolver_missing';
  end if;
  if to_regprocedure('public.gridex_claim_billing_automation_jobs(text,integer)') is null then
    raise exception 'billing_job_claim_rpc_missing';
  end if;
end $$;

-- Broad grants to tenant tables are forbidden. Tenant access must be through
-- reviewed RLS policies, not table-wide privileges.
do $$
declare v_count bigint;
begin
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema='public'
    and table_name in ('ediel_messages','ediel_outbox','metering_values','billing_underlays','customer_invoices')
    and grantee in ('anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  if v_count>0 then raise exception 'broad_tenant_table_grants:%',v_count; end if;
end $$;

-- Surface evidence rows for operator sign-off.
select c.relname as table_name,c.relrowsecurity,c.relforcerowsecurity,
       count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
left join pg_policies p on p.schemaname='public' and p.tablename=c.relname
where c.relname in ('customers','customer_sites','metering_points','customer_contracts','ediel_messages','ediel_outbox','metering_values','billing_underlays','customer_invoices','grid_owner_information_requests','manual_email_outbox')
group by c.relname,c.relrowsecurity,c.relforcerowsecurity
order by c.relname;

rollback;
