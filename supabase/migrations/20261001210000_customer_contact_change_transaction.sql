-- Tenantservice P2b: one database transaction for a customer contact/profile change.
--
-- OPS (named employee) and the customer API (linked portal account through an API client) call
-- the same command. Inside one transaction it:
--   1. locks the customer row in the given company and checks the expected version,
--   2. applies only the allow-listed customer fields that are present in the patch,
--   3. applies the primary-contact patch (when a primary contact exists),
--   4. writes the fail-closed audit row with the real actor,
--   5. records the domain event and its durable webhook outbox intent (idempotent per key).
-- Any failure rolls everything back. External effects run later from the outbox.

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
    'email','phone','preferred_language','apartment_number','metadata'
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

  -- Idempotent replay: the same key returns the recorded result without writing again.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM public.domain_events
      WHERE idempotency_key = 'customer.contact_changed:'||p_company_id||':'||p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('replayed',true,'domain_event_id',v_event_id);
    END IF;
  END IF;

  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_not_found_in_scope';
  END IF;

  -- Staff must be an active member of exactly this company with masterdata.write.
  IF p_actor_kind='staff' AND NOT (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.company_memberships cm ON cm.user_id=up.id AND cm.company_id=p_company_id
      WHERE up.id=p_actor_user_id AND up.user_status='active'
        AND cm.status='active' AND coalesce(cm.is_active,true)
    ) AND (
      coalesce(public.canonical_actor_is_platform_admin(p_actor_user_id),false)
      OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write'),false)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='contact_change_actor_not_authorized';
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
    CASE WHEN p_actor_kind='staff' THEN 'ops' ELSE 'customer_api' END,
    CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE 'customer.contact_changed:'||p_company_id||':'||p_idempotency_key END,
    jsonb_build_object(
      'changed_fields', (SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(v_changes) k),
      'primary_contact_changed', v_contact_changes <> '{}'::jsonb,
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

REVOKE ALL ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)
  TO service_role;

COMMENT ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) IS
  'Tenantservice P2b: atomic customer contact/profile change (customer, primary contact, audit, domain event, outbox) for OPS and the customer API.';
