-- gridex_negative_fixtures.read_v1 answers "is this persisted message a
-- registered negative TGT original?". NULL means no. An ordinary test
-- environment message that was never linked to a TGT run raised
-- "query returned no rows" from the STRICT run-link lookup instead, which
-- aborted every normal test-environment send before validation.
--
-- Only the run-link lookup changes: no link now returns NULL (not a fixture);
-- an ambiguous link still raises through the unchanged STRICT lookup.
-- The message lookup stays STRICT, and a linked message keeps every existing
-- run, actor, revision, wire and receiver check.
BEGIN;
DO $rewrite$DECLARE f record;
 needle CONSTANT text:=$n$  SELECT l.test_run_id,l.step_no INTO STRICT run_id,step FROM public.ediel_test_run_messages l JOIN public.ediel_test_runs x ON x.id=l.test_run_id AND x.company_id=m.company_id AND x.environment='test' WHERE l.ediel_message_id=m.id;
$n$;
 replacement CONSTANT text:=$n$  IF NOT EXISTS(SELECT FROM public.ediel_test_run_messages l JOIN public.ediel_test_runs x ON x.id=l.test_run_id AND x.company_id=m.company_id AND x.environment='test' WHERE l.ediel_message_id=m.id) THEN RETURN NULL;END IF;
  SELECT l.test_run_id,l.step_no INTO STRICT run_id,step FROM public.ediel_test_run_messages l JOIN public.ediel_test_runs x ON x.id=l.test_run_id AND x.company_id=m.company_id AND x.environment='test' WHERE l.ediel_message_id=m.id;
$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_negative_fixtures.read_v1(jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'negative_fixture_read_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'negative_fixture_read_metadata_changed';END IF;
END$rewrite$;
COMMIT;
