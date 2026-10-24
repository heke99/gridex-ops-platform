-- Preserve the immutable original commercial/source snapshot on qualified
-- underlays. Both success and failure diagnostics already live on pricing_runs.
-- Unbound legacy underlays retain their existing diagnostic snapshot behavior.
-- The source guard, exact identity, tenant and pricing receipt guards stay intact.
BEGIN;
DO $repair$ DECLARE f record;b text;needle text;replacement text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
 FROM pg_proc p WHERE oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') NOT IN ('c8676fd912b87e31db2fcef33acb495c0e2123a7318ea54f80e625320f943d3d','ee495118b1e4e568fae2032ba4fc6a0d8b709492b3c46354ba33c2bed819f618') THEN RAISE EXCEPTION 'source_bound_pricing_exact_predecessor_required';END IF;
 b:=f.prosrc;
 needle:=$needle$  v_rows integer;$needle$;replacement:=$replacement$  v_rows integer;
  v_source_bound boolean;$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'source_bound_pricing_exact_anchor_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;$needle$;replacement:=$replacement$  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;
  v_source_bound:=EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.company_id=p_company_id AND b.underlay_id=p_billing_underlay_id);
  IF v_source_bound AND coalesce(p_pricing_snapshot,'{}'::jsonb) IS DISTINCT FROM coalesce(v_underlay.pricing_snapshot,'{}'::jsonb) THEN
    RAISE EXCEPTION 'source_bound_pricing_snapshot_mismatch' USING ERRCODE='23514';
  END IF;$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'source_bound_pricing_exact_anchor_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$pricing_snapshot=coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      )$needle$;replacement:=$replacement$pricing_snapshot=CASE WHEN v_source_bound THEN pricing_snapshot ELSE coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'source_bound_pricing_exact_anchor_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$pricing_snapshot=coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      )$needle$;replacement:=$replacement$pricing_snapshot=CASE WHEN v_source_bound THEN pricing_snapshot ELSE coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'source_bound_pricing_exact_anchor_required';END IF;
 b:=replace(b,needle,replacement);
 EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'source_bound_pricing_metadata_changed';END IF;
END$repair$;
COMMIT;
