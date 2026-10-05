-- SC010's single internal beneficiary export consumer. Existing authority,
-- projection and source owners are reused; no cached authorization or raw E66.
BEGIN;
CREATE SCHEMA gridex_ediel_exports;
REVOKE ALL ON SCHEMA gridex_ediel_exports FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_ediel_exports.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 beneficiary_company_id uuid NOT NULL REFERENCES public.companies(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 idempotency_key uuid NOT NULL,
 grant_id uuid NOT NULL REFERENCES public.ediel_data_access_grants(id),
 expected_grant_version bigint NOT NULL CHECK(expected_grant_version>0),
 series_id uuid NOT NULL REFERENCES public.meter_reading_series(id),
 purpose text NOT NULL CHECK(length(purpose) BETWEEN 1 AND 2000 AND length(btrim(purpose))>0),
 fields text[] NOT NULL CHECK(cardinality(fields)>0 AND array_position(fields,NULL) IS NULL),
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL CHECK(end_at>start_at),
 page_limit integer NOT NULL CHECK(page_limit BETWEEN 1 AND 500),
 after_at timestamptz, after_id uuid,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','leased','completed','blocked')),
 lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz, result_expires_at timestamptz,
 UNIQUE(beneficiary_company_id,actor_user_id,idempotency_key),
 UNIQUE(id,beneficiary_company_id,actor_user_id),
 CHECK((after_at IS NULL)=(after_id IS NULL)),
 CHECK(after_at IS NULL OR after_at>=start_at AND after_at<end_at),
 CHECK((status='leased')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK(status='leased' OR lease_token IS NULL AND lease_expires_at IS NULL),
 CHECK((status='completed')=(completed_at IS NOT NULL AND result_expires_at IS NOT NULL))
);
CREATE INDEX beneficiary_export_claim_idx ON gridex_ediel_exports.jobs(beneficiary_company_id,actor_user_id,created_at,id) WHERE status IN('queued','leased');
CREATE INDEX beneficiary_export_grant_idx ON gridex_ediel_exports.jobs(grant_id);
CREATE INDEX beneficiary_export_series_idx ON gridex_ediel_exports.jobs(series_id);
CREATE INDEX beneficiary_export_actor_idx ON gridex_ediel_exports.jobs(actor_user_id);

CREATE TABLE gridex_ediel_exports.results (
 job_id uuid PRIMARY KEY,
 beneficiary_company_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 page jsonb NOT NULL CHECK(jsonb_typeof(page)='object'),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(job_id,beneficiary_company_id,actor_user_id)
  REFERENCES gridex_ediel_exports.jobs(id,beneficiary_company_id,actor_user_id)
);
CREATE INDEX beneficiary_export_result_expiry_idx ON gridex_ediel_exports.results(beneficiary_company_id,actor_user_id,expires_at);
ALTER TABLE gridex_ediel_exports.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_exports.jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_exports.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_exports.results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_ediel_exports FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_exports.immutable_scope_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR
  ROW(NEW.id,NEW.beneficiary_company_id,NEW.actor_user_id,NEW.idempotency_key,NEW.grant_id,NEW.expected_grant_version,
      NEW.series_id,NEW.purpose,NEW.fields,NEW.start_at,NEW.end_at,NEW.page_limit,NEW.after_at,NEW.after_id,NEW.created_at)
  IS DISTINCT FROM
  ROW(OLD.id,OLD.beneficiary_company_id,OLD.actor_user_id,OLD.idempotency_key,OLD.grant_id,OLD.expected_grant_version,
      OLD.series_id,OLD.purpose,OLD.fields,OLD.start_at,OLD.end_at,OLD.page_limit,OLD.after_at,OLD.after_id,OLD.created_at)
 THEN RAISE EXCEPTION 'ediel_export_scope_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER beneficiary_export_scope_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_exports.jobs FOR EACH ROW EXECUTE FUNCTION gridex_ediel_exports.immutable_scope_v1();

CREATE FUNCTION gridex_ediel_exports.immutable_result_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.expires_at<=clock_timestamp() THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'ediel_export_result_immutable';
END $$;
CREATE TRIGGER beneficiary_export_result_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_exports.results FOR EACH ROW EXECUTE FUNCTION gridex_ediel_exports.immutable_result_v1();
CREATE TRIGGER beneficiary_export_result_no_truncate BEFORE TRUNCATE ON gridex_ediel_exports.results FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_exports.immutable_result_v1();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_exports FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ediel_queue_beneficiary_export_v1(
 p_beneficiary_company_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,
 p_grant_id uuid,p_expected_grant_version bigint,p_purpose text,p_series_id uuid,p_fields text[],
 p_start timestamptz,p_end timestamptz,p_limit integer DEFAULT 100,p_after_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j gridex_ediel_exports.jobs%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Existing full actor/tenant/legal/source/grant filter, without a receipt or
 -- cached result. Any transient values are discarded inside this transaction.
 PERFORM gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2(p_beneficiary_company_id,p_actor_user_id,p_grant_id,p_expected_grant_version,p_purpose,p_series_id,p_fields,p_start,p_end,p_limit,p_after_at,p_after_id);
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'ediel_export_key_required'; END IF;
 INSERT INTO gridex_ediel_exports.jobs(beneficiary_company_id,actor_user_id,idempotency_key,grant_id,expected_grant_version,series_id,purpose,fields,start_at,end_at,page_limit,after_at,after_id)
 VALUES(p_beneficiary_company_id,p_actor_user_id,p_idempotency_key,p_grant_id,p_expected_grant_version,p_series_id,p_purpose,p_fields,p_start,p_end,p_limit,p_after_at,p_after_id)
 ON CONFLICT(beneficiary_company_id,actor_user_id,idempotency_key) DO NOTHING;
 SELECT * INTO STRICT j FROM gridex_ediel_exports.jobs WHERE beneficiary_company_id=p_beneficiary_company_id AND actor_user_id=p_actor_user_id AND idempotency_key=p_idempotency_key;
 IF ROW(j.grant_id,j.expected_grant_version,j.series_id,j.purpose,j.fields,j.start_at,j.end_at,j.page_limit,j.after_at,j.after_id)
  IS DISTINCT FROM ROW(p_grant_id,p_expected_grant_version,p_series_id,p_purpose,p_fields,p_start,p_end,p_limit,p_after_at,p_after_id)
 THEN RAISE EXCEPTION 'ediel_export_idempotency_scope_mismatch'; END IF;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status);
END $$;

CREATE FUNCTION public.ediel_claim_beneficiary_exports_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_beneficiary_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_beneficiary_company_id,'metering.read'),false) IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_beneficiary_forbidden' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN RAISE EXCEPTION 'ediel_export_claim_limit_invalid'; END IF;
 -- Ephemeral derived payloads are denied at expiry by read, and actually
 -- removed on the next authorized worker pass. Job/audit references remain.
 DELETE FROM gridex_ediel_exports.results WHERE beneficiary_company_id=p_beneficiary_company_id AND actor_user_id=p_actor_user_id AND expires_at<=clock_timestamp();
 WITH selected AS (
  SELECT id FROM gridex_ediel_exports.jobs WHERE beneficiary_company_id=p_beneficiary_company_id AND actor_user_id=p_actor_user_id
   AND (status='queued' OR status='leased' AND lease_expires_at<=clock_timestamp())
  ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE gridex_ediel_exports.jobs j SET status='leased',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes'
  FROM selected s WHERE j.id=s.id RETURNING j.id,j.lease_token
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('jobId',id,'leaseToken',lease_token) ORDER BY id),'[]'::jsonb) INTO claims FROM claimed;
 RETURN claims;
END $$;

CREATE FUNCTION public.ediel_execute_beneficiary_export_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j gridex_ediel_exports.jobs%rowtype; page jsonb; denied boolean:=false; finished timestamptz; result_deadline timestamptz;
BEGIN
 -- Consistent graph-before-job order. The lease uses the wall clock after
 -- lock waits; transaction-start now() cannot revive an expired token.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO j FROM gridex_ediel_exports.jobs WHERE id=p_job_id AND beneficiary_company_id=p_beneficiary_company_id AND actor_user_id=p_actor_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_export_not_found' USING ERRCODE='42501'; END IF;
 IF j.status<>'leased' OR j.lease_token IS DISTINCT FROM p_lease_token OR j.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_export_lease_not_current'; END IF;
 BEGIN
  page:=public.ediel_beneficiary_series_page_v1(j.beneficiary_company_id,j.actor_user_id,j.grant_id,j.expected_grant_version,j.purpose,j.series_id,j.fields,j.start_at,j.end_at,j.page_limit,j.after_at,j.after_id);
 EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
  IF SQLERRM=ANY(ARRAY['ediel_grant_not_current','ediel_beneficiary_forbidden','ediel_grant_basis_changed','ediel_assignment_not_authorized','ediel_projection_outside_grant','ediel_market_permission_not_approved','ediel_permission_source_not_current','ediel_permission_legal_actor_mismatch','ediel_series_outside_grant','ediel_series_source_actor_not_qualified','ediel_series_source_contract_mismatch','ediel_series_source_dso_not_qualified','ediel_permission_source_not_qualified','ediel_permission_object_not_approved','ediel_ack_current_captured_role_unavailable','ediel_technical_endpoint_unqualified']) THEN denied:=true;
  ELSE RAISE; END IF;
 END;
 -- Source row locks can also wait inside projection. Fail atomically if the
 -- token's deadline passed there; its potential receipt is rolled back too.
 finished:=clock_timestamp();
 IF j.lease_expires_at<=finished THEN RAISE EXCEPTION 'ediel_export_lease_not_current'; END IF;
 IF denied THEN
  UPDATE gridex_ediel_exports.jobs SET status='blocked',lease_token=NULL,lease_expires_at=NULL WHERE id=j.id;
  IF j.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_export_lease_not_current'; END IF;
  RETURN jsonb_build_object('jobId',j.id,'status','blocked');
 END IF;
 result_deadline:=finished+interval '1 hour';
 INSERT INTO gridex_ediel_exports.results(job_id,beneficiary_company_id,actor_user_id,page,expires_at)
 VALUES(j.id,j.beneficiary_company_id,j.actor_user_id,page,result_deadline);
 -- A destination-table/trigger wait can also outlive the lease. This final
 -- check rolls back both the new result and any projection receipt.
 finished:=clock_timestamp();
 IF j.lease_expires_at<=finished THEN RAISE EXCEPTION 'ediel_export_lease_not_current'; END IF;
 UPDATE gridex_ediel_exports.jobs SET status='completed',completed_at=finished,result_expires_at=result_deadline,lease_token=NULL,lease_expires_at=NULL WHERE id=j.id;
 -- UPDATE can itself wait for a table-lock upgrade. No terminal write is
 -- accepted after the token's deadline; all earlier writes roll back too.
 IF j.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_export_lease_not_current'; END IF;
 RETURN jsonb_build_object('jobId',j.id,'status','completed');
END $$;

CREATE FUNCTION public.ediel_read_beneficiary_export_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j gridex_ediel_exports.jobs%rowtype; current_page jsonb; retained jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO j FROM gridex_ediel_exports.jobs WHERE id=p_job_id AND beneficiary_company_id=p_beneficiary_company_id AND actor_user_id=p_actor_user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_export_not_found' USING ERRCODE='42501'; END IF;
 -- Complete current authority and immutable source proof again; no earlier
 -- job completion, receipt or payload authorizes this read.
 current_page:=public.ediel_beneficiary_series_page_v1(j.beneficiary_company_id,j.actor_user_id,j.grant_id,j.expected_grant_version,j.purpose,j.series_id,j.fields,j.start_at,j.end_at,j.page_limit,j.after_at,j.after_id);
 IF j.status='completed' THEN
  IF j.result_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_export_expired'; END IF;
  SELECT page INTO STRICT retained FROM gridex_ediel_exports.results WHERE job_id=j.id AND beneficiary_company_id=j.beneficiary_company_id AND actor_user_id=j.actor_user_id AND expires_at>clock_timestamp() FOR SHARE;
  IF retained IS DISTINCT FROM current_page THEN RAISE EXCEPTION 'ediel_export_result_basis_changed'; END IF;
 END IF;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'page',retained);
END $$;

REVOKE ALL ON FUNCTION public.ediel_queue_beneficiary_export_v1(uuid,uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ediel_claim_beneficiary_exports_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ediel_execute_beneficiary_export_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ediel_read_beneficiary_export_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_queue_beneficiary_export_v1(uuid,uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_claim_beneficiary_exports_v1(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_execute_beneficiary_export_v1(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_beneficiary_export_v1(uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.ediel_execute_beneficiary_export_v1(uuid,uuid,uuid,uuid) IS 'Single leased internal E66 beneficiary page export; current scope and private destination commit share the existing grant/source fence. No payload in worker response.';
COMMIT;
