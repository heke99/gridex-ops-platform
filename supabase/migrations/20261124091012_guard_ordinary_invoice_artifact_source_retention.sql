-- Apply existing finance retention decisions to ordinary archive delivery.
-- An ordinary member of a mixed file uses the same source-copy authority.
DO $migration$
DECLARE
 plan record;
 body text;
 definition text;
 actual_digest text;
 fragment integer;
BEGIN
 FOR plan IN
  SELECT * FROM (VALUES
   ('public.gridex_read_invoice_file_artifact_v2(uuid,uuid,text)'::regprocedure,
    'a84826f7f2c0439b4b9ebb3c0046baeaa35a7fc568f6126666bf912d691e0cfa',
    'ca2f4b7c88e9abe01db401c80af1c2f82141910e7a464793a469f2da19cd9f9f',
    ARRAY[$old_1$ v_entry jsonb; v_header jsonb; v_archive_version smallint; v_preparation_kind text;$old_1$,
      $old_2$ SELECT artifact_archive_version,preparation_kind INTO v_archive_version,v_preparation_kind FROM public.invoice_export_files WHERE company_id=p_company_id AND id=p_file_id;$old_2$,
      $old_3$  PERFORM gridex_invoice_file_archive.require_mixed_file_sources(p_company_id,p_file_id);
 END IF;$old_3$],
    ARRAY[$new_1$ v_entry jsonb; v_header jsonb; v_archive_version smallint; v_preparation_kind text;
 v_row_count integer; v_member record; v_members integer:=0;$new_1$,
      $new_2$ SELECT artifact_archive_version,preparation_kind,row_count
 INTO v_archive_version,v_preparation_kind,v_row_count
 FROM public.invoice_export_files WHERE company_id=p_company_id AND id=p_file_id;$new_2$,
      $new_3$  PERFORM gridex_invoice_file_archive.require_mixed_file_sources(p_company_id,p_file_id);
 ELSE
  IF jsonb_typeof(v_receipt.selection) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
  END IF;
  IF v_row_count IS NULL OR v_row_count<1 OR jsonb_array_length(v_receipt.selection)<>v_row_count
   OR EXISTS(SELECT FROM jsonb_array_elements(v_receipt.selection) selected
             WHERE coalesce(selected->>'itemId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
   OR (SELECT count(DISTINCT selected->>'itemId') FROM jsonb_array_elements(v_receipt.selection) selected)<>v_row_count THEN
   RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
  END IF;
  FOR v_member IN
   SELECT item.id,item.billing_underlay_id,invoice.id AS invoice_id
   FROM jsonb_array_elements(v_receipt.selection) selected
   JOIN public.invoice_export_items item ON item.id=(selected->>'itemId')::uuid
    AND item.company_id=p_company_id AND item.export_file_id=p_file_id
   JOIN public.customer_invoices invoice ON invoice.company_id=item.company_id AND invoice.invoice_export_item_id=item.id
   WHERE item.billing_underlay_id IS NOT NULL
   ORDER BY item.id
  LOOP
   PERFORM public.ediel_require_invoice_source_copies_available_v1(
    p_company_id,v_member.billing_underlay_id,v_member.invoice_id,v_member.id);
   v_members:=v_members+1;
  END LOOP;
  IF v_members<>v_row_count THEN
   RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
  END IF;
 END IF;$new_3$]),
   ('gridex_invoice_file_archive.require_mixed_file_sources(uuid,uuid)'::regprocedure,
    'b6ea721aeaf1bcb93c1167a4c70ed087f143fc29625f3ebc29472eacddfe245c',
    '3853c66e1401bc33d1b437571fc650906163f54857abdd0d4548b643c01446f8',
    ARRAY[$old_check$PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,member.billing_underlay_id,member.invoice_id);$old_check$],
    ARRAY[$new_check$PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,member.billing_underlay_id,member.invoice_id,member.item_id);$new_check$])
  ) AS edits(target,preimage,postimage,old_fragments,new_fragments)
 LOOP
  SELECT p.prosrc,pg_get_functiondef(p.oid) INTO STRICT body,definition FROM pg_proc p WHERE p.oid=plan.target;
  actual_digest:=encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex');
  IF actual_digest=plan.postimage THEN CONTINUE; END IF;
  IF actual_digest IS DISTINCT FROM plan.preimage THEN
   RAISE EXCEPTION 'invoice_artifact_retention_preimage_changed' USING ERRCODE='55000';
  END IF;
  FOR fragment IN 1..cardinality(plan.old_fragments) LOOP
   IF strpos(definition,plan.old_fragments[fragment])=0 THEN
    RAISE EXCEPTION 'invoice_artifact_retention_anchor_missing' USING ERRCODE='55000';
   END IF;
   definition:=replace(definition,plan.old_fragments[fragment],plan.new_fragments[fragment]);
  END LOOP;
  EXECUTE definition;
  SELECT p.prosrc INTO STRICT body FROM pg_proc p WHERE p.oid=plan.target;
  IF encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM plan.postimage THEN
   RAISE EXCEPTION 'invoice_artifact_retention_postimage_changed' USING ERRCODE='55000';
  END IF;
 END LOOP;
END $migration$;
