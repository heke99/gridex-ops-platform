-- HELD PROPOSAL, NOT A MIGRATION (FINDINGS F113, 2026-10-23). gridex_prodat_object_batch.require_wire_projection_v1 is a
-- protected body (DB-05 20261019180300 protectedNames; SC-031 pins its successor hash 4c9dd19a…). Changing it needs a
-- bounded handoff from those owners. Only the gridex_regulated_supply.scope_v1 part ships, in
-- supabase/migrations/20261023198000_regulated_supply_scope_shared_grid_owner.sql. The native test
-- scripts/reality-f113-shared-grid-owner-object-batch-scope-native.test.ts proves both bodies from this file.
-- FINDINGS F113 (reality world 2026-10-23; F111 side finding 1 and the open F101 variant). Two more installed bodies
-- still assume a tenant-owned grid owner, while in the registry model (F41) grid owners are platform-shared rows
-- (company_id IS NULL) that the product assigns to the tenant's own sites and metering points:
--   * gridex_prodat_object_batch.require_wire_projection_v1 (via require_plan_v1, i.e. the admin's masterdata approval
--     of a PRODAT object batch after a Z04/Z06) resolved the wire grid area (RFF+Z05) by owner_code among the tenant's
--     own grid_owners rows only. A command whose site or metering point names the shared grid owner (what
--     getGridOwnerIdByGridArea/selectTenantUsableGridOwners returns since F101 variants) was refused with
--     prodat_object_batch_wire_grid_owner_required.
--   * gridex_regulated_supply.scope_v1 required grid_owners.company_id = c for the grid owner of the tenant's own site,
--     so a shared grid owner gave a NULL scope (ediel_regulated_supply_ground_scope_v1, the review/archive functions
--     and ground_current_v1).
--
-- Canonical rule (F101 20261023140000, variants 20261023170000, F111 20261023197000): a grid owner is usable by tenant
-- X when it is X's own row, or a shared row that X's own records name. Another tenant's row is never usable, and
-- ambiguity is never resolved by guessing.
--   * Object batch: the tenant's own row for the area is taken first (two own rows stay ambiguous). Only when there is
--     none, the shared row for the area that the command's own site/metering point names is taken; two such rows are
--     ambiguous. The existing equality check then still requires both the site and the metering point to name exactly
--     that row (or none), so another tenant's row, a shared row of another area and a shared row nobody named stay
--     refused.
--   * Regulated supply scope: the grid owner is reached through the tenant's own site (site.company_id = c, same
--     customer); it is accepted when it is the tenant's row or a shared row. Ediel id, environment and is_active
--     conditions are unchanged.
-- Exact-needle body rewrites of the installed bodies (object batch last defined in 20261014202520, scope in
-- 20261001004331); every needle and marker must occur exactly once, owner, ACL, security mode and configuration
-- (proconfig) are preserved and checked.
begin;

do $f113$
declare
  f record;
  body text;
  target record;
begin
  for target in
    select * from (values
      ('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)'::regprocedure,
       $n$AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;$n$,
       $r$AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;
  -- F113: no own row, so the platform-shared row (company_id IS NULL) for this area that the command's own site or
  -- metering point names. Exactly one; never guessed. Another tenant's row is never taken.
  IF grid_id IS NULL THEN SELECT id INTO grid_id FROM public.grid_owners WHERE company_id IS NULL AND owner_code=area AND id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}') FOR SHARE;
   IF (SELECT count(*) FROM public.grid_owners WHERE company_id IS NULL AND owner_code=area AND id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}'))>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;END IF;$r$,
       $m$SELECT id INTO grid_id FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area FOR SHARE;$m$,
       'prodat_object_batch_wire_grid_owner_required'),
      ('gridex_regulated_supply.scope_v1(uuid,jsonb)'::regprocedure,
       $n$SELECT FROM public.grid_owners WHERE id=site.grid_owner_id AND company_id=c AND ediel_id=point.grid_owner_ediel_id$n$,
       $r$SELECT FROM public.grid_owners WHERE id=site.grid_owner_id AND (company_id=c OR company_id IS NULL) AND ediel_id=point.grid_owner_ediel_id$r$,
       $m$SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(point.customer_site_id,point.site_id) AND company_id=c AND customer_id=customer.id FOR SHARE;$m$,
       'gridex_regulated_supply.lock_graph_v1()')
    ) as t(signature, needle, replacement, marker, marker2)
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target.signature;
    if (length(f.prosrc) - length(replace(f.prosrc, target.needle, ''))) / length(target.needle) <> 1
      or (length(f.prosrc) - length(replace(f.prosrc, target.marker, ''))) / length(target.marker) <> 1
      or position(target.marker2 in f.prosrc) = 0
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'shared_grid_owner_f113_predecessor_required:%', target.signature using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, target.needle, target.replacement);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
      or position(target.needle in body) <> 0 then
      raise exception 'shared_grid_owner_f113_metadata_changed:%', target.signature using errcode = 'P0U01';
    end if;
  end loop;
end
$f113$;

commit;

-- ADDITIONAL NOTE, NOT SHIPPED (FINDINGS F114, 2026-10-23). The object-batch part above is still insufficient in the
-- registry model: shared grid owner rows carry owner_code = the Ediel id (gridOwnerReconciliation.ts, actors/actions.ts),
-- never the area code, so `company_id IS NULL AND owner_code=area` matches no row (world: 0 of 278 active areas). The
-- area is mapped only by platform_grid_areas (is_active, valid_from/valid_to; no environment column) ->
-- platform_grid_owners (is_active) -> ops_grid_owner_id, e.g. ALS -> d0015158 (Alingsås 16700, company_id NULL).
-- When this body is handed off, its shared tier should take that mapped row (when it is the tenant's own row or a shared
-- row, is_active, and named by the command's own site/metering point), unioned with any shared owner_code=area row;
-- exactly one distinct candidate, otherwise prodat_object_batch_grid_namespace_ambiguous / _wire_grid_owner_required.
-- This mirrors the TypeScript resolver selectTenantGridOwnerIdForGridArea (lib/grid-owners/platformGridOwnerResolver.ts).
-- Until then lib/ediel/inboundCases.ts calls it with registryArea:false for the object batch, so object-batch commands
-- keep their current shape (and replay hash) and are not refused by the installed body.
-- Sketch of the shared-tier candidate (not a needle; to be written against the then-installed body):
--   SELECT g.id FROM public.platform_grid_areas a
--     JOIN public.platform_grid_owners p ON p.id=a.grid_owner_id AND p.is_active
--     JOIN public.grid_owners g ON g.id=p.ops_grid_owner_id AND g.is_active
--      AND (g.company_id=(command->>'company_id')::uuid OR g.company_id IS NULL)
--    WHERE a.grid_area_code=upper(area) AND a.is_active
--      AND (a.valid_from IS NULL OR a.valid_from<=current_date) AND (a.valid_to IS NULL OR a.valid_to>=current_date)
--      AND g.id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}')
