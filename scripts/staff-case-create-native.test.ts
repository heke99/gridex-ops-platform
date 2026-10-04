import { expect, it } from 'vitest'
import { staffWriteNativeFixture } from './helpers/staff-write-native-fixture'

it('native staff support create is atomic, attributed, privately referenced and retry safe',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    DO $$DECLARE a jsonb;b jsonb;case_id uuid;BEGIN
      a:=public.gridex_create_staff_support_case_v1('${f.companyId}','${f.customerId}','${f.actorId}','${f.clientId}',
        'Atomic support','Internal description','support','normal','native-create','{}');
      case_id:=(a->'case'->>'id')::uuid;
      b:=public.gridex_create_staff_support_case_v1('${f.companyId}','${f.customerId}','${f.actorId}','${f.clientId}',
        'Atomic support','Internal description','support','normal','native-create','{}');
      IF a->>'reused'<>'false' OR b->>'reused'<>'true' OR a->'case'->>'id' IS DISTINCT FROM b->'case'->>'id'
        OR a->'case'->'metadata'->>'support_public_reference' IS NULL
        OR (SELECT count(*) FROM public.customer_case_events WHERE customer_case_id=case_id)<>1
        OR NOT EXISTS(SELECT FROM public.customer_case_events WHERE customer_case_id=case_id AND event_type='created'
          AND payload->>'channel'='staff_api' AND payload->>'api_client_id'='${f.clientId}' AND created_by='${f.actorId}')
        OR NOT EXISTS(SELECT FROM public.audit_logs WHERE entity_id=case_id::text AND action='customer_case_created'
          AND actor_user_id='${f.actorId}' AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'='${f.clientId}')
      THEN RAISE EXCEPTION 'staff_support_create_atomic_shape_invalid'; END IF;
      BEGIN
        PERFORM public.gridex_create_staff_support_case_v1('${f.companyId}','${f.customerId}','${f.actorId}','${f.clientId}',
          'Changed support','Internal description','support','normal','native-create','{}');
        RAISE EXCEPTION 'staff_create_key_conflict_allowed';
      EXCEPTION WHEN unique_violation THEN NULL; END;
      BEGIN
        PERFORM public.gridex_create_staff_support_case_v1('${f.companyId}','${f.foreignCustomerId}','${f.actorId}','${f.clientId}',
          'Foreign support',NULL,'support','normal','native-foreign','{}');
        RAISE EXCEPTION 'staff_create_foreign_customer_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
    END$$;`)).not.toThrow()
})

it('native staff support create rolls back both case and created event when audit fails',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    CREATE FUNCTION pg_temp.staff_create_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.company_id='${f.companyId}' AND NEW.action='customer_case_created' THEN RAISE EXCEPTION 'synthetic_create_audit_failure'; END IF;
      RETURN NEW;
    END$$;
    CREATE TRIGGER synthetic_staff_create_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.staff_create_reject_audit();
    DO $$BEGIN
      BEGIN
        PERFORM public.gridex_create_staff_support_case_v1('${f.companyId}','${f.customerId}','${f.actorId}','${f.clientId}',
          'Rollback support',NULL,'support','normal','native-rollback','{}');
        RAISE EXCEPTION 'staff_create_audit_failure_swallowed';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_create_audit_failure' THEN RAISE; END IF; END;
      IF EXISTS(SELECT FROM public.customer_cases WHERE company_id='${f.companyId}' AND metadata->>'support_idempotency_key'='native-rollback')
        OR EXISTS(SELECT FROM public.customer_case_events WHERE company_id='${f.companyId}' AND event_type='created')
      THEN RAISE EXCEPTION 'staff_create_partial_rows_survived'; END IF;
    END$$;`)).not.toThrow()
})
