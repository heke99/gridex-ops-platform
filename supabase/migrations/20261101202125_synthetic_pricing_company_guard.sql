-- Birth-only permanent financial restriction; source consumers remain disabled.
BEGIN;
CREATE SCHEMA gridex_synthetic_pricing_companies;
REVOKE ALL ON SCHEMA gridex_synthetic_pricing_companies FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_synthetic_pricing_companies.births(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),request_key uuid NOT NULL,
 initial_name text NOT NULL,initial_slug text NOT NULL,declaration text NOT NULL,
 command_sha256 text NOT NULL,canonical_key text NOT NULL UNIQUE,
 canonical_request_sha256 text NOT NULL,canonical_result_sha256 text NOT NULL,
 company_created_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_user_id,request_key),
 CHECK(declaration='SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT')
);
ALTER TABLE gridex_synthetic_pricing_companies.births ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_synthetic_pricing_companies.births FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_synthetic_pricing_companies.births FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_synthetic_pricing_companies.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='synthetic_pricing_company_birth_immutable';END$$;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_synthetic_pricing_companies.births FOR EACH ROW EXECUTE FUNCTION gridex_synthetic_pricing_companies.immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_synthetic_pricing_companies.births FOR EACH STATEMENT EXECUTE FUNCTION gridex_synthetic_pricing_companies.immutable_v1();
CREATE FUNCTION gridex_synthetic_pricing_companies.protected_v1(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_synthetic_pricing_companies.births WHERE company_id=c)$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.authorize_v1(a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 -- Never SHARE-lock companies before canonical INSERT: that creates lock upgrades.
 LOCK TABLE auth.users,public.user_profiles,public.admin_users,public.user_roles,public.roles IN SHARE MODE;
 IF a IS NULL OR public.canonical_actor_is_platform_admin(a) IS DISTINCT FROM true
  OR NOT EXISTS(SELECT FROM auth.users u JOIN public.user_profiles p ON p.id=u.id WHERE u.id=a
   AND u.email_confirmed_at IS NOT NULL AND u.email_confirmed_at<=clock_timestamp()
   AND u.is_anonymous IS FALSE AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
   AND p.user_status='active') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_platform_denied';END IF;
END$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.company_v1(r jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF r->>'default_environment' IS DISTINCT FROM 'test' OR r->>'operating_environment' IS DISTINCT FROM 'test'
  OR r->>'billing_provider_environment' IS NOT NULL AND r->>'billing_provider_environment'<>'test'
  OR r->'invoice_export_enabled' IS DISTINCT FROM 'false'::jsonb
  OR NOT coalesce(r->'outbound_frozen_channels','[]'::jsonb) ? 'invoice_export'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_financial_boundary';END IF;
END$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.receipt_v1(b gridex_synthetic_pricing_companies.births,replayed boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE c public.companies%rowtype;p public.canonical_provisioning_requests%rowtype;BEGIN
 SELECT * INTO c FROM public.companies WHERE id=b.company_id;
 SELECT * INTO p FROM public.canonical_provisioning_requests WHERE idempotency_key=b.canonical_key;
 IF c.id IS NULL OR p.company_id IS DISTINCT FROM b.company_id OR c.created_at IS DISTINCT FROM b.company_created_at
  OR c.created_by IS DISTINCT FROM b.actor_user_id
  OR encode(sha256(convert_to(p.request_payload::text,'UTF8')),'hex') IS DISTINCT FROM b.canonical_request_sha256
  OR encode(sha256(convert_to(p.result_payload::text,'UTF8')),'hex') IS DISTINCT FROM b.canonical_result_sha256
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_pricing_company_provenance_conflict';END IF;
 PERFORM gridex_synthetic_pricing_companies.company_v1(to_jsonb(c));
 RETURN jsonb_build_object('company_id',b.company_id,'birth_id',b.id,'request_key',b.request_key,'actor_user_id',b.actor_user_id,
  'initial_name',b.initial_name,'initial_slug',b.initial_slug,'declaration',b.declaration,'command_sha256',b.command_sha256,
  'company_created_at',to_char(b.company_created_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'recorded_at',to_char(b.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'production_billing_prohibited',true,'external_financial_delivery_prohibited',true,'consumer_enabled',false,'replayed',replayed);
END$$;
CREATE FUNCTION public.gridex_create_synthetic_pricing_company_v1(p_actor_user_id uuid,p_request_key uuid,p_name text,p_slug text,p_declaration text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE b gridex_synthetic_pricing_companies.births%rowtype;c public.companies%rowtype;p public.canonical_provisioning_requests%rowtype;
 command_hash text;k text;company uuid;result jsonb;trim_chars text;BEGIN
 PERFORM gridex_synthetic_pricing_companies.authorize_v1(p_actor_user_id);
 SELECT string_agg(chr(n),'') INTO trim_chars FROM unnest(ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) n;
 IF p_request_key IS NULL OR p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 200 OR btrim(p_name,trim_chars)<>p_name
  OR p_name COLLATE "C" ~ ('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']')
  OR p_slug IS NULL OR char_length(p_slug) NOT BETWEEN 1 AND 63 OR p_slug COLLATE "C" !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  OR p_declaration IS DISTINCT FROM 'SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_pricing_company_command_invalid';END IF;
 command_hash:=encode(sha256(convert_to(E'gridex-synthetic-pricing-company-command-v1\n'||
  octet_length(convert_to(p_name,'UTF8'))::text||':'||p_name||octet_length(convert_to(p_slug,'UTF8'))::text||':'||p_slug||
  octet_length(convert_to(p_declaration,'UTF8'))::text||':'||p_declaration,'UTF8')),'hex');
 k:='synthetic.pricing.company.v1:'||p_actor_user_id::text||':'||p_request_key::text;
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant.provision:'||k,0));
 SELECT * INTO b FROM gridex_synthetic_pricing_companies.births WHERE actor_user_id=p_actor_user_id AND request_key=p_request_key;
 IF FOUND THEN
  IF b.command_sha256<>command_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_pricing_company_command_conflict';END IF;
  RETURN gridex_synthetic_pricing_companies.receipt_v1(b,true);
 END IF;
 IF EXISTS(SELECT FROM public.canonical_provisioning_requests WHERE idempotency_key=k) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_pricing_company_existing_provision_conflict';END IF;
 company:=gen_random_uuid();
 result:=public.canonical_provision_company(jsonb_build_object('actor_user_id',p_actor_user_id,'idempotency_key',k,'company_id',company,
  'name',p_name,'slug',p_slug,'metadata',jsonb_build_object('synthetic_pricing_declaration',p_declaration)));
 SELECT * INTO c FROM public.companies WHERE id=company;
 SELECT * INTO p FROM public.canonical_provisioning_requests WHERE idempotency_key=k;
 IF c.id IS NULL OR c.name<>p_name OR c.slug<>p_slug OR c.created_by IS DISTINCT FROM p_actor_user_id OR p.company_id IS DISTINCT FROM company
  OR result->>'company_id' IS DISTINCT FROM company::text OR result->'external_delivery_queued' IS DISTINCT FROM 'false'::jsonb
  OR result->>'initial_admin_invitation_id' IS NOT NULL OR p.result_payload IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_pricing_company_canonical_result_invalid';END IF;
 UPDATE public.companies SET invoice_export_enabled=false,
  outbound_frozen_channels=CASE WHEN 'invoice_export'=ANY(outbound_frozen_channels) THEN outbound_frozen_channels ELSE array_append(outbound_frozen_channels,'invoice_export') END
 WHERE id=company RETURNING * INTO c;
 PERFORM gridex_synthetic_pricing_companies.company_v1(to_jsonb(c));
 INSERT INTO gridex_synthetic_pricing_companies.births(company_id,actor_user_id,request_key,initial_name,initial_slug,declaration,command_sha256,
  canonical_key,canonical_request_sha256,canonical_result_sha256,company_created_at)
 VALUES(company,p_actor_user_id,p_request_key,p_name,p_slug,p_declaration,command_hash,k,
  encode(sha256(convert_to(p.request_payload::text,'UTF8')),'hex'),encode(sha256(convert_to(p.result_payload::text,'UTF8')),'hex'),c.created_at) RETURNING * INTO b;
 RETURN gridex_synthetic_pricing_companies.receipt_v1(b,false);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_pricing_company_command_conflict';END$$;
CREATE FUNCTION public.gridex_read_synthetic_pricing_company_v1(p_actor_user_id uuid,p_request_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE b gridex_synthetic_pricing_companies.births%rowtype;BEGIN
 PERFORM gridex_synthetic_pricing_companies.authorize_v1(p_actor_user_id);
 SELECT * INTO b FROM gridex_synthetic_pricing_companies.births WHERE actor_user_id=p_actor_user_id AND request_key=p_request_key;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='synthetic_pricing_company_birth_not_found';END IF;
 RETURN gridex_synthetic_pricing_companies.receipt_v1(b,false);
END$$;

-- Resolve actual current-schema ID-only ownership, without company/parent lock
-- inversions. Birth-only immutable ownership makes the restriction non-enrollable.
CREATE FUNCTION gridex_synthetic_pricing_companies.parents_v1(t text,r jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE links jsonb;link record;c uuid:=(r->>'company_id')::uuid;parent_company uuid;protected boolean:=gridex_synthetic_pricing_companies.protected_v1(c);BEGIN
 links:=CASE t
 WHEN 'invoice_export_items' THEN '{"export_run_id":"invoice_export_runs","billing_export_run_item_id":"billing_export_run_items"}'::jsonb
 WHEN 'customer_invoices' THEN '{"invoice_export_item_id":"invoice_export_items","canonical_export_item_id":"invoice_export_items","partner_export_id":"invoice_export_items"}'::jsonb
 WHEN 'billing_export_run_items' THEN '{"billing_export_run_id":"billing_export_runs","export_run_id":"billing_export_runs","partner_export_id":"partner_exports"}'::jsonb
 WHEN 'invoice_export_attempts' THEN '{"invoice_export_item_id":"invoice_export_items","export_run_id":"invoice_export_runs"}'::jsonb
 WHEN 'partner_exports' THEN '{"customer_id":"customers","billing_underlay_id":"billing_underlays","site_id":"customer_sites","metering_point_id":"metering_points"}'::jsonb
 WHEN 'billing_underlays' THEN '{"customer_id":"customers","site_id":"customer_sites","customer_site_id":"customer_sites","metering_point_id":"metering_points"}'::jsonb
 WHEN 'customer_sites' THEN '{"customer_id":"customers","customer_site_id":"customer_sites"}'::jsonb
 WHEN 'metering_points' THEN '{"customer_id":"customers","site_id":"customer_sites","customer_site_id":"customer_sites"}'::jsonb
 WHEN 'invoice_purchase_events' THEN '{"invoice_export_item_id":"invoice_export_items"}'::jsonb
 WHEN 'invoice_documents' THEN '{"invoice_export_item_id":"invoice_export_items"}'::jsonb
 WHEN 'customer_invoice_documents' THEN '{"invoice_id":"customer_invoices","customer_id":"customers"}'::jsonb
 WHEN 'webhook_deliveries' THEN '{"webhook_subscription_id":"webhook_subscriptions","domain_event_id":"domain_events"}'::jsonb
 WHEN 'domain_events' THEN '{"subject_customer_id":"customers"}'::jsonb ELSE '{}'::jsonb END;
 FOR link IN SELECT * FROM jsonb_each_text(links) LOOP
  IF r->>link.key IS NOT NULL THEN
   parent_company:=NULL;
   IF link.value=t AND r->>link.key=r->>'id' THEN parent_company:=c;
   ELSE EXECUTE format('SELECT company_id FROM public.%I WHERE id=$1',link.value) INTO parent_company USING (r->>link.key)::uuid;END IF;
   IF (protected OR gridex_synthetic_pricing_companies.protected_v1(parent_company)) AND parent_company IS DISTINCT FROM c THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_foreign_parent';END IF;
   protected:=protected OR gridex_synthetic_pricing_companies.protected_v1(parent_company);
  END IF;
 END LOOP;
 RETURN protected;
END$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.nulls_v1(r jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT FROM unnest(keys) k WHERE r->>k IS NOT NULL)$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.zeros_v1(r jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT FROM unnest(keys) k WHERE coalesce((r->>k)::numeric,0)<>0)$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.empty_v1(r jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT FROM unnest(keys) k WHERE coalesce(r->k,'null'::jsonb) NOT IN('null'::jsonb,'{}'::jsonb,'[]'::jsonb))$$;
CREATE FUNCTION gridex_synthetic_pricing_companies.guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb:=to_jsonb(NEW);o jsonb;flag boolean;oldflag boolean:=false;valid boolean:=true;item text;BEGIN
 IF TG_TABLE_NAME='companies' THEN
  IF gridex_synthetic_pricing_companies.protected_v1(OLD.id) THEN
   IF OLD.id IS DISTINCT FROM NEW.id OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_reassignment';END IF;
   PERFORM gridex_synthetic_pricing_companies.company_v1(r);
  END IF;RETURN NEW;
 END IF;
 flag:=gridex_synthetic_pricing_companies.parents_v1(TG_TABLE_NAME,r);
 IF TG_OP='UPDATE' THEN
  o:=to_jsonb(OLD);oldflag:=gridex_synthetic_pricing_companies.parents_v1(TG_TABLE_NAME,o);
  IF (flag OR oldflag) AND (o->>'company_id' IS DISTINCT FROM r->>'company_id' OR o->>'id' IS DISTINCT FROM r->>'id') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_reassignment';END IF;
 END IF;
 IF NOT flag AND NOT oldflag THEN RETURN NEW;END IF;
 CASE TG_TABLE_NAME
 WHEN 'customers','integration_api_clients','domain_events','billing_underlays','customer_sites','metering_points' THEN RETURN NEW;
 WHEN 'billing_provider_connections' THEN valid:=r->>'environment'='test';
 WHEN 'invoice_export_runs' THEN valid:=r->>'environment'='test' AND r->>'status' IN('draft','cancelled')
  AND gridex_synthetic_pricing_companies.zeros_v1(r,ARRAY['sent_items','provider_confirmed_items']) AND r->>'started_at' IS NULL;
 WHEN 'invoice_export_items' THEN valid:=r->>'environment'='test' AND r->>'status' IN('pending','cancelled')
  AND gridex_synthetic_pricing_companies.zeros_v1(r,ARRAY['attempt_count'])
  AND gridex_synthetic_pricing_companies.nulls_v1(r,ARRAY['export_file_id','provider_invoice_guid','provider_invoice_id','provider_invoice_number','provider_payment_reference','provider_ocr','provider_imp_stock_id','provider_request_id','provider_idempotency_key','provider_confirmed_at','provider_purchase_confirmed_at','sent_at','next_retry_at','last_attempt_at','provider_status','purchase_status','recourse_status'])
  AND r->'provider_delivery_uncertain'='false'::jsonb AND r->>'reconciliation_status'='not_checked'
  AND r->>'provider_reconciliation_status'='pending' AND gridex_synthetic_pricing_companies.empty_v1(r,ARRAY['request_payload','response_payload','status_payload','error_payload']);
 WHEN 'customer_invoices' THEN
  item:=coalesce(r->>'invoice_export_item_id',r->>'canonical_export_item_id',r->>'id');
  valid:=r->>'status'='draft' AND gridex_synthetic_pricing_companies.nulls_v1(r,ARRAY['issued_at','paid_at','pdf_path','pdf_url','invoice_number','partner_export_id'])
   AND (r->>'partner_invoice_reference' IS NULL OR r->>'partner_invoice_reference'='pending:'||item)
   AND r->>'invoice_reference'='draft:'||item;
 WHEN 'billing_export_runs' THEN valid:=r->>'status' IN('draft','ready','ready_with_flags','blocked','cancelled')
  AND gridex_synthetic_pricing_companies.zeros_v1(r,ARRAY['rows_exported','rows_queued','rows_sent','rows_acknowledged','rows_failed','rows_rejected'])
  AND gridex_synthetic_pricing_companies.nulls_v1(r,ARRAY['last_partner_response_at','partner_locked_at']) AND gridex_synthetic_pricing_companies.empty_v1(r,ARRAY['partner_response_log']);
 WHEN 'billing_export_run_items' THEN valid:=r->>'status' IN('blocked','ready') AND r->>'export_status' IN('not_queued','blocked') AND r->>'partner_result_type'='none'
  AND gridex_synthetic_pricing_companies.zeros_v1(r,ARRAY['retry_count'])
  AND gridex_synthetic_pricing_companies.nulls_v1(r,ARRAY['partner_export_id','queued_at','sent_at','acknowledged_at','failed_at','sent_by','last_partner_response_at'])
  AND gridex_synthetic_pricing_companies.empty_v1(r,ARRAY['partner_response_log']);
 ELSE valid:=false;
 END CASE;
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_pricing_company_financial_output_prohibited';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER zz_synthetic_pricing_company_guard BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION gridex_synthetic_pricing_companies.guard_v1();
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['billing_provider_connections','invoice_export_runs','invoice_export_items','customer_invoices','billing_export_runs','billing_export_run_items','invoice_export_files','partner_exports','invoice_export_attempts','invoice_purchase_events','invoice_documents','customer_invoice_documents','webhook_subscriptions','webhook_deliveries','domain_events','customers','integration_api_clients','billing_underlays','customer_sites','metering_points'] LOOP
 EXECUTE format('CREATE TRIGGER zz_synthetic_pricing_company_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION gridex_synthetic_pricing_companies.guard_v1()',t);
END LOOP;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_synthetic_pricing_companies FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_create_synthetic_pricing_company_v1(uuid,uuid,text,text,text),public.gridex_read_synthetic_pricing_company_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_create_synthetic_pricing_company_v1(uuid,uuid,text,text,text),public.gridex_read_synthetic_pricing_company_v1(uuid,uuid) TO service_role;
COMMIT;
