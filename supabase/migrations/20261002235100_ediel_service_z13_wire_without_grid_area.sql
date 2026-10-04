-- P26.A annex 2 (pp. 114-116) marks field 260 (RFF+Z05, net area) as '-' for
-- PRODAT Z13; the canonical field matrix blocks it. The service Z13 binding
-- (gridex_service_permission.bind_message_v1) instead required the wire to
-- carry the source-defined request grid area, so no service Z13 could be both
-- rendered by the canonical policy and bound by its origin owner.
--
-- The request grid area stays a required source term of the basis (it selects
-- the receiving grid owner). The bound Z13 wire must carry no grid area, like
-- it carries no metering point. Every other comparison is unchanged.
BEGIN;
DO $bind$DECLARE f record;
 needle CONSTANT text:=$n$o->>'gridArea' IS DISTINCT FROM b#>>'{objects,0,gridArea}'$n$;
 replacement CONSTANT text:=$n$nullif(o->>'gridArea','') IS NOT NULL OR nullif(b#>>'{objects,0,gridArea}','') IS NULL$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE p.proname='bind_message_v1' AND p.pronamespace='gridex_service_permission'::regnamespace;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'service_z13_wire_grid_area_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'service_z13_wire_grid_area_metadata_changed';END IF;
END$bind$;
COMMIT;
