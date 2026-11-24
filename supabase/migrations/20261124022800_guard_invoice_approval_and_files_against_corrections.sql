-- Bind first individual approval and archive writes to the same native correction boundary.
DO $migration$
BEGIN

CREATE FUNCTION gridex_billing_source.assert_invoice_sources_uncorrected_v1(
  p_company uuid, p_underlays uuid[]
) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog
AS $correction_gate$
DECLARE
  v_locked integer;
BEGIN
  IF p_company IS NULL OR coalesce(cardinality(p_underlays),0)=0
     OR array_position(p_underlays,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_correction_scope_unavailable' USING ERRCODE='23514';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'invoice_correction_read_committed_required' USING ERRCODE='25001';
  END IF;

  -- Bind a previously unbound legacy underlay as well. FK key-share cannot
  -- overlap these strong locks, even if a correction was still uncommitted.
  BEGIN
    PERFORM u.id
      FROM public.billing_underlays u
      WHERE u.company_id=p_company AND u.id=ANY(p_underlays)
      ORDER BY u.id FOR UPDATE OF u NOWAIT;
    GET DIAGNOSTICS v_locked=ROW_COUNT;
    IF v_locked<>(SELECT count(DISTINCT id) FROM unnest(p_underlays) AS ids(id)) THEN
      RAISE EXCEPTION 'invoice_correction_scope_unavailable' USING ERRCODE='23514';
    END IF;

    PERFORM b.underlay_id
      FROM gridex_billing_source.underlay_bindings b
      WHERE b.company_id=p_company AND b.underlay_id=ANY(p_underlays)
      ORDER BY b.underlay_id FOR UPDATE OF b NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'invoice_correction_source_busy' USING ERRCODE='55P03';
  END;

  -- Separate VOLATILE command under READ COMMITTED, after taking both locks.
  IF EXISTS (
    SELECT FROM gridex_billing_source.correction_journal j
    WHERE j.company_id=p_company AND j.underlay_id=ANY(p_underlays)
  ) THEN
    RAISE EXCEPTION 'billing_source_correction_required' USING ERRCODE='23514';
  END IF;
END
$correction_gate$;

REVOKE ALL ON FUNCTION gridex_billing_source.assert_invoice_sources_uncorrected_v1(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

DO $correction_body_0$
DECLARE p record; next_body text;
  old_0 constant text := $old_0$  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);$old_0$;
  new_0 constant text := $new_0$  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);
  PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company_id,ARRAY[v_underlay.id]);$new_0$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
  INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)');
  IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
    OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '5cfdade5309b2524bd7a9e690405819a53cd87994bf9d88cbec605ba40065481'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_required'; END IF;
  next_body:=p.prosrc;
  next_body:=replace(next_body,old_0,new_0);
  EXECUTE replace(p.definition,p.prosrc,next_body);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid) <> 'ce3ae029237a33871bb6bf9ee35fc36370a81b6c38c3be0de3f1ab2d9cc523ac'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_install_failed'; END IF;
END
$correction_body_0$;

DO $correction_body_1$
DECLARE p record; next_body text;
  old_0 constant text := $old_0$  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;$old_0$;
  new_0 constant text := $new_0$  PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company_id,ARRAY(
    SELECT i.billing_underlay_id FROM public.invoice_export_items i
    WHERE i.company_id=p_company_id AND i.id=ANY(v_ids)
  ));

  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;$new_0$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
  INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)');
  IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
    OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '5314681ded9ea8c8eba0aa7ead6ef0c85351f35c800d39a92c2f2313b246e658'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_required'; END IF;
  next_body:=p.prosrc;
  next_body:=replace(next_body,old_0,new_0);
  EXECUTE replace(p.definition,p.prosrc,next_body);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid) <> '28be525f2186cb3533598b07793f2d1298b4a517d624e54f62e5b7404b53100a'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_install_failed'; END IF;
END
$correction_body_1$;

DO $correction_body_2$
DECLARE p record; next_body text;
  old_0 constant text := $old_0$DECLARE row_position integer:=0;$old_0$;
  new_0 constant text := $new_0$DECLARE row_position integer:=0;
DECLARE source_ids uuid[]:='{}';$new_0$;
  old_1 constant text := $old_1$     group_copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,draft.invoice_id,chosen->>'reviewHash');$old_1$;
  new_1 constant text := $new_1$     group_copy:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,draft.invoice_id,chosen->>'reviewHash');
     source_ids:=source_ids||ARRAY(SELECT s.billing_underlay_id FROM gridex_invoice_groups.sources s
       WHERE s.company_id=p_company_id AND s.invoice_id=draft.invoice_id);$new_1$;
  old_2 constant text := $old_2$     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,item.billing_underlay_id,item.invoice_id);$old_2$;
  new_2 constant text := $new_2$     PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,item.billing_underlay_id,item.invoice_id);
     source_ids:=array_append(source_ids,item.billing_underlay_id);$new_2$;
  old_3 constant text := $old_3$ new_file_id:=gen_random_uuid();$old_3$;
  new_3 constant text := $new_3$ PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company_id,source_ids);

 new_file_id:=gen_random_uuid();$new_3$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
  INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_prepare_mixed_invoice_month_file_v1(uuid,text,text,uuid,uuid,jsonb)');
  IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
    OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '1ebebb286d6df55bd8079032e9a5e5a78f2f2ab0ca24c883d34c9ac179da204e'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_required'; END IF;
  next_body:=p.prosrc;
  next_body:=replace(next_body,old_0,new_0);
  next_body:=replace(next_body,old_1,new_1);
  next_body:=replace(next_body,old_2,new_2);
  next_body:=replace(next_body,old_3,new_3);
  EXECUTE replace(p.definition,p.prosrc,next_body);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid) <> '08e97903b1af877e1f5d081697b54226db0d164a1550db14963c1bb51c463050'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_install_failed'; END IF;
END
$correction_body_2$;

DO $correction_body_3$
DECLARE p record; next_body text;
  old_0 constant text := $old_0$    PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,p_invoice_id);$old_0$;
  new_0 constant text := $new_0$    PERFORM gridex_case_confirmation.require_group_invoice_open_v1(p_company_id,p_invoice_id);
    PERFORM gridex_billing_source.assert_invoice_sources_uncorrected_v1(p_company_id,ARRAY(
      SELECT s.billing_underlay_id FROM gridex_invoice_groups.sources s
      WHERE s.company_id=p_company_id AND s.invoice_id=p_invoice_id
    ));$new_0$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
  INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid,text)');
  IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
    OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '96075633444adb021b9d45eb90bd1ad460ca939cd564b531c5228fc037acbad1'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_required'; END IF;
  next_body:=p.prosrc;
  next_body:=replace(next_body,old_0,new_0);
  EXECUTE replace(p.definition,p.prosrc,next_body);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid) <> '75f40e7b78762883645541c68155e45bb4546142a5ca0beec7fe459fa92ce157'
  THEN RAISE EXCEPTION 'invoice_correction_preimage_install_failed'; END IF;
END
$correction_body_3$;

END
$migration$;
