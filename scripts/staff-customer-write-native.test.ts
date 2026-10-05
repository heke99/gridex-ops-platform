import { expect, it } from 'vitest'
import { staffWriteNativeFixture } from './helpers/staff-write-native-fixture'

it('native staff contact writes preserve attribution, reject foreign customers/clients and version conflicts',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    INSERT INTO public.customer_contacts(company_id,customer_id,type,name,email,is_primary)
      VALUES('${f.companyId}','${f.customerId}','primary','Synthetic native contact','before-contact@example.invalid',true);
    SELECT public.gridex_customer_contact_change_v1('${f.companyId}','${f.customerId}','staff','${f.actorId}','${f.clientId}',NULL,'staff_api',NULL,'{"email":"changed@example.invalid"}','{}','native-contact');
    DO $$DECLARE before_stale jsonb; after_stale jsonb; BEGIN
      IF NOT EXISTS(SELECT FROM public.audit_logs WHERE company_id='${f.companyId}' AND entity_id='${f.customerId}'
        AND actor_user_id='${f.actorId}' AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'='${f.clientId}')
        OR NOT EXISTS(SELECT FROM public.domain_events WHERE company_id='${f.companyId}' AND aggregate_id='${f.customerId}'
        AND source='staff_api' AND payload->>'api_client_id'='${f.clientId}')
      THEN RAISE EXCEPTION 'staff_contact_attribution_missing'; END IF;
      BEGIN
        PERFORM public.gridex_customer_contact_change_v1('${f.companyId}','${f.foreignCustomerId}','staff','${f.actorId}','${f.clientId}',NULL,'staff_api',NULL,'{"email":"foreign@example.invalid"}','{}','native-foreign');
        RAISE EXCEPTION 'staff_foreign_contact_allowed';
      EXCEPTION WHEN no_data_found THEN NULL; END;
      BEGIN
        PERFORM public.gridex_customer_contact_change_v1('${f.companyId}','${f.customerId}','staff','${f.actorId}','${f.foreignClientId}',NULL,'staff_api',NULL,'{"email":"wrong-client@example.invalid"}','{}','native-wrong-client');
        RAISE EXCEPTION 'staff_foreign_client_allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      SELECT jsonb_build_object(
        'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.company_id='${f.companyId}' AND c.id='${f.customerId}'),
        'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM public.customer_contacts c WHERE c.company_id='${f.companyId}' AND c.customer_id='${f.customerId}'),
        'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.audit_logs a WHERE a.company_id='${f.companyId}'),
        'domain',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM public.domain_events d WHERE d.company_id='${f.companyId}'),
        'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]'::jsonb) FROM public.event_outbox o WHERE o.company_id='${f.companyId}')
      ) INTO before_stale;
      BEGIN
        PERFORM public.gridex_customer_contact_change_v1('${f.companyId}','${f.customerId}','staff','${f.actorId}','${f.clientId}',NULL,'staff_api','2000-01-01','{"email":"stale@example.invalid"}','{"email":"stale-contact@example.invalid"}','native-stale');
        RAISE EXCEPTION 'staff_stale_contact_allowed';
      EXCEPTION WHEN SQLSTATE 'PT409' THEN
        IF SQLSTATE IS DISTINCT FROM 'PT409' OR SQLERRM IS DISTINCT FROM 'contact_change_version_conflict' THEN RAISE; END IF;
      END;
      SELECT jsonb_build_object(
        'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.company_id='${f.companyId}' AND c.id='${f.customerId}'),
        'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM public.customer_contacts c WHERE c.company_id='${f.companyId}' AND c.customer_id='${f.customerId}'),
        'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.audit_logs a WHERE a.company_id='${f.companyId}'),
        'domain',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM public.domain_events d WHERE d.company_id='${f.companyId}'),
        'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]'::jsonb) FROM public.event_outbox o WHERE o.company_id='${f.companyId}')
      ) INTO after_stale;
      IF after_stale IS DISTINCT FROM before_stale THEN RAISE EXCEPTION 'staff_stale_contact_wrote_effects'; END IF;
    END$$;
    SELECT public.gridex_customer_contact_change_v1('${f.companyId}','${f.customerId}','staff','${f.actorId}','${f.clientId}',NULL,'staff_api',NULL,'{"email":"changed@example.invalid"}','{}','native-contact');
    DO $$BEGIN
      IF (SELECT count(*) FROM public.domain_events WHERE company_id='${f.companyId}' AND aggregate_id='${f.customerId}' AND event_type='customer.contact_changed')<>1
      THEN RAISE EXCEPTION 'staff_contact_replay_wrote_again'; END IF;
    END$$;`)).not.toThrow()
})

it('native literal search finds older customers beyond 1000 rows and rejects foreign/hidden matches',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    INSERT INTO public.customers(company_id,full_name,status,created_at) SELECT '${f.companyId}','Recent filler '||n,'active',now() FROM generate_series(1,1001)n;
    INSERT INTO public.customers(company_id,full_name,status) VALUES('${f.companyId}','Hidden special %','archived');
    DO $$DECLARE r jsonb;BEGIN
      r:=public.gridex_staff_customer_search_v1('${f.companyId}','special %',1,25,'all','all');
      IF r->>'total'<>'1' OR r->'customer_ids'<>jsonb_build_array('${f.customerId}') THEN RAISE EXCEPTION 'staff_complete_search_failed'; END IF;
      r:=public.gridex_staff_customer_search_v1('${f.companyId}',chr(39)||' OR 1=1 --',1,25,'all','all');
      IF r->>'total'<>'0' THEN RAISE EXCEPTION 'staff_literal_search_injection'; END IF;
      r:=public.gridex_staff_customer_search_v1('${f.companyId}','',1,25,'all','all');
      IF r->>'total'<>'1002' OR jsonb_array_length(r->'customer_ids')<>25 THEN RAISE EXCEPTION 'staff_search_paging_failed'; END IF;
      BEGIN
        PERFORM public.gridex_staff_customer_search_v1('${f.companyId}','',1,101,'all','all');
        RAISE EXCEPTION 'staff_search_limit_bypassed';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END$$;`)).not.toThrow()
})

it('native staff identity request audits atomically and customer decision retains request attribution',()=>{
  const f=staffWriteNativeFixture()
  expect(()=>f.run(`
    INSERT INTO public.customer_identity_change_requests(company_id,customer_id,field,new_value,reason,requested_by,approval_required,status,source_channel,api_client_id)
      VALUES('${f.companyId}','${f.customerId}','org_number','5599990001','Synthetic native request','${f.actorId}',false,'pending_customer_approval','staff_api','${f.clientId}');
    DO $$DECLARE request_id uuid;BEGIN
      SELECT id INTO request_id FROM public.customer_identity_change_requests WHERE company_id='${f.companyId}';
      IF NOT EXISTS(SELECT FROM public.audit_logs WHERE company_id='${f.companyId}' AND action='customer_identity_change_requested' AND actor_user_id='${f.actorId}' AND metadata->>'api_client_id'='${f.clientId}')
      THEN RAISE EXCEPTION 'staff_identity_request_audit_missing'; END IF;
      PERFORM public.gridex_decide_customer_identity_change_v1('${f.companyId}',request_id,'applied','staff','${f.actorId}',NULL);
      IF NOT EXISTS(SELECT FROM public.audit_logs WHERE company_id='${f.companyId}' AND action='customer_identity_change_applied'
        AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'='${f.clientId}' AND metadata->>'originating_staff_actor_user_id'='${f.actorId}')
      THEN RAISE EXCEPTION 'staff_identity_decision_origin_missing'; END IF;
    END$$;`)).not.toThrow()
})
