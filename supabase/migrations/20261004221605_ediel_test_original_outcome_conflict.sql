-- A protected original cannot simultaneously qualify as positive and negative
-- in the same company/run/step/revision/wire-hash scope. Keep every declaration
-- and historical byte intact; refuse contradictory legacy qualification too.
-- Replace only nine existing private bodies, retaining all pg_proc metadata.
-- Publishers require a fresh statement snapshot after the shared lock. PostgreSQL
-- READ UNCOMMITTED has READ COMMITTED semantics; stale higher-isolation snapshots
-- cannot safely inspect declarations in the opposite original table.
BEGIN;
DO $fix$
DECLARE target record;f record;needle text;guard text;body text;n integer:=0;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('publish_v1(jsonb,bytea,text)','positive_originals','negative','publisher'),
  ('publish_positive_v1(jsonb,bytea,text)','originals','positive','publisher'),
  ('read_v1(jsonb)','positive_originals','negative','reader'),
  ('read_positive_v1(jsonb)','originals','positive','reader'),
  ('read_negative_preparation_v1(jsonb)','positive_originals','negative','reader'),
  ('consume_positive_v1()','originals','positive','original'),
  ('consume_negative_v1()','positive_originals','negative','original'),
  ('require_positive_message_v1(uuid,uuid,text)','originals','positive','original'),
  ('require_negative_message_v1(uuid,uuid,text)','positive_originals','negative','original')
 ) targets(signature,opposite,outcome,boundary)
 LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
   FROM pg_proc p WHERE p.oid=('gridex_negative_fixtures.'||target.signature)::regprocedure;
  IF target.boundary='publisher' THEN
   needle:=$anchor$ PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text||'|'||(p_context->>'stepNo')||'|'||hash,0));$anchor$;
   guard:=format($body$
 IF EXISTS(SELECT FROM gridex_negative_fixtures.%I opposite WHERE opposite.company_id=r.company_id AND opposite.run_id=r.id
  AND opposite.step_no=(p_context->>'stepNo')::integer AND opposite.revision=r.approval_version AND opposite.wire_sha256=hash)
 THEN RAISE EXCEPTION %L;END IF;$body$,target.opposite,'ediel_'||target.outcome||'_fixture_original_conflict');
  ELSE
   IF target.boundary='reader' THEN
    needle:=' IF NOT FOUND THEN RETURN NULL;END IF;';
   ELSE
    needle:=format(' SELECT * INTO STRICT f FROM gridex_negative_fixtures.%I WHERE id=w.registration_id FOR SHARE;',
     CASE WHEN target.outcome='positive' THEN 'positive_originals' ELSE 'originals' END);
   END IF;
   guard:=format($body$
 IF EXISTS(SELECT FROM gridex_negative_fixtures.%I opposite WHERE opposite.company_id=f.company_id AND opposite.run_id=f.run_id
  AND opposite.step_no=f.step_no AND opposite.revision=f.revision AND opposite.wire_sha256=f.wire_sha256)
 THEN RAISE EXCEPTION %L;END IF;$body$,target.opposite,'ediel_'||target.outcome||'_fixture_original_conflict');
  END IF;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
   THEN RAISE EXCEPTION 'test_original_outcome_conflict_predecessor_required: %',target.signature;END IF;
  body:=replace(f.prosrc,needle,
   CASE WHEN target.boundary='publisher' THEN $isolation$
 IF current_setting('transaction_isolation') NOT IN('read committed','read uncommitted')
 THEN RAISE EXCEPTION 'ediel_fixture_publisher_read_committed_required' USING ERRCODE='25000';END IF;
$isolation$ ELSE '' END||needle||guard);
  EXECUTE replace(f.definition,f.prosrc,body);
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata
   THEN RAISE EXCEPTION 'test_original_outcome_conflict_metadata_changed: %',target.signature;END IF;
  n:=n+1;
 END LOOP;
 IF n<>9 THEN RAISE EXCEPTION 'test_original_outcome_conflict_predecessor_required';END IF;
END$fix$;
COMMIT;
