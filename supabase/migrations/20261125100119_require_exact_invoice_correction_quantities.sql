-- Validate current attributed consumption quantities when a new correction case is registered.
-- Preserve old case receipts and the existing period, permissions and eligibility checks.

DO $migration$
BEGIN
<<gridex_register_invoice_correction_v1>>
DECLARE
  target constant regprocedure := 'public.gridex_register_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;
  old_hash constant text := 'fb2cb9bb6df4738759b902573293a92bb6fae9eaab428a69e2806d64ed008423';
  new_hash constant text := '7907c927bca0aa06113dbac5f63d0f0facc4577fbcd15fd2c4fa3cbe623d3850';
  current_hash text;
  definition text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), pg_get_functiondef(oid)
    INTO STRICT current_hash, definition FROM pg_proc WHERE oid = target;
  IF current_hash IS DISTINCT FROM new_hash THEN
    IF current_hash IS DISTINCT FROM old_hash THEN
      RAISE EXCEPTION 'Unexpected original correction definition for %', target USING ERRCODE = '55000';
    END IF;
    EXECUTE replace(definition, $previous$      AND li.period_end>li.period_start$previous$, $checked$      -- For a direct E66 consumption line the current normalized reading owns both kWh quantities.
      AND (
        m.source_type <> 'ediel_utilts' OR m.source_message_id IS NULL
        OR m.source_metering_value_id IS NULL OR m.direction <> 'consumption'
        OR m.quantity_kwh < 0 OR m.unit <> 'kWh' OR li.unit <> 'kWh'
        OR (li.quantity = m.quantity_kwh AND (li.quantity_kwh IS NULL OR li.quantity_kwh = m.quantity_kwh))
      )
      AND li.period_end>li.period_start$checked$);
    IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = target)
      IS DISTINCT FROM new_hash THEN
      RAISE EXCEPTION 'Unexpected updated correction definition for %', target USING ERRCODE = '55000';
    END IF;
  END IF;
END;

<<gridex_register_grouped_invoice_correction_v1>>
DECLARE
  target constant regprocedure := 'public.gridex_register_grouped_invoice_correction_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;
  old_hash constant text := 'ddbadcff3d1d38c2c659b10cec9800f8f06f1c252638f786e8d3267d2cda32c5';
  new_hash constant text := '407d4e5971af7fe776cdb6d475dcdd2f52063783227384e61a62c565e44cf104';
  current_hash text;
  definition text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), pg_get_functiondef(oid)
    INTO STRICT current_hash, definition FROM pg_proc WHERE oid = target;
  IF current_hash IS DISTINCT FROM new_hash THEN
    IF current_hash IS DISTINCT FROM old_hash THEN
      RAISE EXCEPTION 'Unexpected original correction definition for %', target USING ERRCODE = '55000';
    END IF;
    EXECUTE replace(definition, $previous$      AND li.period_end>li.period_start$previous$, $checked$      -- For a direct E66 consumption line the current normalized reading owns both kWh quantities.
      AND (
        m.source_type <> 'ediel_utilts' OR m.source_message_id IS NULL
        OR m.source_metering_value_id IS NULL OR m.direction <> 'consumption'
        OR m.quantity_kwh < 0 OR m.unit <> 'kWh' OR li.unit <> 'kWh'
        OR (li.quantity = m.quantity_kwh AND (li.quantity_kwh IS NULL OR li.quantity_kwh = m.quantity_kwh))
      )
      AND li.period_end>li.period_start$checked$);
    IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = target)
      IS DISTINCT FROM new_hash THEN
      RAISE EXCEPTION 'Unexpected updated correction definition for %', target USING ERRCODE = '55000';
    END IF;
  END IF;
END;
END;
$migration$;
