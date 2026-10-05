-- A national H Z08 (supply rescission) is dispatched through the sealed Z08
-- lane (gridex_outbound_dispatch), whose accepted provider result is recorded
-- in gridex_outbound_dispatch.attempts/events. The accepted-source projector
-- already reads both journals (gridex_ediel_transport.accepted_source_basis_v1)
-- and registers the Z08 business expectation, but registration only looked in
-- the generic journal: every accepted national H failed with
-- ediel_expectation_actual_smtp_acceptance_required.
--
-- Registration now takes the single accepted receipt from either journal via
-- accepted_source_basis_v1, and a binding references exactly one attempt.
BEGIN;
ALTER TABLE gridex_business_expectations.bindings
  ADD COLUMN IF NOT EXISTS dispatch_attempt_id uuid REFERENCES gridex_outbound_dispatch.attempts(id) ON DELETE RESTRICT,
  ALTER COLUMN transport_attempt_id DROP NOT NULL;
DO $c$BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='gridex_business_expectations.bindings'::regclass AND conname='bindings_exactly_one_attempt') THEN
  ALTER TABLE gridex_business_expectations.bindings ADD CONSTRAINT bindings_exactly_one_attempt CHECK (num_nonnulls(transport_attempt_id,dispatch_attempt_id)=1);
 END IF;
END$c$;

DO $expect$DECLARE f record;
 n1 CONSTANT text:=$n$result jsonb;$n$;
 r1 CONSTANT text:=$n$result jsonb;sealed jsonb;sealed_attempt uuid;$n$;
 n2 CONSTANT text:=$n$  SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE message_id=mid AND company_id=c AND environment=env AND classification='accepted' AND observed_at IS NOT NULL AND entered_at IS NOT NULL ORDER BY observed_at,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_expectation_actual_smtp_acceptance_required'; END IF;$n$;
 r2 CONSTANT text:=$n$  SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE message_id=mid AND company_id=c AND environment=env AND classification='accepted' AND observed_at IS NOT NULL AND entered_at IS NOT NULL ORDER BY observed_at,id LIMIT 1;
  IF NOT FOUND AND code='Z08' THEN
   -- The sealed Z08 lane: exactly one accepted, entered provider result.
   sealed:=gridex_ediel_transport.accepted_source_basis_v1(m);
   -- accepted_source_basis_v1 has already verified entry, provider receipt and plan.
   IF sealed->>'status'='accepted_projection' AND sealed->>'lane'='sealed_z08' AND sealed->>'messageId'=mid::text AND sealed->>'observedAt' IS NOT NULL THEN
    sealed_attempt:=(sealed->>'attemptId')::uuid;
    a.id:=NULL;a.observed_at:=(sealed->>'observedAt')::timestamptz;
    a.binding:=jsonb_build_object('originalHash',sealed->>'originalHash','businessExpectationPlan',sealed->'businessExpectationPlan');
   END IF;
  END IF;
  IF a.id IS NULL AND sealed_attempt IS NULL THEN RAISE EXCEPTION 'ediel_expectation_actual_smtp_acceptance_required'; END IF;$n$;
 n3 CONSTANT text:=$n$'transportAttemptId',a.id)) RETURNING id INTO expected_id;$n$;
 r3 CONSTANT text:=$n$'transportAttemptId',coalesce(a.id,sealed_attempt))) RETURNING id INTO expected_id;$n$;
 n4 CONSTANT text:=$n$  INSERT INTO gridex_business_expectations.bindings(expectation_id,company_id,environment,source_message_id,transport_attempt_id,source_payload_hash,observed_at,plan)
   VALUES(expected_id,c,env,mid,a.id,m.immutable_payload_hash,a.observed_at,plan);$n$;
 r4 CONSTANT text:=$n$  INSERT INTO gridex_business_expectations.bindings(expectation_id,company_id,environment,source_message_id,transport_attempt_id,dispatch_attempt_id,source_payload_hash,observed_at,plan)
   VALUES(expected_id,c,env,mid,a.id,sealed_attempt,m.immutable_payload_hash,a.observed_at,plan);$n$;
 src text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_business_expectations.mutate_v1(jsonb)'::regprocedure;
 src:=f.prosrc;
 IF (length(src)-length(replace(src,n1,'')))/length(n1)<>1 OR (length(src)-length(replace(src,n2,'')))/length(n2)<>1
  OR (length(src)-length(replace(src,n3,'')))/length(n3)<>1 OR (length(src)-length(replace(src,n4,'')))/length(n4)<>1
 THEN RAISE EXCEPTION 'expectation_sealed_z08_predecessor_required';END IF;
 src:=replace(replace(replace(replace(src,n1,r1),n2,r2),n3,r3),n4,r4);
 EXECUTE replace(f.definition,f.prosrc,src);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'expectation_sealed_z08_metadata_changed';END IF;
END$expect$;
COMMIT;
