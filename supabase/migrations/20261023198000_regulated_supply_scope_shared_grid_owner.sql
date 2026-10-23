-- FINDINGS F113 (reality world 2026-10-23; the open F101 variant): gridex_regulated_supply.scope_v1 required
-- grid_owners.company_id = c for the grid owner of the tenant's own site, while in the registry model (F41) grid owners
-- are platform-shared rows (company_id IS NULL) that the product assigns to the tenant's own sites and metering points.
-- A shared grid owner therefore gave a NULL scope (ediel_regulated_supply_ground_scope_v1, the review/archive functions
-- and ground_current_v1).
--
-- Canonical rule (F101 20261023140000, variants 20261023170000, F111 20261023197000): a grid owner is usable by tenant
-- X when it is X's own row, or a shared row that X's own records name; another tenant's row is never usable. Here the
-- grid owner is reached through the tenant's own site (site.company_id = c, same customer); it is accepted when it is
-- the tenant's row or a shared row. Ediel id, environment and is_active conditions are unchanged.
--
-- The F113 object-batch part (gridex_prodat_object_batch.require_wire_projection_v1) is HELD: that body is protected by
-- DB-05 (20261019180300) and pinned by SC-031, so it needs a bounded handoff from those owners
-- (quality/audits/live-chain-20261015/proposals/F113-object-batch-and-scope-shared-grid-owner.sql).
-- Exact-needle body rewrite of the installed body (last defined in 20261001004331); needle and markers must occur
-- exactly once; owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $f113$
declare
  f record;
  body text;
  target record;
begin
  for target in
    select * from (values
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
