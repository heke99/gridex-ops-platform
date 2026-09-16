-- Offline-only forward boundary Q. Actual CLI2.101.0 skeleton, artifact10155731061.
-- Requires one owner-run A/B/C/D/E/F/H/I transaction; never a live migration.
-- No transaction control: the executor commits only after separate assertions.
DO $legacy$
DECLARE columns_sql text; r record; col smallint; parent smallint; fk text;
BEGIN
 IF to_regclass('pg_temp.legacy_context') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='I')<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED';
 END IF;
 -- Restore every preexisting role field, including NULL/false and timestamps.
 -- No trigger is disabled; an unexpected role UPDATE trigger fails admission.
 SELECT string_agg(format('%I = restored.%I',name,name),', ' ORDER BY ordinal)
 INTO columns_sql FROM pg_temp.legacy_context c,
 unnest(c.role_columns) WITH ORDINALITY names(name,ordinal) WHERE name<>'id';
 EXECUTE 'UPDATE public.roles actual SET '||columns_sql||
 ' FROM pg_temp.legacy_role_rows saved CROSS JOIN LATERAL jsonb_populate_record(NULL::public.roles,saved.row_value) restored WHERE actual.id=saved.id';
 IF NOT (SELECT 'is_system'=ANY(role_columns) FROM pg_temp.legacy_context) THEN
  UPDATE public.roles SET is_system=false WHERE id IN (SELECT id FROM pg_temp.legacy_role_rows);
 END IF;
 -- Selected6 flexible action authority; no lossy hardfix normalization DML.
 ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_last_auth_email_action_check;
 ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_last_auth_email_action_check
  CHECK (last_auth_email_action IS NULL OR (length(last_auth_email_action)<=120 AND last_auth_email_action ~ '^[a-z0-9_:.]+$'));
 -- Exact canonical durable-delivery vocabulary, source20260810193450:60-68.
 ALTER TABLE public.company_invitations DROP CONSTRAINT IF EXISTS company_invitations_status_check;
 ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_status_check
  CHECK (status IN ('pending','sending','sent','delivery_uncertain','accepted','revoked','expired','invitation_revoked','invited','failed'));
 -- Restore validated first43 event CHECKs, including authoritative absence.
 ALTER TABLE public.auth_email_events DROP CONSTRAINT IF EXISTS auth_email_events_event_type_check;
 ALTER TABLE public.auth_email_events DROP CONSTRAINT IF EXISTS auth_email_events_action_check;
 ALTER TABLE public.auth_email_events DROP CONSTRAINT IF EXISTS auth_email_events_status_check;
 FOR r IN SELECT name,definition FROM pg_temp.legacy_event_checks ORDER BY name LOOP
  EXECUTE format('ALTER TABLE public.auth_email_events ADD CONSTRAINT %I %s',r.name,r.definition);
 END LOOP;
 -- Exact independently reviewed profile and actor FK reconstructions.
 FOR r IN SELECT * FROM (VALUES
 ('user_profiles','active_company_id','public.companies'),
 ('company_memberships','disabled_by','auth.users'),
 ('company_memberships','removed_by','auth.users'),
 ('company_invitations','invited_by','auth.users'),
 ('company_invitations','invited_user_id','auth.users')) x(tbl,column_name,parent_name) LOOP
  SELECT attnum INTO STRICT col FROM pg_attribute WHERE attrelid=format('public.%I',r.tbl)::regclass AND attname=r.column_name AND NOT attisdropped;
  SELECT attnum INTO STRICT parent FROM pg_attribute WHERE attrelid=r.parent_name::regclass AND attname='id' AND NOT attisdropped;
  fk := r.tbl||'_'||r.column_name||'_fkey';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=format('public.%I',r.tbl)::regclass AND conname=fk) THEN
   IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=format('public.%I',r.tbl)::regclass AND conname=fk
    AND contype='f' AND conkey=ARRAY[col] AND confkey=ARRAY[parent] AND confrelid=r.parent_name::regclass
    AND confdeltype='n' AND confupdtype='a' AND confmatchtype='s' AND convalidated AND NOT condeferrable AND NOT condeferred) THEN
     RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH';
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE SET NULL',r.tbl,fk,r.column_name,r.parent_name);
  END IF;
 END LOOP;
 UPDATE pg_temp.legacy_context SET stage='Q' WHERE txid=txid_current();
END $legacy$;
