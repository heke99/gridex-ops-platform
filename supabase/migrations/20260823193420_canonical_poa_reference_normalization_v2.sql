begin;

alter table public.powers_of_attorney
  drop constraint if exists powers_of_attorney_legal_reference_exclusive_check;

create or replace function public.gridex_normalize_power_of_attorney_legal_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.gridex_normalize_power_of_attorney_legal_reference() is
  'Normalizes canonical V5 POA legal evidence while preserving verified legacy legal_text_versions references.';

commit;
