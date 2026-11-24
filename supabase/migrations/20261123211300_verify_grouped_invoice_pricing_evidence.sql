DO $proof_migration$
DECLARE p record; next_body text;
 old_decl constant text := $old_decl$  calculation jsonb;$old_decl$;
 new_decl constant text := $new_decl$  calculation jsonb;
  sealed_count bigint;
  sealed_digest bytea;$new_decl$;
 old_fragment constant text := $old_fragment$    PERFORM gridex_billing_source.require_underlay_v1(p_company_id,underlay.id);$old_fragment$;
 new_fragment constant text := $new_fragment$    IF previous.invoice_id IS NULL THEN
      SELECT s.evidence_count, s.evidence_digest INTO sealed_count, sealed_digest
        FROM gridex_locked_pricing_evidence.run_seals s
        WHERE s.company_id=p_company_id AND s.underlay_id=underlay.id AND s.run_id=price.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'proof_authoritative_seal_missing' USING ERRCODE='55000';
      END IF;
      IF jsonb_typeof(calculation->'interval_evidence') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'proof_evidence_count_mismatch' USING ERRCODE='55000';
      END IF;
      IF jsonb_array_length(calculation->'interval_evidence') <> sealed_count THEN
        RAISE EXCEPTION 'proof_evidence_count_mismatch' USING ERRCODE='55000';
      END IF;
      IF gridex_locked_pricing_evidence.seal_digest(
        p_company_id,underlay.id,price.id,calculation->'interval_evidence'
      ) IS DISTINCT FROM sealed_digest THEN
        RAISE EXCEPTION 'proof_evidence_digest_mismatch' USING ERRCODE='55000';
      END IF;
    END IF;

    PERFORM gridex_billing_source.require_underlay_v1(p_company_id,underlay.id);$new_fragment$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_prepare_consolidated_invoice_v1(uuid,uuid,text,text,text,uuid,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR to_regclass('gridex_locked_pricing_evidence.run_seals') IS NULL
  OR to_regprocedure('gridex_locked_pricing_evidence.seal_digest(uuid,uuid,uuid,jsonb)') IS NULL
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'875f3c383d9afebaf956ae4028137351d9d2d16b93c889bfa9fb8dd6e449d56e'
 THEN RAISE EXCEPTION 'grouped_pricing_evidence_predecessor_changed'; END IF;
 next_body:=replace(replace(p.prosrc,old_decl,new_decl),old_fragment,new_fragment);
 EXECUTE replace(p.definition,p.prosrc,next_body);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'dd48559eac347297aabed57fe40449758429bdcd1cb095c3e6253c4c48d6ce24'
 THEN RAISE EXCEPTION 'grouped_pricing_evidence_metadata_changed'; END IF;
END
$proof_migration$;
