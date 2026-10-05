-- API read prerequisite only. Creates empty private canonical journal structures
-- where the entire prerequisite is absent; verifies an existing canonical
-- catalog without altering it. No eraser/workflow/provider entry is installed.
-- One atomic DO statement permits byte-identical BEGIN/ROLLBACK rehearsal.
DO $staff_retention_read$
DECLARE
 migration_role text := current_user;
 owner_id oid := to_regrole('gridex_ediel_retention_owner')::oid;
 namespace_id oid := to_regnamespace('gridex_ediel_retention')::oid;
 table_name text;
 relation_id oid;
 app_role text;
 expected record;
 owner_had_public_create boolean;
 owner_had_database_create boolean;
 expected_columns constant jsonb := '[{"t":"record_class_catalog","n":"retention_class","y":"text","r":true,"d":null},{"t":"record_class_catalog","n":"source_table","y":"text","r":true,"d":null},{"t":"record_class_catalog","n":"permission_key","y":"text","r":true,"d":null},{"t":"record_class_catalog","n":"operation","y":"text","r":true,"d":null},{"t":"record_class_catalog","n":"redaction","y":"jsonb","r":true,"d":null},{"t":"record_decisions","n":"id","y":"uuid","r":true,"d":"gen_random_uuid()"},{"t":"record_decisions","n":"company_id","y":"uuid","r":true,"d":null},{"t":"record_decisions","n":"retention_class","y":"text","r":true,"d":null},{"t":"record_decisions","n":"target_id","y":"uuid","r":true,"d":null},{"t":"record_decisions","n":"customer_id","y":"uuid","r":true,"d":null},{"t":"record_decisions","n":"contract_id","y":"uuid","r":false,"d":null},{"t":"record_decisions","n":"source_hash","y":"text","r":true,"d":null},{"t":"record_decisions","n":"target_hash","y":"text","r":true,"d":null},{"t":"record_decisions","n":"document_bytes","y":"bytea","r":false,"d":null},{"t":"record_decisions","n":"document_hash","y":"text","r":true,"d":null},{"t":"record_decisions","n":"issuer_receipt","y":"jsonb","r":false,"d":null},{"t":"record_decisions","n":"submitted_by","y":"uuid","r":true,"d":null},{"t":"record_decisions","n":"created_at","y":"timestamp with time zone","r":true,"d":"clock_timestamp()"},{"t":"record_decisions","n":"document_byte_length","y":"bigint","r":false,"d":null},{"t":"record_decisions","n":"document_purged_at","y":"timestamp with time zone","r":false,"d":null},{"t":"record_reviews","n":"id","y":"uuid","r":true,"d":"gen_random_uuid()"},{"t":"record_reviews","n":"decision_id","y":"uuid","r":true,"d":null},{"t":"record_reviews","n":"actor_user_id","y":"uuid","r":true,"d":null},{"t":"record_reviews","n":"outcome","y":"text","r":true,"d":null},{"t":"record_reviews","n":"reason","y":"text","r":true,"d":null},{"t":"record_reviews","n":"created_at","y":"timestamp with time zone","r":true,"d":"clock_timestamp()"},{"t":"record_tombstones","n":"retention_class","y":"text","r":true,"d":null},{"t":"record_tombstones","n":"target_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"company_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"customer_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"contract_id","y":"uuid","r":false,"d":null},{"t":"record_tombstones","n":"decision_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"review_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"source_hash","y":"text","r":true,"d":null},{"t":"record_tombstones","n":"target_hash","y":"text","r":true,"d":null},{"t":"record_tombstones","n":"byte_length","y":"bigint","r":true,"d":null},{"t":"record_tombstones","n":"storage_path","y":"text","r":false,"d":null},{"t":"record_tombstones","n":"actor_user_id","y":"uuid","r":true,"d":null},{"t":"record_tombstones","n":"journal_retain_until","y":"timestamp with time zone","r":true,"d":null},{"t":"record_tombstones","n":"journal_purpose_reference","y":"text","r":true,"d":null},{"t":"record_tombstones","n":"created_at","y":"timestamp with time zone","r":true,"d":"clock_timestamp()"}]'::jsonb;
 expected_constraints constant jsonb := '[{"t":"record_class_catalog","n":"record_class_catalog_pkey","d":"PRIMARY KEY (retention_class)","f":null},{"t":"record_class_catalog","n":"record_class_catalog_redaction_check","d":"CHECK ((jsonb_typeof(redaction) = ''object''::text))","f":null},{"t":"record_class_catalog","n":"record_class_catalog_source_table_key","d":"UNIQUE (source_table)","f":null},{"t":"record_decisions","n":"decision_original_byte_custody","d":"CHECK ((((document_bytes IS NOT NULL) AND (document_purged_at IS NULL)) OR ((document_bytes IS NULL) AND (document_purged_at IS NOT NULL) AND (document_byte_length > 0))))","f":null},{"t":"record_decisions","n":"record_decisions_check","d":"CHECK ((document_hash = encode(sha256(document_bytes), ''hex''::text)))","f":null},{"t":"record_decisions","n":"record_decisions_company_id_fkey","d":"FOREIGN KEY (company_id) REFERENCES companies(id)","f":"public.companies"},{"t":"record_decisions","n":"record_decisions_company_id_retention_class_target_id_targe_key","d":"UNIQUE (company_id, retention_class, target_id, target_hash, document_hash)","f":null},{"t":"record_decisions","n":"record_decisions_customer_id_fkey","d":"FOREIGN KEY (customer_id) REFERENCES customers(id)","f":"public.customers"},{"t":"record_decisions","n":"record_decisions_document_bytes_check","d":"CHECK (((octet_length(document_bytes) >= 1) AND (octet_length(document_bytes) <= 1048576)))","f":null},{"t":"record_decisions","n":"record_decisions_pkey","d":"PRIMARY KEY (id)","f":null},{"t":"record_decisions","n":"record_decisions_retention_class_fkey","d":"FOREIGN KEY (retention_class) REFERENCES gridex_ediel_retention.record_class_catalog(retention_class)","f":"gridex_ediel_retention.record_class_catalog"},{"t":"record_decisions","n":"record_decisions_source_hash_check","d":"CHECK ((source_hash ~ ''^[a-f0-9]{64}$''::text))","f":null},{"t":"record_decisions","n":"record_decisions_submitted_by_fkey","d":"FOREIGN KEY (submitted_by) REFERENCES auth.users(id)","f":"auth.users"},{"t":"record_decisions","n":"record_decisions_target_hash_check","d":"CHECK ((target_hash ~ ''^[a-f0-9]{64}$''::text))","f":null},{"t":"record_reviews","n":"record_reviews_actor_user_id_fkey","d":"FOREIGN KEY (actor_user_id) REFERENCES auth.users(id)","f":"auth.users"},{"t":"record_reviews","n":"record_reviews_decision_id_fkey","d":"FOREIGN KEY (decision_id) REFERENCES gridex_ediel_retention.record_decisions(id)","f":"gridex_ediel_retention.record_decisions"},{"t":"record_reviews","n":"record_reviews_outcome_check","d":"CHECK ((outcome = ANY (ARRAY[''approved''::text, ''held''::text, ''rejected''::text])))","f":null},{"t":"record_reviews","n":"record_reviews_pkey","d":"PRIMARY KEY (id)","f":null},{"t":"record_tombstones","n":"record_tombstones_actor_user_id_fkey","d":"FOREIGN KEY (actor_user_id) REFERENCES auth.users(id)","f":"auth.users"},{"t":"record_tombstones","n":"record_tombstones_byte_length_check","d":"CHECK ((byte_length > 0))","f":null},{"t":"record_tombstones","n":"record_tombstones_decision_id_fkey","d":"FOREIGN KEY (decision_id) REFERENCES gridex_ediel_retention.record_decisions(id)","f":"gridex_ediel_retention.record_decisions"},{"t":"record_tombstones","n":"record_tombstones_pkey","d":"PRIMARY KEY (retention_class, target_id)","f":null},{"t":"record_tombstones","n":"record_tombstones_retention_class_fkey","d":"FOREIGN KEY (retention_class) REFERENCES gridex_ediel_retention.record_class_catalog(retention_class)","f":"gridex_ediel_retention.record_class_catalog"},{"t":"record_tombstones","n":"record_tombstones_review_id_fkey","d":"FOREIGN KEY (review_id) REFERENCES gridex_ediel_retention.record_reviews(id)","f":"gridex_ediel_retention.record_reviews"}]'::jsonb;
 expected_classes constant jsonb := '[{"retention_class":"contract_acceptance_personal_snapshot","source_table":"customer_contract_acceptances","permission_key":"ediel.retention.signature","operation":"redact_contract_acceptance_personal","redaction":{"ip_hash":null,"user_agent":null,"acceptance_snapshot":{},"customer_identity_snapshot":{},"power_of_attorney_snapshot":{}}},{"retention_class":"contract_evidence_personal_snapshot","source_table":"customer_contract_evidence","permission_key":"ediel.retention.signature","operation":"redact_contract_evidence_personal","redaction":{"evidence_snapshot":{}}},{"retention_class":"contract_signature_personal_snapshot","source_table":"customer_contracts","permission_key":"ediel.retention.signature","operation":"redact_contract_signature_personal_snapshot","redaction":{"signed_ip_hash":null,"signed_user_agent":null,"signature_snapshot":{}}},{"retention_class":"contract_signature_request_personal","source_table":"customer_contract_signature_requests","permission_key":"ediel.retention.signature","operation":"redact_signature_request_personal","redaction":{"metadata":{},"recipient_email":"RETENTION_EMAIL"}},{"retention_class":"contract_signed_pdf_bytes","source_table":"customer_contract_documents","permission_key":"ediel.retention.contract_pdf","operation":"remove_contract_pdf_bytes","redaction":{"storage_path":null,"generation_snapshot":{}}},{"retention_class":"customer_address_history","source_table":"customer_addresses","permission_key":"ediel.retention.address_history","operation":"redact_inactive_customer_address","redaction":{"city":null,"metadata":{},"street_1":null,"street_2":null,"postal_code":null,"municipality":null}},{"retention_class":"legal_acceptance_personal_snapshot","source_table":"customer_legal_acceptances","permission_key":"ediel.retention.legal_history","operation":"redact_legal_acceptance_personal","redaction":{"metadata":{},"snapshot":{},"accepted_ip":null,"customer_number":null,"accepted_ip_hash":null,"accepted_user_agent":null,"external_customer_id":null}},{"retention_class":"onboarding_legal_personal_snapshot","source_table":"customer_onboarding_legal_snapshots","permission_key":"ediel.retention.legal_history","operation":"redact_onboarding_legal_personal","redaction":{"acceptance_snapshot":{},"signed_scope_snapshot":[]}},{"retention_class":"portal_access_log_history","source_table":"customer_portal_api_access_logs","permission_key":"ediel.retention.portal_history","operation":"redact_portal_access_log_personal","redaction":{"metadata":{},"external_customer_id":null}},{"retention_class":"portal_customer_event_history","source_table":"customer_events","permission_key":"ediel.retention.portal_history","operation":"redact_portal_customer_event_personal","redaction":{"payload":{},"metadata":{},"customer_number":null,"external_customer_id":null}},{"retention_class":"portal_domain_event_history","source_table":"domain_events","permission_key":"ediel.retention.portal_history","operation":"redact_portal_domain_event_personal","redaction":{"payload":{},"actor_user_id":null}},{"retention_class":"portal_event_history","source_table":"customer_portal_events","permission_key":"ediel.retention.portal_history","operation":"redact_portal_event_personal","redaction":{"payload":{},"user_id":null,"metadata":{}}}]'::jsonb;
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog, public',true);
 IF migration_role IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=migration_role AND (rolsuper OR (rolcreaterole AND rolbypassrls))) THEN
  RAISE EXCEPTION 'staff_retention_read_migration_role_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure('gridex_received_sources.reject_mutation()') AND p.prorettype='trigger'::regtype
   AND l.lanname='plpgsql' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='0d736e35ddb2519022243066a4362e2dacc38d9a9cdccfc42de28846c888d01a') THEN
  RAISE EXCEPTION 'staff_retention_read_immutable_guard_required';
 END IF;
 IF namespace_id IS NULL AND owner_id IS NULL AND to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)') IS NULL THEN
  IF has_database_privilege(migration_role,current_database(),'CREATE WITH GRANT OPTION') IS NOT TRUE
  OR has_schema_privilege(migration_role,'public','CREATE WITH GRANT OPTION') IS NOT TRUE
  OR has_table_privilege(migration_role,'public.customers','SELECT WITH GRANT OPTION') IS NOT TRUE
  OR has_table_privilege(migration_role,'public.customers','UPDATE WITH GRANT OPTION') IS NOT TRUE THEN
   RAISE EXCEPTION 'staff_retention_read_migration_grantor_required' USING ERRCODE='42501';
  END IF;
  CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;
  GRANT gridex_ediel_retention_owner TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
  -- Build under the migration owner; transfer only after its guarded DDL.
  CREATE SCHEMA gridex_ediel_retention;
  REVOKE ALL ON SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role;
  GRANT USAGE,CREATE ON SCHEMA gridex_ediel_retention TO gridex_ediel_retention_owner;
CREATE TABLE gridex_ediel_retention.record_class_catalog (
    retention_class text NOT NULL,
    source_table text NOT NULL,
    permission_key text NOT NULL,
    operation text NOT NULL,
    redaction jsonb NOT NULL,
    CONSTRAINT record_class_catalog_redaction_check CHECK ((jsonb_typeof(redaction) = 'object'::text))
);
ALTER TABLE ONLY gridex_ediel_retention.record_class_catalog
    ADD CONSTRAINT record_class_catalog_pkey PRIMARY KEY (retention_class);
ALTER TABLE ONLY gridex_ediel_retention.record_class_catalog
    ADD CONSTRAINT record_class_catalog_source_table_key UNIQUE (source_table);
CREATE TABLE gridex_ediel_retention.record_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    retention_class text NOT NULL,
    target_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    contract_id uuid,
    source_hash text NOT NULL,
    target_hash text NOT NULL,
    document_bytes bytea,
    document_hash text NOT NULL,
    issuer_receipt jsonb,
    submitted_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    document_byte_length bigint,
    document_purged_at timestamp with time zone,
    CONSTRAINT decision_original_byte_custody CHECK ((((document_bytes IS NOT NULL) AND (document_purged_at IS NULL)) OR ((document_bytes IS NULL) AND (document_purged_at IS NOT NULL) AND (document_byte_length > 0)))),
    CONSTRAINT record_decisions_check CHECK ((document_hash = encode(sha256(document_bytes), 'hex'::text))),
    CONSTRAINT record_decisions_document_bytes_check CHECK (((octet_length(document_bytes) >= 1) AND (octet_length(document_bytes) <= 1048576))),
    CONSTRAINT record_decisions_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT record_decisions_target_hash_check CHECK ((target_hash ~ '^[a-f0-9]{64}$'::text))
);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_company_id_retention_class_target_id_targe_key UNIQUE (company_id, retention_class, target_id, target_hash, document_hash);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_retention_class_fkey FOREIGN KEY (retention_class) REFERENCES gridex_ediel_retention.record_class_catalog(retention_class);
ALTER TABLE ONLY gridex_ediel_retention.record_decisions
    ADD CONSTRAINT record_decisions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id);
CREATE TABLE gridex_ediel_retention.record_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    outcome text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT record_reviews_outcome_check CHECK ((outcome = ANY (ARRAY['approved'::text, 'held'::text, 'rejected'::text])))
);
ALTER TABLE ONLY gridex_ediel_retention.record_reviews
    ADD CONSTRAINT record_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY gridex_ediel_retention.record_reviews
    ADD CONSTRAINT record_reviews_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY gridex_ediel_retention.record_reviews
    ADD CONSTRAINT record_reviews_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES gridex_ediel_retention.record_decisions(id);
CREATE TABLE gridex_ediel_retention.record_tombstones (
    retention_class text NOT NULL,
    target_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    contract_id uuid,
    decision_id uuid NOT NULL,
    review_id uuid NOT NULL,
    source_hash text NOT NULL,
    target_hash text NOT NULL,
    byte_length bigint NOT NULL,
    storage_path text,
    actor_user_id uuid NOT NULL,
    journal_retain_until timestamp with time zone NOT NULL,
    journal_purpose_reference text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT record_tombstones_byte_length_check CHECK ((byte_length > 0))
);
ALTER TABLE ONLY gridex_ediel_retention.record_tombstones
    ADD CONSTRAINT record_tombstones_pkey PRIMARY KEY (retention_class, target_id);
ALTER TABLE ONLY gridex_ediel_retention.record_tombstones
    ADD CONSTRAINT record_tombstones_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY gridex_ediel_retention.record_tombstones
    ADD CONSTRAINT record_tombstones_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES gridex_ediel_retention.record_decisions(id);
ALTER TABLE ONLY gridex_ediel_retention.record_tombstones
    ADD CONSTRAINT record_tombstones_retention_class_fkey FOREIGN KEY (retention_class) REFERENCES gridex_ediel_retention.record_class_catalog(retention_class);
ALTER TABLE ONLY gridex_ediel_retention.record_tombstones
    ADD CONSTRAINT record_tombstones_review_id_fkey FOREIGN KEY (review_id) REFERENCES gridex_ediel_retention.record_reviews(id);
INSERT INTO gridex_ediel_retention.record_class_catalog VALUES
('contract_signed_pdf_bytes','customer_contract_documents','ediel.retention.contract_pdf','remove_contract_pdf_bytes','{"storage_path": null, "generation_snapshot": {}}'::jsonb),
 ('contract_signature_personal_snapshot','customer_contracts','ediel.retention.signature','redact_contract_signature_personal_snapshot','{"signature_snapshot": {}, "signed_ip_hash": null, "signed_user_agent": null}'::jsonb),
 ('contract_signature_request_personal','customer_contract_signature_requests','ediel.retention.signature','redact_signature_request_personal','{"recipient_email": "RETENTION_EMAIL", "metadata": {}}'::jsonb),
 ('contract_acceptance_personal_snapshot','customer_contract_acceptances','ediel.retention.signature','redact_contract_acceptance_personal','{"ip_hash": null, "user_agent": null, "customer_identity_snapshot": {}, "power_of_attorney_snapshot": {}, "acceptance_snapshot": {}}'::jsonb),
 ('contract_evidence_personal_snapshot','customer_contract_evidence','ediel.retention.signature','redact_contract_evidence_personal','{"evidence_snapshot": {}}'::jsonb),
 ('customer_address_history','customer_addresses','ediel.retention.address_history','redact_inactive_customer_address','{"street_1": null, "street_2": null, "postal_code": null, "city": null, "municipality": null, "metadata": {}}'::jsonb),
 ('portal_event_history','customer_portal_events','ediel.retention.portal_history','redact_portal_event_personal','{"user_id": null, "payload": {}, "metadata": {}}'::jsonb),
 ('portal_access_log_history','customer_portal_api_access_logs','ediel.retention.portal_history','redact_portal_access_log_personal','{"external_customer_id": null, "metadata": {}}'::jsonb),
 ('portal_customer_event_history','customer_events','ediel.retention.portal_history','redact_portal_customer_event_personal','{"external_customer_id": null, "customer_number": null, "payload": {}, "metadata": {}}'::jsonb),
 ('portal_domain_event_history','domain_events','ediel.retention.portal_history','redact_portal_domain_event_personal','{"actor_user_id": null, "payload": {}}'::jsonb),
 ('legal_acceptance_personal_snapshot','customer_legal_acceptances','ediel.retention.legal_history','redact_legal_acceptance_personal','{"accepted_ip": null, "accepted_ip_hash": null, "accepted_user_agent": null, "snapshot": {}, "metadata": {}, "customer_number": null, "external_customer_id": null}'::jsonb),
 ('onboarding_legal_personal_snapshot','customer_onboarding_legal_snapshots','ediel.retention.legal_history','redact_onboarding_legal_personal','{"signed_scope_snapshot": [], "acceptance_snapshot": {}}'::jsonb);

  FOREACH table_name IN ARRAY ARRAY['record_class_catalog','record_decisions','record_reviews','record_tombstones'] LOOP
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',table_name);
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',table_name);
   EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',table_name);
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',table_name||'_immutable',table_name);
   EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ediel_retention.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',table_name||'_no_truncate',table_name);
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',table_name);
  END LOOP;
  -- PostgreSQL requires CREATE on the database for the new schema owner.
  -- Preserve inherited/preexisting rights; remove only this temporary grant.
  owner_had_database_create := has_database_privilege('gridex_ediel_retention_owner',current_database(),'CREATE');
  IF NOT owner_had_database_create THEN
   EXECUTE format('GRANT CREATE ON DATABASE %I TO gridex_ediel_retention_owner',current_database());
  END IF;
  ALTER SCHEMA gridex_ediel_retention OWNER TO gridex_ediel_retention_owner;
  IF NOT owner_had_database_create THEN
   EXECUTE format('REVOKE CREATE ON DATABASE %I FROM gridex_ediel_retention_owner',current_database());
  END IF;
  GRANT USAGE ON SCHEMA public,gridex_received_sources TO gridex_ediel_retention_owner;
  GRANT SELECT,UPDATE ON public.customers TO gridex_ediel_retention_owner;
  owner_had_public_create := has_schema_privilege('gridex_ediel_retention_owner','public','CREATE');
  IF NOT owner_had_public_create THEN GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner; END IF;
CREATE FUNCTION public.ediel_customer_record_tombstones_v1(p_company_id uuid, p_customer_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$BEGIN
 PERFORM id FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_record_customer_scope_required';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('retentionClass',retention_class,'targetId',target_id,'sourceHash',source_hash,'journalRetainUntil',journal_retain_until,'personalDataAvailable',false) ORDER BY retention_class,target_id) FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id),'[]');
END$$;
  ALTER FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) OWNER TO gridex_ediel_retention_owner;
  EXECUTE 'SET LOCAL ROLE gridex_ediel_retention_owner';
  REVOKE ALL ON FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) TO service_role;
  EXECUTE format('SET LOCAL ROLE %I',migration_role);
  IF NOT owner_had_public_create THEN REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner; END IF;
  owner_id := to_regrole('gridex_ediel_retention_owner')::oid;
  namespace_id := to_regnamespace('gridex_ediel_retention')::oid;
 ELSIF namespace_id IS NULL OR owner_id IS NULL THEN
  RAISE EXCEPTION 'staff_retention_read_partial_prerequisite';
 END IF;
 -- All existing-object checks are read-only. Never repair drift in place.
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=owner_id AND NOT rolcanlogin AND NOT rolinherit
   AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE oid=namespace_id AND nspowner=owner_id)
 OR pg_has_role(migration_role,owner_id,'SET') IS NOT TRUE
 OR has_table_privilege(owner_id,'public.customers','SELECT') IS NOT TRUE
 OR has_table_privilege(owner_id,'public.customers','UPDATE') IS NOT TRUE THEN
  RAISE EXCEPTION 'staff_retention_read_private_owner_required' USING ERRCODE='42501';
 END IF;
 FOREACH app_role IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
  IF pg_has_role(app_role,owner_id,'MEMBER') OR has_schema_privilege(app_role,namespace_id,'USAGE,CREATE') THEN
   RAISE EXCEPTION 'staff_retention_read_private_schema_acl_required' USING ERRCODE='42501';
  END IF;
 END LOOP;
 -- The migration member has SET, not inherited access, to this private schema.
 EXECUTE 'SET LOCAL ROLE gridex_ediel_retention_owner';
 FOR expected IN SELECT * FROM jsonb_to_recordset(expected_columns) AS x(t text,n text,y text,r boolean,d text) LOOP
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE c.relnamespace=namespace_id AND c.relname=expected.t AND c.relkind='r' AND a.attname=expected.n
    AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attidentity=''
    AND format_type(a.atttypid,a.atttypmod)=expected.y AND a.attnotnull=expected.r
    AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM expected.d) THEN
   RAISE EXCEPTION 'staff_retention_read_column_mismatch: %.%',expected.t,expected.n;
  END IF;
 END LOOP;
 FOR expected IN SELECT * FROM jsonb_to_recordset(expected_constraints) AS x(t text,n text,d text,f text) LOOP
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
    LEFT JOIN pg_catalog.pg_class f ON f.oid=k.confrelid LEFT JOIN pg_catalog.pg_namespace n ON n.oid=f.relnamespace
    WHERE c.relnamespace=namespace_id AND c.relname=expected.t AND k.conname=expected.n AND k.convalidated
    AND NOT k.condeferrable AND NOT k.condeferred AND pg_get_constraintdef(k.oid)=expected.d
    AND (n.nspname||'.'||f.relname) IS NOT DISTINCT FROM expected.f) THEN
   RAISE EXCEPTION 'staff_retention_read_constraint_mismatch: %.%',expected.t,expected.n;
  END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['record_class_catalog','record_decisions','record_reviews','record_tombstones'] LOOP
  relation_id := to_regclass('gridex_ediel_retention.'||table_name)::oid;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_class WHERE oid=relation_id AND relowner=owner_id AND relrowsecurity AND relforcerowsecurity) THEN
   RAISE EXCEPTION 'staff_retention_read_table_owner_rls_required: %',table_name;
  END IF;
  FOREACH app_role IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
   IF has_table_privilege(app_role,relation_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   OR has_any_column_privilege(app_role,relation_id,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'staff_retention_read_table_acl_required: %',table_name USING ERRCODE='42501';
   END IF;
  END LOOP;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid=relation_id AND t.tgname=table_name||'_no_truncate'
    AND t.tgfoid=to_regprocedure('gridex_received_sources.reject_mutation()') AND t.tgtype=34
    AND t.tgenabled IN('O','A') AND t.tgqual IS NULL AND t.tgnargs=0 AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=relation_id AND t.tgname=table_name||'_immutable' AND t.tgtype=27
    AND t.tgenabled IN('O','A') AND t.tgqual IS NULL AND t.tgnargs=0 AND NOT t.tgisinternal
    AND (t.tgfoid=to_regprocedure('gridex_received_sources.reject_mutation()')
      OR (table_name='record_decisions' AND t.tgfoid=to_regprocedure('gridex_ediel_retention.record_decisions_original_guard_v1()')
        AND p.proowner=owner_id AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='169b31c1148b0d560b38b433ef9d6d6077b941251af5417d9fbf46cf89908000'))) THEN
   RAISE EXCEPTION 'staff_retention_read_immutable_trigger_required: %',table_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')
   AND p.proowner=owner_id AND p.prosecdef AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
   AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proargnames=ARRAY['p_company_id','p_customer_id']
   AND p.pronargdefaults=0 AND p.proargmodes IS NULL AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='93ac25b47abd2ade07e0e7ef304ae8e39c2ccf6b6c806f676e6865cfe3e4df08')
 OR has_function_privilege('service_role','public.ediel_customer_record_tombstones_v1(uuid,uuid)','EXECUTE') IS NOT TRUE
 OR EXISTS(SELECT FROM pg_catalog.pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid=to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)') AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'staff_retention_read_rpc_definition_acl_required';
 END IF;
 FOREACH app_role IN ARRAY ARRAY['anon','authenticated','authenticator'] LOOP
  IF has_function_privilege(app_role,'public.ediel_customer_record_tombstones_v1(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'staff_retention_read_rpc_private_execute_required' USING ERRCODE='42501';
  END IF;
 END LOOP;
 -- Inspect immutable class metadata as its existing private owner, then restore
 -- the caller. No app principal is granted schema/table access.
 EXECUTE 'SET LOCAL ROLE gridex_ediel_retention_owner';
 FOR expected IN SELECT value AS row FROM jsonb_array_elements(expected_classes) LOOP
  IF NOT EXISTS(SELECT FROM gridex_ediel_retention.record_class_catalog c WHERE to_jsonb(c) @> expected.row) THEN
   RAISE EXCEPTION 'staff_retention_read_class_metadata_mismatch';
  END IF;
 END LOOP;
 EXECUTE format('SET LOCAL ROLE %I',migration_role);
END
$staff_retention_read$;
