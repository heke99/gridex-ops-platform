-- Capture the deadline evidence in the same transaction that closes the timer.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  CREATE FUNCTION public.gridex_record_late_contrl_resolution_v1()
  RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
  SET search_path TO pg_catalog SET "TimeZone" TO 'UTC'
  AS $fact$
  DECLARE
    v_ack_id uuid;
    v_sent_at timestamptz;
  BEGIN
    -- Only the existing service sweep can add evidence, using the same
    -- company, environment, source and evaluation time as its resolution.
    IF current_user IS DISTINCT FROM 'service_role' OR NEW.company_id IS NULL
      OR (NEW.company_id,NEW.ediel_message_id,NEW.due_at)
        IS DISTINCT FROM (OLD.company_id,OLD.ediel_message_id,OLD.due_at)
      OR NOT isfinite(NEW.due_at) OR NOT isfinite(NEW.updated_at)
    THEN RETURN NEW; END IF;

    SELECT ack.id,ack.message_sent_at INTO v_ack_id,v_sent_at
    FROM public.ediel_messages source
    JOIN public.ediel_messages ack
      ON (ack.company_id,ack.environment,ack.related_message_id)=(source.company_id,source.environment,source.id)
    WHERE (source.company_id,source.id)=(NEW.company_id,NEW.ediel_message_id)
      AND source.direction='inbound' AND source.message_standard='edifact'
      AND ack.direction='outbound' AND ack.message_family='CONTRL' AND ack.status='sent'
      AND isfinite(ack.message_sent_at) AND ack.message_sent_at<=NEW.updated_at
    ORDER BY ack.message_sent_at,ack.id LIMIT 1;

    IF v_ack_id IS NOT NULL AND v_sent_at>NEW.due_at THEN
      NEW.payload:=CASE WHEN jsonb_typeof(NEW.payload)='object' THEN NEW.payload
        ELSE jsonb_build_object('previousPayload',NEW.payload) END
        ||jsonb_build_object('lateContrl',jsonb_build_object(
          'acknowledgementId',v_ack_id,'dueAt',NEW.due_at,'sentAt',v_sent_at
        ));
    END IF;
    RETURN NEW;
  END
  $fact$;
  REVOKE ALL ON FUNCTION public.gridex_record_late_contrl_resolution_v1() FROM PUBLIC,anon,authenticated,service_role;
  CREATE TRIGGER gridex_record_late_contrl_resolution
    BEFORE UPDATE OF status ON public.ediel_sla_timers FOR EACH ROW
    WHEN (OLD.timer_type='contrl_due' AND NEW.timer_type='contrl_due'
      AND OLD.status IN ('open','warning','critical','expired') AND NEW.status='resolved')
    EXECUTE FUNCTION public.gridex_record_late_contrl_resolution_v1();
END
$migration$;
