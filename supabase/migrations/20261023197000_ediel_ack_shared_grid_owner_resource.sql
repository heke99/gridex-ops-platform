-- FINDINGS F111 (reality world 2026-10-23, scenario F run 28). Every inbound PRODAT Z04 from the grid owner got
-- "APERAK skapades inte: ediel_ack_atomic_foreign_source_resource" and its aperak_due timer expired, so the business
-- APERAK that ACK-02 requires was never sent. The atomic ACK creators (gridex_ediel_ack_replay.create_v1 for
-- UTILTS/E66 APERAK and UTILTS-ERR, create_scope_v2 for PRODAT APERAK) copy the source message's resource links onto
-- the ACK and check each one with `r.company_id = c`. In the registry model (F41) grid owners are platform-shared rows
-- (company_id IS NULL), so a source naming the shared grid owner was refused as foreign (same class as F101).
--
-- Canonical rule (F101, 20261023140000/20261023170000): a grid owner is usable by tenant X when it is X's own row, or
-- a shared row that X's own records name. Here the record naming it is the source message itself, and only when that
-- message belongs to X (the creators also accept company-less inbound sources; those stay strict). Every other
-- resource table (customers, sites, points, switch/data/outbound requests, partner exports) keeps company_id = c, and
-- another tenant's grid owner row is still refused.
--
-- Exact-needle body rewrites of the installed bodies (last defined in 20261010102349): the needle must occur exactly
-- once and the grid_owners resource entry must be present; owner, ACL, security mode and configuration (proconfig)
-- are preserved and checked.
begin;

do $f111$
declare
  f record;
  body text;
  target regprocedure;
  needle constant text := $n$EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND r.company_id=$2 FOR SHARE',resource.table_name) INTO resource_json USING resource.id,c;$n$;
  replacement constant text := $r$EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND (r.company_id=$2 OR ($3 AND r.company_id IS NULL)) FOR SHARE',resource.table_name) INTO resource_json USING resource.id,c,resource.table_name='grid_owners' AND coalesce(s.company_id=c,false);$r$;
  marker constant text := $m$('grid_owners',s.grid_owner_id)$m$;
begin
  foreach target in array array[
    'gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure,
    'gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure]
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target;
    if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
      or (length(f.prosrc) - length(replace(f.prosrc, marker, ''))) / length(marker) <> 1
      or position('ediel_ack_atomic_foreign_source_resource' in f.prosrc) = 0
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'ediel_ack_shared_grid_owner_predecessor_required:%', target using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, needle, replacement);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
      or position(needle in body) <> 0 then
      raise exception 'ediel_ack_shared_grid_owner_metadata_changed:%', target using errcode = 'P0U01';
    end if;
  end loop;
end
$f111$;

commit;
