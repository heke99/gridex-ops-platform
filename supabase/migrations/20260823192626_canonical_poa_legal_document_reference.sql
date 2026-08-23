begin;

alter table public.powers_of_attorney
  add column if not exists legal_bundle_version_document_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.powers_of_attorney'::regclass
      and conname = 'powers_of_attorney_legal_bundle_version_document_id_fkey'
  ) then
    alter table public.powers_of_attorney
      add constraint powers_of_attorney_legal_bundle_version_document_id_fkey
      foreign key (legal_bundle_version_document_id)
      references public.legal_bundle_version_documents(id)
      on delete restrict;
  end if;
end $$;

create index if not exists powers_of_attorney_legal_bundle_document_idx
  on public.powers_of_attorney(company_id, legal_bundle_version_document_id)
  where legal_bundle_version_document_id is not null;

alter table public.powers_of_attorney
  drop constraint if exists powers_of_attorney_legal_reference_exclusive_check;
alter table public.powers_of_attorney
  add constraint powers_of_attorney_legal_reference_exclusive_check
  check (
    legal_text_version_id is null
    or legal_bundle_version_document_id is null
  ) not valid;
alter table public.powers_of_attorney
  validate constraint powers_of_attorney_legal_reference_exclusive_check;

create or replace function public.gridex_normalize_power_of_attorney_legal_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_document_company_id uuid;
  v_module_key text;
  v_locked_at timestamptz;
begin
  -- Compatibility bridge for pre-fix website deployments: V5 sends the exact
  -- legal_bundle_version_documents.id, while older POA persistence put that
  -- canonical id into the legacy legal_text_version_id column. Move only a
  -- verified tenant-bound power_of_attorney document before FK validation.
  if new.legal_bundle_version_document_id is null
     and new.legal_text_version_id is not null
     and not exists (
       select 1
       from public.legal_text_versions legacy
       where legacy.id = new.legal_text_version_id
     ) then
    select lbv.company_id, d.module_key, lbv.locked_at
      into v_document_company_id, v_module_key, v_locked_at
      from public.legal_bundle_version_documents d
      join public.legal_bundle_versions lbv
        on lbv.id = d.legal_bundle_version_id
     where d.id = new.legal_text_version_id;

    if found then
      if new.company_id is null or v_document_company_id is distinct from new.company_id then
        raise exception 'power_of_attorney_legal_document_tenant_mismatch' using errcode = '23514';
      end if;
      if v_module_key is distinct from 'power_of_attorney' then
        raise exception 'power_of_attorney_legal_document_type_mismatch' using errcode = '23514';
      end if;
      if v_locked_at is null then
        raise exception 'power_of_attorney_legal_document_not_locked' using errcode = '23514';
      end if;

      new.legal_bundle_version_document_id := new.legal_text_version_id;
      new.legal_text_version_id := null;
    end if;
  end if;

  if new.legal_bundle_version_document_id is not null then
    select lbv.company_id, d.module_key, lbv.locked_at
      into v_document_company_id, v_module_key, v_locked_at
      from public.legal_bundle_version_documents d
      join public.legal_bundle_versions lbv
        on lbv.id = d.legal_bundle_version_id
     where d.id = new.legal_bundle_version_document_id;

    if not found then
      return new; -- the declarative FK provides the canonical 23503 error
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
    if new.legal_text_version_id is not null then
      raise exception 'power_of_attorney_legal_reference_ambiguous' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists powers_of_attorney_legal_reference_normalize_tg
  on public.powers_of_attorney;
create trigger powers_of_attorney_legal_reference_normalize_tg
before insert or update of company_id, legal_text_version_id, legal_bundle_version_document_id
on public.powers_of_attorney
for each row execute function public.gridex_normalize_power_of_attorney_legal_reference();

comment on column public.powers_of_attorney.legal_text_version_id is
  'Historical legal evidence only. Canonical V5 website POAs use legal_bundle_version_document_id.';
comment on column public.powers_of_attorney.legal_bundle_version_document_id is
  'Exact immutable power_of_attorney document from the locked legal bundle accepted by the customer.';

commit;
