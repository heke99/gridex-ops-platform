-- One-use controller context is private pg_temp state in this cleanup transaction.
-- Every removed identity was independently captured after complete native input.
DO $fixed_restoration$
DECLARE envelope jsonb; item jsonb; fk record; child_test text; column_list text;
  affected bigint; current_row jsonb; parent_relation regclass; child_relation regclass;
BEGIN
  IF to_regclass('pg_temp.fixed_restoration_context') IS NULL
     OR to_regclass('pg_temp.fixed_restoration_reservation') IS NULL
     OR to_regclass('pg_temp.fixed_post_catalog') IS NULL
     OR to_regclass('pg_temp.fixed_post_rows') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_CONTROLLER_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
       'pg_temp.fixed_restoration_context'::regclass,'pg_temp.fixed_restoration_reservation'::regclass,
       'pg_temp.fixed_post_catalog'::regclass,'pg_temp.fixed_post_rows'::regclass)
       AND (relnamespace<>pg_my_temp_schema() OR relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
         OR relacl IS NOT NULL OR relpersistence<>'t'))
     OR (SELECT count(*) FROM pg_temp.fixed_restoration_context)<>1
     OR (SELECT count(*) FROM pg_temp.fixed_restoration_reservation)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_CONTEXT_CARDINALITY';
  END IF;
  SELECT value INTO STRICT envelope FROM pg_temp.fixed_restoration_context;
  IF envelope->>'database' IS DISTINCT FROM current_database()
     OR current_database()<>'gridex_auth_legacy_replay' OR current_user<>'postgres'
     OR inet_server_addr() IS NOT NULL OR inet_server_port() IS NOT NULL
     OR envelope->>'backend' IS DISTINCT FROM pg_backend_pid()::text
     OR envelope->>'transaction' IS DISTINCT FROM txid_current()::text
     OR envelope->>'stage' IS DISTINCT FROM 'F2_COMPLETE'
     OR envelope->>'owner' !~ '^gridex-auth-legacy-(fixed|continuation)-[0-9]+-[0-9]+$'
     OR envelope->>'reservation' !~ '^[0-9a-f]{32}$'
     OR jsonb_array_length(envelope->'hashes') IS DISTINCT FROM 6
     OR NOT EXISTS (SELECT 1 FROM pg_temp.fixed_restoration_reservation r
       WHERE r.owner=envelope->>'owner' AND r.reservation=envelope->>'reservation'
         AND r.hashes=envelope->'hashes' AND r.database_name=current_database()
         AND r.backend=pg_backend_pid() AND r.transaction_id=txid_current()
         AND r.stage='F2_COMPLETE' AND r.company=envelope->'company')
     OR envelope->'post_catalog' IS DISTINCT FROM (SELECT catalog FROM pg_temp.fixed_post_catalog)
     OR envelope->'post_rows' IS DISTINCT FROM (SELECT rows FROM pg_temp.fixed_post_rows) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_CONTEXT_MISMATCH';
  END IF;
  IF envelope->'company'->>'table' IS DISTINCT FROM 'public.companies'
     OR envelope->'company'->'before'->>'id' IS NULL
     OR envelope->'company'->'before'->>'id' IS DISTINCT FROM envelope->'company'->'after'->>'id'
     OR (SELECT count(*) FROM jsonb_array_elements(envelope->'restorations') x
         WHERE x->>'table'='public.companies')<>1
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(envelope->'restorations') x
                    WHERE x=envelope->'company') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_COMPANY_RESERVATION';
  END IF;
  -- Consume before the first write. A repeated X cannot regain this reservation.
  DELETE FROM pg_temp.fixed_restoration_context;
  DELETE FROM pg_temp.fixed_restoration_reservation;
  FOR item IN SELECT value FROM jsonb_array_elements(envelope->'deletions') LOOP
    IF item->>'table' NOT IN ('auth.users','public.companies','public.user_profiles',
      'public.roles','public.permissions','public.role_permissions','public.user_roles',
      'public.company_memberships','public.company_invitations','public.audit_logs') THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_DELETE_GRAPH';
    END IF;
    IF item->>'table'='public.companies'
       AND item->'row'->>'id'=envelope->'company'->'before'->>'id' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_ORIGINAL_COMPANY_DELETE';
    END IF;
    parent_relation := (item->>'table')::regclass;
    -- Explicitly prove no descendants remain. FK actions never perform reversal.
    FOR fk IN SELECT * FROM pg_constraint WHERE contype='f' AND confrelid=parent_relation LOOP
      child_relation := fk.conrelid;
      SELECT string_agg(format('c.%I IS NOT DISTINCT FROM p.%I',ca.attname,pa.attname),' AND ' ORDER BY x.ordinality)
        INTO child_test FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY x(child,parent,ordinality)
        JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=x.child
        JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=x.parent;
      EXECUTE format('SELECT count(*) FROM %s c CROSS JOIN jsonb_populate_record(NULL::%s,$1) p WHERE %s',
                     child_relation,parent_relation,child_test) INTO affected USING item->'row';
      IF affected<>0 THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_DESCENDANT_REMAINS';
      END IF;
    END LOOP;
    EXECUTE format('DELETE FROM %s t WHERE t.id=($1->>''id'')::uuid AND to_jsonb(t)=$1',parent_relation)
      USING item->'row';
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_CAPTURED_ROW_MISMATCH'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(envelope->'restorations') LOOP
    IF (item->>'table' NOT IN ('public.roles','public.permissions','public.role_permissions')
        AND NOT (item->>'table'='public.companies' AND item=envelope->'company'))
       OR item->'before'->>'id' IS DISTINCT FROM item->'after'->>'id' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_SEED_IDENTITY';
    END IF;
    parent_relation := (item->>'table')::regclass;
    SELECT string_agg(format('%I=p.%I',attname,attname),',' ORDER BY attnum) INTO column_list
      FROM pg_attribute WHERE attrelid=parent_relation AND attnum>0 AND NOT attisdropped
      AND attgenerated='' AND attidentity='' AND attname<>'id';
    EXECUTE format('UPDATE %s t SET %s FROM jsonb_populate_record(NULL::%s,$1) p WHERE t.id=p.id AND to_jsonb(t)=$2',
                   parent_relation,column_list,parent_relation) USING item->'before',item->'after';
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_SEED_PREIMAGE_MISMATCH'; END IF;
  END LOOP;
  IF envelope->'membership_check'->>'kind'<>'c'
     OR (envelope->'membership_check'->>'deferrable')::boolean
     OR (envelope->'membership_check'->>'deferred')::boolean
     OR NOT (envelope->'membership_check'->>'validated')::boolean THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_CHECK_ATTRIBUTES';
  END IF;
  ALTER TABLE public.company_memberships DROP CONSTRAINT company_memberships_role_check;
  EXECUTE 'ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_role_check '
    || (envelope->'membership_check'->>'definition');
END
$fixed_restoration$;
