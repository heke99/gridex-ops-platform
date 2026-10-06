-- Classify the three private external staff identity tables without changing
-- their authority. Parent invitations have a globally unique id and each child
-- has a validated (invitation_id,company_id) FK with company_id NOT NULL, so the
-- company-scoped unique key admits exactly the same rows, including NULL
-- invitation ids on explicitly enrolled bindings. The isolation gate stays intact.
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

DO $classify_staff_identity$
DECLARE
 v_table text;
 v_relation regclass;
 v_parent regclass := 'public.company_invitations'::regclass;
 v_parent_id smallint;
 v_parent_company smallint;
 v_invitation smallint;
 v_company smallint;
 v_unique record;
BEGIN
 SELECT attnum INTO STRICT v_parent_id FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='id' AND NOT attisdropped;
 SELECT attnum INTO STRICT v_parent_company FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='company_id' AND NOT attisdropped;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
  WHERE conrelid=v_parent AND contype='p' AND convalidated AND NOT condeferrable
   AND conkey=ARRAY[v_parent_id]::smallint[])
 THEN RAISE EXCEPTION 'staff_identity_classification_parent_mismatch'; END IF;

 FOREACH v_table IN ARRAY ARRAY['tenant_staff_actor_anchors','tenant_staff_identity_deliveries','tenant_staff_identity_bindings'] LOOP
  v_relation:=pg_catalog.to_regclass('public.'||v_table);
  IF v_relation IS NULL THEN RAISE EXCEPTION 'staff_identity_classification_table_missing: %',v_table; END IF;
  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',v_relation);
  SELECT attnum INTO STRICT v_invitation FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='invitation_id' AND atttypid='uuid'::regtype AND NOT attisdropped;
  SELECT attnum INTO v_company FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='company_id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped;
  IF v_company IS NULL OR NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
   WHERE conrelid=v_relation AND contype='f' AND convalidated AND NOT condeferrable
    AND conkey=ARRAY[v_invitation,v_company]::smallint[]
    AND confrelid=v_parent AND confkey=ARRAY[v_parent_id,v_parent_company]::smallint[])
  THEN RAISE EXCEPTION 'staff_identity_classification_company_fk_mismatch: %',v_table; END IF;
  SELECT c.*,i.indisunique,i.indisvalid,i.indnullsnotdistinct INTO v_unique
  FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
  WHERE c.conrelid=v_relation AND c.conname=v_table||'_invitation_id_key' AND c.contype='u'
   AND c.convalidated AND NOT c.condeferrable;
  IF NOT FOUND OR v_unique.conkey NOT IN(ARRAY[v_invitation]::smallint[],ARRAY[v_invitation,v_company]::smallint[])
   OR NOT v_unique.indisunique OR NOT v_unique.indisvalid OR v_unique.indnullsnotdistinct
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_mismatch: %',v_table; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_constraint WHERE contype='f' AND conindid=v_unique.conindid)
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_dependency: %',v_table; END IF;
  IF v_unique.conkey=ARRAY[v_invitation]::smallint[] THEN
   -- No CASCADE: unexpected dependent objects must stop this atomic forward.
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I UNIQUE(invitation_id,company_id)',
    v_relation,v_unique.conname,v_unique.conname);
  END IF;
 END LOOP;

 INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
 VALUES
  ('tenant_staff_actor_anchors','tenant','Company-owned no-login central staff actor anchors, bound to an invitation and protected by private RLS and canonical authority.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_deliveries','tenant','Company-owned staff invitation delivery intents and verified receipts, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_bindings','tenant','Company-owned explicit tenant Auth to central staff actor bindings, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables')
 ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now()
 WHERE (platform_table_classification.kind,platform_table_classification.rationale,platform_table_classification.null_company_meaning,platform_table_classification.classified_by)
  IS DISTINCT FROM (EXCLUDED.kind,EXCLUDED.rationale,EXCLUDED.null_company_meaning,EXCLUDED.classified_by);
END $classify_staff_identity$;
