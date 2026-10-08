BEGIN;

CREATE OR REPLACE FUNCTION public.gridex_finalize_signature_before_record_retention_v1(p_token_hash text, p_signed_ip_hash text DEFAULT NULL::text, p_signed_user_agent text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_request public.customer_contract_signature_requests%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_customer public.customers%rowtype;
  v_company public.companies%rowtype;
  v_price public.contract_price_snapshots%rowtype;
  v_legal_versions jsonb;
  v_signature jsonb;
  v_signature_hash text;
  v_acceptance jsonb;
  v_acceptance_hash text;
  v_customer_type text;
  v_withdrawal_required boolean;
  v_withdrawal_deadline timestamptz;
  v_event jsonb;
begin
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='signature_token_invalid'; end if;
  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash for update;
  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;
  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id for update;
  if v_request.used_at is not null then
    if v_contract.status in ('signed','active','terminated','cancelled','expired') and v_contract.signed_at is not null then
      return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',true);
    end if;
    raise exception using errcode='55000',message='signature_link_already_used';
  end if;
  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;
  if v_request.expires_at<=now() then raise exception using errcode='55000',message='signature_link_expired'; end if;
  select * into v_company from public.companies where id=v_request.company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_tenant_not_operational';
  end if;
  if v_contract.status<>'pending_signature' or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='contract_not_pending_signature';
  end if;
  select * into v_customer from public.customers where id=v_contract.customer_id and company_id=v_contract.company_id;
  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_contract.company_id and contract_id=v_contract.id;
  if not found or nullif(v_price.snapshot_hash,'') is null then raise exception using errcode='23514',message='signature_pricing_snapshot_missing'; end if;

  if not exists(
    select 1 from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=v_contract.company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
  ) then raise exception using errcode='23514',message='signature_exact_locked_chain_invalid'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'legal_bundle_version_document_id',d.id,'module_key',d.module_key,'title',d.title,
    'legal_document_version',coalesce(d.template_version,left(d.content_sha256,12)),
    'document_sha256',d.content_sha256,'body_sha256',d.content_sha256
  ) order by d.sort_order,d.id),'[]'::jsonb)
  into v_legal_versions from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;
  if jsonb_array_length(v_legal_versions)=0 then raise exception using errcode='23514',message='signature_legal_document_set_missing'; end if;

  v_signature:=jsonb_build_object(
    'schema','gridex_online_contract_signature_v1','company_id',v_contract.company_id,'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,'signature_request_id',v_request.id,'channel',v_request.channel,'accepted_at',now(),
    'recipient_email',v_request.recipient_email,'contract_number',v_contract.contract_number,'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,'contract_product_version_id',v_contract.contract_product_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id,'pricing_snapshot_sha256',v_price.snapshot_hash,
    'legal_versions',v_legal_versions,'tenant_communication_snapshot_sha256',v_contract.tenant_communication_snapshot_sha256,
    'request_evidence',jsonb_build_object('ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000))
  );
  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');
  v_acceptance:=jsonb_build_object(
    'schema','gridex_contract_acceptance_v1','signature_request_id',v_request.id,'contract_id',v_contract.id,
    'accepted_at',v_signature->>'accepted_at','channel',v_request.channel,'signing_method','secure_link_click',
    'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'legal_versions',v_legal_versions
  );
  v_acceptance_hash:=encode(extensions.digest(convert_to(v_acceptance::text,'UTF8'),'sha256'),'hex');

  insert into public.customer_legal_acceptances(
    company_id,customer_id,contract_id,acceptance_type,legal_text_version_id,
    legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,
    accepted_at,accepted_ip_hash,accepted_user_agent,source,snapshot,metadata
  )
  select v_contract.company_id,v_contract.customer_id,v_contract.id,
    case public.gridex_legacy_legal_type_for_module(d.module_key)
      when 'privacy_policy' then 'privacy_policy' when 'withdrawal' then 'withdrawal_info'
      when 'power_of_attorney' then 'power_of_attorney' when 'price_terms' then 'price_snapshot' else 'terms' end,
    null,d.id,d.module_key,coalesce(d.template_version,left(d.content_sha256,12)),d.content_sha256,
    (v_signature->>'accepted_at')::timestamptz,p_signed_ip_hash,left(p_signed_user_agent,1000),'customer_portal',
    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash),
    jsonb_build_object('channel',v_request.channel,'pricing_snapshot_sha256',v_price.snapshot_hash)
  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
  on conflict do nothing;

  insert into public.customer_contract_acceptances(
    company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,
    ip_hash,user_agent,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256
  ) values(
    v_contract.company_id,v_contract.id,v_contract.contract_publication_version_id,(v_signature->>'accepted_at')::timestamptz,
    v_request.channel,'secure_link_click',p_signed_ip_hash,left(p_signed_user_agent,1000),
    jsonb_strip_nulls(jsonb_build_object('customer_id',v_customer.id,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),'email',v_customer.email,'customer_type',v_customer.customer_type)),
    '{}',v_acceptance,v_acceptance_hash
  ) on conflict (customer_contract_id,acceptance_sha256) do nothing;

  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)
  values(v_contract.company_id,v_contract.id,'online_acceptance',v_signature,v_signature_hash,(v_signature->>'accepted_at')::timestamptz)
  on conflict (customer_contract_id,evidence_type,evidence_sha256) do nothing;

  select coalesce(v_customer.customer_type,'private') into v_customer_type;
  select exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id and d.module_key in ('withdrawal','withdrawal_right','withdrawal_form','distance_contract_information','pre_contract_information')) into v_withdrawal_required;
  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then (v_signature->>'accepted_at')::timestamptz+interval '14 days' else null end;

  update public.customer_contracts set
    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,
    snapshot_hash=v_price.snapshot_hash,
    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,
    legal_versions_snapshot=v_legal_versions,signature_snapshot=v_signature,signature_snapshot_sha256=v_signature_hash,
    signed_ip_hash=p_signed_ip_hash,signed_user_agent=left(p_signed_user_agent,1000),locked_at=(v_signature->>'accepted_at')::timestamptz,
    lifecycle_stage='agreement_signed',signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('signature_status','signed','signature_method','secure_link_click','signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash),
    updated_at=now()
  where id=v_contract.id and company_id=v_contract.company_id
  returning * into v_contract;

  update public.customer_contract_signature_requests set used_at=(v_signature->>'accepted_at')::timestamptz where id=v_request.id;

  v_event:=public.gridex_record_customer_contract_event_v1(
    v_contract.company_id,v_contract.id,v_contract.customer_id,'signed',(v_signature->>'accepted_at')::timestamptz,
    'Avtal signerat online via säker engångslänk',
    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'channel',v_request.channel),
    null,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signed'),'UTF8'),'sha256'),'hex')
  );

  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',false,'withdrawal_deadline_at',v_withdrawal_deadline);
end
$_$;

REVOKE ALL ON FUNCTION public.gridex_finalize_signature_before_record_retention_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
