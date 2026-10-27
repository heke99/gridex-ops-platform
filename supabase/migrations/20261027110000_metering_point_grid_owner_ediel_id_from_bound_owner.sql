-- FINDINGS A-B5 (reality scenarios A and K, batch 5e): a website customer's metering point, created by the Z02 core
-- (gridex_apply_exact_z02_core), is bound to its grid owner (grid_owner_id) but its denormalized grid_owner_ediel_id
-- stays NULL (world: 508 of 589 points). The new agreement's requested metering method (F46,
-- ediel_derive_contract_requested_method_v1) and its later basis checks (contract_request_basis_v1,
-- context_before_contract_request_v1) require that column, so the derivation was held
-- (same_signed_agreement_revision_original_customer_site_point) and no website customer's Z03 could ever be prepared
-- (start_supplier_switch failed with prodat_new_agreement_requested_method_held). Only the reality harness's own points
-- carried the column.
--
-- Change: a BEFORE INSERT/UPDATE trigger fills grid_owner_ediel_id from the bound grid owner when it is missing, and
-- follows a change of grid_owner_id when the stored value was the previous owner's. The grid owner must be active and
-- usable by the point's tenant (its own row or a platform-shared row); another tenant's row is never read. An explicit
-- value that differs from the bound owner is never overwritten. No pinned function body is changed, and existing
-- rows are not rewritten here (a backfill would also be recorded by the e035 correction capture; it is left to an
-- explicit decision).
begin;

create function public.gridex_metering_point_grid_owner_ediel_id_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  bound text;
  previous text;
begin
  if new.grid_owner_id is null then return new; end if;
  select g.ediel_id into bound from public.grid_owners g
   where g.id = new.grid_owner_id and g.is_active and (g.company_id = new.company_id or g.company_id is null);
  if nullif(bound, '') is null then return new; end if;
  if nullif(new.grid_owner_ediel_id, '') is null then
    new.grid_owner_ediel_id := bound;
  elsif tg_op = 'UPDATE' and new.grid_owner_id is distinct from old.grid_owner_id
    and new.grid_owner_ediel_id is not distinct from old.grid_owner_ediel_id then
    select g.ediel_id into previous from public.grid_owners g where g.id = old.grid_owner_id;
    if previous is not distinct from old.grid_owner_ediel_id then new.grid_owner_ediel_id := bound; end if;
  end if;
  return new;
end
$$;

revoke all on function public.gridex_metering_point_grid_owner_ediel_id_v1() from public, anon, authenticated;

create trigger metering_points_grid_owner_ediel_id_trg
  before insert or update of grid_owner_id, grid_owner_ediel_id on public.metering_points
  for each row execute function public.gridex_metering_point_grid_owner_ediel_id_v1();

commit;
