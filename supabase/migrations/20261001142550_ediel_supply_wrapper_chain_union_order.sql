-- Composed-history normalization for the supply wrapper chain.
-- 20261001043234 (own partition) renames whatever public.ediel_apply_supply_source_v1
-- is current. On a timestamp replay it runs before the bilateral H/H-end
-- wrappers (052735/083335); on a database that already carries them it runs
-- after, so the same four bodies end up under rotated names. Bodies, OIDs, ACLs
-- and configuration are unchanged. Only names and schemas rotate so that each
-- inner call resolves exactly as on the canonical timestamp replay:
--   closure: H-end wrapper -> before_h_end
--   h_end: H wrapper -> before_h
--   h: own-partition wrapper -> before_own_partition
--   own_partition: normal-switch wrapper -> before_normal_switch
-- A database already in canonical order is left untouched; any other shape
-- refuses.
BEGIN;
DO $normalize$DECLARE
 closure regprocedure:=to_regprocedure('gridex_bilateral_prodat.apply_supply_before_closure_v1(uuid,uuid,uuid)');
 h_end regprocedure:=to_regprocedure('gridex_bilateral_prodat.apply_supply_before_h_end_v1(uuid,uuid,uuid)');
 h regprocedure:=to_regprocedure('gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid)');
 own regprocedure:=to_regprocedure('gridex_received_sources.apply_supply_before_own_partition_v1(uuid,uuid,uuid)');
 before jsonb;after jsonb;
BEGIN
 IF closure IS NULL OR h_end IS NULL OR h IS NULL OR own IS NULL THEN RAISE EXCEPTION 'supply_wrapper_chain_members_required';END IF;
 -- Canonical order: nothing to do.
 IF (SELECT prosrc FROM pg_proc WHERE oid=closure) LIKE '%gridex_bilateral_prodat.apply_supply_before_h_end_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=h_end) LIKE '%gridex_bilateral_prodat.apply_supply_before_h_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=h) LIKE '%gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=own) LIKE '%gridex_received_sources.apply_supply_before_normal_switch_v1(p_company_id%'
 THEN RETURN;END IF;
 -- Union order: closure holds the own-partition wrapper, own_partition the
 -- H-end wrapper, h_end the H wrapper and h the normal-switch wrapper.
 IF NOT((SELECT prosrc FROM pg_proc WHERE oid=closure) LIKE '%gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=own) LIKE '%gridex_bilateral_prodat.apply_supply_before_h_end_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=h_end) LIKE '%gridex_bilateral_prodat.apply_supply_before_h_v1(p_company_id%'
  AND (SELECT prosrc FROM pg_proc WHERE oid=h) LIKE '%gridex_received_sources.apply_supply_before_normal_switch_v1(p_company_id%')
 THEN RAISE EXCEPTION 'supply_wrapper_chain_unrecognized_order';END IF;
 SELECT jsonb_object_agg(oid::text,to_jsonb(p)-'proname'-'pronamespace') INTO before FROM pg_proc p WHERE oid IN(closure,h_end,h,own);
 -- Rotate through a unique temporary name; OIDs, bodies, ACL and config stay.
 ALTER FUNCTION gridex_bilateral_prodat.apply_supply_before_closure_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_chain_rotation_tmp_v1;
 ALTER FUNCTION gridex_received_sources.apply_supply_before_own_partition_v1(uuid,uuid,uuid) SET SCHEMA gridex_bilateral_prodat;
 ALTER FUNCTION gridex_bilateral_prodat.apply_supply_before_own_partition_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_closure_v1;
 ALTER FUNCTION gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
 ALTER FUNCTION gridex_received_sources.apply_supply_before_h_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_own_partition_v1;
 ALTER FUNCTION gridex_bilateral_prodat.apply_supply_before_chain_rotation_tmp_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_h_v1;
 SELECT jsonb_object_agg(oid::text,to_jsonb(p)-'proname'-'pronamespace') INTO after FROM pg_proc p WHERE oid IN(closure,h_end,h,own);
 IF after IS DISTINCT FROM before THEN RAISE EXCEPTION 'supply_wrapper_chain_rotation_metadata_changed';END IF;
 IF (SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('gridex_bilateral_prodat.apply_supply_before_closure_v1(uuid,uuid,uuid)')) NOT LIKE '%gridex_bilateral_prodat.apply_supply_before_h_end_v1(p_company_id%'
  OR (SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid)')) NOT LIKE '%gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id%'
  OR (SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('gridex_received_sources.apply_supply_before_own_partition_v1(uuid,uuid,uuid)')) NOT LIKE '%gridex_received_sources.apply_supply_before_normal_switch_v1(p_company_id%'
 THEN RAISE EXCEPTION 'supply_wrapper_chain_rotation_incomplete';END IF;
END$normalize$;
COMMIT;
