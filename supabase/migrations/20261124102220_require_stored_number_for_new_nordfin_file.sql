DO $migration$
DECLARE
  target constant regprocedure := 'gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)'::regprocedure;
  previous record;
  next_body text;
  anchor constant text := $old$    -- The mirror rows above remain locked until the frozen archive commits.$old$;
  replacement constant text := $new$    -- The mirror rows above remain locked until the frozen archive commits.
    IF p_provider='nordfin' THEN
      IF EXISTS (
        SELECT FROM jsonb_array_elements(p_rows) row_data
        JOIN public.customer_invoices mirror ON mirror.company_id=p_company_id
          AND mirror.invoice_export_item_id=(row_data->>'invoice_export_item_id')::uuid
        WHERE mirror.invoice_number IS NULL OR mirror.invoice_number=''
          OR mirror.invoice_number ~ '[[:cntrl:]]'
          OR btrim(mirror.invoice_number,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            IS DISTINCT FROM mirror.invoice_number
      ) THEN
        RAISE EXCEPTION 'nordfin_invoice_number_required' USING ERRCODE='23514';
      END IF;
      IF EXISTS (
        SELECT FROM jsonb_array_elements(p_rows) row_data
        JOIN public.customer_invoices mirror ON mirror.company_id=p_company_id
          AND mirror.invoice_export_item_id=(row_data->>'invoice_export_item_id')::uuid
        WHERE row_data->'invoice_number' IS DISTINCT FROM to_jsonb(mirror.invoice_number)
      ) THEN
        RAISE EXCEPTION 'invoice_file_selection_changed'
          USING ERRCODE='23514',DETAIL='invoice_file_invoice_number_changed';
      END IF;
    END IF;$new$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT previous FROM pg_proc p WHERE p.oid=target;
  IF md5(previous.prosrc) IS DISTINCT FROM '74883e0fa623b36543ff1dc382cb9b58'
     OR (length(previous.prosrc)-length(replace(previous.prosrc,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'invoice_file_issued_number_predecessor_changed';
  END IF;
  next_body:=replace(previous.prosrc,anchor,replacement);
  EXECUTE replace(previous.definition,previous.prosrc,next_body);
  IF NOT EXISTS (
    SELECT FROM pg_proc p WHERE p.oid=target AND p.prosrc=next_body
      AND (to_jsonb(p)-'prosrc')=previous.metadata
  ) THEN
    RAISE EXCEPTION 'invoice_file_issued_number_metadata_changed';
  END IF;
END
$migration$;
