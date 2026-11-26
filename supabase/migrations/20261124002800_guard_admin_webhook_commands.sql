DO $migration$
BEGIN
  CREATE FUNCTION private.gridex_webhook_admin_command_allowed_v1(p_status text, p_command text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
  SET search_path TO pg_catalog
  AS $status$
    SELECT CASE p_command
      WHEN 'resend' THEN p_status IN ('failed','dead_letter','sent','skipped','blocked_tenant_state')
      WHEN 'ignore' THEN p_status IN ('failed','dead_letter','queued','delivery_uncertain','blocked_tenant_state')
      ELSE false END;
  $status$;
  REVOKE ALL ON FUNCTION private.gridex_webhook_admin_command_allowed_v1(text,text)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION private.gridex_webhook_admin_command_allowed_v1(text,text) TO service_role;

  CREATE FUNCTION public.gridex_list_webhook_admin_commands_v1(p_targets jsonb)
  RETURNS TABLE(id uuid,status text,can_resend boolean,can_ignore boolean)
  LANGUAGE plpgsql STABLE
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $availability$
  BEGIN
    IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets) > 150 THEN
      RAISE EXCEPTION 'webhook_command_targets_invalid' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
      SELECT delivery.id,delivery.status,
        private.gridex_webhook_admin_command_allowed_v1(delivery.status,'resend') AND subscription.id IS NOT NULL,
        private.gridex_webhook_admin_command_allowed_v1(delivery.status,'ignore')
      FROM jsonb_to_recordset(p_targets) AS target(id uuid,company_id uuid)
      JOIN public.webhook_deliveries AS delivery ON delivery.id = target.id AND delivery.company_id = target.company_id
      LEFT JOIN public.webhook_subscriptions AS subscription
        ON subscription.id = delivery.webhook_subscription_id AND subscription.company_id = delivery.company_id
        AND subscription.status = 'active'
      WHERE delivery.locked_at IS NULL AND delivery.locked_by IS NULL;
  END;
  $availability$;
  REVOKE ALL ON FUNCTION public.gridex_list_webhook_admin_commands_v1(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_webhook_admin_commands_v1(jsonb) TO service_role;

  CREATE FUNCTION public.gridex_admin_webhook_command_v1(
    p_company_id uuid, p_actor_id uuid, p_target_id uuid, p_request_id uuid,
    p_command text, p_original_status text, p_note text
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    delivery public.webhook_deliveries;
    receipt public.audit_logs;
    subscription_id uuid;
    event_id uuid;
    audit_action text;
    target_type text;
    new_status text;
    changed_at timestamptz;
  BEGIN
    IF p_company_id IS NULL OR p_actor_id IS NULL OR p_target_id IS NULL OR p_request_id IS NULL
      OR (p_command IN ('test','resend','ignore')) IS NOT TRUE
      OR (p_command <> 'test' AND nullif(btrim(p_original_status),'') IS NULL) THEN
      RAISE EXCEPTION 'webhook_command_invalid' USING ERRCODE = '22023';
    END IF;

    target_type := CASE WHEN p_command = 'test' THEN 'webhook_subscription' ELSE 'webhook_delivery' END;
    audit_action := CASE p_command
      WHEN 'test' THEN 'webhook.test_event_created'
      WHEN 'resend' THEN 'webhook.delivery_resend_requested'
      ELSE 'webhook.delivery_ignored' END;

    -- The audit ID is also a durable, actor- and target-bound command receipt.
    -- A retry after a lost acknowledgement returns the recorded result.
    PERFORM pg_advisory_xact_lock(hashtextextended('admin_webhook_command:' || p_request_id::text, 0));
    SELECT log.* INTO receipt FROM public.audit_logs AS log WHERE log.id = p_request_id;
    IF FOUND THEN
      IF receipt.company_id IS DISTINCT FROM p_company_id OR receipt.actor_user_id IS DISTINCT FROM p_actor_id
        OR receipt.entity_type IS DISTINCT FROM target_type OR receipt.entity_id IS DISTINCT FROM p_target_id::text
        OR receipt.action IS DISTINCT FROM audit_action THEN
        RAISE EXCEPTION 'webhook_command_target_unavailable' USING ERRCODE = 'P0002';
      END IF;
      RETURN jsonb_build_object('applied',true,'replay',true);
    END IF;
    changed_at := clock_timestamp();

    IF p_command = 'test' THEN
      PERFORM 1 FROM public.webhook_subscriptions AS subscription
      WHERE subscription.id = p_target_id AND subscription.company_id = p_company_id AND subscription.status = 'active'
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'webhook_command_target_unavailable' USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO public.domain_events (
        company_id, event_type, aggregate_type, aggregate_id, actor_user_id, source, idempotency_key, payload
      ) VALUES (
        p_company_id, 'webhook.test', target_type, p_target_id::text, p_actor_id, 'admin_webhook_test',
        format('webhook-test:%s:%s:%s',p_company_id,p_target_id,p_request_id),
        jsonb_build_object('test',true,'webhook_subscription_id',p_target_id,'expected_subscription_id',p_target_id,
          'message','Gridex webhook test event')
      ) RETURNING id INTO event_id;

      INSERT INTO public.event_outbox (
        company_id, domain_event_id, destination_type, destination_key, status, attempts, max_attempts, available_at, payload
      ) VALUES (
        p_company_id,event_id,'webhook','webhook_fanout_v1','queued',0,12,changed_at,
        jsonb_build_object('event_type','webhook.test','aggregate_type',target_type,'aggregate_id',p_target_id)
      );
    ELSE
      IF p_command = 'resend' THEN
        SELECT current.webhook_subscription_id INTO subscription_id FROM public.webhook_deliveries AS current
        WHERE current.id = p_target_id AND current.company_id = p_company_id;
        PERFORM 1 FROM public.webhook_subscriptions AS subscription
        WHERE subscription.id = subscription_id AND subscription.company_id = p_company_id AND subscription.status = 'active'
        FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'webhook_command_target_unavailable' USING ERRCODE = 'P0002';
        END IF;
      END IF;

      SELECT current.* INTO delivery FROM public.webhook_deliveries AS current
      WHERE current.id = p_target_id AND current.company_id = p_company_id
        AND (p_command <> 'resend' OR current.webhook_subscription_id = subscription_id)
      FOR UPDATE;
      IF NOT FOUND OR delivery.status IS DISTINCT FROM p_original_status
        OR delivery.locked_at IS NOT NULL OR delivery.locked_by IS NOT NULL
        OR private.gridex_webhook_admin_command_allowed_v1(delivery.status,p_command) IS NOT TRUE THEN
        RAISE EXCEPTION 'webhook_command_target_unavailable' USING ERRCODE = 'P0002';
      END IF;

      new_status := CASE WHEN p_command = 'resend' THEN 'queued' ELSE 'skipped' END;
      UPDATE public.webhook_deliveries AS current
      SET status = new_status,
          next_attempt_at = CASE WHEN p_command = 'resend' THEN changed_at ELSE current.next_attempt_at END,
          manual_status = CASE WHEN p_command = 'resend' THEN 'resend_requested' ELSE 'ignored' END,
          manual_note = CASE WHEN p_command = 'ignore' THEN nullif(btrim(p_note),'') ELSE current.manual_note END,
          resent_by = CASE WHEN p_command = 'resend' THEN p_actor_id ELSE current.resent_by END,
          resent_at = CASE WHEN p_command = 'resend' THEN changed_at ELSE current.resent_at END,
          updated_at = changed_at
      WHERE current.id = delivery.id;
    END IF;

    INSERT INTO public.audit_logs (
      id, company_id, actor_user_id, action, entity_type, entity_id, resource_type, resource_id,
      actor_type, request_id, correlation_id, previous_status, new_status, new_values
    ) VALUES (
      p_request_id,p_company_id,p_actor_id,audit_action,target_type,p_target_id::text,target_type,p_target_id::text,
      'user',p_request_id::text,p_request_id::text,delivery.status,new_status,
      CASE WHEN p_command = 'test' THEN jsonb_build_object('event_id',event_id)
        WHEN p_command = 'ignore' THEN jsonb_build_object('note',p_note) ELSE NULL END
    );

    RETURN jsonb_build_object('applied',true,'replay',false);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_admin_webhook_command_v1(uuid,uuid,uuid,uuid,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_admin_webhook_command_v1(uuid,uuid,uuid,uuid,text,text,text)
    TO service_role;
END
$migration$;
