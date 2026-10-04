-- Source-only cohort discovery precedes the actual shared provider contract
-- locks. Established native attempts/provider truth delegate before new E
-- lineage selection; all existing actor/attempt/archive/current guards remain.
BEGIN;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_customer_event_recovery_cohort_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(i->>'companyId')::uuid;mid uuid:=(i->>'messageId')::uuid;env text:=i->>'environment';action text:=i->>'action';
 m public.ediel_messages%rowtype;r gridex_ediel_transport.reservations%rowtype;
BEGIN
 IF(action IN('prepare','enter')) IS NOT TRUE THEN RETURN gridex_ediel_transport.mutate_before_customer_event_recovery_cohort_v1(i);END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=env AND direction='outbound';
 IF m.id IS NULL THEN RETURN gridex_ediel_transport.mutate_before_customer_event_recovery_cohort_v1(i);END IF;
 SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=m.id;
 IF(action='prepare' AND r.message_id IS NOT NULL AND r.state IS DISTINCT FROM 'released')
  OR(action='enter' AND r.message_id IS NOT NULL AND r.state IS DISTINCT FROM 'prepared')
  OR gridex_ediel_transport.accepted_source_basis_v1(m) IS NOT NULL THEN
  -- The real delegate retains current execution actor and exact frozen attempt
  -- checks. This branch introduces no new provider or source authorization.
  RETURN gridex_ediel_transport.mutate_before_customer_event_recovery_cohort_v1(i);
 END IF;
 PERFORM gridex_customer_life_events.prelock_recovery_lineage_v1(c,mid);
 RETURN gridex_ediel_transport.mutate_before_customer_event_recovery_cohort_v1(i);
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_customer_event_recovery_cohort_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
