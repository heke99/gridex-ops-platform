-- A historical unsealed Z08 payload cannot prove an unrelated scope.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_correction_process.combined_outbound_body_v3(
 p_company_id uuid,p_environment text,p_cutoff timestamptz,p_point_ids text[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH concerns AS MATERIALIZED (
  SELECT c.facts->'scope' AS scope FROM gridex_received_sources.correction_concerns c
  WHERE c.company_id=p_company_id AND c.environment=p_environment
   AND c.captured_at<=p_cutoff AND c.source_received_at<=p_cutoff
   AND (p_point_ids IS NULL OR c.facts->'scope'->>'objectId' IS NULL
    OR c.facts->'scope'->>'objectId'=ANY(p_point_ids))
 ), candidates AS MATERIALIZED (
  SELECT m.id,o.message_id IS NOT NULL AS instrumented,
   coalesce(o.raw_payload,m.raw_payload) AS raw_payload,
   coalesce(o.payload_hash,m.immutable_payload_hash) AS payload_hash,
   gridex_outbound_dispatch.scope_v1(CASE
    WHEN o.message_id IS NOT NULL AND o.payload_hash=encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex')
     THEN o.raw_payload
    WHEN o.message_id IS NULL AND m.immutable_rendered_at IS NOT NULL
     AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
     THEN m.raw_payload
    ELSE NULL END) AS wire_scope
  FROM public.ediel_messages m
  LEFT JOIN gridex_outbound_dispatch.originals o ON o.message_id=m.id
   AND o.company_id=p_company_id AND o.environment=p_environment AND o.captured_at<=p_cutoff
  WHERE m.company_id=p_company_id AND m.environment=p_environment
   AND m.direction='outbound' AND m.created_at<=p_cutoff
   AND (m.message_code='Z08' OR m.rule_profile_key='PRODAT:Z08:H:26.A:r3' OR o.message_id IS NOT NULL)
 ), scoped AS MATERIALIZED (
  SELECT c.* FROM candidates c WHERE EXISTS(SELECT FROM concerns concern
    WHERE (concern.scope->>'objectId' IS NULL OR c.wire_scope->>'point' IS NULL
      OR concern.scope->>'objectId'=c.wire_scope->>'point'
      OR (concern.scope->>'objectId'=ANY(p_point_ids)
       AND c.wire_scope->>'point'=ANY(p_point_ids)))
     AND (concern.scope->>'legalSender' IS NULL OR c.wire_scope->>'outboundReceiver' IS NULL
      OR concern.scope->>'legalSender'=c.wire_scope->>'outboundReceiver')
     AND (concern.scope->>'legalReceiver' IS NULL OR c.wire_scope->>'outboundSender' IS NULL
      OR concern.scope->>'legalReceiver'=c.wire_scope->>'outboundSender'))
 ), totals AS (
  SELECT count(*) AS n,coalesce(sum(octet_length(raw_payload)),0) AS bytes FROM scoped
 )
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','reason',
  CASE WHEN t.n>1000 THEN 'outbound_count_overflow'
   WHEN t.bytes>6291456 THEN 'outbound_bytes_overflow' ELSE 'prospective_history_only' END,
  'originalCount',t.n,'visibilitySnapshot',pg_current_snapshot()::text,
  'epoch',(SELECT to_jsonb(e) FROM gridex_outbound_dispatch.epoch e),
  'originals',CASE WHEN t.n<=1000 AND t.bytes<=6291456 THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'messageId',s.id,'instrumented',s.instrumented,'rawPayload',s.raw_payload,
    'payloadHash',s.payload_hash,'scope',s.wire_scope,
    'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'owner',a.owner,
      'binding',a.binding,'createdAt',a.created_at) ORDER BY a.id),'[]'::jsonb)
     FROM gridex_outbound_dispatch.attempts a WHERE a.message_id=s.id AND a.created_at<=p_cutoff),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'attemptId',e.attempt_id,
      'kind',e.kind,'facts',e.facts,'observedAt',e.observed_at,
      'witnessId',w.event_id,'witnessAt',w.available_at) ORDER BY e.observed_at,e.id),'[]'::jsonb)
     FROM gridex_outbound_dispatch.events e LEFT JOIN gridex_outbound_dispatch.witnesses w
       ON w.event_id=e.id AND w.company_id=p_company_id AND w.environment=p_environment
       AND w.available_at<=p_cutoff
     WHERE e.message_id=s.id AND e.company_id=p_company_id AND e.environment=p_environment
      AND e.observed_at<=p_cutoff)) ORDER BY s.id),'[]'::jsonb) FROM scoped s)
   ELSE '[]'::jsonb END) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.combined_outbound_body_v3(uuid,text,timestamptz,text[])
 FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
