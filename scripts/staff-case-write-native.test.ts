import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { staffWriteNativeFixture } from './helpers/staff-write-native-fixture'

it('native staff support events, shared status, assignment and attachment writes carry actor/client and preserve internal privacy',()=>{
  const f=staffWriteNativeFixture(),attachmentId=randomUUID()
  expect(()=>f.run(`
    SELECT public.gridex_staff_support_event('${f.companyId}','${f.caseId}','${f.customerId}','${f.actorId}','${f.clientId}',
      'support_phone_interaction','Synthetic call','{"visibility":"customer"}');
    SELECT public.gridex_assign_customer_case('${f.companyId}','${f.caseId}','${f.actorId}','${f.actorId}','${f.clientId}',NULL);
    SELECT public.gridex_staff_update_customer_case_status('${f.companyId}','${f.caseId}','${f.actorId}','${f.clientId}','resolved',NULL,'Done');
    INSERT INTO public.customer_case_attachments(id,company_id,customer_id,customer_case_id,public_reference,file_name,byte_size,sha256,storage_path,visibility,uploaded_by_kind,uploaded_by_user_id,api_client_id)
      VALUES('${attachmentId}','${f.companyId}','${f.customerId}','${f.caseId}','support_attachment_${attachmentId.replaceAll('-','')}','synthetic.png',8,repeat('0',64),'synthetic/${attachmentId}','internal','staff','${f.actorId}','${f.clientId}');
    UPDATE public.customer_case_attachments SET scan_status='released',detected_mime_type='image/png',scanned_at=now() WHERE id='${attachmentId}';
    DO $$BEGIN
      IF NOT EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id='${f.caseId}' AND event_type='support_phone_interaction' AND payload->>'visibility'='internal')
        OR NOT EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id='${f.caseId}' AND event_type='status_changed' AND payload->>'channel'='staff_api' AND payload->>'api_client_id'='${f.clientId}')
        OR NOT EXISTS(SELECT FROM public.audit_logs WHERE entity_id='${attachmentId}' AND actor_user_id='${f.actorId}' AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'='${f.clientId}')
        OR NOT EXISTS(SELECT FROM public.customer_cases WHERE id='${f.caseId}' AND status='resolved' AND assigned_to='${f.actorId}')
      THEN RAISE EXCEPTION 'staff_support_attribution_missing'; END IF;
      BEGIN
        PERFORM public.gridex_assign_customer_case('${f.companyId}','${f.caseId}','${f.actorId}','${f.foreignActorId}','${f.clientId}',NULL);
        RAISE EXCEPTION 'staff_foreign_assignee_allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        PERFORM public.gridex_staff_support_event('${f.companyId}','${f.caseId}','${f.foreignCustomerId}','${f.actorId}','${f.clientId}','support_staff_reply','Cross customer','{}');
        RAISE EXCEPTION 'staff_foreign_event_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
      BEGIN
        UPDATE public.customer_case_attachments SET api_client_id='${f.foreignClientId}' WHERE id='${attachmentId}';
        RAISE EXCEPTION 'staff_attachment_origin_mutated';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END$$;`)).not.toThrow()
})

it('native staff support mutations reject operational cases even when the support marker is present',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    UPDATE public.customer_cases SET source='admin_customer_cases',case_type='technical_blocker',billing_blocked=true WHERE id='${f.caseId}';
    DO $$BEGIN
      BEGIN
        PERFORM public.gridex_staff_support_event('${f.companyId}','${f.caseId}','${f.customerId}','${f.actorId}','${f.clientId}','support_staff_reply','Operational','{}');
        RAISE EXCEPTION 'staff_operational_event_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
      BEGIN
        PERFORM public.gridex_assign_customer_case('${f.companyId}','${f.caseId}','${f.actorId}',NULL,'${f.clientId}',NULL);
        RAISE EXCEPTION 'staff_operational_assignment_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
      BEGIN
        PERFORM public.gridex_staff_update_customer_case_status('${f.companyId}','${f.caseId}','${f.actorId}','${f.clientId}','closed',NULL,NULL);
        RAISE EXCEPTION 'staff_operational_status_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
      IF EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id='${f.caseId}')
        OR NOT EXISTS(SELECT FROM public.customer_cases WHERE id='${f.caseId}' AND status='open' AND billing_blocked)
      THEN RAISE EXCEPTION 'staff_operational_failure_wrote'; END IF;
    END$$;`)).not.toThrow()
})

it('native staff support event rolls back when its audit cannot be written',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    CREATE FUNCTION pg_temp.staff_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.company_id='${f.companyId}' AND NEW.metadata->>'channel'='staff_api' THEN RAISE EXCEPTION 'synthetic_staff_audit_failure'; END IF;
      RETURN NEW;
    END$$;
    CREATE TRIGGER synthetic_staff_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.staff_test_reject_audit();
    DO $$BEGIN
      BEGIN
        PERFORM public.gridex_staff_support_event('${f.companyId}','${f.caseId}','${f.customerId}','${f.actorId}','${f.clientId}','support_internal_note','Atomic note','{}');
        RAISE EXCEPTION 'staff_audit_failure_swallowed';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'synthetic_staff_audit_failure' THEN RAISE; END IF;
      END;
      IF EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id='${f.caseId}') THEN RAISE EXCEPTION 'staff_event_survived_audit_failure'; END IF;
    END$$;`)).not.toThrow()
})
