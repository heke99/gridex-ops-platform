-- Preserve the closed status vocabulary while admitting the two existing Z01
-- producer results omitted by the 17-status bootstrap. Historical 19/24-status
-- checks already admit them and must remain byte- and OID-identical.
DO $z01_status_compatibility$
DECLARE
  relation_id pg_catalog.oid := pg_catalog.to_regclass('public.customer_info_requests');
  status_column pg_catalog.record;
  status_check pg_catalog.record;
  expression pg_catalog.text;
  original_search_path pg_catalog.text;
  observed_statuses pg_catalog.text[];
  literal_count pg_catalog.int4;
  distinct_count pg_catalog.int4;
  baseline pg_catalog.text[] := ARRAY[
    'draft','missing_authorization','ready_to_send','sent_to_grid_owner',
    'waiting_for_contrl','waiting_for_aperak','waiting_for_z02','z02_received',
    'negative_aperak','manual_review_required','missing_binding_info',
    'missing_termination_info','ready_for_switch','cancelled','rejected',
    'completed','blocked'];
  compatible pg_catalog.text[];
  historical pg_catalog.text[];
  constraint_comment pg_catalog.text;
BEGIN
  -- Recognition, comparisons and construction must all use catalog types and
  -- operators. A failed DO statement rolls back this transaction-local setting.
  original_search_path := pg_catalog.current_setting('search_path');
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  IF relation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation_id AND relkind='r' AND NOT relispartition
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_id OR inhparent=relation_id
  ) THEN
    RAISE EXCEPTION 'customer_info_requests_status_compatibility_unrecognized';
  END IF;
  LOCK TABLE public.customer_info_requests IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO status_column FROM pg_catalog.pg_attribute
    WHERE attrelid=relation_id AND attname='status' AND attnum>0 AND NOT attisdropped;
  SELECT * INTO status_check FROM pg_catalog.pg_constraint
    WHERE conrelid=relation_id AND conname='customer_info_requests_status_check';
  IF status_column.attnum IS NULL OR status_check.oid IS NULL
    OR status_column.atttypid<>'pg_catalog.text'::pg_catalog.regtype
    OR status_column.atttypmod<>-1 OR status_column.attndims<>0 OR NOT status_column.attnotnull
    OR NOT status_column.attislocal OR status_column.attinhcount<>0
    OR status_column.attcollation IS DISTINCT FROM (
      SELECT typcollation FROM pg_catalog.pg_type WHERE oid='pg_catalog.text'::pg_catalog.regtype)
    OR status_column.attgenerated<>'' OR status_column.attidentity<>''
    OR status_check.contype<>'c' OR status_check.conkey IS DISTINCT FROM ARRAY[status_column.attnum]::smallint[]
    OR NOT status_check.convalidated OR NOT status_check.conislocal
    OR status_check.coninhcount<>0 OR status_check.conparentid<>0 OR status_check.connoinherit
    OR status_check.condeferrable OR status_check.condeferred
    OR status_check.contypid<>0 OR status_check.conindid<>0 OR status_check.confrelid<>0
  THEN
    RAISE EXCEPTION 'customer_info_requests_status_compatibility_unrecognized';
  END IF;

  -- Deparse with only catalog operators visible: a custom text-equality
  -- operator must remain qualified and cannot impersonate the bare '=' shape.
  expression := pg_catalog.pg_get_expr(status_check.conbin,relation_id,false);
  -- Whole-expression recognition prevents an additional predicate, coercion,
  -- operator or NULL branch from being discarded by literal extraction.
  IF expression IS NULL OR expression !~
    $shape$^\(status = ANY \(ARRAY\[('[a-z0-9_]+'::text)(, '[a-z0-9_]+'::text)*\]\)\)$$shape$
  THEN
    RAISE EXCEPTION 'customer_info_requests_status_compatibility_unrecognized';
  END IF;
  SELECT array_agg(value[1] ORDER BY value[1]),count(*),count(DISTINCT value[1])
    INTO observed_statuses,literal_count,distinct_count
    FROM pg_catalog.regexp_matches(expression,$literal$'([a-z0-9_]+)'::text$literal$,'g') value;
  IF literal_count<>distinct_count THEN
    RAISE EXCEPTION 'customer_info_requests_status_compatibility_unrecognized';
  END IF;
  SELECT array_agg(value ORDER BY value) INTO compatible
    FROM pg_catalog.unnest(baseline||ARRAY['z01_prepared','route_missing']) value;
  SELECT array_agg(value ORDER BY value) INTO historical
    FROM pg_catalog.unnest(compatible||ARRAY['sent','waiting_response','received','partially_received','failed']) value;
  SELECT array_agg(value ORDER BY value) INTO baseline FROM pg_catalog.unnest(baseline) value;
  IF observed_statuses=compatible OR observed_statuses=historical THEN
    PERFORM pg_catalog.set_config('search_path',original_search_path,true);
    RETURN;
  END IF;
  IF observed_statuses IS DISTINCT FROM baseline THEN
    RAISE EXCEPTION 'customer_info_requests_status_compatibility_unrecognized';
  END IF;

  constraint_comment := pg_catalog.obj_description(status_check.oid,'pg_constraint');
  ALTER TABLE public.customer_info_requests DROP CONSTRAINT customer_info_requests_status_check;
  ALTER TABLE public.customer_info_requests ADD CONSTRAINT customer_info_requests_status_check
    CHECK (status OPERATOR(pg_catalog.=) ANY (ARRAY[
      'draft','missing_authorization','ready_to_send','z01_prepared','route_missing',
      'sent_to_grid_owner','waiting_for_contrl','waiting_for_aperak','waiting_for_z02',
      'z02_received','negative_aperak','manual_review_required','missing_binding_info',
      'missing_termination_info','ready_for_switch','cancelled','rejected','completed','blocked']::pg_catalog.text[]));
  IF constraint_comment IS NOT NULL THEN
    EXECUTE pg_catalog.format('COMMENT ON CONSTRAINT customer_info_requests_status_check ON public.customer_info_requests IS %L',constraint_comment);
  END IF;
  PERFORM pg_catalog.set_config('search_path',original_search_path,true);
END
$z01_status_compatibility$;
