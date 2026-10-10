-- Gridex OPS: resterande catch-up (7 migrationer) + radering av testdata.
-- Kör HELA filen i Supabase SQL editor. Allt sker i en transaktion: blir något fel ändras ingenting.
begin;
set local lock_timeout = '15s';

-- ===== 20261005130000_hard_delete_guard_companies_customers =====
-- DB-05 / F-DB-05-01: a raw DELETE of a company or customer must not silently
-- cascade away audit, journal and billing history (265 ON DELETE CASCADE
-- foreign keys hang off companies/customers).
--
-- Guard, not an FK rewrite (owner decision 2026-10-05): the cascade stays for
-- the two sanctioned paths and everything else is refused.
--   companies : only a disposable tenant (status = 'deleted_test_only') or the
--               database owner roles (migrations / maintenance).
--   customers : only the database owner roles (this is what the
--               SECURITY DEFINER command gridex_delete_test_customer_v1 runs
--               as). customers.company_id is NO ACTION, so no company delete
--               ever cascades into customers.
-- service_role / authenticated / anon directly are refused with 23001.
-- Independent review (2026-10-05) closed two bypasses:
--   * status shortcut: only owner roles (incl. SECURITY DEFINER lifecycle
--     commands) may move a company into 'deleted_test_only';
--   * TRUNCATE skips row triggers: a statement guard refuses TRUNCATE by
--     non-owner roles on companies, customers and every table referencing them.
--   * the canonical lifecycle allows pending_deletion -> deleted_test_only; no
--     role (owner/SECURITY DEFINER included) may mark or hard-delete a tenant as
--     disposable while it holds retained history (real customers, contracts,
--     invoices, settlement or charge ledgers).
-- Forward-only; retention-class purge workflows remain separate.

create or replace function public.gridex_company_retained_history_v1(p_company_id uuid)
returns text[]
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select array_remove(array[
    case when exists (select 1 from public.customers c where c.company_id = p_company_id
      and c.is_test_data is not true and coalesce(lower(c.source), '') not like '%test%') then 'customers' end,
    case when exists (select 1 from public.customer_contracts x where x.company_id = p_company_id) then 'customer_contracts' end,
    case when exists (select 1 from public.customer_invoices x where x.company_id = p_company_id) then 'customer_invoices' end,
    case when exists (select 1 from public.invoice_documents x where x.company_id = p_company_id) then 'invoice_documents' end,
    case when exists (select 1 from public.billing_underlays x where x.company_id = p_company_id) then 'billing_underlays' end,
    case when exists (select 1 from public.contract_charge_ledger x where x.company_id = p_company_id) then 'contract_charge_ledger' end
  ], null)
$function$;

-- Invoker rights on purpose: guards call it as the acting role, and it only sees rows that role can read.

create or replace function public.gridex_guard_company_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_retained text[];
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if old.status = 'deleted_test_only' then
    v_retained := public.gridex_company_retained_history_v1(old.id);
    if cardinality(v_retained) = 0 then
      return old;
    end if;
    raise exception using
      errcode = '23001',
      message = 'company_hard_delete_blocked',
      detail = 'Disposable tenant still holds retained history: ' || array_to_string(v_retained, ',');
  end if;
  raise exception using
    errcode = '23001',
    message = 'company_hard_delete_blocked',
    detail = 'Retained audit, journal and billing history would be cascaded away; close the tenant through canonical_transition_tenant_lifecycle.';
end
$function$;

create or replace function public.gridex_guard_customer_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception using
    errcode = '23001',
    message = 'customer_hard_delete_blocked',
    detail = 'Use gridex_delete_test_customer_v1 for test customers; real customers keep their history.';
end
$function$;

revoke all on function public.gridex_guard_company_hard_delete_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_customer_hard_delete_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_hard_delete_guard on public.companies;
create trigger gridex_companies_hard_delete_guard
  before delete on public.companies
  for each row execute function public.gridex_guard_company_hard_delete_v1();

drop trigger if exists gridex_customers_hard_delete_guard on public.customers;
create trigger gridex_customers_hard_delete_guard
  before delete on public.customers
  for each row execute function public.gridex_guard_customer_hard_delete_v1();

create or replace function public.gridex_guard_company_disposable_status_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_retained text[];
begin
  if new.status = 'deleted_test_only' and old.status is distinct from 'deleted_test_only' then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception using
        errcode = '23001',
        message = 'company_disposable_status_blocked',
        detail = 'Only the canonical lifecycle command may mark a tenant disposable.';
    end if;
    -- Applies to every role, including the SECURITY DEFINER lifecycle command.
    v_retained := public.gridex_company_retained_history_v1(new.id);
    if cardinality(v_retained) > 0 then
      raise exception using
        errcode = '23001',
        message = 'company_disposable_retained_history',
        detail = 'Tenant holds retained history: ' || array_to_string(v_retained, ',');
    end if;
  end if;
  return new;
end
$function$;

create or replace function public.gridex_guard_history_truncate_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return null;
  end if;
  raise exception using
    errcode = '23001',
    message = 'history_truncate_blocked',
    detail = format('TRUNCATE of %I.%I would remove retained history.', tg_table_schema, tg_table_name);
end
$function$;

revoke all on function public.gridex_guard_company_disposable_status_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_history_truncate_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_disposable_status_guard on public.companies;
create trigger gridex_companies_disposable_status_guard
  before update of status on public.companies
  for each row execute function public.gridex_guard_company_disposable_status_v1();

do $guard$
declare
  t regclass;
begin
  for t in
    select distinct c.oid::regclass
    from pg_class c
    where c.oid in ('public.companies'::regclass, 'public.customers'::regclass)
       or c.oid in (
         select con.conrelid from pg_constraint con
         where con.contype = 'f'
           and con.confrelid in ('public.companies'::regclass, 'public.customers'::regclass))
  loop
    execute format('drop trigger if exists gridex_history_truncate_guard on %s', t);
    execute format('create trigger gridex_history_truncate_guard before truncate on %s for each statement execute function public.gridex_guard_history_truncate_v1()', t);
  end loop;
end
$guard$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261005130000','hard_delete_guard_companies_customers') on conflict (version) do nothing;

-- ===== 20261005160940_classify_tenant_staff_external_identity_tables =====
-- Classify the three private external staff identity tables without changing
-- their authority. Parent invitations have a globally unique id and each child
-- has a validated (invitation_id,company_id) FK with company_id NOT NULL, so the
-- company-scoped unique key admits exactly the same rows, including NULL
-- invitation ids on explicitly enrolled bindings. The isolation gate stays intact.


DO $classify_staff_identity$
DECLARE
 v_table text;
 v_relation regclass;
 v_parent regclass := 'public.company_invitations'::regclass;
 v_parent_id smallint;
 v_parent_company smallint;
 v_invitation smallint;
 v_company smallint;
 v_unique record;
BEGIN
 SELECT attnum INTO STRICT v_parent_id FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='id' AND NOT attisdropped;
 SELECT attnum INTO STRICT v_parent_company FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='company_id' AND NOT attisdropped;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
  WHERE conrelid=v_parent AND contype='p' AND convalidated AND NOT condeferrable
   AND conkey=ARRAY[v_parent_id]::smallint[])
 THEN RAISE EXCEPTION 'staff_identity_classification_parent_mismatch'; END IF;

 FOREACH v_table IN ARRAY ARRAY['tenant_staff_actor_anchors','tenant_staff_identity_deliveries','tenant_staff_identity_bindings'] LOOP
  v_relation:=pg_catalog.to_regclass('public.'||v_table);
  IF v_relation IS NULL THEN RAISE EXCEPTION 'staff_identity_classification_table_missing: %',v_table; END IF;
  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',v_relation);
  SELECT attnum INTO STRICT v_invitation FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='invitation_id' AND atttypid='uuid'::regtype AND NOT attisdropped;
  SELECT attnum INTO v_company FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='company_id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped;
  IF v_company IS NULL OR NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
   WHERE conrelid=v_relation AND contype='f' AND convalidated AND NOT condeferrable
    AND conkey=ARRAY[v_invitation,v_company]::smallint[]
    AND confrelid=v_parent AND confkey=ARRAY[v_parent_id,v_parent_company]::smallint[])
  THEN RAISE EXCEPTION 'staff_identity_classification_company_fk_mismatch: %',v_table; END IF;
  SELECT c.*,i.indisunique,i.indisvalid,i.indnullsnotdistinct INTO v_unique
  FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
  WHERE c.conrelid=v_relation AND c.conname=v_table||'_invitation_id_key' AND c.contype='u'
   AND c.convalidated AND NOT c.condeferrable;
  IF NOT FOUND OR v_unique.conkey NOT IN(ARRAY[v_invitation]::smallint[],ARRAY[v_invitation,v_company]::smallint[])
   OR NOT v_unique.indisunique OR NOT v_unique.indisvalid OR v_unique.indnullsnotdistinct
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_mismatch: %',v_table; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_constraint WHERE contype='f' AND conindid=v_unique.conindid)
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_dependency: %',v_table; END IF;
  IF v_unique.conkey=ARRAY[v_invitation]::smallint[] THEN
   -- No CASCADE: unexpected dependent objects must stop this atomic forward.
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I UNIQUE(invitation_id,company_id)',
    v_relation,v_unique.conname,v_unique.conname);
  END IF;
 END LOOP;

 INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
 VALUES
  ('tenant_staff_actor_anchors','tenant','Company-owned no-login central staff actor anchors, bound to an invitation and protected by private RLS and canonical authority.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_deliveries','tenant','Company-owned staff invitation delivery intents and verified receipts, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_bindings','tenant','Company-owned explicit tenant Auth to central staff actor bindings, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables')
 ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now()
 WHERE (platform_table_classification.kind,platform_table_classification.rationale,platform_table_classification.null_company_meaning,platform_table_classification.classified_by)
  IS DISTINCT FROM (EXCLUDED.kind,EXCLUDED.rationale,EXCLUDED.null_company_meaning,EXCLUDED.classified_by);
END $classify_staff_identity$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261005160940','classify_tenant_staff_external_identity_tables') on conflict (version) do nothing;

-- ===== 20261009090000_ops_api_exact_accepted_poa_document =====
-- OPS API review F42/F28 (2026-10-07): exact accepted power-of-attorney document.
--
-- F42: the deployed normalization trigger for powers_of_attorney legal
-- references existed only in the live catalog. Version it verbatim so clean
-- restores keep the tenant/module/lock guard.
--
-- F28: a website POA could reference another published, locked POA document of
-- the same company instead of the document in the accepted legal bundle. The
-- onboarding core records the accepted bundle (already checked against the
-- quote/offer by the wrapper) in customer_onboarding_legal_snapshots and links
-- the POA to that snapshot in the same transaction. Enforce equality there,
-- independent of the client payload.

CREATE OR REPLACE FUNCTION public.gridex_normalize_power_of_attorney_legal_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_candidate uuid;
  v_candidate_text text;
  v_document_company_id uuid;
  v_module_key text;
  v_locked_at timestamptz;
  v_linked_legacy_id uuid;
  v_legacy_exists boolean := false;
begin
  if new.legal_text_version_id is not null then
    select exists (
      select 1 from public.legal_text_versions legacy
      where legacy.id = new.legal_text_version_id
    ) into v_legacy_exists;
  end if;

  v_candidate := new.legal_bundle_version_document_id;

  -- Compatibility path for the website onboarding RPC that historically
  -- transported the canonical legal document id through legal_text_version_id.
  if v_candidate is null
     and new.legal_text_version_id is not null
     and not v_legacy_exists then
    v_candidate := new.legal_text_version_id;
    new.legal_text_version_id := null;
  end if;

  -- Other canonical writers already persist the immutable document id in their
  -- captured evidence/snapshot. Normalize those writes into the first-class
  -- column without changing their external behavior.
  if v_candidate is null then
    v_candidate_text := coalesce(
      nullif(new.evidence_payload->>'legal_bundle_version_document_id', ''),
      nullif(new.fullmakt_snapshot->>'legal_bundle_version_document_id', ''),
      nullif(new.metadata->>'legal_bundle_document_id', '')
    );
    if v_candidate_text is not null
       and v_candidate_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_candidate := v_candidate_text::uuid;
    end if;
  end if;

  if v_candidate is null then
    return new;
  end if;

  select lbv.company_id, d.module_key, lbv.locked_at, d.legacy_legal_text_version_id
    into v_document_company_id, v_module_key, v_locked_at, v_linked_legacy_id
    from public.legal_bundle_version_documents d
    join public.legal_bundle_versions lbv
      on lbv.id = d.legal_bundle_version_id
   where d.id = v_candidate;

  if not found then
    new.legal_bundle_version_document_id := v_candidate;
    return new; -- declarative FK returns the canonical 23503
  end if;

  if new.company_id is null or v_document_company_id is distinct from new.company_id then
    raise exception 'power_of_attorney_legal_document_tenant_mismatch' using errcode = '23514';
  end if;
  if v_module_key is distinct from 'power_of_attorney' then
    raise exception 'power_of_attorney_legal_document_type_mismatch' using errcode = '23514';
  end if;
  if v_locked_at is null then
    raise exception 'power_of_attorney_legal_document_not_locked' using errcode = '23514';
  end if;

  if new.legal_text_version_id is not null
     and v_linked_legacy_id is distinct from new.legal_text_version_id then
    raise exception 'power_of_attorney_legal_reference_mismatch' using errcode = '23514';
  end if;

  new.legal_bundle_version_document_id := v_candidate;
  return new;
end;
$function$;

drop trigger if exists powers_of_attorney_legal_reference_normalize_tg on public.powers_of_attorney;
create trigger powers_of_attorney_legal_reference_normalize_tg
  before insert or update on public.powers_of_attorney
  for each row execute function public.gridex_normalize_power_of_attorney_legal_reference();

create or replace function public.gridex_assert_onboarding_poa_matches_accepted_bundle()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.power_of_attorney_id is null or new.legal_bundle_version_id is null then
    return new;
  end if;
  if exists (
    select 1
      from public.powers_of_attorney poa
      join public.legal_bundle_version_documents d
        on d.id = poa.legal_bundle_version_document_id
     where poa.id = new.power_of_attorney_id
       and poa.company_id = new.company_id
       and d.legal_bundle_version_id is distinct from new.legal_bundle_version_id
  ) then
    raise exception 'power_of_attorney_offer_version_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.gridex_assert_poa_legal_snapshot_matches_bundle()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_bundle_id uuid;
begin
  if new.legal_snapshot_id is null or new.legal_bundle_version_document_id is null then
    return new;
  end if;
  select s.legal_bundle_version_id into v_bundle_id
    from public.customer_onboarding_legal_snapshots s
   where s.id = new.legal_snapshot_id
     and s.company_id = new.company_id;
  if v_bundle_id is not null and exists (
    select 1 from public.legal_bundle_version_documents d
     where d.id = new.legal_bundle_version_document_id
       and d.legal_bundle_version_id is distinct from v_bundle_id
  ) then
    raise exception 'power_of_attorney_offer_version_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.gridex_assert_onboarding_poa_matches_accepted_bundle() from public, anon, authenticated;
revoke all on function public.gridex_assert_poa_legal_snapshot_matches_bundle() from public, anon, authenticated;

drop trigger if exists customer_onboarding_legal_snapshots_poa_bundle_guard_tg on public.customer_onboarding_legal_snapshots;
create trigger customer_onboarding_legal_snapshots_poa_bundle_guard_tg
  before insert or update of power_of_attorney_id, legal_bundle_version_id on public.customer_onboarding_legal_snapshots
  for each row execute function public.gridex_assert_onboarding_poa_matches_accepted_bundle();

drop trigger if exists powers_of_attorney_legal_snapshot_bundle_guard_tg on public.powers_of_attorney;
create trigger powers_of_attorney_legal_snapshot_bundle_guard_tg
  before update of legal_snapshot_id, legal_bundle_version_document_id on public.powers_of_attorney
  for each row execute function public.gridex_assert_poa_legal_snapshot_matches_bundle();

insert into supabase_migrations.schema_migrations(version,name) values ('20261009090000','ops_api_exact_accepted_poa_document') on conflict (version) do nothing;

-- ===== 20261009100000_ops_api_contract_confirmation_delivery_continuation =====
-- OPS API review F27 (2026-10-07): durable signed-contract confirmation delivery.
--
-- Online signing finalizes the contract before archiving the PDF and queueing
-- the confirmation mail. A failure in between left no retry. A pending
-- continuation is now created in the same transaction that marks the
-- signature request used, so every signed contract has a tenant-bound delivery
-- record that a worker retries until the confirmation is queued.

create table if not exists public.customer_contract_confirmation_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null,
  signature_request_id uuid not null references public.customer_contract_signature_requests(id) on delete restrict,
  state text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  queued_at timestamptz,
  document_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contract_confirmation_deliveries_state_chk
    check (state in ('pending', 'queued', 'failed')),
  constraint customer_contract_confirmation_deliveries_attempts_chk check (attempts >= 0),
  constraint customer_contract_confirmation_deliveries_queued_chk
    check ((state = 'queued') = (queued_at is not null)),
  constraint customer_contract_confirmation_deliveries_request_key unique (signature_request_id)
);

comment on table public.customer_contract_confirmation_deliveries is
  'Durable continuation for the signed-contract confirmation mail (F27). Service-role only.';

create index if not exists customer_contract_confirmation_deliveries_due_idx
  on public.customer_contract_confirmation_deliveries (next_attempt_at)
  where state = 'pending';
create index if not exists customer_contract_confirmation_deliveries_company_contract_idx
  on public.customer_contract_confirmation_deliveries (company_id, customer_contract_id);

alter table public.customer_contract_confirmation_deliveries enable row level security;
revoke all on table public.customer_contract_confirmation_deliveries from public, anon, authenticated;
grant select, insert, update on table public.customer_contract_confirmation_deliveries to service_role;

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (signature_request_id) do nothing;
  return new;
end;
$$;

revoke all on function public.gridex_enqueue_contract_confirmation_delivery() from public, anon, authenticated;

drop trigger if exists customer_contract_signature_requests_confirmation_delivery_tg
  on public.customer_contract_signature_requests;
create trigger customer_contract_signature_requests_confirmation_delivery_tg
  after update of used_at on public.customer_contract_signature_requests
  for each row
  when (old.used_at is null and new.used_at is not null)
  execute function public.gridex_enqueue_contract_confirmation_delivery();

insert into supabase_migrations.schema_migrations(version,name) values ('20261009100000','ops_api_contract_confirmation_delivery_continuation') on conflict (version) do nothing;

-- ===== 20261009170000_ops_api_drop_duplicate_indexes =====
-- OPS API review F31 (2026-10-07): remove two verified duplicate indexes.
--
-- Each pair has identical definitions, no constraint owner and 16 kB size.
-- The canonical index of each pair is kept; a duplicate is dropped only when
-- its twin still exists with the same column list and predicate, so
-- uniqueness and query plans are unchanged.

do $dedupe$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('ux_customers_company_customer_number', 'customers_company_customer_number_uk'),
      ('idx_fk_customer_case_events_b634ce08bab5', 'customer_case_events_customer_idx')
    ) as p(duplicate_name, keep_name)
  loop
    if to_regclass('public.' || pair.duplicate_name) is null then
      continue;
    end if;
    if to_regclass('public.' || pair.keep_name) is null then
      raise notice 'keeping % because % is missing', pair.duplicate_name, pair.keep_name;
      continue;
    end if;
    if exists (
      select 1
        from pg_index d, pg_index k
       where d.indexrelid = ('public.' || pair.duplicate_name)::regclass
         and k.indexrelid = ('public.' || pair.keep_name)::regclass
         and d.indrelid = k.indrelid
         and d.indkey = k.indkey
         and d.indisunique = k.indisunique
         and d.indclass = k.indclass
         and coalesce(pg_get_expr(d.indpred, d.indrelid), '') = coalesce(pg_get_expr(k.indpred, k.indrelid), '')
         and coalesce(pg_get_expr(d.indexprs, d.indrelid), '') = coalesce(pg_get_expr(k.indexprs, k.indrelid), '')
         and not exists (select 1 from pg_constraint c where c.conindid = d.indexrelid)
    ) then
      execute format('drop index public.%I', pair.duplicate_name);
    else
      raise notice 'keeping % because it is not an exact duplicate of %', pair.duplicate_name, pair.keep_name;
    end if;
  end loop;
end
$dedupe$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009170000','ops_api_drop_duplicate_indexes') on conflict (version) do nothing;

-- ===== 20261009220000_classify_contract_confirmation_deliveries =====
-- Tenant-isolation invariants (F-6, F-8) for the F27 confirmation continuation:
-- classify the table as tenant data and scope its unique key by company_id.

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_contract_confirmation_deliveries',
  'tenant',
  'Per-company durable continuation for the signed-contract confirmation mail; service-role only.',
  'migration'
)
on conflict (table_name) do update
  set kind = excluded.kind, rationale = excluded.rationale;

alter table public.customer_contract_confirmation_deliveries
  drop constraint if exists customer_contract_confirmation_deliveries_request_key;
alter table public.customer_contract_confirmation_deliveries
  add constraint customer_contract_confirmation_deliveries_company_request_key
  unique (company_id, signature_request_id);

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (company_id, signature_request_id) do nothing;
  return new;
end;
$$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009220000','classify_contract_confirmation_deliveries') on conflict (version) do nothing;

-- ===== Radering av testkunder och testföretag =====
set local session_replication_role = replica;


do $$
declare r record; n int; cids uuid[]; coids uuid[];
begin
  select array_agg(id) into cids from ops_purge_20261010.tgt where tbl = 'customers';
  select array_agg(id) into coids from ops_purge_20261010.tgt where tbl = 'companies';

  -- Tabeller utan id-kolumn som pekar på raderade rader
  for r in
    select con.conrelid::regclass::text rel, con.confrelid::regclass::text ref,
      (select string_agg(format('c.%I = p.%I', a1.attname, a2.attname), ' and ')
         from unnest(con.conkey, con.confkey) k(c1, c2)
         join pg_attribute a1 on a1.attrelid = con.conrelid and a1.attnum = k.c1
         join pg_attribute a2 on a2.attrelid = con.confrelid and a2.attnum = k.c2) cond
    from pg_constraint con
    where con.contype = 'f' and con.connamespace = 'public'::regnamespace
      and con.confrelid::regclass::text in (select distinct tbl from ops_purge_20261010.tgt)
      and not exists (select 1 from pg_attribute a where a.attrelid = con.conrelid and a.attname = 'id' and not a.attisdropped)
  loop
    execute format('delete from %s c using %s p where %s and p.id in (select id from ops_purge_20261010.tgt where tbl = %L)', r.rel, r.ref, r.cond, r.ref);
    get diagnostics n = row_count;
    raise notice 'nofk % : %', r.rel, n;
  end loop;

  -- Hela beroendegrafen, djupast först
  for r in select tbl from ops_purge_20261010.tgt group by tbl order by max(depth) desc loop
    execute format('delete from public.%I where id in (select id from ops_purge_20261010.tgt where tbl = %L)', r.tbl, r.tbl);
    get diagnostics n = row_count;
    raise notice '% : %', r.tbl, n;
  end loop;

  -- Rester utan foreign key (customer_id / company_id)
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'uuid'
      and c.column_name in ('customer_id', 'company_id')
  loop
    execute format('delete from public.%I where %I = any(%L::uuid[])', r.table_name, r.column_name,
      case when r.column_name = 'customer_id' then cids else coids end);
    get diagnostics n = row_count;
    if n > 0 then raise notice 'rest %.% : %', r.table_name, r.column_name, n; end if;
  end loop;
end $$;

-- Kontroll: ska visa 0 kunder och 3 företag kvar
select (select count(*) from public.customers) kunder,
       (select count(*) from public.companies) foretag;


set local session_replication_role = origin;
commit;

drop schema if exists ops_purge_20261010 cascade;
