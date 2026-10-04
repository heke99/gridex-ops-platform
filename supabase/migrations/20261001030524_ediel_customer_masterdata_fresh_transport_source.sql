-- Created by the actual Supabase CLI. Fresh native attempts consume the same
-- protected customer source before any contract locks or provider journal write.
-- Fixed prepare/entry results delegate before current source qualification.
BEGIN;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_customer_masterdata_source_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 c uuid:=(p_input->>'companyId')::uuid;mid uuid:=(p_input->>'messageId')::uuid;
 env text:=p_input->>'environment';action text:=p_input->>'action';
 m public.ediel_messages%rowtype;r gridex_ediel_transport.reservations%rowtype;
BEGIN
 IF (action IN('prepare','enter')) IS NOT TRUE THEN
  RETURN gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(p_input);
 END IF;
 -- Immutable origin supplies the source IDs. This is only lock ordering and
 -- qualifies no actor, rule, address, or customer from a caller selector.
 PERFORM gridex_customer_masterdata.prelock_message_v1(c,mid);
 SELECT * INTO m FROM public.ediel_messages
  WHERE id=mid AND company_id=c AND environment=env AND direction='outbound' FOR UPDATE;
 IF m.id IS NULL THEN RETURN gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(p_input);END IF;
 SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=m.id FOR UPDATE;
 IF action='prepare' AND r.message_id IS NOT NULL AND r.state<>'released'
  OR action='enter' AND r.state IN('entered','observed') THEN
  -- The delegate retains its current actor/read and exact attempt checks.
  RETURN gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(p_input);
 END IF;
 PERFORM gridex_customer_masterdata.require_current_v1(c,mid,(p_input->>'actorUserId')::uuid,'send');
 RETURN gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(p_input);
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_customer_masterdata_source_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
