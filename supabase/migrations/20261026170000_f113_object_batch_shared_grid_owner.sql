-- FINDINGS F113 (object-batch part; takeover in #840 comment 6423229557). In the registry model (F41) grid owners are
-- platform-shared rows (company_id IS NULL) that the product assigns to the tenant's own sites and metering points.
-- gridex_prodat_object_batch.require_wire_projection_v1 (via require_plan_v1, the admin's masterdata approval of a
-- PRODAT object batch after a Z04/Z06) resolved the wire grid area (RFF+Z05) by owner_code among the tenant's own
-- grid_owners rows only. A command whose site or metering point names the shared grid owner was refused with
-- prodat_object_batch_wire_grid_owner_required. Shared registry rows carry owner_code = the Ediel id, never the area
-- code (F114), so the area is mapped only by platform_grid_areas -> platform_grid_owners.ops_grid_owner_id.
--
-- Canonical rule (F101 20261023140000, variants 20261023170000, F111 20261023197000, TypeScript
-- selectTenantGridOwnerIdForGridArea in lib/grid-owners/platformGridOwnerResolver.ts): a grid owner is usable by tenant
-- X when it is X's own row, or a shared row that X's own records name. Another tenant's row is never usable, and
-- ambiguity is never resolved by guessing.
--   * The tenant's own row for the area by owner_code is taken first (two own rows stay ambiguous), unchanged.
--   * Only when there is none: every candidate the command's own site or metering point names among
--       - a shared row (company_id IS NULL) whose owner_code is the area code, and
--       - the area's registry grid owner: an active platform_grid_areas row for the area inside its validity window,
--         its active platform grid owner, and that owner's active ops grid owner row when it is the tenant's own or a
--         shared row.
--     Exactly one distinct candidate is taken; two are prodat_object_batch_grid_namespace_ambiguous.
--   * The existing equality check still requires both the site and the metering point to name exactly that row (or
--     none), so another tenant's row, a row of another area and a row nobody named stay refused.
-- The gridex_regulated_supply.scope_v1 part of F113 shipped in 20261023198000.
--
-- Exact-needle rewrite of the installed body (last defined in 20261014202520, SC-031 successor 4c9dd19a…); the needle
-- and marker must occur exactly once, owner, ACL, security mode and configuration (proconfig) are preserved and
-- checked. GEN recapture of schema.sql must then accept the new body in SC-031's successor pin and DB-05's catalog
-- expectation (FINDINGS F113).
begin;

do $f113$
declare
  needle constant text := $n$AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;$n$;
  replacement constant text := $r$AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;
  -- F113 (20261026170000): no own row, so the one shared or registry-mapped grid owner of this area that the command's
  -- own site or metering point names. Never guessed; another tenant's row is never taken.
  IF grid_id IS NULL THEN
   IF (SELECT count(DISTINCT c.id) FROM (
     SELECT g.id FROM public.grid_owners g WHERE g.company_id IS NULL AND g.owner_code=area
      AND g.id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}')
     UNION SELECT g.id FROM public.platform_grid_areas a
      JOIN public.platform_grid_owners p ON p.id=a.grid_owner_id AND p.is_active
      JOIN public.grid_owners g ON g.id=p.ops_grid_owner_id AND g.is_active
       AND (g.company_id=(command->>'company_id')::uuid OR g.company_id IS NULL)
      WHERE a.grid_area_code=upper(area) AND a.is_active
       AND (a.valid_from IS NULL OR a.valid_from<=current_date) AND (a.valid_to IS NULL OR a.valid_to>=current_date)
       AND g.id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}')) c)>1 THEN
    RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;
   SELECT g.id INTO grid_id FROM public.grid_owners g WHERE g.id IN(
     SELECT g2.id FROM public.grid_owners g2 WHERE g2.company_id IS NULL AND g2.owner_code=area
      AND g2.id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}')
     UNION SELECT g3.id FROM public.platform_grid_areas a
      JOIN public.platform_grid_owners p ON p.id=a.grid_owner_id AND p.is_active
      JOIN public.grid_owners g3 ON g3.id=p.ops_grid_owner_id AND g3.is_active
       AND (g3.company_id=(command->>'company_id')::uuid OR g3.company_id IS NULL)
      WHERE a.grid_area_code=upper(area) AND a.is_active
       AND (a.valid_from IS NULL OR a.valid_from<=current_date) AND (a.valid_to IS NULL OR a.valid_to>=current_date)
       AND g3.id::text IN(command#>>'{site,grid_owner_id}',command#>>'{metering_point,grid_owner_id}')) FOR SHARE;
  END IF;END IF;$r$;
  marker constant text := $m$SELECT id INTO grid_id FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area FOR SHARE;$m$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, marker, ''))) / length(marker) <> 1
    or position('F113 (20261026170000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'shared_grid_owner_f113_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position(needle in body) <> 0 then
    raise exception 'shared_grid_owner_f113_metadata_changed' using errcode = 'P0U01';
  end if;
end
$f113$;

commit;
