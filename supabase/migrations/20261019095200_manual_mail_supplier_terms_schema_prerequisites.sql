-- Restore only the legacy columns used by manual-supplier application and its
-- canonical supplier-switch continuation. Existing production columns already
-- have this exact shape; their values and definitions are never rewritten.
-- Source: 20260528_batch_1_completion_customer_flow.sql (customer_sites).
-- SHA256: bb6a4e08e24bc08e9571fa8f79bb26bbbfe4c7199a50d1c8efee917a729d8e0b
-- Source: 20260528_batch_1_customer_flow_masterdata_preflight.sql (sites/switches).
-- SHA256: 08d183bdbb1506958893aada9400982ea58cd2e4c0acec0a886ad83194533135
-- No contract fields, row backfills, scopes, grants, policies or history changes.
DO $gridex_manual_supplier_continuation_columns$
DECLARE
  expected record;
  actual record;
BEGIN
  IF to_regclass('public.customer_sites') IS NULL
    OR to_regclass('public.supplier_switch_requests') IS NULL THEN
    RAISE EXCEPTION 'manual_supplier_continuation_tables_required' USING ERRCODE='23514';
  END IF;
  FOR expected IN
    SELECT * FROM (VALUES
      ('customer_sites','current_supplier_contract_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_contract_end_date','pg_catalog.date'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_notice_period','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_termination_fee','pg_catalog.numeric'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_response_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_id','pg_catalog.uuid'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_unknown','pg_catalog.bool'::regtype::oid,true,'false'::text),
      ('supplier_switch_requests','current_supplier_contract_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_contract_end_date','pg_catalog.date'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_notice_period','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_termination_fee','pg_catalog.numeric'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_response_status','pg_catalog.text'::regtype::oid,false,NULL::text)
    ) AS wanted(table_name,column_name,type_oid,not_null,default_expression)
  LOOP
    SELECT a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attcollation,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression,t.typcollation AS expected_collation,
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND a.attnum=ANY(c.conkey)) AS has_column_constraint
    INTO actual
    FROM pg_attribute a JOIN pg_type t ON t.oid=expected.type_oid
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.'||expected.table_name) AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped;
    IF FOUND AND (actual.atttypid IS DISTINCT FROM expected.type_oid OR actual.atttypmod<>-1
      OR actual.attnotnull IS DISTINCT FROM expected.not_null
      OR actual.default_expression IS DISTINCT FROM expected.default_expression
      OR actual.attidentity<>'' OR actual.attgenerated<>''
      OR actual.attcollation IS DISTINCT FROM actual.expected_collation OR actual.has_column_constraint) THEN
      RAISE EXCEPTION 'manual_supplier_continuation_existing_shape_mismatch' USING ERRCODE='23514';
    END IF;
  END LOOP;

  ALTER TABLE public.customer_sites
    ADD COLUMN IF NOT EXISTS current_supplier_contract_status text,
    ADD COLUMN IF NOT EXISTS current_supplier_contract_end_date date,
    ADD COLUMN IF NOT EXISTS current_supplier_notice_period text,
    ADD COLUMN IF NOT EXISTS current_supplier_termination_fee numeric,
    ADD COLUMN IF NOT EXISTS current_supplier_response_status text;

  ALTER TABLE public.supplier_switch_requests
    ADD COLUMN IF NOT EXISTS current_supplier_id uuid,
    ADD COLUMN IF NOT EXISTS current_supplier_unknown boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS current_supplier_contract_status text,
    ADD COLUMN IF NOT EXISTS current_supplier_contract_end_date date,
    ADD COLUMN IF NOT EXISTS current_supplier_notice_period text,
    ADD COLUMN IF NOT EXISTS current_supplier_termination_fee numeric,
    ADD COLUMN IF NOT EXISTS current_supplier_response_status text;

  FOR expected IN
    SELECT * FROM (VALUES
      ('customer_sites','current_supplier_contract_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_contract_end_date','pg_catalog.date'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_notice_period','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_termination_fee','pg_catalog.numeric'::regtype::oid,false,NULL::text),
      ('customer_sites','current_supplier_response_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_id','pg_catalog.uuid'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_unknown','pg_catalog.bool'::regtype::oid,true,'false'::text),
      ('supplier_switch_requests','current_supplier_contract_status','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_contract_end_date','pg_catalog.date'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_notice_period','pg_catalog.text'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_termination_fee','pg_catalog.numeric'::regtype::oid,false,NULL::text),
      ('supplier_switch_requests','current_supplier_response_status','pg_catalog.text'::regtype::oid,false,NULL::text)
    ) AS wanted(table_name,column_name,type_oid,not_null,default_expression)
  LOOP
    SELECT a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attcollation,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression,t.typcollation AS expected_collation,
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND a.attnum=ANY(c.conkey)) AS has_column_constraint
    INTO actual
    FROM pg_attribute a JOIN pg_type t ON t.oid=expected.type_oid
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.'||expected.table_name) AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'manual_supplier_continuation_postcondition_missing' USING ERRCODE='23514';
    END IF;
    IF actual.atttypid IS DISTINCT FROM expected.type_oid OR actual.atttypmod<>-1
      OR actual.attnotnull IS DISTINCT FROM expected.not_null
      OR actual.default_expression IS DISTINCT FROM expected.default_expression
      OR actual.attidentity<>'' OR actual.attgenerated<>''
      OR actual.attcollation IS DISTINCT FROM actual.expected_collation OR actual.has_column_constraint THEN
      RAISE EXCEPTION 'manual_supplier_continuation_postcondition_shape' USING ERRCODE='23514';
    END IF;
  END LOOP;
END
$gridex_manual_supplier_continuation_columns$;
