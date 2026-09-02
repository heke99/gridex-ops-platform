-- Tenant isolation invariant gate.
--
-- Every check exists because a real finding got through without one. Run against a
-- database: npm run tenant:invariants
--
--   F-6   every table classified; every client-reachable tenant table guarded; RLS on
--   F-3   no row in a tenant-classified table without a tenant
--   F-8/10/11  unique business keys on tenant tables include company_id
--   F-13  every view runs as the invoker
--   F-14  no policy targets roles that cannot reach the table
--   F-7   platform roles are global, company roles are not
--
-- The gate raises on any breach so the build fails rather than the invariant
-- quietly eroding, which is how the original findings accumulated.

\set ON_ERROR_STOP on

do $$
declare
  v_failures text[] := '{}';
  v_row record;
  v_count bigint;
begin
  ------------------------------------------------------------------
  -- F-6: every public table is classified.
  ------------------------------------------------------------------
  for v_row in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join public.platform_table_classification t on t.table_name = c.relname
    where c.relkind = 'r' and t.table_name is null
  loop
    v_failures := v_failures || format(
      'F-6: table %I is not classified in platform_table_classification', v_row.relname);
  end loop;

  ------------------------------------------------------------------
  -- F-6: a tenant table a client role can actually reach must carry a
  -- restrictive company guard for every command. Reachability is measured, not
  -- assumed: service-role-only tables are closed by grants and need no policy.
  ------------------------------------------------------------------
  for v_row in
    select c.relname, cmd
    from public.platform_table_classification t
    join pg_class c on c.relname = t.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join unnest(array['r', 'a', 'w', 'd']) as cmd
    where t.kind in ('tenant', 'mixed')
      and c.relkind = 'r'
      and c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'company_id'
          and a.attnum > 0 and not a.attisdropped
      )
      and exists (
        select 1 from pg_roles r
        where r.rolname in ('anon', 'authenticated')
          and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
      )
      and not exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid
          and not p.polpermissive
          and p.polcmd in (cmd, '*')
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
              || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%company_id%'
      )
  loop
    v_failures := v_failures || format(
      'F-6: %I is reachable by a client role but has no restrictive company guard for command %s',
      v_row.relname, v_row.cmd);
  end loop;

  ------------------------------------------------------------------
  -- F-6: row level security is enabled everywhere.
  ------------------------------------------------------------------
  for v_row in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r' and not c.relrowsecurity
  loop
    v_failures := v_failures || format('F-6: table %I has row level security disabled', v_row.relname);
  end loop;

  ------------------------------------------------------------------
  -- F-3: no row in a tenant-classified table without a tenant. Tables that
  -- legitimately hold platform rows are classified "mixed" and must declare what
  -- NULL means (enforced by a check constraint on the classification table).
  ------------------------------------------------------------------
  for v_row in
    select c.relname
    from public.platform_table_classification t
    join pg_class c on c.relname = t.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where t.kind = 'tenant' and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'company_id'
          and a.attnum > 0 and not a.attisdropped
      )
  loop
    execute format('select count(*) from public.%I where company_id is null', v_row.relname)
      into v_count;
    if v_count > 0 then
      v_failures := v_failures || format(
        'F-3: tenant table %I holds %s row(s) with no company_id', v_row.relname, v_count);
    end if;
  end loop;

  ------------------------------------------------------------------
  -- F-8/F-10/F-11: unique business keys on tenant tables include company_id.
  --
  -- Exempt: primary and surrogate keys; keys scoped transitively through a parent
  -- id that is itself tenant-bound; credentials and tokens, where global
  -- uniqueness is the point; and market-level identifiers listed by name with a
  -- reason.
  ------------------------------------------------------------------
  for v_row in
    select c.relname as tbl, i.relname as idx
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class c on c.oid = x.indrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join public.platform_table_classification t
      on t.table_name = c.relname and t.kind in ('tenant', 'mixed')
    where x.indisunique
      and not x.indisprimary
      and pg_get_indexdef(x.indexrelid) not like '%company_id%'
      and pg_get_indexdef(x.indexrelid) !~ '\(id\)'
      and i.relname not in (
        -- an EDIEL ID identifies a market actor, not a tenant
        'ediel_actor_settings_unique_active_production_ediel_idx',
        'ux_ediel_actor_settings_active_actor',
        -- inbound de-duplication is a platform-level idempotency concern: the same
        -- physical message must be ingested once, and the key must keep working
        -- while the tenant is still unresolved
        'ediel_messages_inbound_interchange_uidx',
        'ediel_messages_inbound_mailbox_uidx',
        'ediel_messages_inbound_transaction_external_uidx',
        'ediel_messages_mailbox_message_unique',
        -- storage paths embed generated ids and are unique by construction
        'customer_contract_documents_storage_uidx'
      )
      and pg_get_indexdef(x.indexrelid) !~ '\((customer_id|contract_id|customer_contract_id|contract_offer_id|price_plan_id|price_plan_version_id|contract_product_version_id|contract_publication_version_id|invoice_id|series_id|session_id|test_run_id|run_id|campaign_id|billing_underlay_id|pricing_run_id|domain_event_id|ediel_message_id|source_message_id|message_id|inbound_email_message_id|mailbox_id|attempt_id|import_id|import_run_id|import_batch_id|webhook_subscription_id|api_client_id|onboarding_operation_id|portfolio_price_id|forecast_run_id|communication_route_id|route_profile_id|certificate_id|email_setting_id|contract_price_option_id|outbound_request_id|related_message_id|profile_id|rule_profile_id|user_id|source_type|source_id|source_table|legacy_legal_bundle_id|repair_key|remediation_type|conflict_fingerprint|source_hash|lock_key|idempotency_key|accept_token_hash|token|token_hash|key_prefix|quote_reference|reference|batch_key|profile_key|upload_idempotency_key|automation_key|case_reference|platform_grid_owner_id|provider|environment|message_family|test_suite|smtp_email)'
  loop
    v_failures := v_failures || format(
      'F-8/F-10: unique index %I on tenant table %I is not scoped by company_id', v_row.idx, v_row.tbl);
  end loop;

  ------------------------------------------------------------------
  -- F-13: every view runs as the invoker.
  ------------------------------------------------------------------
  for v_row in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'v'
      and coalesce(
        (select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'),
        'unset'
      ) <> 'true'
  loop
    v_failures := v_failures || format('F-13: view %I does not set security_invoker', v_row.relname);
  end loop;

  ------------------------------------------------------------------
  -- F-14: no policy targets roles that cannot reach the table. Such a policy has
  -- no effect and only makes the policy set harder to reason about.
  ------------------------------------------------------------------
  select count(*) into v_count
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where pol.polroles <> '{0}'::oid[]
    and not exists (
      select 1 from unnest(pol.polroles) as role_oid
      join pg_roles r on r.oid = role_oid
      where has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
    );

  if v_count > 0 then
    v_failures := v_failures || format(
      'F-14: %s policy/policies target roles with no privileges on their table and are inert', v_count);
  end if;

  ------------------------------------------------------------------
  -- F-7: platform roles are global, company roles are not.
  ------------------------------------------------------------------
  select count(*) into v_count
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where (
    public.gridex_normalize_platform_role(coalesce(r.key, r.name)) in ('super_admin', 'platform_admin')
      and ur.company_id is not null
  ) or (
    public.gridex_normalize_platform_role(coalesce(r.key, r.name)) not in ('super_admin', 'platform_admin')
      and ur.company_id is null
  );

  if v_count > 0 then
    v_failures := v_failures || format(
      'F-7: %s user_role row(s) have an inconsistent platform/company scope', v_count);
  end if;

  ------------------------------------------------------------------
  if array_length(v_failures, 1) > 0 then
    raise exception E'Tenant isolation invariants failed (% breach(es)):\n  - %',
      array_length(v_failures, 1), array_to_string(v_failures, E'\n  - ');
  end if;

  raise notice 'Tenant isolation invariants: all checks passed.';
end
$$;
