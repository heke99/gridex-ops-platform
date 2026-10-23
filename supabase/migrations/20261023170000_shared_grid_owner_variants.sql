-- FINDINGS F101 variants (reality world 2026-10-23). F101 (20261023140000) fixed the UTILTS attribution lock,
-- which accepted only grid_owners rows owned by the tenant. In the registry model (F41) grid owners are
-- platform-shared rows (company_id IS NULL) that the product assigns to the tenant's own metering points and
-- sites, so the same tenant-owned-only assumption also:
--   * left every shared grid owner out of the per-grid-owner monthly statistics
--     (gridex_rebuild_company_analytics_month, owners CTE), so grid_owner_monthly_metrics had no row for the
--     grid owners the tenant's points actually belong to;
--   * made gridex_bilateral_prodat.scope_v1 return NULL for a metering point whose site names a shared grid owner.
--
-- Canonical rule (document_reference_facts_v1, gridex_manual_grid_owner_source_current_v2, lock_attribution_v1,
-- normalizeGridOwnerIdToOps, grid_owners RLS): a grid owner is usable by tenant X when it is X's own row, or a
-- shared row that X's own records (metering point, customer site, grid-owner data request) name. Another
-- tenant's row is never used.
--   * Statistics: the owners CTE also takes the shared rows named by the tenant's own metering points, sites or
--     requests - exactly the sources its pts/sites/reqs/missing CTEs count per grid owner.
--   * Bilateral scope: the grid owner is already reached through the tenant's own site
--     (site.company_id = point.company_id = c); it is accepted when it is that tenant's row or a shared row.
-- Exact-needle body rewrites of the installed bodies (the analytics body is the K-06 one, 20261023150000);
-- owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $f101v$
declare
  f record;
  body text;
  target record;
begin
  for target in
    select * from (values
      ('public.gridex_rebuild_company_analytics_month(uuid,date)'::regprocedure,
       $n$  with owners as (select g.id from public.grid_owners g where g.company_id = p_company_id),$n$,
       $r$  with owners as (select g.id from public.grid_owners g where g.company_id = p_company_id
    or (g.company_id is null and (
      exists (select from public.metering_points mp where mp.company_id = p_company_id and mp.grid_owner_id = g.id)
      or exists (select from public.customer_sites s where s.company_id = p_company_id and s.grid_owner_id = g.id)
      or exists (select from public.grid_owner_data_requests r where r.company_id = p_company_id and r.grid_owner_id = g.id)))),$r$,
       -- The K-06 body is the predecessor.
       'gridex_supply_period_last_day_v1'),
      ('gridex_bilateral_prodat.scope_v1(uuid,jsonb)'::regprocedure,
       $n$JOIN public.grid_owners grid ON grid.id=site.grid_owner_id AND grid.company_id=point.company_id WHERE$n$,
       $r$JOIN public.grid_owners grid ON grid.id=site.grid_owner_id AND (grid.company_id=point.company_id OR grid.company_id IS NULL) WHERE$r$,
       'point.grid_owner_ediel_id=receiver AND grid.ediel_id=receiver')
    ) as t(signature, needle, replacement, marker)
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target.signature;
    if (length(f.prosrc) - length(replace(f.prosrc, target.needle, ''))) / length(target.needle) <> 1
      or position(target.marker in f.prosrc) = 0
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'shared_grid_owner_variants_predecessor_required:%', target.signature using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, target.needle, target.replacement);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
      raise exception 'shared_grid_owner_variants_metadata_changed:%', target.signature using errcode = 'P0U01';
    end if;
  end loop;
end
$f101v$;

commit;
