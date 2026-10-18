-- One text field only. Existing original-byte policies never authorise it.
-- Times and retained witness purpose/fields must be explicit signed facts.
BEGIN;
DO $owner$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 THEN RAISE EXCEPTION 'completed_review_reason_private_owner_required';END IF;
END $owner$;

-- A closed narrative has no active-source receipt/revocation target. Do not
-- invent byte-source dispatch metadata. The original classes stay NOT NULL.
ALTER TABLE gridex_ediel_retention.decision_evidence_catalog
 ALTER COLUMN revocation_table DROP NOT NULL,
 ALTER COLUMN revocation_id_column DROP NOT NULL,
 ALTER COLUMN receipt_function DROP NOT NULL;
ALTER TABLE gridex_ediel_retention.decision_evidence_catalog ADD CONSTRAINT completed_review_reason_dispatch CHECK (
 (retention_class='completed_decision_review_reason' AND source_table='decision_evidence_reviews'
  AND permission_key='ediel.retention.completed_review_reason'
  AND revocation_table IS NULL AND revocation_id_column IS NULL AND receipt_function IS NULL)
 OR (retention_class<>'completed_decision_review_reason' AND revocation_table IS NOT NULL
  AND revocation_id_column IS NOT NULL AND receipt_function IS NOT NULL));
INSERT INTO gridex_ediel_retention.decision_evidence_catalog(retention_class,source_table,permission_key,revocation_table,revocation_id_column,receipt_function)
VALUES('completed_decision_review_reason','decision_evidence_reviews','ediel.retention.completed_review_reason',NULL,NULL,NULL);
INSERT INTO public.permissions(key,name,category,description,is_active)
VALUES('ediel.retention.completed_review_reason','Completed retention review narrative','ediel','Separate signed completed-review reason retirement; no default grant, period or original-byte authority',true);

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_scope_v1(c uuid,target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $scope$
DECLARE r gridex_ediel_retention.decision_evidence_reviews%rowtype;
 q gridex_ediel_retention.decision_evidence_policies%rowtype;
 t gridex_ediel_retention.decision_evidence_tombstones%rowtype;h text;
BEGIN
 SELECT x.* INTO STRICT r FROM gridex_ediel_retention.decision_evidence_reviews x
 JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=x.policy_id
 WHERE x.id=target AND p.company_id=c FOR UPDATE OF x;
 SELECT * INTO STRICT q FROM gridex_ediel_retention.decision_evidence_policies WHERE id=r.policy_id AND company_id=c FOR UPDATE;
 SELECT * INTO STRICT t FROM gridex_ediel_retention.decision_evidence_tombstones
 WHERE policy_id=q.id AND company_id=c AND retention_class=q.retention_class AND target_id=q.target_id FOR SHARE;
 -- Completed immutable receipt, not expired issuer competence or caller closure.
 h:=encode(sha256(convert_to(jsonb_build_object('review',to_jsonb(r)-'reason',
  'policy',to_jsonb(q)-ARRAY['document_bytes','document_byte_length','document_purged_at'],
  'completion',to_jsonb(t))::text,'UTF8')),'hex');
 RETURN jsonb_build_object('retentionClass','completed_decision_review_reason','targetId',r.id,
  'sourceHash',encode(sha256(convert_to(r.reason,'UTF8')),'hex'),'targetMetadataHash',h,
  'byteLength',octet_length(convert_to(r.reason,'UTF8')),'minimumRetainUntil',t.journal_retain_until,
  'sourcePolicyId',q.id);
END $scope$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_basis_v1(c uuid,target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $basis$
DECLARE b jsonb;BEGIN
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);
 IF EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_tombstones
  WHERE retention_class='completed_decision_review_reason' AND target_id=target AND company_id=c)
 THEN RAISE EXCEPTION 'decision_evidence_actual_original_bytes_required';END IF;
 RETURN b;
END $basis$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_terms_v1(d gridex_ediel_retention.decision_evidence_policies,p jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $terms$
DECLARE floor_at timestamptz;BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p) k WHERE k NOT IN(
  'format','operation','companyId','retentionClass','targetId','sourceHash','targetMetadataHash','documentHash',
  'issuerLegalReference','legalBasisReference','journalPurposeReference','issuedAt','expiresAt','retainUntil','journalRetainUntil','witnessFields'))
 OR p->'witnessFields' IS DISTINCT FROM '["review.id","review.policy_id","review.actor_user_id","review.outcome","review.created_at","policy_evidence","retirement_review","retirement_revocation","retirement_tombstone","retirement_audit"]'::jsonb THEN RETURN false;END IF;
 SELECT t.journal_retain_until INTO floor_at FROM gridex_ediel_retention.decision_evidence_reviews r
 JOIN gridex_ediel_retention.decision_evidence_policies q ON q.id=r.policy_id AND q.company_id=d.company_id
 JOIN gridex_ediel_retention.decision_evidence_tombstones t ON t.policy_id=q.id AND t.company_id=q.company_id
  AND t.retention_class=q.retention_class AND t.target_id=q.target_id
 WHERE r.id=d.target_id;
 -- Existing journal end is only a floor. A new signed metadata purpose and
 -- finite journal end separately cover the deliberately retained witnesses.
 RETURN floor_at IS NOT NULL AND (p->>'retainUntil')::timestamptz>=floor_at;
END $terms$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_transition_v1(o jsonb,n jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $transition$
DECLARE c uuid;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;b jsonb;BEGIN
 SELECT company_id INTO c FROM gridex_ediel_retention.decision_evidence_policies WHERE id=(o->>'policy_id')::uuid;
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class='completed_decision_review_reason'
  AND target_id=(o->>'id')::uuid AND company_id=c;
 IF t.target_id IS NULL OR NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=t.policy_id AND actor_user_id=t.actor_user_id)
 OR n->>'reason' IS DISTINCT FROM '[Retired retention review reason]'
 OR o-'reason' IS DISTINCT FROM n-'reason' OR encode(sha256(convert_to(o->>'reason','UTF8')),'hex') IS DISTINCT FROM t.source_hash
 THEN RETURN false;END IF;
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,t.target_id);
 RETURN b->>'targetMetadataHash'=t.target_metadata_hash AND (b->>'byteLength')::bigint=t.byte_length;
END $transition$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
BEGIN
 IF TG_OP='UPDATE' AND gridex_ediel_retention.completed_review_reason_transition_v1(to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'received_source_evidence_is_append_only' USING ERRCODE='23514';
END $guard$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_read_v1(c uuid,target uuid,include_body boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $read$
DECLARE b jsonb;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;body text;BEGIN
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class='completed_decision_review_reason' AND target_id=target AND company_id=c;
 IF t.target_id IS NOT NULL AND b->>'targetMetadataHash' IS DISTINCT FROM t.target_metadata_hash THEN RAISE EXCEPTION 'completed_review_reason_retained_scope_changed';END IF;
 IF include_body AND t.target_id IS NULL THEN SELECT reason INTO STRICT body FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=target;END IF;
 RETURN jsonb_build_object('companyId',c,'retentionClass','completed_decision_review_reason','targetId',target,
  'documentHash',coalesce(t.source_hash,b->>'sourceHash'),'targetMetadataHash',coalesce(t.target_metadata_hash,b->>'targetMetadataHash'),
  'documentByteLength',coalesce(t.byte_length,(b->>'byteLength')::bigint),'bytesAvailable',t.target_id IS NULL,
  'documentBase64',CASE WHEN body IS NOT NULL THEN replace(encode(convert_to(body,'UTF8'),'base64'),E'\n','') ELSE NULL END,
  'purgedAt',t.created_at,'minimumRetainUntil',b->>'minimumRetainUntil','authority','none');
END $read$;

CREATE FUNCTION gridex_ediel_retention.completed_review_reason_retire_v1(d gridex_ediel_retention.decision_evidence_policies,r gridex_ediel_retention.decision_evidence_reviews,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $retire$
DECLARE b jsonb;p jsonb;at timestamptz;BEGIN
 b:=gridex_ediel_retention.completed_review_reason_basis_v1(d.company_id,d.target_id);
 IF b->>'sourceHash' IS DISTINCT FROM d.source_hash OR b->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RAISE EXCEPTION 'completed_review_reason_source_changed';END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(d.company_id,actor,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(d.company_id,r.actor_user_id,d.retention_class);
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(d.company_id,actor,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(d.company_id,r.actor_user_id,d.retention_class);
 at:=clock_timestamp();
 IF p IS NULL OR (p->>'retainUntil')::timestamptz>at OR (p->>'expiresAt')::timestamptz<=at OR (p->>'journalRetainUntil')::timestamptz<=at
 THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['current_separate_metadata_purpose_deadline_and_witness_authority']);END IF;
 -- Consume this separate metadata policy before changing the selected text.
 INSERT INTO gridex_ediel_retention.decision_evidence_revocations(policy_id,actor_user_id,reason)
 VALUES(d.id,actor,'Consumed completed-review reason retirement policy');
 INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference,created_at)
 VALUES(d.retention_class,d.target_id,d.company_id,d.id,r.id,d.source_hash,d.target_metadata_hash,(b->>'byteLength')::bigint,actor,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference',at);
 UPDATE gridex_ediel_retention.decision_evidence_reviews SET reason='[Retired retention review reason]' WHERE id=d.target_id;
 -- No OLD/NEW body, reason, source snapshot or receipt payload is copied.
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata)
 VALUES(actor,d.company_id,'retention_review',d.target_id,'ediel.retention.completed_review_reason_retired',
  jsonb_build_object('policyId',d.id,'reviewId',r.id,'retentionClass',d.retention_class,'sourceHash',d.source_hash,
   'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference'));
 RETURN jsonb_build_object('status','purged','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,
  'byteLength',(b->>'byteLength')::bigint,'bytesAvailable',false,'authority','none','replay',false);
END $retire$;

DO $forward$
DECLARE spec jsonb;change jsonb;f record;after_row jsonb;before_metadata jsonb;body text;definition text;
 specs constant jsonb := $specs$[{"name":"gridex_ediel_retention.decision_evidence_basis_v1","before":"b27a0cc7d77cb6cea3700d0619105c5213edca8d73d5a10d5e6fc8d16bbde810","after":"eb995e271494fb03120c14de66ff7fbd6ec879051352a277b9b1eebe16f471ef","changes":[{"old":"BEGIN\n IF k IN(","new":"BEGIN\n IF k='completed_decision_review_reason' THEN RETURN gridex_ediel_retention.completed_review_reason_basis_v1(c,target);END IF;\n IF k IN(","count":1}]},{"name":"gridex_ediel_retention.decision_evidence_receipt_v1","before":"95bbeff82a26871c6fc3dee7f3ebca264eb9901624cea1917b385cf3a623c78a","after":"74cfc4fe0c4b35b1638764be4168c1d992da179cc915ab2a6b6dfa768f3e977a","changes":[{"old":"p->>'format' IS DISTINCT FROM 'ediel_retention_decision_original_policy_v1' OR p->>'operation' IS DISTINCT FROM 'erase_retention_decision_original_bytes'","new":"p->>'format' IS DISTINCT FROM (CASE WHEN d.retention_class='completed_decision_review_reason' THEN 'ediel_retention_completed_review_reason_policy_v1' ELSE 'ediel_retention_decision_original_policy_v1' END) OR p->>'operation' IS DISTINCT FROM (CASE WHEN d.retention_class='completed_decision_review_reason' THEN 'retire_completed_decision_review_reason' ELSE 'erase_retention_decision_original_bytes' END)","count":1},{"old":" RETURN p;","new":" IF d.retention_class='completed_decision_review_reason' AND gridex_ediel_retention.completed_review_reason_terms_v1(d,p) IS NOT TRUE THEN RETURN NULL;END IF;\n RETURN p;","count":1}]},{"name":"gridex_ediel_retention.permission_v1","before":"32c79a9f30939ab51637d1fbd3ca524766836ec6df5d2371d20e051d2601a51b","after":"6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7","changes":[{"old":"'ediel.retention.finance_decision_evidence'];","new":"'ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason'];","count":1}]},{"name":"public.ediel_current_retention_session_v1","before":"95d319ab1e1d5108167728504fff37e5dd0eb9e60e0945cd7fdf02e714ab539b","after":"4155e906777e697b2a43939e2fc002c3a17756915fdb353858c47d251208d773","changes":[{"old":"'ediel.retention.finance_decision_evidence']","new":"'ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason']","count":2}]},{"name":"public.ediel_purge_decision_evidence_retention_v1","before":"0b7a7d55661cb330e1f4ea78e2017698dc57215a894a2ae46b3f476b92ab9caf","after":"30ae0d48b6adefe9cb4eacb5253b8b38b0fa7f29faacb7d417777d0820872e12","changes":[{"old":" -- Invalidate the consumed original policy before physical byte removal. Its","new":" IF d.retention_class='completed_decision_review_reason' THEN RETURN gridex_ediel_retention.completed_review_reason_retire_v1(d,r,p_actor_user_id);END IF;\n -- Invalidate the consumed original policy before physical byte removal. Its","count":1}]},{"name":"public.ediel_read_retention_decision_original_v1","before":"ac905921caba6935453d55840a52c261945545ad9839fa96e901c7a172625748","after":"0820d4c12535393a32db6b898b9d3b607e25b0ea0e445ff09a491d9e8d4bb0a5","changes":[{"old":" IF p_retention_class IN('life_event_classification_source_original_bytes'","new":" IF p_retention_class='completed_decision_review_reason' THEN\n  r:=gridex_ediel_retention.completed_review_reason_read_v1(p_company_id,p_target_id,p_include_document);\n  PERFORM gridex_ediel_retention.decision_evidence_read_actor_v1(p_company_id,p_actor_user_id,p_retention_class);IF p_include_document THEN PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,p_retention_class,'ediel.retention.review');END IF;\n  RETURN r;\n END IF;\n IF p_retention_class IN('life_event_classification_source_original_bytes'","count":1}]}]$specs$::jsonb;
BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements(specs) LOOP
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=split_part(spec->>'name','.',1) AND p.proname=split_part(spec->>'name','.',2);
  IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec->>'before' THEN RAISE EXCEPTION 'completed_review_reason_predecessor_changed:%',spec->>'name';END IF;
  body:=f.prosrc;before_metadata:=f.metadata;
  FOR change IN SELECT value FROM jsonb_array_elements(spec->'changes') LOOP
   IF (length(body)-length(replace(body,change->>'old','')))/length(change->>'old')<>(change->>'count')::int THEN RAISE EXCEPTION 'completed_review_reason_anchor_changed:%',spec->>'name';END IF;
   body:=replace(body,change->>'old',change->>'new');
  END LOOP;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM spec->>'after' THEN RAISE EXCEPTION 'completed_review_reason_output_changed:%',spec->>'name';END IF;
  EXECUTE replace(f.definition,f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO STRICT after_row FROM pg_proc p WHERE p.oid=f.oid;
  IF after_row IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'completed_review_reason_function_metadata_changed:%',spec->>'name';END IF;
 END LOOP;
END $forward$;

DO $guard_install$
DECLARE t record;name text;BEGIN
 SELECT x.oid,x.tgenabled,pg_get_triggerdef(x.oid) AS definition INTO STRICT t
 FROM pg_trigger x WHERE x.tgrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND x.tgname='immutable' AND NOT x.tgisinternal
 AND x.tgfoid='gridex_received_sources.reject_mutation()'::regprocedure;
 DROP TRIGGER immutable ON gridex_ediel_retention.decision_evidence_reviews;
 EXECUTE regexp_replace(t.definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',
  'EXECUTE FUNCTION gridex_ediel_retention.completed_review_reason_guard_v1()');
 IF t.tgenabled='A' THEN ALTER TABLE gridex_ediel_retention.decision_evidence_reviews ENABLE ALWAYS TRIGGER immutable;
 ELSIF t.tgenabled<>'O' THEN RAISE EXCEPTION 'completed_review_reason_enabled_predecessor_required';END IF;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'completed_review_reason_%' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',name);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',name);
 END LOOP;
END $guard_install$;
-- No role assignments, default legal periods, new public RPCs, body snapshots,
-- global mutation bypass, history cascade, producer or capture are introduced.
COMMIT;
