BEGIN;
-- Nondestructive disclosure cutoff for an actually completed metadata scope.
-- W is the immutable signed admission copied to that scope's tombstone.
-- No retention period, physical disposition, replay or historical row changes.
CREATE FUNCTION gridex_ediel_retention.require_completed_review_witness_disclosure_v1(
 c uuid, actor uuid, policy uuid, requested_class text, include_body boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $disclosure$
DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;
 t gridex_ediel_retention.decision_evidence_tombstones%rowtype;
 r gridex_ediel_retention.decision_evidence_reviews%rowtype;b jsonb;
BEGIN
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies
 WHERE id=policy AND company_id=c FOR SHARE;
 IF d.retention_class<>'completed_decision_review_reason' THEN RETURN;END IF;
 IF requested_class NOT IN('completed_decision_review_reason','decision_evidence_policy_original_bytes')
 THEN RAISE EXCEPTION 'completed_review_witness_disclosure_namespace_required' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones
 WHERE retention_class=d.retention_class AND target_id=d.target_id AND company_id=c FOR SHARE;
 -- An uncompleted intake has no qualified historical W. Keep its existing
 -- review path; an untrusted caller payload never supplies a deadline here.
 IF NOT FOUND THEN RETURN;END IF;
 IF t.policy_id IS DISTINCT FROM d.id OR t.source_hash IS DISTINCT FROM d.source_hash
 OR t.target_metadata_hash IS DISTINCT FROM d.target_metadata_hash
 OR isfinite(t.journal_retain_until) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'completed_review_witness_disclosure_scope_required' USING ERRCODE='42501';END IF;
 -- Lock the actual selected review/source policy/completion graph. This
 -- reuses its exact source-derived metadata hash, not a caller closure flag.
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,d.target_id);
 IF b->>'targetMetadataHash' IS DISTINCT FROM t.target_metadata_hash
 THEN RAISE EXCEPTION 'completed_review_witness_disclosure_scope_required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM gridex_ediel_retention.decision_evidence_reviews
 WHERE id=t.review_id AND policy_id=d.id FOR SHARE;
 IF NOT FOUND OR r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by
 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_revocations
 WHERE policy_id=d.id AND actor_user_id=t.actor_user_id)
 THEN RAISE EXCEPTION 'completed_review_witness_disclosure_completion_required' USING ERRCODE='42501';END IF;
 -- These are the requesting namespace's current READ/body permissions.
 -- Historical reviewer authority is not reissued by a historical disclosure.
 PERFORM gridex_ediel_retention.decision_evidence_read_actor_v1(c,actor,requested_class);
 IF include_body THEN PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,requested_class,'ediel.retention.review');END IF;
 -- All potentially blocking graph/auth locks precede this decision instant.
 IF clock_timestamp()>=t.journal_retain_until
 THEN RAISE EXCEPTION 'completed_review_witness_disclosure_ended' USING ERRCODE='42501';END IF;
END $disclosure$;
ALTER FUNCTION gridex_ediel_retention.require_completed_review_witness_disclosure_v1(uuid,uuid,uuid,text,boolean) OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.require_completed_review_witness_disclosure_v1(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $forward$
DECLARE spec jsonb;change jsonb;f record;after_row jsonb;body text;before_metadata jsonb;
 specs constant jsonb := $specs$[{"name":"public.ediel_read_decision_evidence_policy_v1","before":"2acb3c1d940f1a200b829917e14deff42c7acf8f355e8e221401de11f7fff1d3","after":"289988176a5b14a5bbc23445e518b32def1edce2b85300733d841c54cf6724cc","changes":[{"old":" bytes_length:=coalesce(octet_length(d.document_bytes),d.document_byte_length);","new":" bytes_length:=coalesce(octet_length(d.document_bytes),d.document_byte_length);\n PERFORM gridex_ediel_retention.require_completed_review_witness_disclosure_v1(p_company_id,p_actor_user_id,d.id,d.retention_class,p_include_document);","count":1}]},{"name":"public.ediel_read_retention_decision_original_v1","before":"0820d4c12535393a32db6b898b9d3b607e25b0ea0e445ff09a491d9e8d4bb0a5","after":"2a61722dde35012bbda239c68efe9bebf2a2be7b2ebb591e6bbd702786ac5132","changes":[{"old":" IF b IS NULL AND (t.target_id IS NULL OR r->>'document_hash' IS DISTINCT FROM t.source_hash) OR b IS NOT NULL AND encode(sha256(b),'hex') IS DISTINCT FROM r->>'document_hash' THEN RAISE EXCEPTION 'decision_evidence_original_custody_mismatch';END IF;","new":" IF b IS NULL AND (t.target_id IS NULL OR r->>'document_hash' IS DISTINCT FROM t.source_hash) OR b IS NOT NULL AND encode(sha256(b),'hex') IS DISTINCT FROM r->>'document_hash' THEN RAISE EXCEPTION 'decision_evidence_original_custody_mismatch';END IF;\n IF p_retention_class='decision_evidence_policy_original_bytes' THEN PERFORM gridex_ediel_retention.require_completed_review_witness_disclosure_v1(p_company_id,p_actor_user_id,p_target_id,p_retention_class,p_include_document);END IF;","count":1}]}]$specs$::jsonb;
BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements(specs) LOOP
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=split_part(spec->>'name','.',1) AND p.proname=split_part(spec->>'name','.',2);
  IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec->>'before' THEN RAISE EXCEPTION 'completed_review_witness_predecessor_changed:%',spec->>'name';END IF;
  body:=f.prosrc;before_metadata:=f.metadata;
  FOR change IN SELECT value FROM jsonb_array_elements(spec->'changes') LOOP
   IF (length(body)-length(replace(body,change->>'old','')))/length(change->>'old')<>(change->>'count')::int THEN RAISE EXCEPTION 'completed_review_witness_anchor_changed:%',spec->>'name';END IF;
   body:=replace(body,change->>'old',change->>'new');
  END LOOP;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM spec->>'after' THEN RAISE EXCEPTION 'completed_review_witness_output_changed:%',spec->>'name';END IF;
  EXECUTE replace(f.definition,f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO STRICT after_row FROM pg_proc p WHERE p.oid=f.oid;
  IF after_row IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'completed_review_witness_function_metadata_changed:%',spec->>'name';END IF;
 END LOOP;
END $forward$;

COMMIT;
