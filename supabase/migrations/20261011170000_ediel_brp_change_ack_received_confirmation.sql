-- masterplan: AT-Z09B-SUPPLIER (CONTRL and APERAK; update according to the BRP flow)
-- The dated BRP period version is recorded when our own Z09/Z27 is bound for
-- sending (20260930200545, 20260930230653); Z27 is its field-223 reason, the
-- message code is Z09. That is a source declaration, not
-- an acknowledged change. A valid receipt is the acknowledged transition of
-- that same bound outbound PRODAT Z09 with at least one positive APERAK scope
-- outcome and no negative scope outcome (the ACK authority writes
-- aperak_status='received' plus immutable gridex_ack_authority.scope_outcomes).
-- It confirms exactly the producing BRP-change event of the same tenant and
-- environment whose bound bytes are unchanged, never a revoked one. CONTRL
-- alone, a negative APERAK, an unbound message, a changed original or a
-- revoked event confirms nothing. Existing events, origins and period versions
-- are not changed; the history reports the confirmation per dated version.
-- Z09 messages acknowledged before this migration stay source_declared (no backfill).
BEGIN;
CREATE TABLE gridex_brp_changes.confirmations (
 event_id uuid PRIMARY KEY REFERENCES gridex_brp_changes.events(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')),
 message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gridex_brp_changes.confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_brp_changes.confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_brp_changes.confirmations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER confirmations_immutable BEFORE UPDATE OR DELETE ON gridex_brp_changes.confirmations
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER confirmations_no_truncate BEFORE TRUNCATE ON gridex_brp_changes.confirmations
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION gridex_brp_changes.confirm_on_ack_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_brp_changes.origins%rowtype;e gridex_brp_changes.events%rowtype;v gridex_brp_changes.period_versions%rowtype;
BEGIN
 IF NEW.status IS DISTINCT FROM 'acknowledged' OR OLD.status IS NOT DISTINCT FROM 'acknowledged'
 OR NEW.aperak_status IS DISTINCT FROM 'received'
 OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z09' THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=NEW.id AND x.ack_family='APERAK' AND x.outcome='positive')
 OR EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=NEW.id AND x.outcome='negative') THEN RETURN NEW;END IF;
 SELECT * INTO o FROM gridex_brp_changes.origins WHERE message_id=NEW.id AND company_id=NEW.company_id;
 IF NOT FOUND OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') THEN RETURN NEW;END IF;
 SELECT * INTO e FROM gridex_brp_changes.events WHERE id=o.event_id FOR SHARE;
 SELECT * INTO v FROM gridex_brp_changes.period_versions WHERE event_id=o.event_id;
 IF e.company_id IS DISTINCT FROM NEW.company_id OR e.environment IS DISTINCT FROM NEW.environment
 OR v.source_message_id IS DISTINCT FROM NEW.id OR v.source_payload_hash IS DISTINCT FROM o.payload_hash
 OR EXISTS(SELECT FROM gridex_brp_changes.revocations r WHERE r.target_kind='event' AND r.target_id=e.id) THEN RETURN NEW;END IF;
 INSERT INTO gridex_brp_changes.confirmations(event_id,company_id,environment,message_id)
  VALUES(e.id,e.company_id,e.environment,NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_brp_changes.confirm_on_ack_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION gridex_brp_changes.confirm_on_ack_v1() IS
 'AT-Z09B-SUPPLIER: confirms the producing BRP-change event once its own bound, unchanged outbound PRODAT Z09/Z27 reaches acknowledged with a positive APERAK scope outcome and no negative scope outcome.';
CREATE TRIGGER confirm_brp_change_on_ack AFTER UPDATE OF status,aperak_status ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_brp_changes.confirm_on_ack_v1();

-- History: unchanged authorization and dated versioning; each version now
-- reports whether its own Z09/Z27 received a valid APERAK confirmation.
CREATE OR REPLACE FUNCTION public.ediel_brp_responsibility_history_v1(p_company_id uuid,p_supply_period_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;

BEGIN PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id FOR SHARE;
IF p_company_id IS NULL
  OR p_supply_period_id IS NULL
  OR p_actor_user_id IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id
  AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id
  AND user_id=p_actor_user_id
  AND status='active'
  AND is_active
  AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read') IS NOT TRUE THEN RAISE EXCEPTION 'brp_history_actor_forbidden' USING ERRCODE='42501';
END IF;
PERFORM p.id FROM public.customer_supply_periods p WHERE p.company_id=p_company_id
  AND p.id=p_supply_period_id FOR SHARE;
IF NOT FOUND THEN RAISE EXCEPTION 'brp_history_relation_unavailable';
END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',v.event_id,'effectiveAt',v.effective_at,'effectiveUntil',(SELECT min(next.effective_at) FROM gridex_brp_changes.period_versions next WHERE next.company_id=v.company_id
  AND next.environment=v.environment
  AND next.supply_period_id=v.supply_period_id
  AND next.effective_at>v.effective_at),'brpActorId',v.brp_actor_id,'brpEdielId',v.brp_ediel_id,'sourceMessageId',v.source_message_id,'sourcePayloadHash',v.source_payload_hash,
  'status',CASE WHEN c.event_id IS NULL THEN 'source_declared' ELSE 'aperak_confirmed' END,
  'confirmedAt',c.confirmed_at,'confirmationMessageId',c.message_id,
  'sourceRevoked',EXISTS(SELECT FROM gridex_brp_changes.revocations WHERE target_kind='event'
  AND target_id=v.event_id),'marketActivationProven',false) ORDER BY v.effective_at,v.event_id),'[]') INTO rows FROM gridex_brp_changes.period_versions v
  LEFT JOIN gridex_brp_changes.confirmations c ON c.event_id=v.event_id AND c.company_id=v.company_id AND c.environment=v.environment
  WHERE v.company_id=p_company_id
  AND v.supply_period_id=p_supply_period_id;

 RETURN jsonb_build_object('companyId',p_company_id,'supplyPeriodId',p_supply_period_id,'versions',rows,'marketActivationProven',false);
END$$;
REVOKE ALL ON FUNCTION public.ediel_brp_responsibility_history_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_brp_responsibility_history_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
