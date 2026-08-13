begin;
-- Forward repair for workbook import artifact on L653Q description.
-- The authoritative 20260813210500 import preserves provenance including a
-- leading tab copied from Tidsserieprodukter_20250528 (3).xls row 46.
-- Do not rewrite that applied migration; clean the live description here.

update public.ediel_timeseries_products
set description = ltrim(description, E'\t ')
where version = '25-A-3'
  and valid_from = date '2025-06-01'
  and code = 'L653Q'
  and source_hash = '2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98'
  and description is not null
  and description ~ E'^[\\t ]+';

do $$
begin
  if exists (
    select 1
    from public.ediel_timeseries_products
    where version = '25-A-3'
      and valid_from = date '2025-06-01'
      and code = 'L653Q'
      and source_hash = '2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98'
      and description is distinct from 'Energilager förbrukning per NA, BR och SU, 15 min'
  ) then
    raise exception 'field_511_l653q_description_not_trimmed';
  end if;
end $$;
commit;
