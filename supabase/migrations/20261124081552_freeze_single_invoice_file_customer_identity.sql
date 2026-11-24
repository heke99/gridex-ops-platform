-- Save the first ordinary file approval customer identity in the locked mirrors.
-- Existing first-file receipts and approvals without a versioned identity retain their contracts.
BEGIN;
DO $change$
DECLARE
  target regprocedure := 'public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure;
  body text;
  definition text;
  body_hash text;
  old_1 constant text := $old_1$  v_approval jsonb;$old_1$;
  new_1 constant text := $new_1$  v_approval jsonb;
  v_customer_identity jsonb;
  -- Match String.trim() in the ordinary file renderer.
  v_identity_whitespace constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';$new_1$;
  old_2 constant text := $old_2$  v_approved_at:=clock_timestamp();
  v_approval:=jsonb_build_object('status','approved','approved_at',v_approved_at,
    'approved_by',p_actor_user_id,'review_hash',p_review_hash,
    'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256);$old_2$;
  new_2 constant text := $new_2$  IF v_item.provider IN ('file_export','nordfin') THEN
    SELECT jsonb_build_object(
      'version',1,'customer_id',customer.id,
      'number',nullif(btrim(customer.customer_number,v_identity_whitespace),''),
      'name',coalesce(nullif(btrim(customer.name,v_identity_whitespace),''),
        nullif(btrim(customer.company_name,v_identity_whitespace),''),
        nullif(concat_ws(' ',nullif(btrim(customer.first_name,v_identity_whitespace),''),
          nullif(btrim(customer.last_name,v_identity_whitespace),'')),''),'Okänd kund')
    )
    INTO v_customer_identity
    FROM public.customers customer
    WHERE customer.company_id=p_company_id AND customer.id=v_item.customer_id
    FOR SHARE NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice_customer_identity_snapshot_missing' USING ERRCODE='23514';
    END IF;
  END IF;
  v_approved_at:=clock_timestamp();
  v_approval:=jsonb_build_object('status','approved','approved_at',v_approved_at,
    'approved_by',p_actor_user_id,'review_hash',p_review_hash,
    'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256);
  IF v_customer_identity IS NOT NULL THEN
    v_approval:=v_approval||jsonb_build_object('customer_identity',v_customer_identity);
  END IF;$new_2$;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) INTO STRICT body,definition
  FROM pg_proc p WHERE p.oid=target;
  body_hash:=encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex');
  IF body_hash='809feaf770c0a0bca0ec5c8d95691c93c2319fe949489b1c1a42b98908c781fd' THEN RETURN; END IF;
  IF body_hash IS DISTINCT FROM 'd03fcc0d80a564c95e555748abb23bdaf3455e5576be655c467efb9b73bf85c7' THEN
    RAISE EXCEPTION 'rad82_invoice_identity_preimage_changed:public.gridex_approve_invoice_export_item_v1' USING ERRCODE='55000';
  END IF;
  IF strpos(definition,old_1)=0 THEN
    RAISE EXCEPTION 'rad82_invoice_identity_anchor_missing:public.gridex_approve_invoice_export_item_v1' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,old_1,new_1);
  IF strpos(definition,old_2)=0 THEN
    RAISE EXCEPTION 'rad82_invoice_identity_anchor_missing:public.gridex_approve_invoice_export_item_v1' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,old_2,new_2);
  EXECUTE definition;
  SELECT p.prosrc INTO STRICT body FROM pg_proc p WHERE p.oid=target;
  IF encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM '809feaf770c0a0bca0ec5c8d95691c93c2319fe949489b1c1a42b98908c781fd' THEN
    RAISE EXCEPTION 'rad82_invoice_identity_postimage_changed:public.gridex_approve_invoice_export_item_v1' USING ERRCODE='55000';
  END IF;
END $change$;

DO $change$
DECLARE
  target regprocedure := 'gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)'::regprocedure;
  body text;
  definition text;
  body_hash text;
  old_1 constant text := $old_1$    -- The mirror rows above remain locked until the frozen archive commits.$old_1$;
  new_1 constant text := $new_1$    -- The mirror rows above remain locked until the frozen archive commits.
    IF EXISTS (
      SELECT FROM jsonb_array_elements(p_rows) row_data
      JOIN public.customer_invoices mirror ON mirror.company_id=p_company_id
        AND mirror.invoice_export_item_id=(row_data->>'invoice_export_item_id')::uuid
      JOIN public.invoice_export_items item ON item.company_id=mirror.company_id
        AND item.id=mirror.invoice_export_item_id
      CROSS JOIN LATERAL (SELECT mirror.metadata#>'{approval,customer_identity}' snapshot) saved
      WHERE saved.snapshot IS NOT NULL AND (
        jsonb_typeof(saved.snapshot) IS DISTINCT FROM 'object'
        OR saved.snapshot->'version' IS DISTINCT FROM '1'::jsonb
        OR saved.snapshot->'customer_id' IS DISTINCT FROM to_jsonb(mirror.customer_id)
        OR mirror.customer_id IS NULL OR mirror.customer_id IS DISTINCT FROM item.customer_id
        OR jsonb_typeof(saved.snapshot->'name') IS DISTINCT FROM 'string'
        OR nullif(saved.snapshot->>'name','') IS NULL
        OR coalesce(jsonb_typeof(saved.snapshot->'number'),'') NOT IN ('null','string')
        OR row_data->'customer_name' IS DISTINCT FROM saved.snapshot->'name'
        OR row_data->'customer_number' IS DISTINCT FROM saved.snapshot->'number'
      )
    ) THEN
      RAISE EXCEPTION 'invoice_file_selection_changed' USING ERRCODE='23514';
    END IF;$new_1$;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) INTO STRICT body,definition
  FROM pg_proc p WHERE p.oid=target;
  body_hash:=encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex');
  IF body_hash='b60e0b33d4af2f4008a835d7d2b945e1565ff50c8b01f84cca3536e19e655fa7' THEN RETURN; END IF;
  IF body_hash IS DISTINCT FROM '1d20fce58e660f0a0581af8f39777fb85813b3e8715b548b186383ac849acccd' THEN
    RAISE EXCEPTION 'rad82_invoice_identity_preimage_changed:gridex_invoice_file_archive.create_file' USING ERRCODE='55000';
  END IF;
  IF strpos(definition,old_1)=0 THEN
    RAISE EXCEPTION 'rad82_invoice_identity_anchor_missing:gridex_invoice_file_archive.create_file' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,old_1,new_1);
  EXECUTE definition;
  SELECT p.prosrc INTO STRICT body FROM pg_proc p WHERE p.oid=target;
  IF encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b60e0b33d4af2f4008a835d7d2b945e1565ff50c8b01f84cca3536e19e655fa7' THEN
    RAISE EXCEPTION 'rad82_invoice_identity_postimage_changed:gridex_invoice_file_archive.create_file' USING ERRCODE='55000';
  END IF;
END $change$;

COMMIT;
