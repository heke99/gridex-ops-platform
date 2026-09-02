-- Table classification, so tenant isolation can be gated instead of remembered.
--
-- F-6: isolation is carried entirely by the restrictive tenant_lifecycle_* family
-- because the permissive layer is open by construction. Coverage was complete, but
-- nothing enforced it: a new tenant table is cross-tenant readable the moment it is
-- created, until someone remembers the guard.
--
-- A gate first needs to know which tables are tenant-owned. Today
-- `company_id IS NULL` cannot be told apart from a broken row, and that silence is
-- what let the drift behind F-3 and F-5 grow unnoticed. So classification becomes
-- data, and "mixed" -- a table that legitimately holds both platform and tenant
-- rows -- must declare what NULL means.
--
-- The gate itself lives in scripts/tenant-isolation-invariants.sql
-- (npm run tenant:invariants).
--
-- Forward-only.

begin;

create table if not exists public.platform_table_classification (
  table_name text primary key,
  kind text not null,
  rationale text not null,
  null_company_meaning text,
  classified_at timestamptz not null default now(),
  classified_by text not null default 'migration'
);

alter table public.platform_table_classification
  add column if not exists null_company_meaning text;

alter table public.platform_table_classification
  drop constraint if exists platform_table_classification_kind_check;

alter table public.platform_table_classification
  add constraint platform_table_classification_kind_check
  check (kind in ('tenant', 'platform_shared', 'mixed', 'system'));

alter table public.platform_table_classification
  drop constraint if exists platform_table_classification_mixed_needs_meaning;

alter table public.platform_table_classification
  add constraint platform_table_classification_mixed_needs_meaning
  check (kind <> 'mixed' or (null_company_meaning is not null and length(btrim(null_company_meaning)) > 0));

comment on table public.platform_table_classification is
  'F-6: every table in public is classified. tenant = company-owned rows; platform_shared = reference data; mixed = both, and must say what NULL means; system = infrastructure.';

comment on column public.platform_table_classification.null_company_meaning is
  'Required for kind = mixed. Silence about what NULL means is what let untenanted rows accumulate unnoticed.';

alter table public.platform_table_classification enable row level security;

drop policy if exists platform_table_classification_service_all on public.platform_table_classification;
create policy platform_table_classification_service_all
  on public.platform_table_classification
  for all to service_role using (true) with check (true);

drop policy if exists platform_table_classification_read on public.platform_table_classification;
create policy platform_table_classification_read
  on public.platform_table_classification
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Seed. Shape first, then corrected by evidence below.
-- ---------------------------------------------------------------------------

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
select
  c.relname,
  case
    when c.relname in (
      'grid_owners', 'electricity_suppliers', 'price_areas', 'price_area_localities',
      'consumption_profiles', 'ediel_error_rules', 'ediel_aperak_error_rules',
      'ediel_message_rules', 'ediel_rule_profiles', 'ediel_rule_profile_versions',
      'ediel_field_matrix_rules', 'ediel_field_matrix_imports', 'ediel_ack_matrix_rules',
      'spot_price_import_jobs', 'ediel_certificate_directory_cache',
      'actor_registry_import_runs', 'actor_registry_import_items', 'actor_registry_conflicts',
      'ediel_tgt_test_data', 'market_process_policies', 'ediel_certificate_refresh_jobs'
    ) then 'platform_shared'
    when c.relname in (
      'platform_table_classification', 'platform_inbound_quarantine',
      'tenant_integrity_audit_runs', 'tenant_integrity_findings',
      'canonical_provisioning_requests', 'canonical_readiness_shadow_comparisons',
      'canonical_data_repair_audit', 'automation_locks'
    ) then 'system'
    when exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'company_id'
        and a.attnum > 0 and not a.attisdropped
    ) then 'tenant'
    else 'platform_shared'
  end,
  'Seeded from observed schema shape during the 2026-09-02 tenant isolation remediation.',
  'migration:platform_table_classification'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
on conflict (table_name) do nothing;

-- Service-role only: closed by having no policy while RLS is enabled.
update public.platform_table_classification set
  kind = 'system',
  rationale = 'Service-role only; RLS enabled with no policy, so no client role can reach it.',
  classified_by = 'migration:platform_table_classification'
where table_name in ('customer_contract_signature_requests', 'metering_value_sources');

-- Shared registries that carry a company_id column but hold platform rows.
update public.platform_table_classification set
  kind = 'platform_shared',
  rationale = 'Shared platform registry; rows describe market participants or platform infrastructure, not one tenant.',
  classified_by = 'migration:platform_table_classification'
where table_name in (
  'ediel_certificates', 'ediel_certificate_events', 'ediel_mailboxes',
  'grid_owner_contact_channels', 'manual_communication_mailboxes',
  'ediel_cleanup_runs', 'ediel_message_payloads', 'auth_email_events'
);

-- Legitimately mixed, each with what NULL means spelled out.
update public.platform_table_classification set
  kind = 'mixed',
  classified_by = 'migration:platform_table_classification',
  rationale = 'Holds both platform-scoped and tenant-scoped rows.',
  null_company_meaning = v.meaning
from (values
  ('user_roles',
   'NULL = a platform role (super_admin/platform_admin). Enforced by trigger gridex_user_roles_scope_consistent: company roles may not be global.'),
  ('canonical_energy_flow_events',
   'NULL = a platform market event (market_price.*, energy_geodata.*). Enforced by canonical_energy_flow_events_scope_check against event_scope.'),
  ('inbound_email_messages',
   'NULL = tenant not yet resolved. Such rows are enrolled in platform_inbound_quarantine so the backlog is owned rather than invisible.'),
  ('inbound_processing_jobs',
   'NULL = tenant not yet resolved; follows the parent inbound_email_messages row.'),
  ('inbound_ediel_parse_results',
   'NULL = tenant not yet resolved; follows the parent inbound_email_messages row.'),
  ('inbound_email_attachments',
   'NULL = tenant not yet resolved; follows the parent inbound_email_messages row.'),
  ('audit_logs',
   'NULL = a platform-level audit event with no owning tenant. Reducing these is tracked follow-up work.'),
  ('integration_api_requests',
   'NULL = a request that failed authentication before a client could be resolved, so no tenant exists to attribute it to.'),
  ('platform_usage_events',
   'NULL = a platform-level usage event not attributable to one tenant.'),
  ('tenant_governance_events',
   'NULL = a governance event raised by the platform rather than inside one tenant.'),
  ('communication_log_events',
   'NULL = a provider-level delivery event received before the owning communication log was matched.'),
  ('tenant_email_outbox_runs',
   'NULL = a platform-wide outbox sweep covering all tenants rather than one tenant run.')
) as v(table_name, meaning)
where public.platform_table_classification.table_name = v.table_name;

-- Reclassify by evidence rather than by column shape: a table carrying company_id
-- that no client role holds any privilege on is service-role only. It is closed by
-- grants, not by policy, and demanding a restrictive guard on it would be theatre.
update public.platform_table_classification t
set kind = 'system',
    rationale = 'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
    null_company_meaning = null,
    classified_by = 'migration:platform_table_classification'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relname = t.table_name
  and c.relkind = 'r'
  and t.kind in ('tenant', 'mixed')
  and not exists (
    select 1 from pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  );

-- ---------------------------------------------------------------------------
-- F-14 continued: the first sweep used information_schema, which does not expand
-- role inheritance. has_table_privilege does. A policy no reachable role can
-- exercise is inert by definition, so removing it cannot change effective access.
-- Verified before applying: every table affected had zero permissive client
-- policies and zero client privileges.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy record;
  v_dropped integer := 0;
begin
  for v_policy in
    select pol.polname, c.relname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where pol.polroles <> '{0}'::oid[]
      and not exists (
        select 1 from unnest(pol.polroles) as role_oid
        join pg_roles r on r.oid = role_oid
        where has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
      )
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.polname, v_policy.relname);
    v_dropped := v_dropped + 1;
  end loop;

  raise notice 'F-14: dropped % inert policies', v_dropped;
end
$$;

commit;
