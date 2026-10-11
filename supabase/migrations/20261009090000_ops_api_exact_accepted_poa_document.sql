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
