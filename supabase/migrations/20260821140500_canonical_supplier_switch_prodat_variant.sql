-- Canonical site-scoped supplier-switch process variant.
-- The database materializes the same process semantics used by the TypeScript
-- resolver so legacy/admin callers cannot silently re-introduce Z22 for move-in.

alter table public.supplier_switch_requests
  add column if not exists process_type text,
  add column if not exists prodat_variant text,
  add column if not exists prodat_reason text,
  add column if not exists expected_z02_variant text,
  add column if not exists z03_variant text;

alter table public.supplier_switch_requests
  drop constraint if exists supplier_switch_requests_process_type_check,
  add constraint supplier_switch_requests_process_type_check
    check (
      process_type is null
      or process_type in (
        'supplier_switch_existing_site',
        'move_in',
        'move_out',
        'takeover',
        'unknown'
      )
    ),
  drop constraint if exists supplier_switch_requests_prodat_variant_check,
  add constraint supplier_switch_requests_prodat_variant_check
    check (prodat_variant is null or prodat_variant in ('L', 'LK')),
  drop constraint if exists supplier_switch_requests_expected_z02_variant_check,
  add constraint supplier_switch_requests_expected_z02_variant_check
    check (expected_z02_variant is null or expected_z02_variant in ('L', 'LK')),
  drop constraint if exists supplier_switch_requests_z03_variant_check,
  add constraint supplier_switch_requests_z03_variant_check
    check (z03_variant is null or z03_variant in ('L', 'LK'));

create or replace function public.gridex_materialize_supplier_switch_process_variant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_process_type text;
  v_variant text;
  v_reason text;
  v_expected_z02 text;
  v_z03_variant text;
  v_canonical jsonb;
  v_portal jsonb;
begin
  case new.request_type
    when 'switch' then
      v_process_type := 'supplier_switch_existing_site';
      v_variant := 'L';
      v_reason := 'Z22';
      v_expected_z02 := 'L';
      v_z03_variant := 'L';
    when 'move_in' then
      v_process_type := 'move_in';
      v_variant := 'LK';
      v_reason := 'Z23';
      v_expected_z02 := 'LK';
      v_z03_variant := 'LK';
    else
      v_process_type := coalesce(nullif(new.process_type, ''), 'unknown');
      v_variant := null;
      v_reason := null;
      v_expected_z02 := null;
      v_z03_variant := null;
  end case;

  new.process_type := v_process_type;
  new.prodat_variant := v_variant;
  new.prodat_reason := v_reason;
  new.expected_z02_variant := v_expected_z02;
  new.z03_variant := v_z03_variant;

  v_canonical := jsonb_build_object(
    'process_type', v_process_type,
    'z01_variant', v_variant,
    'z01_reason', v_reason,
    'expected_z02_variant', v_expected_z02,
    'z03_variant', v_z03_variant,
    'source', 'gridex_materialize_supplier_switch_process_variant'
  );

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object('canonical_process', v_canonical);

  new.validation_snapshot := coalesce(new.validation_snapshot, '{}'::jsonb)
    || jsonb_build_object('canonicalProcess', v_canonical);

  if v_reason is not null then
    v_portal := coalesce(new.validation_snapshot -> 'portalData', '{}'::jsonb)
      || jsonb_build_object('reasonForTransaction', v_reason);
    new.validation_snapshot := jsonb_set(
      new.validation_snapshot,
      '{portalData}',
      v_portal,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supplier_switch_process_variant
  on public.supplier_switch_requests;

create trigger trg_supplier_switch_process_variant
before insert or update of request_type, process_type, validation_snapshot, metadata
on public.supplier_switch_requests
for each row
execute function public.gridex_materialize_supplier_switch_process_variant();

update public.supplier_switch_requests
set request_type = request_type
where request_type is not null;

create index if not exists idx_supplier_switch_process_variant_open
  on public.supplier_switch_requests (
    company_id,
    customer_id,
    customer_site_id,
    process_type,
    status
  );

comment on column public.supplier_switch_requests.process_type is
  'Canonical site-scoped customer market process. Source of truth for PRODAT L/LK variant selection.';
comment on column public.supplier_switch_requests.prodat_variant is
  'Canonical initiating PRODAT customer-process variant: L for supplier switch, LK for move-in.';
comment on column public.supplier_switch_requests.expected_z02_variant is
  'Required inbound Z02 subtype for the originating customer process; variant mismatch must be reviewed.';
comment on column public.supplier_switch_requests.z03_variant is
  'Canonical Z03 subtype to dispatch after prerequisites: L or LK.';
