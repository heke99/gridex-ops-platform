-- S3: staff contact and identity writes retain the human actor, API client and channel.
BEGIN;
CREATE FUNCTION public.gridex_staff_assert_write_actor_v1(p_company_id uuid,p_actor_user_id uuid,p_api_client_id uuid,p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.company_memberships cm
    JOIN public.user_profiles up ON up.id=cm.user_id
    JOIN public.companies c ON c.id=cm.company_id
    WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active
      AND up.user_status='active'
      AND c.status IN ('active','onboarding') AND c.is_active
    FOR SHARE OF cm,up,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_api_actor_inactive' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.integration_api_clients cl
    WHERE cl.id=p_api_client_id AND cl.company_id=p_company_id AND cl.status='active'
      AND cl.deleted_at IS NULL AND (cl.expires_at IS NULL OR cl.expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_api_client_not_in_scope' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,p_permission),false)
  THEN RAISE EXCEPTION 'staff_api_actor_not_authorized' USING ERRCODE='42501'; END IF;
END$$;
REVOKE ALL ON FUNCTION public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.gridex_staff_customer_search_v1(p_company_id uuid,p_query text,p_page integer,p_page_size integer,p_status text,p_customer_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR p_query IS NULL OR length(p_query)>200 THEN
    RAISE EXCEPTION 'staff_customer_search_invalid' USING ERRCODE='22023';
  END IF;
  WITH filtered AS MATERIALIZED(
    SELECT c.id,c.created_at FROM public.customers c WHERE c.company_id=p_company_id
      AND (c.source IS NULL OR c.source<>'ediel_portal_test')
      AND (p_status='archived' OR c.status IS NULL OR c.status NOT IN('archived','deleted','deleted_test_only','pending_deletion'))
      AND (p_status IS NULL OR p_status='all' OR c.status=p_status)
      AND (p_customer_type IS NULL OR p_customer_type='all' OR c.customer_type=p_customer_type
        OR (p_customer_type='private' AND c.customer_type IS NULL))
      AND (strpos(lower(coalesce(c.full_name,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.company_name,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.email,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.phone,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.personal_number,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.org_number,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.customer_number,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.first_name,'')),lower(p_query))>0
        OR strpos(lower(coalesce(c.last_name,'')),lower(p_query))>0)
  ), page AS(
    SELECT id,created_at FROM filtered ORDER BY created_at DESC,id DESC
    LIMIT p_page_size OFFSET (p_page-1)*p_page_size
  ) SELECT jsonb_build_object('customer_ids',coalesce((SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END$$;
REVOKE ALL ON FUNCTION public.gridex_staff_customer_search_v1(uuid,text,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_customer_search_v1(uuid,text,integer,integer,text,text) TO service_role;

CREATE FUNCTION public.gridex_staff_customer_id_for_reference_v1(p_company_id uuid,p_reference text)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.id FROM public.customers c WHERE c.company_id=p_company_id
    AND 'customer_' || substr(translate(rtrim(encode(extensions.digest(
      'gridex-public-reference:v1:'||c.company_id::text||':customer:'||c.id::text,'sha256'),'base64'),'='),'+/','-_'),1,32)=p_reference
$$;
REVOKE ALL ON FUNCTION public.gridex_staff_customer_id_for_reference_v1(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_customer_id_for_reference_v1(uuid,text) TO service_role;
CREATE INDEX customers_staff_public_reference_idx ON public.customers(company_id,(
  'customer_' || substr(translate(rtrim(encode(extensions.digest(
    'gridex-public-reference:v1:'||company_id::text||':customer:'||id::text,'sha256'),'base64'),'='),'+/','-_'),1,32)
));

ALTER TABLE public.customer_identity_change_requests
  ADD COLUMN source_channel text NOT NULL DEFAULT 'ops' CHECK(source_channel IN ('ops','staff_api')),
  ADD COLUMN api_client_id uuid REFERENCES public.integration_api_clients(id),
  ADD CONSTRAINT customer_identity_change_requests_staff_client_check CHECK(source_channel<>'staff_api' OR api_client_id IS NOT NULL);

CREATE FUNCTION public.gridex_audit_staff_identity_request_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.source_channel='staff_api' THEN
    PERFORM public.gridex_staff_assert_write_actor_v1(NEW.company_id,NEW.requested_by,NEW.api_client_id,'customers.write');
    INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    VALUES(NEW.company_id,NEW.requested_by,'customer',NEW.customer_id::text,'customer_identity_change_requested',
      jsonb_build_object(NEW.field,public.gridex_mask_identity_number(NEW.previous_value)),
      jsonb_build_object(NEW.field,public.gridex_mask_identity_number(NEW.new_value)),
      jsonb_build_object('channel','staff_api','api_client_id',NEW.api_client_id,'identity_change_request_id',NEW.id));
  END IF;
  RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.gridex_audit_staff_identity_request_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_audit_staff_identity_request_v1() TO service_role;
CREATE FUNCTION public.gridex_identity_request_staff_origin_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.source_channel IS DISTINCT FROM OLD.source_channel OR NEW.api_client_id IS DISTINCT FROM OLD.api_client_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'identity_request_origin_immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.gridex_identity_request_staff_origin_immutable_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER customer_identity_change_requests_origin_immutable BEFORE UPDATE ON public.customer_identity_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.gridex_identity_request_staff_origin_immutable_v1();
CREATE TRIGGER customer_identity_change_requests_staff_audit AFTER INSERT ON public.customer_identity_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.gridex_audit_staff_identity_request_v1();

CREATE OR REPLACE FUNCTION public.gridex_customer_contact_change_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_api_client_id uuid,
  p_portal_identity_id text,
  p_channel text,
  p_expected_updated_at timestamptz,
  p_customer_patch jsonb,
  p_contact_patch jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_allowed_customer constant text[] := ARRAY[
    'customer_type','status','first_name','last_name','full_name','company_name','personal_number','org_number',
    'email','phone','invoice_email','preferred_language','apartment_number','metadata'
  ];
  v_allowed_contact constant text[] := ARRAY['name','email','phone'];
  v_customer public.customers%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_contact public.customer_contacts%ROWTYPE;
  v_contact_before jsonb := NULL;
  v_contact_after jsonb := NULL;
  v_changes jsonb := '{}'::jsonb;
  v_contact_changes jsonb := '{}'::jsonb;
  v_key text;
  v_event_id uuid;
  v_now timestamptz := clock_timestamp();
  v_idempotency_key text;
BEGIN
  IF p_actor_kind NOT IN ('staff','customer_portal') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_actor_kind_invalid';
  END IF;
  IF p_actor_kind='staff' AND p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_staff_actor_required';
  END IF;
  IF p_actor_kind='customer_portal' AND p_api_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_api_client_required';
  END IF;
  IF p_channel NOT IN ('ops','customer_api','phone','staff_api') OR p_channel IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='contact_change_channel_invalid';
  END IF;
  IF p_channel='staff_api' THEN
    IF p_actor_kind IS DISTINCT FROM 'staff' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contact_change_staff_api_actor_invalid';
    END IF;
    PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'masterdata.write');
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_customer_patch,'{}'::jsonb)) LOOP
    IF NOT v_key = ANY(v_allowed_customer) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_field_not_allowed:'||v_key;
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_contact_patch,'{}'::jsonb)) LOOP
    IF NOT v_key = ANY(v_allowed_contact) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_contact_field_not_allowed:'||v_key;
    END IF;
  END LOOP;

  v_idempotency_key := CASE WHEN p_idempotency_key IS NULL THEN NULL
    WHEN p_channel='staff_api' THEN 'customer.contact_changed:'||p_company_id||':staff_api:'||p_api_client_id||':'||p_customer_id||':'||p_idempotency_key
    ELSE 'customer.contact_changed:'||p_company_id||':'||p_idempotency_key END;

  -- Idempotent replay: the same key returns the recorded result without writing again.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM public.domain_events
      WHERE company_id=p_company_id AND idempotency_key=v_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('replayed',true,'domain_event_id',v_event_id);
    END IF;
  END IF;

  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_not_found_in_scope';
  END IF;

  -- Staff: the canonical resolver grants masterdata.write in exactly this company (active member
  -- with the permission) or to an active platform superadmin; disabled/banned users never pass.
  IF p_actor_kind='staff'
     AND NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write'),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='contact_change_actor_not_authorized';
  END IF;

  IF v_customer.merged_into_customer_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='customer_merged_write_conflict';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_customer.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='contact_change_version_conflict';
  END IF;
  IF v_customer.status='archived' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='contact_change_customer_archived';
  END IF;

  v_before := to_jsonb(v_customer);
  SELECT jsonb_object_agg(e.key, jsonb_build_object('from', v_before->e.key, 'to', e.value))
    INTO v_changes
    FROM jsonb_each(coalesce(p_customer_patch,'{}'::jsonb)) e
    WHERE (v_before->e.key) IS DISTINCT FROM e.value;
  v_changes := coalesce(v_changes,'{}'::jsonb);

  IF v_changes <> '{}'::jsonb THEN
    UPDATE public.customers c SET
      customer_type = CASE WHEN p_customer_patch ? 'customer_type' THEN p_customer_patch->>'customer_type' ELSE c.customer_type END,
      status = CASE WHEN p_customer_patch ? 'status' THEN p_customer_patch->>'status' ELSE c.status END,
      first_name = CASE WHEN p_customer_patch ? 'first_name' THEN p_customer_patch->>'first_name' ELSE c.first_name END,
      last_name = CASE WHEN p_customer_patch ? 'last_name' THEN p_customer_patch->>'last_name' ELSE c.last_name END,
      full_name = CASE WHEN p_customer_patch ? 'full_name' THEN p_customer_patch->>'full_name' ELSE c.full_name END,
      company_name = CASE WHEN p_customer_patch ? 'company_name' THEN p_customer_patch->>'company_name' ELSE c.company_name END,
      personal_number = CASE WHEN p_customer_patch ? 'personal_number' THEN p_customer_patch->>'personal_number' ELSE c.personal_number END,
      org_number = CASE WHEN p_customer_patch ? 'org_number' THEN p_customer_patch->>'org_number' ELSE c.org_number END,
      email = CASE WHEN p_customer_patch ? 'email' THEN p_customer_patch->>'email' ELSE c.email END,
      phone = CASE WHEN p_customer_patch ? 'phone' THEN p_customer_patch->>'phone' ELSE c.phone END,
      invoice_email = CASE WHEN p_customer_patch ? 'invoice_email' THEN p_customer_patch->>'invoice_email' ELSE c.invoice_email END,
      preferred_language = CASE WHEN p_customer_patch ? 'preferred_language' THEN p_customer_patch->>'preferred_language' ELSE c.preferred_language END,
      apartment_number = CASE WHEN p_customer_patch ? 'apartment_number' THEN p_customer_patch->>'apartment_number' ELSE c.apartment_number END,
      metadata = CASE WHEN p_customer_patch ? 'metadata' THEN p_customer_patch->'metadata' ELSE c.metadata END,
      updated_at = v_now
    WHERE c.id=v_customer.id AND c.company_id=p_company_id
    RETURNING * INTO v_customer;
  END IF;
  v_after := to_jsonb(v_customer);

  IF coalesce(p_contact_patch,'{}'::jsonb) <> '{}'::jsonb THEN
    SELECT * INTO v_contact FROM public.customer_contacts
      WHERE company_id=p_company_id AND customer_id=p_customer_id AND is_primary
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      v_contact_before := to_jsonb(v_contact);
      SELECT jsonb_object_agg(e.key, jsonb_build_object('from', v_contact_before->e.key, 'to', e.value))
        INTO v_contact_changes
        FROM jsonb_each(p_contact_patch) e
        WHERE (v_contact_before->e.key) IS DISTINCT FROM e.value;
      v_contact_changes := coalesce(v_contact_changes,'{}'::jsonb);
      IF v_contact_changes <> '{}'::jsonb THEN
        UPDATE public.customer_contacts cc SET
          name = CASE WHEN p_contact_patch ? 'name' THEN p_contact_patch->>'name' ELSE cc.name END,
          email = CASE WHEN p_contact_patch ? 'email' THEN p_contact_patch->>'email' ELSE cc.email END,
          phone = CASE WHEN p_contact_patch ? 'phone' THEN p_contact_patch->>'phone' ELSE cc.phone END
        WHERE cc.id=v_contact.id AND cc.company_id=p_company_id AND cc.customer_id=p_customer_id
        RETURNING to_jsonb(cc.*) INTO v_contact_after;
      END IF;
    ELSIF p_contact_patch ? 'name' OR p_contact_patch ? 'email' OR p_contact_patch ? 'phone' THEN
      INSERT INTO public.customer_contacts(company_id,customer_id,type,name,email,phone,title,is_primary)
      VALUES (p_company_id,p_customer_id,'primary',p_contact_patch->>'name',p_contact_patch->>'email',p_contact_patch->>'phone',NULL,true)
      RETURNING to_jsonb(customer_contacts.*) INTO v_contact_after;
      v_contact_changes := jsonb_build_object('created', true);
    END IF;
  END IF;

  IF v_changes = '{}'::jsonb AND v_contact_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object('replayed',false,'changed',false,'customer_updated_at',v_customer.updated_at);
  END IF;

  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  VALUES (
    p_company_id, p_actor_user_id, 'customer', p_customer_id::text, 'customer_profile_updated',
    (SELECT coalesce(jsonb_object_agg(k, v->'from'),'{}'::jsonb) FROM jsonb_each(v_changes) x(k,v)),
    (SELECT coalesce(jsonb_object_agg(k, v->'to'),'{}'::jsonb) FROM jsonb_each(v_changes) x(k,v)),
    jsonb_build_object(
      'channel', p_channel,
      'actor_type', CASE WHEN p_actor_kind='staff' THEN 'staff' ELSE 'customer_portal_account' END,
      'api_client_id', p_api_client_id,
      'portal_identity_id', p_portal_identity_id,
      'primary_contact_changes', v_contact_changes,
      'transaction', 'gridex_customer_contact_change_v1'
    )
  );

  -- Durable integration intent. Only changed field names leave the database; values stay internal.
  INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,idempotency_key,payload)
  VALUES (
    p_company_id, 'customer.contact_changed', 'customer', p_customer_id::text, p_customer_id, p_actor_user_id,
    CASE WHEN p_channel='staff_api' THEN 'staff_api' WHEN p_actor_kind='staff' THEN 'ops' ELSE 'customer_api' END,
    v_idempotency_key,
    jsonb_build_object(
      'changed_fields', (SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(v_changes) k),
      'primary_contact_changed', v_contact_changes <> '{}'::jsonb,
      'channel',p_channel,
      'api_client_id',p_api_client_id,
      'actor_user_id',p_actor_user_id,
      'customer_version', v_customer.updated_at
    )
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
  VALUES (p_company_id, v_event_id, 'webhook', 'webhook_fanout_v1', 'queued', 0, 12, v_now,
    jsonb_build_object('event_type','customer.contact_changed','aggregate_type','customer','aggregate_id',p_customer_id::text));

  RETURN jsonb_build_object(
    'replayed', false,
    'changed', true,
    'domain_event_id', v_event_id,
    'customer_updated_at', v_customer.updated_at,
    'changes', v_changes,
    'primary_contact_changes', v_contact_changes
  );
END
$$;

CREATE OR REPLACE FUNCTION public.gridex_decide_customer_identity_change_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_outcome text,
  p_decided_by text,
  p_actor_user_id uuid DEFAULT NULL,
  p_acceptance jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r public.customer_identity_change_requests%rowtype;
  v_current text;
BEGIN
  IF p_outcome NOT IN ('applied', 'rejected', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'identity_change_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_decided_by NOT IN ('customer', 'staff', 'system') THEN
    RAISE EXCEPTION 'identity_change_actor_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.customer_identity_change_requests
   WHERE id = p_request_id AND company_id = p_company_id
   FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'identity_change_not_found' USING ERRCODE = 'P0002'; END IF;

  IF r.source_channel='staff_api' AND p_decided_by='staff' THEN
    PERFORM public.gridex_staff_assert_write_actor_v1(r.company_id,p_actor_user_id,r.api_client_id,'customers.write');
  END IF;
  IF r.status <> 'pending_customer_approval' THEN
    RAISE EXCEPTION 'identity_change_not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_outcome = 'applied' AND r.approval_required AND p_decided_by <> 'customer' THEN
    RAISE EXCEPTION 'identity_change_requires_customer_approval' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IN ('applied', 'rejected') AND r.approval_required AND r.expires_at <= now() THEN
    UPDATE public.customer_identity_change_requests SET status = 'expired', decided_at = now(), decided_by = 'system' WHERE id = r.id;
    INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, field, previous_value_masked, new_value_masked)
    VALUES (r.company_id, r.customer_id, r.id, 'expired', 'system', r.field,
            public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value));
    RETURN jsonb_build_object('status', 'expired', 'request_id', r.id);
  END IF;

  -- A takeover of binding contracts needs the new party's explicit acceptance of exactly the
  -- contracts and terms that were shown (same snapshot hash), each confirmation separately.
  IF p_outcome = 'applied' AND r.takeover_required THEN
    IF p_acceptance IS NULL
       OR p_acceptance->>'snapshot_sha256' IS DISTINCT FROM r.takeover_snapshot_sha256
       OR (p_acceptance->'confirmations'->>'identity') IS DISTINCT FROM 'true'
       OR (p_acceptance->'confirmations'->>'contracts') IS DISTINCT FROM 'true'
       OR (p_acceptance->'confirmations'->>'terms') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'identity_change_takeover_acceptance_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_outcome = 'applied' THEN
    -- The value must still be what the request was based on; otherwise someone changed it meanwhile.
    EXECUTE format('SELECT %I FROM public.customers WHERE company_id = $1 AND id = $2 FOR UPDATE', r.field)
      INTO v_current USING r.company_id, r.customer_id;
    IF v_current IS DISTINCT FROM r.previous_value THEN
      RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = '40001';
    END IF;
    EXECUTE format('UPDATE public.customers SET %I = $1, updated_at = now() WHERE company_id = $2 AND id = $3', r.field)
      USING r.new_value, r.company_id, r.customer_id;
  END IF;

  UPDATE public.customer_identity_change_requests
     SET status = p_outcome, decided_at = now(), decided_by = p_decided_by,
         acceptance_evidence = CASE WHEN p_outcome = 'applied' AND p_decided_by = 'customer' AND p_acceptance IS NOT NULL
                                    THEN p_acceptance || jsonb_build_object('accepted_at', now())
                                    ELSE acceptance_evidence END
   WHERE id = r.id;

  IF r.approval_required AND p_outcome IN ('applied', 'rejected') THEN
    INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, actor_user_id, field, previous_value_masked, new_value_masked)
    VALUES (r.company_id, r.customer_id, r.id, CASE WHEN p_outcome = 'applied' THEN 'approved' ELSE 'rejected' END,
            p_decided_by, p_actor_user_id, r.field,
            public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value));
  END IF;
  INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, actor_user_id, field, previous_value_masked, new_value_masked, detail)
  VALUES (r.company_id, r.customer_id, r.id,
          CASE p_outcome WHEN 'applied' THEN 'applied' WHEN 'rejected' THEN 'rejected' ELSE p_outcome END,
          p_decided_by, p_actor_user_id, r.field,
          public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value),
          jsonb_build_object('affected_contract_count', r.affected_contract_count, 'approval_required', r.approval_required,
                             'takeover_required', r.takeover_required, 'takeover_snapshot_sha256', r.takeover_snapshot_sha256,
                             'document_sha256', r.document_sha256,
                             'channel',r.source_channel,'api_client_id',r.api_client_id,
                             'originating_staff_actor_user_id',r.requested_by));

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, system_actor, entity_type, entity_id, action,
                                 old_values, new_values, metadata, request_id, correlation_id, resource_type, resource_id)
  VALUES (r.company_id, p_actor_user_id,
          CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor_user_id IS NULL THEN 'customer_identity_change:' || p_decided_by ELSE NULL END,
          'customer', r.customer_id::text, 'customer_identity_change_' || p_outcome,
          jsonb_build_object(r.field, public.gridex_mask_identity_number(r.previous_value)),
          jsonb_build_object(r.field, public.gridex_mask_identity_number(r.new_value)),
          jsonb_build_object('identity_change_request_id', r.id, 'decided_by', p_decided_by,
                             'approval_required', r.approval_required, 'affected_contract_count', r.affected_contract_count,
                             'takeover_required', r.takeover_required, 'takeover_snapshot_sha256', r.takeover_snapshot_sha256,
                             'document_sha256', r.document_sha256,
                             'channel',r.source_channel,'api_client_id',r.api_client_id,
                             'originating_staff_actor_user_id',r.requested_by),
          r.id::text, r.id::text, 'customer_identity_change_request', r.id::text);

  RETURN jsonb_build_object('status', p_outcome, 'request_id', r.id, 'customer_id', r.customer_id, 'field', r.field);
END $$;
REVOKE ALL ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_decide_customer_identity_change_v1(uuid,uuid,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_decide_customer_identity_change_v1(uuid,uuid,text,text,uuid,jsonb) TO service_role;
COMMIT;
