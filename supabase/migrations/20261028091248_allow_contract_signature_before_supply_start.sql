-- Agreement acceptance precedes delivery-date discovery; never invent starts_at.
create or replace function public.gridex_customer_contracts_auto_renew_guard()
 returns trigger
 language plpgsql
 set search_path to 'public','auth','extensions'
as $function$
declare
  v_binding_months integer;
  v_notice_months integer;
  v_auto_renew_months integer;
  v_bound_until timestamptz;
  v_notice_until timestamptz;
begin
  v_binding_months := coalesce(new.binding_months, 0);
  v_notice_months := coalesce(new.notice_months, 0);
  v_auto_renew_months := coalesce(new.auto_renew_term_months, new.binding_months);

  if new.auto_renew_enabled and (v_auto_renew_months is null or v_auto_renew_months <= 0) then
    raise exception 'auto_renew_term_months or binding_months must be set when auto_renew_enabled=true';
  end if;

  if new.termination_reason is not null and new.termination_notice_date is null then
    raise exception 'termination_notice_date is required when termination_reason is set';
  end if;

  -- Agreement evidence and withdrawal/termination notice may legitimately be
  -- recorded before a future supply start date. starts_at is a delivery date,
  -- not an agreement timestamp.

  -- The canonical state machine validates delivered operation using the
  -- operational actual_start_date. Signed commercial starts_at stays frozen.
  -- A pre-delivery termination legitimately has no delivered start date.
  if new.status = 'active' and new.actual_start_date is null then
    raise exception 'actual_start_date is required when status is active';
  end if;

  if new.green_fee_mode = 'none' and coalesce(new.green_fee_value, 0) <> 0 then
    raise exception 'green_fee_value must be null or 0 when green_fee_mode = none';
  end if;

  if new.starts_at is not null and new.ends_at is not null and new.ends_at < new.starts_at then
    raise exception 'ends_at cannot be earlier than starts_at';
  end if;

  -- Binding/notice effects after signing belong to operational supply periods.
  -- Do not derive a new frozen commercial end date after the signed-row guard.
  if tg_op = 'UPDATE' then
    if old.status in ('signed','active','terminated','cancelled','expired')
      or old.signed_at is not null or old.locked_at is not null then
      return new;
    end if;
  end if;

  v_bound_until := public.gridex_add_months_timestamptz(new.starts_at, nullif(v_binding_months, 0));
  v_notice_until := public.gridex_add_months_timestamptz(new.termination_notice_date, nullif(v_notice_months, 0));

  if new.ends_at is null then
    new.ends_at := greatest(v_bound_until, v_notice_until);
  elsif new.termination_notice_date is not null then
    new.ends_at := greatest(new.ends_at, v_bound_until, v_notice_until);
  end if;

  if new.status in ('terminated', 'expired') and new.ends_at is null then
    new.ends_at := greatest(v_bound_until, v_notice_until, new.starts_at);
  end if;

  if new.starts_at is not null and new.ends_at is not null and new.ends_at < new.starts_at then
    raise exception 'ends_at cannot be earlier than starts_at';
  end if;

  return new;
end;
$function$;

-- Online signing V2: explicit, atomic POA consent; V1 remains unchanged.
CREATE OR REPLACE FUNCTION public.gridex_finalize_customer_contract_signature_v2(
  p_token_hash text, p_signed_ip_hash text DEFAULT NULL, p_signed_user_agent text DEFAULT NULL,
  p_signer_ip text DEFAULT NULL, p_poa_accepted boolean DEFAULT false,
  p_poa_scopes text[] DEFAULT '{}'::text[], p_poa_terms_version text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
declare
  v_request public.customer_contract_signature_requests%rowtype;
  v_locator public.customer_contract_signature_requests%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_customer public.customers%rowtype;
  v_company public.companies%rowtype;
  v_price public.contract_price_snapshots%rowtype;
  v_legal_versions jsonb;
  v_signature jsonb;
  v_signature_hash text;
  v_accepted_at timestamptz;
  v_acceptance jsonb;
  v_acceptance_hash text;
  v_customer_type text;
  v_withdrawal_required boolean;
  v_withdrawal_deadline timestamptz;
  v_event jsonb;
  v_poa_doc public.legal_bundle_version_documents%rowtype;
  v_poa_snapshot jsonb := '{}'::jsonb;
  v_poa_id uuid;
  v_poa_evidence jsonb;
  v_poa_required boolean;
  v_signer_name text;
  v_signer_identity text;
  v_valid_from date;
  v_valid_to date;
  v_verifier text;
  v_scope text;
  v_site_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='signature_service_role_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='signature_token_invalid'; end if;
  select * into v_locator from public.customer_contract_signature_requests where token_hash=p_token_hash;
  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;
  perform id from public.companies where id=v_locator.company_id for share;
  select * into v_contract from public.customer_contracts where id=v_locator.customer_contract_id and company_id=v_locator.company_id for update;
  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash for update;
  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;
  if v_request.id is distinct from v_locator.id or v_request.token_hash is distinct from p_token_hash
    or v_request.company_id is distinct from v_locator.company_id or v_request.customer_id is distinct from v_locator.customer_id
    or v_request.customer_contract_id is distinct from v_locator.customer_contract_id then
    raise exception using errcode='40001',message='signature_request_scope_changed';
  end if;
  if v_contract.id is distinct from v_request.customer_contract_id or v_contract.company_id is distinct from v_request.company_id
    or v_contract.customer_id is distinct from v_request.customer_id then
    raise exception using errcode='23514',message='signature_exact_locked_chain_invalid';
  end if;
  perform public.ediel_require_contract_records_available_v1(v_request.company_id,v_request.customer_contract_id);
  if v_request.used_at is not null then
    if v_contract.status in ('signed','active','terminated','cancelled','expired') and v_contract.signed_at is not null then
      -- Replays return original evidence only. Never create/backfill consent or IP.
      select id into v_poa_id from public.powers_of_attorney
        where company_id=v_contract.company_id and customer_id=v_contract.customer_id
          and customer_contract_id=v_contract.id and source='ops_online_signature'
          and evidence_payload->>'signature_request_id'=v_request.id::text
          and id::text=v_contract.signature_snapshot#>>'{power_of_attorney_snapshot,power_of_attorney_id}'
          and evidence_payload->>'signature_snapshot_sha256'=v_contract.signature_snapshot_sha256;
      return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash)
        || jsonb_build_object('already_signed',true,'power_of_attorney_id',v_poa_id);
    end if;
    raise exception using errcode='55000',message='signature_link_already_used';
  end if;
  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;
  if v_request.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='signature_link_expired'; end if;
  select * into v_company from public.companies where id=v_request.company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_tenant_not_operational';
  end if;
  if v_contract.status<>'pending_signature' or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='contract_not_pending_signature';
  end if;
  select * into v_customer from public.customers where id=v_contract.customer_id and company_id=v_contract.company_id for share;
  if not found then raise exception using errcode='23514',message='signature_customer_scope_invalid'; end if;
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

  select power_of_attorney_required into v_poa_required from public.contract_product_versions
    where id=v_contract.contract_product_version_id;
  if coalesce(v_poa_required,true) and not coalesce(p_poa_accepted,false) then
    raise exception using errcode='22023',message='poa_explicit_consent_required';
  end if;
  if coalesce(p_poa_accepted,false) then
    if p_poa_terms_version is distinct from 'ops_online_poa_v1'
      or not coalesce(p_poa_scopes @> array['supplier_switch']::text[],false)
      or cardinality(p_poa_scopes) not between 1 and 2
      or not coalesce(p_poa_scopes <@ array['supplier_switch','facility_information_lookup']::text[],false)
      or exists(select 1 from unnest(p_poa_scopes) x group by x having count(*)>1)
      or array_position(p_poa_scopes,null) is not null then
      raise exception using errcode='22023',message='poa_explicit_scopes_invalid';
    end if;
    -- inet rejects invalid addresses; prefixes are not a single signing client.
    if nullif(btrim(p_signer_ip),'') is null or position('/' in p_signer_ip)>0 then
      raise exception using errcode='22023',message='poa_signer_ip_required';
    end if;
    begin perform p_signer_ip::inet;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='poa_signer_ip_invalid';
    end;
    if coalesce(v_customer.customer_type,'private')<>'private' then
      raise exception using errcode='22023',message='poa_authorized_business_signer_required';
    end if;
    v_signer_name:=coalesce(nullif(btrim(v_request.metadata->>'customer_full_name'),''),nullif(btrim(v_customer.full_name),''),nullif(btrim(concat_ws(' ',v_customer.first_name,v_customer.last_name)),''));
    v_signer_identity:=coalesce(nullif(btrim(v_customer.personal_number),''),nullif(btrim(v_customer.identity_number),''));
    if v_signer_name is null or v_signer_identity is null then
      raise exception using errcode='22023',message='poa_signer_identity_required';
    end if;
    v_site_id:=coalesce(v_contract.customer_site_id,v_contract.site_id);
    if (v_contract.customer_site_id is not null and v_contract.site_id is not null
        and v_contract.customer_site_id<>v_contract.site_id)
      or v_site_id is null or not exists(select 1 from public.customer_sites
        where id=v_site_id and company_id=v_contract.company_id and customer_id=v_contract.customer_id for share) then
      raise exception using errcode='23514',message='poa_site_scope_invalid';
    end if;
    if (select count(*) from public.legal_bundle_version_documents
      where legal_bundle_version_id=v_contract.legal_bundle_version_id and module_key='power_of_attorney')<>1 then
      raise exception using errcode='23514',message='poa_legal_document_missing_or_ambiguous';
    end if;
    select * into v_poa_doc from public.legal_bundle_version_documents
      where legal_bundle_version_id=v_contract.legal_bundle_version_id and module_key='power_of_attorney';
    if nullif(btrim(v_poa_doc.rendered_body),'') is null or cardinality(v_poa_doc.unresolved_variables)<>0
      or encode(extensions.digest(convert_to(v_poa_doc.rendered_body,'UTF8'),'sha256'),'hex') is distinct from v_poa_doc.content_sha256 then
      raise exception using errcode='23514',message='poa_legal_document_invalid';
    end if;
  elsif cardinality(coalesce(p_poa_scopes,'{}'::text[]))<>0 then
    raise exception using errcode='22023',message='poa_scopes_without_consent';
  end if;

  -- Capture one actual acceptance instant after all blocking locks and validations.
  -- Reuse it for the signature, acceptance/evidence, signed/used timestamps and event.
  v_accepted_at:=clock_timestamp();
  if v_request.expires_at<=v_accepted_at then
    raise exception using errcode='55000',message='signature_link_expired';
  end if;

  if coalesce(p_poa_accepted,false) then
    v_poa_id:=gen_random_uuid();
    v_verifier:=public.gridex_new_public_resource_reference('poa_verification');
    v_valid_from:=(v_accepted_at at time zone 'Europe/Stockholm')::date;
    v_valid_to:=(v_valid_from+interval '12 months')::date-1;
    v_poa_snapshot:=jsonb_build_object(
      'schema','ops_online_poa_v1','power_of_attorney_id',v_poa_id,'signature_request_id',v_request.id,
      'company_id',v_contract.company_id,'customer_id',v_contract.customer_id,'customer_site_id',v_site_id,
      'customer_contract_id',v_contract.id,'accepted_at',v_accepted_at,'scopes',to_jsonb(p_poa_scopes),
      'valid_from',v_valid_from,'valid_to',v_valid_to,'verification_reference',v_verifier,
      'customer',jsonb_build_object('name',v_signer_name,'identity',v_signer_identity),
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,'legal_bundle_version_document_id',v_poa_doc.id,
      'document_hash',v_poa_doc.content_sha256,
      'legal_text',jsonb_build_object('id',v_poa_doc.id,'title',v_poa_doc.title,'version',v_poa_doc.template_version,
        'body',v_poa_doc.rendered_body,'content_sha256',v_poa_doc.content_sha256),
      'request_evidence',jsonb_build_object('ip_address',p_signer_ip,'ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000)));
  end if;

  v_signature:=jsonb_build_object(
    'schema','gridex_online_contract_signature_v2','company_id',v_contract.company_id,'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,'signature_request_id',v_request.id,'channel',v_request.channel,'accepted_at',v_accepted_at,
    'recipient_email',v_request.recipient_email,'contract_number',v_contract.contract_number,'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,'contract_product_version_id',v_contract.contract_product_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id,'pricing_snapshot_sha256',v_price.snapshot_hash,
    'legal_versions',v_legal_versions,'tenant_communication_snapshot_sha256',v_contract.tenant_communication_snapshot_sha256,
    'customer_identity_snapshot',jsonb_strip_nulls(jsonb_build_object(
      'customer_id',v_customer.id,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),
      'email',v_customer.email,'customer_type',v_customer.customer_type,
      'full_name',coalesce(nullif(btrim(v_request.metadata->>'customer_full_name'),''),
        nullif(btrim(v_customer.full_name),''),nullif(btrim(v_customer.company_name),''),
        nullif(btrim(concat_ws(' ',v_customer.first_name,v_customer.last_name)),''))
    )),
    'power_of_attorney_snapshot',v_poa_snapshot,
    'request_evidence',jsonb_build_object('ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000))
  );
  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');
  v_acceptance:=jsonb_build_object(
    'schema','gridex_contract_acceptance_v2','signature_request_id',v_request.id,'contract_id',v_contract.id,
    'accepted_at',v_signature->>'accepted_at','channel',v_request.channel,'signing_method','secure_link_click',
    'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'legal_versions',v_legal_versions,
    'power_of_attorney_snapshot',v_poa_snapshot
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
    and (d.module_key<>'power_of_attorney' or coalesce(p_poa_accepted,false))
  on conflict do nothing;

  insert into public.customer_contract_acceptances(
    company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,
    ip_hash,user_agent,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256
  ) values(
    v_contract.company_id,v_contract.id,v_contract.contract_publication_version_id,(v_signature->>'accepted_at')::timestamptz,
    v_request.channel,'secure_link_click',p_signed_ip_hash,left(p_signed_user_agent,1000),
    v_signature->'customer_identity_snapshot',
    v_poa_snapshot,v_acceptance,v_acceptance_hash
  ) on conflict (customer_contract_id,acceptance_sha256) do nothing;

  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)
  values(v_contract.company_id,v_contract.id,'online_acceptance',v_signature,v_signature_hash,(v_signature->>'accepted_at')::timestamptz)
  on conflict (customer_contract_id,evidence_type,evidence_sha256) do nothing;

  select coalesce(v_customer.customer_type,'private') into v_customer_type;
  select exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id and d.module_key in ('withdrawal','withdrawal_right','withdrawal_form','distance_contract_information','pre_contract_information')) into v_withdrawal_required;
  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then ((((v_signature->>'accepted_at')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date+15)::timestamp AT TIME ZONE 'Europe/Stockholm')-interval '1 microsecond' else null end;

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

  if v_poa_id is not null then
    v_poa_evidence:=jsonb_build_object('source','ops_online_signature','capture_type','structured_complete',
      'capture_source','actual_signing_request','signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,
      'accepted_at',v_accepted_at,'verification_reference',v_verifier,'ip_address',p_signer_ip,'ip_address_source','signer_reported',
      'user_agent',left(p_signed_user_agent,1000),'legal_bundle_version_document_id',v_poa_doc.id,
      'legal_document_sha256',v_poa_doc.content_sha256);
    insert into public.powers_of_attorney(id,company_id,customer_id,site_id,customer_site_id,contract_id,customer_contract_id,
      scope,status,signed_at,accepted_at,valid_from,valid_to,valid_until,source,accepted_source,method,
      signer_name,signer_identity_number,customer_number,accepted_ip,accepted_ip_hash,accepted_user_agent,
      legal_bundle_version_document_id,fullmakt_snapshot,signed_scope_snapshot,scope_summary,evidence_payload,reference,metadata)
    values(v_poa_id,v_contract.company_id,v_contract.customer_id,v_site_id,v_site_id,v_contract.id,v_contract.id,
      'supplier_switch','signed',v_accepted_at,v_accepted_at,v_valid_from,v_valid_to,v_valid_to,'ops_online_signature','ops_online_signature','secure_link_click',
      v_signer_name,v_signer_identity,v_customer.customer_number,p_signer_ip,
      encode(extensions.digest(convert_to(p_signer_ip,'UTF8'),'sha256'),'hex'),left(p_signed_user_agent,1000),
      v_poa_doc.id,v_poa_snapshot,to_jsonb(p_poa_scopes),jsonb_build_object('scopes',to_jsonb(p_poa_scopes)),
      v_poa_evidence,v_verifier,jsonb_build_object('online_signature_archive_pending',true,'signature_request_id',v_request.id));
    -- The existing date synchronizer runs on INSERT. Explicitly preserve the
    -- displayed inclusive last Swedish calendar day without changing its dates.
    update public.powers_of_attorney set expires_at=((v_valid_to+1)::timestamp at time zone 'Europe/Stockholm')
      where id=v_poa_id and company_id=v_contract.company_id and customer_id=v_contract.customer_id;
    foreach v_scope in array p_poa_scopes loop
      insert into public.power_of_attorney_scopes(company_id,power_of_attorney_id,customer_id,site_id,customer_contract_id,
        scope_type,status,is_active,valid_from,valid_to,metadata)
      values(v_contract.company_id,v_poa_id,v_contract.customer_id,v_site_id,v_contract.id,
        v_scope,'active',true,v_valid_from,v_valid_to,jsonb_build_object('source','ops_online_signature','signature_request_id',v_request.id));
    end loop;
  end if;
  -- Signed-trigger enqueue and this hold commit atomically. No worker can
  -- observe the intermediate queued state. Never overwrite another review.
  update public.customer_operation_jobs set
    status=case when v_poa_id is null then 'needs_review' else 'blocked' end,
    review_reason_code=case when v_poa_id is null then 'poa_not_granted' else 'poa_archive_pending' end,
    last_error=case when v_poa_id is null then 'Ingen fullmakt har godkänts. Granska fullmaktsunderlaget innan leverantörsbytet fortsätter.'
      else 'Fullmaktens privata PDF förbereds. Leverantörsbytet väntar på verifierat originalarkiv.' end,
    payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('online_poa_id',v_poa_id,'signature_request_id',v_request.id),
    updated_at=now()
  where company_id=v_contract.company_id and customer_id=v_contract.customer_id
    and idempotency_key='contract-signed:'||v_contract.id::text and job_type='start_supplier_switch'
    and status='queued' and payload->>'contract_id'=v_contract.id::text;

  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash)
    || jsonb_build_object('already_signed',false,'withdrawal_deadline_at',v_withdrawal_deadline,'power_of_attorney_id',v_poa_id);
end
$_$;
REVOKE ALL ON FUNCTION public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text) TO service_role;

-- A verified private PDF is the only transition that clears our archive hold.
CREATE OR REPLACE FUNCTION public.gridex_complete_online_signature_poa_archive_v1(
  p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_request_id uuid,p_poa_id uuid,
  p_path text,p_sha256 text,p_evidence_sha256 text,p_size_bytes bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
declare
  p public.powers_of_attorney%rowtype;
  c public.customer_contracts%rowtype;
  r public.customer_contract_signature_requests%rowtype;
  a jsonb;
  d public.customer_authorization_documents%rowtype;
  s public.authorization_scopes%rowtype;
  v_document_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='signature_service_role_required';
  end if;
  perform id from public.companies where id=p_company_id and is_active=true
    and lifecycle_status='active' and suspended_at is null for share;
  if not found then raise exception using errcode='55000',message='poa_archive_tenant_not_operational'; end if;
  select * into c from public.customer_contracts where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id for update;
  if not found then raise exception using errcode='23514',message='poa_archive_contract_scope_invalid'; end if;
  perform public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
  select * into r from public.customer_contract_signature_requests where id=p_request_id and company_id=p_company_id
    and customer_id=p_customer_id and customer_contract_id=p_contract_id for share;
  if not found or r.used_at is null or r.used_at is distinct from c.signed_at then
    raise exception using errcode='23514',message='poa_archive_request_scope_invalid';
  end if;
  select * into p from public.powers_of_attorney where id=p_poa_id and company_id=p_company_id and customer_id=p_customer_id
    and customer_contract_id=p_contract_id and source='ops_online_signature' for update;
  if not found or p.evidence_payload->>'signature_request_id' is distinct from p_request_id::text
    or p.evidence_payload->>'signature_snapshot_sha256' is distinct from c.signature_snapshot_sha256
    or p.accepted_at is distinct from c.signed_at or p.revoked_at is not null or p.status<>'signed'
    or p.expires_at is null or p.expires_at<=clock_timestamp()
    or c.signature_snapshot#>>'{power_of_attorney_snapshot,power_of_attorney_id}' is distinct from p.id::text
    or c.signature_snapshot_sha256 is distinct from encode(extensions.digest(convert_to(c.signature_snapshot::text,'UTF8'),'sha256'),'hex')
    or p.fullmakt_snapshot is distinct from c.signature_snapshot->'power_of_attorney_snapshot'
    or p.signer_name is distinct from p.fullmakt_snapshot#>>'{customer,name}'
    or p.signer_identity_number is distinct from p.fullmakt_snapshot#>>'{customer,identity}'
    or p.signed_scope_snapshot is distinct from p.fullmakt_snapshot->'scopes'
    or p.accepted_ip is distinct from p.fullmakt_snapshot#>>'{request_evidence,ip_address}'
    or p.evidence_payload->>'ip_address' is distinct from p.accepted_ip
    or p.evidence_payload->>'verification_reference' is distinct from p.fullmakt_snapshot->>'verification_reference'
    or p.legal_bundle_version_document_id::text is distinct from p.fullmakt_snapshot->>'legal_bundle_version_document_id' then
    raise exception using errcode='23514',message='poa_archive_original_binding_invalid';
  end if;
  a:=p.metadata->'document_archive';
  if coalesce(p_sha256,'')!~'^[a-f0-9]{64}$' or coalesce(p_evidence_sha256,'')!~'^[a-f0-9]{64}$'
    or p_size_bytes is null or p_size_bytes<=0
    or p_path is distinct from ('companies/'||p_company_id||'/customers/'||p_customer_id||'/powers-of-attorney/'||p_poa_id||'/fullmakt-'||p_sha256||'.pdf')
    or p.document_path is distinct from p_path or a->>'path' is distinct from p_path
    or a->>'storage_bucket' is distinct from 'customer-documents' or a->>'sha256' is distinct from p_sha256
    or a->>'evidence_sha256' is distinct from p_evidence_sha256
    or not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id='customer-documents' and o.name=p_path and b.public=false) then
    raise exception using errcode='23514',message='poa_archive_private_pdf_invalid';
  end if;
  if p.document_id is not null then
    select * into d from public.customer_authorization_documents where id=p.document_id and company_id=p_company_id
      and customer_id=p_customer_id and customer_contract_id=p_contract_id and power_of_attorney_id=p.id;
    if not found or d.file_path is distinct from p_path or d.file_checksum is distinct from p_sha256
      or d.storage_bucket is distinct from 'customer-documents' or d.status<>'active' then
      raise exception using errcode='23514',message='poa_archive_document_binding_invalid';
    end if;
    v_document_id:=d.id;
  else
    insert into public.customer_authorization_documents(company_id,customer_id,site_id,power_of_attorney_id,customer_contract_id,
      document_type,status,title,file_name,mime_type,file_size_bytes,storage_bucket,file_path,file_checksum,
      upload_idempotency_key,reference,metadata)
    values(p_company_id,p_customer_id,p.customer_site_id,p.id,p_contract_id,'power_of_attorney','active','Signerad fullmakt',
      'fullmakt-'||p.reference||'.pdf','application/pdf',p_size_bytes,'customer-documents',p_path,p_sha256,
      'online-poa:'||p.id,p.reference,jsonb_build_object('source','ops_online_signature','signature_request_id',p_request_id,
        'evidence_sha256',p_evidence_sha256,'signature_snapshot_sha256',c.signature_snapshot_sha256)) returning id into v_document_id;
  end if;
  -- The operational reader uses authorization_scopes bound to the exact PDF,
  -- not power_of_attorney_scopes. Project only this original's signed rights.
  if (select count(*) from public.authorization_scopes where authorization_document_id=v_document_id)>1 then
    raise exception using errcode='23514',message='poa_archive_authorization_ambiguous';
  end if;
  select * into s from public.authorization_scopes where authorization_document_id=v_document_id;
  if found then
    if s.company_id is distinct from p_company_id or s.customer_id is distinct from p_customer_id
      or s.status<>'active' or s.revoked_at is not null or s.scope_type<>'supplier_switch_data'
      or s.signed_scope_snapshot is distinct from p.signed_scope_snapshot
      or s.valid_from is distinct from p.valid_from or s.valid_to is distinct from p.valid_to
      or s.covers_grid_owner_data is distinct from true or s.covers_current_supplier_contract is distinct from true
      or s.covers_metering_data is distinct from (p.signed_scope_snapshot ? 'facility_information_lookup')
      or s.metadata->>'powerOfAttorneyId' is distinct from p.id::text
      or s.metadata->>'signature_request_id' is distinct from p_request_id::text then
      raise exception using errcode='23514',message='poa_archive_authorization_binding_invalid';
    end if;
  else
    insert into public.authorization_scopes(company_id,customer_id,authorization_document_id,scope_type,status,
      covers_grid_owner_data,covers_current_supplier_contract,covers_metering_data,signed_scope_snapshot,
      valid_from,valid_to,evidence_note,metadata)
    values(p_company_id,p_customer_id,v_document_id,'supplier_switch_data','active',true,true,
      p.signed_scope_snapshot ? 'facility_information_lookup',p.signed_scope_snapshot,p.valid_from,p.valid_to,
      'Uttryckligen godkänd fullmakt, verifierad mot originalsignering och privat PDF.',
      jsonb_build_object('source','ops_online_signature','powerOfAttorneyId',p.id,'authorizationDocumentId',v_document_id,
        'signature_request_id',p_request_id,'signature_snapshot_sha256',c.signature_snapshot_sha256));
  end if;
  update public.powers_of_attorney set document_id=v_document_id,
    metadata=metadata||jsonb_build_object('online_signature_archive_pending',false,'online_signature_archive_completed_at',coalesce(metadata->>'online_signature_archive_completed_at',clock_timestamp()::text)),
    updated_at=now() where id=p.id and company_id=p_company_id and customer_id=p_customer_id;
  update public.customer_operation_jobs set status='queued',review_reason_code=null,last_error=null,updated_at=now()
    where company_id=p_company_id and customer_id=p_customer_id and customer_site_id=p.customer_site_id
      and idempotency_key='contract-signed:'||p_contract_id::text and job_type='start_supplier_switch'
      and status='blocked' and review_reason_code='poa_archive_pending' and locked_at is null
      and not coalesce(lifecycle_blocked_by_tenant,false) and c.status='signed'
      and payload->>'contract_id'=p_contract_id::text and payload->>'online_poa_id'=p_poa_id::text
      and payload->>'signature_request_id'=p_request_id::text;
  return jsonb_build_object('power_of_attorney_id',p.id,'document_id',v_document_id,'sha256',p_sha256);
end;
$function$;
REVOKE ALL ON FUNCTION public.gridex_complete_online_signature_poa_archive_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_complete_online_signature_poa_archive_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint) TO service_role;

-- Online capture is immutable. A later IP, legal text or signer must never
-- replace the customer's original evidence. Archive fields are service-only.
CREATE OR REPLACE FUNCTION public.gridex_protect_online_signature_poa_capture_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
declare
  -- Match ECMAScript String.trim, including tabs, NBSP and BOM. Consumers
  -- recognize these reserved-source spellings; none may bypass provenance.
  v_trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_new_source text;
  v_old_source text;
begin
  v_new_source:=lower(coalesce(nullif(btrim(coalesce(new.source,''),v_trim_chars),''),
    btrim(coalesce(new.evidence_payload->>'source',''),v_trim_chars)));
  if tg_op='INSERT' then
    if v_new_source='ops_online_signature' then
      if auth.role() is distinct from 'service_role' then
        raise exception using errcode='42501',message='poa_online_capture_service_role_required';
      end if;
      if new.source is distinct from 'ops_online_signature' then
        raise exception using errcode='23514',message='poa_online_source_noncanonical';
      end if;
    end if;
    return new;
  end if;
  v_old_source:=lower(coalesce(nullif(btrim(coalesce(old.source,''),v_trim_chars),''),
    btrim(coalesce(old.evidence_payload->>'source',''),v_trim_chars)));
  if v_old_source='ops_online_signature' then
    if (to_jsonb(new)-array['status','revoked_at','document_id','document_path','document_hash','metadata','updated_at','updated_by','notes','evidence_note','expires_at'])
      is distinct from (to_jsonb(old)-array['status','revoked_at','document_id','document_path','document_hash','metadata','updated_at','updated_by','notes','evidence_note','expires_at']) then
      raise exception using errcode='23514',message='poa_online_original_capture_immutable';
    end if;
    if auth.role() is distinct from 'service_role' and (
      row(new.document_id,new.document_path,new.document_hash,new.expires_at)
        is distinct from row(old.document_id,old.document_path,old.document_hash,old.expires_at)
      or new.metadata->'document_archive' is distinct from old.metadata->'document_archive'
      or new.metadata->'online_signature_archive_pending' is distinct from old.metadata->'online_signature_archive_pending') then
      raise exception using errcode='42501',message='poa_online_archive_service_role_required';
    end if;
  elsif v_new_source='ops_online_signature' then
    raise exception using errcode='23514',message='poa_online_source_cannot_be_relabelled';
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.gridex_protect_online_signature_poa_capture_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_protect_online_signature_poa_capture_v1() TO service_role;
CREATE TRIGGER powers_of_attorney_online_capture_guard_tg BEFORE INSERT OR UPDATE ON public.powers_of_attorney
FOR EACH ROW EXECUTE FUNCTION public.gridex_protect_online_signature_poa_capture_v1();
