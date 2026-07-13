-- Gridex contract/API visibility, immutable website-signature evidence and tenant mail hardening.
-- 2026-07-13

begin;

create extension if not exists pgcrypto;

-- Keep the three contract identities separate:
--   contract_offer_id          = internal OPS offer template
--   public_contract_offer_id   = public website offer
--   customer_contracts.id      = signed customer agreement
alter table if exists public.customer_contracts
  add column if not exists public_contract_offer_id uuid,
  add column if not exists offer_reference text,
  add column if not exists legal_versions_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists signature_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists signature_snapshot_sha256 text,
  add column if not exists signed_ip_hash text,
  add column if not exists signed_user_agent text;

do $$
begin
  if to_regclass('public.public_contract_offers') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = to_regclass('public.customer_contracts')
         and conname = 'customer_contracts_public_contract_offer_fk'
     ) then
    alter table public.customer_contracts
      add constraint customer_contracts_public_contract_offer_fk
      foreign key (public_contract_offer_id)
      references public.public_contract_offers(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    execute 'create index if not exists customer_contracts_company_public_offer_idx on public.customer_contracts(company_id, public_contract_offer_id, created_at desc) where public_contract_offer_id is not null';
    execute 'create index if not exists customer_contracts_company_offer_reference_idx on public.customer_contracts(company_id, offer_reference, created_at desc) where offer_reference is not null';
  end if;
end $$;

-- Backfill only when the old metadata value is a real public offer UUID. Never
-- copy it into the legacy internal contract_offer_id column.
do $$
begin
  if to_regclass('public.public_contract_offers') is not null then
    update public.customer_contracts c
       set public_contract_offer_id = p.id,
           updated_at = now()
      from public.public_contract_offers p
     where c.public_contract_offer_id is null
       and p.company_id = c.company_id
       and p.id::text = nullif(c.metadata->>'contract_offer_id', '');
  end if;
end $$;

-- Store attachment snapshots in the durable outbox so retries send the same
-- agreement PDF rather than regenerating mutable content.
alter table if exists public.tenant_email_outbox
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- External intake diagnostics must not overload contract_offer_id with a price
-- plan version. Preserve each identity in its own column.
alter table if exists public.external_contract_intakes
  add column if not exists public_contract_offer_id uuid,
  add column if not exists offer_reference text,
  add column if not exists price_plan_id uuid,
  add column if not exists price_plan_version_id uuid;

do $$
begin
  if to_regclass('public.public_contract_offers') is not null
     and to_regclass('public.external_contract_intakes') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = to_regclass('public.external_contract_intakes')
         and conname = 'external_contract_intakes_public_offer_fk'
     ) then
    alter table public.external_contract_intakes
      add constraint external_contract_intakes_public_offer_fk
      foreign key (public_contract_offer_id)
      references public.public_contract_offers(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.external_contract_intakes') is not null then
    execute 'create index if not exists external_contract_intakes_company_public_offer_idx on public.external_contract_intakes(company_id, public_contract_offer_id, created_at desc) where public_contract_offer_id is not null';
  end if;
end $$;

-- Keep the selected public-offer identity directly on the durable application
-- record for support, reconciliation and webhook replay.
alter table if exists public.website_customer_applications
  add column if not exists public_contract_offer_id uuid,
  add column if not exists offer_reference text;

do $$
begin
  if to_regclass('public.public_contract_offers') is not null
     and to_regclass('public.website_customer_applications') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = to_regclass('public.website_customer_applications')
         and conname = 'website_customer_applications_public_offer_fk'
     ) then
    alter table public.website_customer_applications
      add constraint website_customer_applications_public_offer_fk
      foreign key (public_contract_offer_id)
      references public.public_contract_offers(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.website_customer_applications') is not null then
    execute 'create index if not exists website_customer_applications_company_public_offer_idx on public.website_customer_applications(company_id, public_contract_offer_id, created_at desc) where public_contract_offer_id is not null';
  end if;
end $$;

-- Recover canonical identities for already-created website agreements. The
-- backfill only follows same-tenant, durable links; it never guesses an offer
-- from product code or a "latest" price/legal version.
do $$
begin
  if to_regclass('public.website_customer_applications') is not null then
    update public.website_customer_applications a
       set offer_reference = coalesce(
             nullif(a.response_payload->>'offer_reference', ''),
             nullif(a.payload->>'offer_reference', ''),
             nullif(a.payload->>'offerReference', ''),
             nullif(a.payload->'contract'->>'offer_reference', ''),
             nullif(a.payload->'contract'->>'offerReference', '')
           ),
           updated_at = now()
     where a.offer_reference is null
       and coalesce(
             nullif(a.response_payload->>'offer_reference', ''),
             nullif(a.payload->>'offer_reference', ''),
             nullif(a.payload->>'offerReference', ''),
             nullif(a.payload->'contract'->>'offer_reference', ''),
             nullif(a.payload->'contract'->>'offerReference', '')
           ) is not null;
  end if;

  if to_regclass('public.website_customer_applications') is not null
     and to_regclass('public.customer_contracts') is not null then
    update public.website_customer_applications a
       set public_contract_offer_id = c.public_contract_offer_id,
           offer_reference = coalesce(a.offer_reference, c.offer_reference),
           updated_at = now()
      from public.customer_contracts c
     where a.company_id = c.company_id
       and a.contract_id = c.id
       and (a.public_contract_offer_id is null or a.offer_reference is null)
       and (c.public_contract_offer_id is not null or c.offer_reference is not null);

    update public.customer_contracts c
       set public_contract_offer_id = coalesce(c.public_contract_offer_id, a.public_contract_offer_id),
           offer_reference = coalesce(c.offer_reference, a.offer_reference),
           legal_versions_snapshot = case
             when jsonb_array_length(coalesce(c.legal_versions_snapshot, '[]'::jsonb)) > 0
               then c.legal_versions_snapshot
             when jsonb_typeof(c.metadata->'legal_versions') = 'array'
               then c.metadata->'legal_versions'
             when jsonb_typeof(c.metadata->'public_offer'->'legal_versions') = 'array'
               then c.metadata->'public_offer'->'legal_versions'
             else '[]'::jsonb
           end,
           updated_at = now()
      from public.website_customer_applications a
     where a.company_id = c.company_id
       and a.contract_id = c.id
       and (
         c.public_contract_offer_id is null
         or c.offer_reference is null
         or jsonb_array_length(coalesce(c.legal_versions_snapshot, '[]'::jsonb)) = 0
       );
  end if;
end $$;

-- Repair historical external intake rows where contract_offer_id was populated
-- with a price-plan-version UUID. Existing records are linked back through the
-- durable website application/customer contract before the overloaded value is
-- cleared.
do $$
begin
  if to_regclass('public.external_contract_intakes') is not null
     and to_regclass('public.website_customer_applications') is not null then
    update public.external_contract_intakes x
       set public_contract_offer_id = coalesce(x.public_contract_offer_id, a.public_contract_offer_id),
           offer_reference = coalesce(x.offer_reference, a.offer_reference),
           price_plan_id = coalesce(x.price_plan_id, a.price_plan_id),
           price_plan_version_id = coalesce(x.price_plan_version_id, a.price_plan_version_id),
           updated_at = now()
      from public.website_customer_applications a
     where x.company_id = a.company_id
       and (
         (x.created_contract_id is not null and x.created_contract_id = a.contract_id)
         or x.payload->>'website_application_id' = a.id::text
       )
       and (
         x.public_contract_offer_id is null
         or x.offer_reference is null
         or x.price_plan_id is null
         or x.price_plan_version_id is null
       );
  end if;

  if to_regclass('public.external_contract_intakes') is not null
     and to_regclass('public.price_plan_versions') is not null
     and to_regclass('public.contract_offers') is not null then
    update public.external_contract_intakes x
       set price_plan_version_id = coalesce(x.price_plan_version_id, v.id),
           price_plan_id = coalesce(x.price_plan_id, v.price_plan_id),
           contract_offer_id = null,
           updated_at = now()
      from public.price_plan_versions v
     where x.contract_offer_id = v.id
       and x.company_id = v.company_id
       and not exists (
         select 1
           from public.contract_offers o
          where o.id = x.contract_offer_id
            and o.company_id = x.company_id
       );
  end if;
end $$;

-- Finalizes a website contract only after all exact legal versions from the
-- published offer have immutable acceptance evidence. The update itself is
-- atomic and server-authoritative; browser supplied signed_at values are never
-- trusted.
create or replace function public.gridex_finalize_website_contract_signature(
  p_company_id uuid,
  p_contract_id uuid,
  p_application_id uuid,
  p_public_contract_offer_id uuid,
  p_offer_reference text,
  p_accepted_at timestamptz,
  p_legal_versions jsonb,
  p_signature_snapshot jsonb,
  p_signature_snapshot_sha256 text,
  p_signed_ip_hash text default null,
  p_signed_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_expected_count integer;
  v_acceptance_count integer;
begin
  if p_company_id is null or p_contract_id is null or p_application_id is null then
    raise exception 'company, contract and application are required' using errcode = '22023';
  end if;
  if p_public_contract_offer_id is null or nullif(btrim(coalesce(p_offer_reference, '')), '') is null then
    raise exception 'public offer identity is required' using errcode = '22023';
  end if;
  if p_accepted_at is null then
    raise exception 'server acceptance timestamp is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_legal_versions, 'null'::jsonb)) <> 'array' then
    raise exception 'legal_versions must be an array' using errcode = '22023';
  end if;

  select * into v_contract
    from public.customer_contracts
   where id = p_contract_id
     and company_id = p_company_id
   for update;
  if not found then
    raise exception 'customer contract not found for tenant' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.public_contract_offers o
     where o.id = p_public_contract_offer_id
       and o.company_id = p_company_id
  ) then
    raise exception 'public contract offer not found for tenant' using errcode = 'P0002';
  end if;

  select count(*) into v_expected_count
    from (
      select distinct item->>'type' as legal_type, item->>'id' as legal_id
        from jsonb_array_elements(p_legal_versions) item
       where nullif(item->>'id', '') is not null
         and item->>'type' in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')
    ) expected;

  if v_expected_count <> 5
     or (select count(distinct item->>'type') from jsonb_array_elements(p_legal_versions) item) <> 5
     or (select count(distinct item->>'id') from jsonb_array_elements(p_legal_versions) item) <> 5 then
    raise exception 'exactly five unique required legal versions are required' using errcode = '23514';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_legal_versions) item
     where not exists (
       select 1
         from public.customer_legal_acceptances a
        where a.company_id = p_company_id
          and a.contract_id = p_contract_id
          and a.contract_application_id = p_application_id
          and a.legal_text_version_id = (item->>'id')::uuid
          and a.accepted_at = p_accepted_at
          and a.acceptance_type = case item->>'type'
            when 'terms' then 'terms'
            when 'privacy_policy' then 'privacy_policy'
            when 'withdrawal' then 'withdrawal_info'
            when 'power_of_attorney' then 'power_of_attorney'
            when 'price_terms' then 'price_snapshot'
          end
     )
  ) then
    raise exception 'legal acceptance evidence is incomplete or does not match the offer versions' using errcode = '23514';
  end if;

  select count(distinct a.acceptance_type) into v_acceptance_count
    from public.customer_legal_acceptances a
   where a.company_id = p_company_id
     and a.contract_id = p_contract_id
     and a.contract_application_id = p_application_id
     and a.accepted_at = p_accepted_at
     and a.acceptance_type in ('terms','privacy_policy','withdrawal_info','power_of_attorney','price_snapshot');

  if v_acceptance_count <> 5 then
    raise exception 'all required legal acceptance types are required' using errcode = '23514';
  end if;

  update public.customer_contracts
     set status = 'signed',
         signed_at = p_accepted_at,
         is_distance_agreement = true,
         withdrawal_deadline_at = p_accepted_at + interval '14 days',
         public_contract_offer_id = p_public_contract_offer_id,
         offer_reference = p_offer_reference,
         legal_versions_snapshot = p_legal_versions,
         signature_snapshot = coalesce(p_signature_snapshot, '{}'::jsonb),
         signature_snapshot_sha256 = p_signature_snapshot_sha256,
         signed_ip_hash = p_signed_ip_hash,
         signed_user_agent = left(p_signed_user_agent, 1000),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'public_contract_offer_id', p_public_contract_offer_id,
           'offer_reference', p_offer_reference,
           'signature_status', 'signed',
           'signature_finalized_at', now(),
           'signature_snapshot_sha256', p_signature_snapshot_sha256
         ),
         updated_at = now()
   where id = p_contract_id
     and company_id = p_company_id;

  return jsonb_build_object(
    'contract_id', p_contract_id,
    'status', 'signed',
    'signed_at', p_accepted_at,
    'withdrawal_deadline_at', p_accepted_at + interval '14 days',
    'public_contract_offer_id', p_public_contract_offer_id,
    'offer_reference', p_offer_reference,
    'signature_snapshot_sha256', p_signature_snapshot_sha256
  );
end;
$$;

-- Safely repair historical website agreements that were left in
-- pending_signature even though the database already contains a complete,
-- same-timestamp acceptance set for the exact five offer-bound legal
-- versions. The finalizer remains the source of truth and rejects every
-- ambiguous/incomplete row. Nothing is inferred from a product code, current
-- legal publication or browser-provided timestamp.
do $$
declare
  v_row record;
  v_signature_snapshot jsonb;
  v_signature_hash text;
begin
  for v_row in
    select
      c.id as contract_id,
      c.company_id,
      a.id as application_id,
      c.public_contract_offer_id,
      coalesce(nullif(c.offer_reference, ''), nullif(a.offer_reference, '')) as offer_reference,
      evidence.accepted_at,
      c.legal_versions_snapshot
    from public.customer_contracts c
    join public.website_customer_applications a
      on a.company_id = c.company_id
     and a.contract_id = c.id
    cross join lateral (
      select cla.accepted_at
      from public.customer_legal_acceptances cla
      where cla.company_id = c.company_id
        and cla.contract_id = c.id
        and cla.contract_application_id = a.id
        and cla.acceptance_type in (
          'terms',
          'privacy_policy',
          'withdrawal_info',
          'power_of_attorney',
          'price_snapshot'
        )
      group by cla.accepted_at
      having count(distinct cla.acceptance_type) = 5
    ) evidence
    where c.status = 'pending_signature'
      and c.public_contract_offer_id is not null
      and coalesce(nullif(c.offer_reference, ''), nullif(a.offer_reference, '')) is not null
      and jsonb_typeof(c.legal_versions_snapshot) = 'array'
      and jsonb_array_length(c.legal_versions_snapshot) = 5
    order by c.created_at, evidence.accepted_at
  loop
    -- A contract can have more than one historical acceptance timestamp. Once
    -- one exact set succeeds, skip any later candidate rows from the snapshot.
    continue when not exists (
      select 1
      from public.customer_contracts current_contract
      where current_contract.id = v_row.contract_id
        and current_contract.company_id = v_row.company_id
        and current_contract.status = 'pending_signature'
    );

    v_signature_snapshot := jsonb_build_object(
      'schema_version', 1,
      'source', 'migration_exact_evidence_repair',
      'contract_id', v_row.contract_id,
      'application_id', v_row.application_id,
      'company_id', v_row.company_id,
      'public_contract_offer_id', v_row.public_contract_offer_id,
      'offer_reference', v_row.offer_reference,
      'accepted_at', v_row.accepted_at,
      'legal_versions', v_row.legal_versions_snapshot
    );
    v_signature_hash := encode(digest(v_signature_snapshot::text, 'sha256'), 'hex');

    begin
      perform public.gridex_finalize_website_contract_signature(
        v_row.company_id,
        v_row.contract_id,
        v_row.application_id,
        v_row.public_contract_offer_id,
        v_row.offer_reference,
        v_row.accepted_at,
        v_row.legal_versions_snapshot,
        v_signature_snapshot,
        v_signature_hash,
        null,
        null
      );
    exception
      when others then
        -- Incomplete or mismatched legacy evidence is intentionally preserved
        -- as pending_signature for explicit review. The migration must not
        -- manufacture a legal signature.
        raise warning 'Skipped historical contract signature repair for %: %',
          v_row.contract_id, sqlerrm;
    end;
  end loop;
end $$;

revoke all on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) from public;
revoke all on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) from anon;
revoke all on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) from authenticated;
grant execute on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) to service_role;

comment on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) is
  'Atomically marks a website contract signed only after exact offer-bound legal acceptance evidence exists.';

commit;
