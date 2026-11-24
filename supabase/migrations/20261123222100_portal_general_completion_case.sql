CREATE SCHEMA gridex_portal_intake;
REVOKE ALL ON SCHEMA gridex_portal_intake FROM PUBLIC,anon,authenticated,service_role;

-- The authenticated role's browser request identity is independent of API keys.
CREATE TABLE gridex_portal_intake.portal_attempts (
 company_id uuid NOT NULL, customer_id uuid NOT NULL, user_id uuid NOT NULL, attempt_id uuid NOT NULL,
 request_hash bytea NOT NULL,
 completion_id uuid NOT NULL UNIQUE REFERENCES public.customer_portal_completions(id) ON DELETE CASCADE,
 PRIMARY KEY(company_id,customer_id,user_id,attempt_id)
);
ALTER TABLE gridex_portal_intake.portal_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_portal_intake.portal_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_portal_intake.create_completion(
 p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_type text,p_payload jsonb,p_result jsonb,
 p_user_id uuid,p_client_id uuid,p_key text,p_request_hash text,p_needs_review boolean
) RETURNS public.customer_portal_completions
LANGUAGE plpgsql SET search_path=pg_catalog
AS $create$
DECLARE saved public.customer_portal_completions%rowtype; case_id uuid;
BEGIN
 INSERT INTO public.customer_portal_completions(company_id,customer_id,site_id,completion_type,status,
  submitted_payload,result_payload,created_by_user_id,api_client_id,idempotency_key,request_hash)
 VALUES(p_company_id,p_customer_id,p_site_id,p_type,CASE WHEN p_needs_review THEN 'submitted' ELSE 'accepted' END,
  p_payload,p_result,p_user_id,p_client_id,p_key,p_request_hash)
 RETURNING * INTO STRICT saved;
 IF p_needs_review THEN
  INSERT INTO public.customer_cases(company_id,customer_id,site_id,case_type,status,priority,title,description,
   reason_category,next_action,source,metadata)
  VALUES(p_company_id,p_customer_id,p_site_id,'technical_blocker','action_required','normal',
   'Kund har kompletterat uppgifter i portalen',
   'Kunden har lämnat uppgifter som behöver granskas innan masterdata uppdateras.',
   'portal_completion','Granska portalkompletteringen och uppdatera rätt masterdatafält.',
   CASE WHEN p_user_id IS NULL THEN 'customer_portal_api' ELSE 'customer_portal' END,
   jsonb_build_object('completionId',saved.id,'completionType',p_type,'payload',p_payload)
    || CASE WHEN p_user_id IS NULL THEN '{}'::jsonb ELSE '{"support_case":true}'::jsonb END)
  RETURNING id INTO STRICT case_id;
  UPDATE public.customer_portal_completions
  SET linked_case_id=case_id,updated_at=clock_timestamp()
  WHERE id=saved.id AND company_id=p_company_id AND customer_id=p_customer_id
  RETURNING * INTO STRICT saved;
  IF saved.linked_case_id IS DISTINCT FROM case_id THEN
   RAISE EXCEPTION 'portal_intake_link_not_saved' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN saved;
END
$create$;
REVOKE ALL ON FUNCTION gridex_portal_intake.create_completion(uuid,uuid,uuid,text,jsonb,jsonb,uuid,uuid,text,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_portal_intake.require_completion_case(p_completion public.customer_portal_completions,p_source text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog
AS $scope$
BEGIN
 PERFORM FROM public.customer_cases c
 WHERE c.id=p_completion.linked_case_id AND c.company_id=p_completion.company_id AND c.customer_id=p_completion.customer_id
   AND c.site_id IS NOT DISTINCT FROM p_completion.site_id AND c.source=p_source
   AND c.metadata->>'completionId'=p_completion.id::text AND c.metadata->>'completionType'=p_completion.completion_type
 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_intake_completion_case_unverified' USING ERRCODE='23514'; END IF;
END
$scope$;
REVOKE ALL ON FUNCTION gridex_portal_intake.require_completion_case(public.customer_portal_completions,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_submit_portal_completion_v1(
 p_company_id uuid,p_customer_id uuid,p_user_id uuid,p_session_id uuid,p_attempt_id uuid,p_site_id uuid,p_type text,p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $intake$
DECLARE attempt gridex_portal_intake.portal_attempts%rowtype; saved public.customer_portal_completions%rowtype; digest bytea; active_company_id uuid;
BEGIN
 IF p_company_id IS NULL OR p_customer_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL OR p_attempt_id IS NULL
   OR (p_payload IS NOT NULL AND (jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR (p_type IN ('missing_information','metering_point_update','contact_update')) IS NOT TRUE))
   OR (p_payload IS NULL AND (p_type IS NOT NULL OR p_site_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'portal_intake_invalid_command' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('portal-intake',p_company_id,p_customer_id,p_user_id,p_attempt_id)::text,0));
 PERFORM FROM public.customers c WHERE c.id=p_customer_id AND c.company_id=p_company_id
  AND c.merged_into_customer_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_intake_customer_forbidden' USING ERRCODE='42501'; END IF;

 PERFORM FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 WHERE u.id=p_user_id AND s.id=p_session_id AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
  AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) FOR SHARE OF u,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_intake_customer_forbidden' USING ERRCODE='42501'; END IF;

 -- Serialize with account revocation and customer/record retention before reading a receipt or writing.
 PERFORM FROM public.customer_portal_accounts a WHERE a.user_id=p_user_id ORDER BY a.id FOR SHARE;
 SELECT coalesce(a.company_id,c.company_id) INTO active_company_id
 FROM public.customer_portal_accounts a JOIN public.customers c ON c.id=a.customer_id
 WHERE a.user_id=p_user_id AND a.is_active AND coalesce(a.company_id,c.company_id) IS NOT NULL
 ORDER BY a.activated_at DESC NULLS LAST,a.id LIMIT 1;
 IF active_company_id IS DISTINCT FROM p_company_id OR NOT EXISTS(
  SELECT FROM public.customer_portal_accounts a
  WHERE a.user_id=p_user_id AND a.customer_id=p_customer_id AND a.is_active AND a.status='active'
   AND (a.company_id IS NULL OR a.company_id=p_company_id)
 ) THEN RAISE EXCEPTION 'portal_intake_customer_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM public.ediel_require_portal_retention_access_v1(p_company_id,p_customer_id);

 -- Time-based expiry still applies if the account or retention check had to wait.
 IF NOT EXISTS(
  SELECT FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
  WHERE u.id=p_user_id AND s.id=p_session_id
    AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
    AND (s.not_after IS NULL OR s.not_after>clock_timestamp())
 ) THEN RAISE EXCEPTION 'portal_intake_customer_forbidden' USING ERRCODE='42501'; END IF;
 IF p_site_id IS NOT NULL THEN
  PERFORM FROM public.customer_sites s
  WHERE s.id=p_site_id AND s.company_id=p_company_id AND s.customer_id=p_customer_id
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal_intake_customer_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO attempt FROM gridex_portal_intake.portal_attempts WHERE company_id=p_company_id
  AND customer_id=p_customer_id AND user_id=p_user_id AND attempt_id=p_attempt_id;
 IF p_payload IS NOT NULL THEN
  digest:=sha256(convert_to(jsonb_build_array(p_type,p_site_id,p_payload)::text,'UTF8'));
 END IF;
 IF FOUND THEN
  IF digest IS NOT NULL AND digest IS DISTINCT FROM attempt.request_hash THEN
   RAISE EXCEPTION 'portal_intake_attempt_conflict' USING ERRCODE='23505';
  END IF;
  SELECT * INTO STRICT saved FROM public.customer_portal_completions WHERE id=attempt.completion_id
   AND company_id=p_company_id AND customer_id=p_customer_id AND created_by_user_id=p_user_id FOR SHARE;
  PERFORM gridex_portal_intake.require_completion_case(saved,'customer_portal');
  RETURN jsonb_build_object('receipt',saved.completion_reference,'caseId',saved.linked_case_id,'createdAt',saved.created_at,'replayed',true);
 END IF;
 IF p_payload IS NULL THEN RETURN NULL; END IF;
 saved:=gridex_portal_intake.create_completion(p_company_id,p_customer_id,p_site_id,p_type,
   p_payload||jsonb_build_object('portal_submission_kind','general','submittedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
   NULL,p_user_id,NULL,NULL,NULL,true);
 INSERT INTO gridex_portal_intake.portal_attempts VALUES(p_company_id,p_customer_id,p_user_id,p_attempt_id,digest,saved.id);
 RETURN jsonb_build_object('receipt',saved.completion_reference,'caseId',saved.linked_case_id,'createdAt',saved.created_at,'replayed',false);
END
$intake$;
REVOKE ALL ON FUNCTION public.gridex_submit_portal_completion_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_submit_portal_completion_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
