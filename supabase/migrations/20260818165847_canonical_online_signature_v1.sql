create table if not exists public.customer_contract_signature_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,
  token_hash text not null unique,
  recipient_email text not null,
  channel text not null default 'internal',
  expires_at timestamptz not null,
  sent_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint customer_contract_signature_requests_token_hash_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_contract_signature_requests_channel_chk check (channel in ('internal','website','partner_api','customer_portal')),
  constraint customer_contract_signature_requests_expiry_chk check (expires_at > created_at),
  constraint customer_contract_signature_requests_customer_tenant_fk foreign key (company_id,customer_id) references public.customers(company_id,id),
  constraint customer_contract_signature_requests_contract_tenant_fk foreign key (company_id,customer_contract_id) references public.customer_contracts(company_id,id)
);

create index if not exists customer_contract_signature_requests_contract_active_idx
  on public.customer_contract_signature_requests(company_id,customer_contract_id,created_at desc)
  where used_at is null and revoked_at is null;
create index if not exists customer_contract_signature_requests_expiry_idx
  on public.customer_contract_signature_requests(expires_at)
  where used_at is null and revoked_at is null;

alter table public.customer_contract_signature_requests enable row level security;
revoke all on public.customer_contract_signature_requests from anon, authenticated;
grant select,insert,update on public.customer_contract_signature_requests to service_role;

create or replace function public.gridex_prepare_customer_contract_signature_request_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_contract_id uuid,
  p_token_hash text,
  p_recipient_email text,
  p_expires_at timestamptz,
  p_actor_user_id uuid,
  p_channel text default 'internal'
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_temp'
as $function$
declare
  v_contract public.customer_contracts%rowtype;
  v_company public.companies%rowtype;
  v_binding jsonb;
  v_snapshot_id uuid;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_request public.customer_contract_signature_requests%rowtype;
  v_event jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');

  if p_company_id is null or p_customer_id is null or p_contract_id is null then
    raise exception using errcode='22023',message='signature_request_company_customer_contract_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='signature_request_token_hash_invalid';
  end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)=0 then
    raise exception using errcode='22023',message='signature_request_recipient_email_required';
  end if;
  if p_channel not in ('internal','website','partner_api','customer_portal') then
    raise exception using errcode='22023',message='signature_request_channel_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  select * into v_company from public.companies where id=p_company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_request_tenant_not_operational';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='signature_request_contract_not_found_for_tenant';
  end if;
  if v_contract.status in ('signed','active','terminated','cancelled','expired') or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='signature_request_contract_already_finalized';
  end if;
  if v_contract.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='23514',message='signature_request_contract_state_invalid';
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(p_company_id,v_contract.contract_offer_id,p_actor_user_id);
      update public.customer_contracts
      set contract_offer_id=v_contract.contract_offer_id,updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    else
      v_binding:=public.gridex_prepare_manual_contract_binding(
        p_company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name',v_contract.contract_name,
          'customer_type',(select c.customer_type from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id),
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'campaign_code',v_contract.campaign_code,
          'campaign_version',v_contract.campaign_version,
          'terms_version',v_contract.terms_version,
          'binding_months',v_contract.binding_months,
          'notice_months',v_contract.notice_months,
          'valid_from',coalesce(v_contract.starts_at::date,current_date),
          'valid_to',v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'price_area',v_contract.price_area_used,
          'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek',v_contract.monthly_fee_sek,
          'invoice_fee_sek',v_contract.invoice_fee_sek,
          'green_fee_mode',v_contract.green_fee_mode,
          'green_fee_value',v_contract.green_fee_value,
          'discount_value',v_contract.discount_value,
          'discount_unit',v_contract.discount_unit,
          'start_fee_sek',v_contract.start_fee_sek,
          'admin_fee_sek',v_contract.admin_fee_sek,
          'break_fee_sek',v_contract.break_fee_sek,
          'vat_rate',v_contract.vat_rate
        )),
        p_actor_user_id
      );
      update public.customer_contracts set
        contract_offer_id=nullif(v_binding->>'contract_offer_id','')::uuid,
        contract_product_id=nullif(v_binding->>'contract_product_id','')::uuid,
        contract_product_version_id=nullif(v_binding->>'contract_product_version_id','')::uuid,
        contract_publication_version_id=nullif(v_binding->>'contract_publication_version_id','')::uuid,
        price_plan_id=nullif(v_binding->>'price_plan_id','')::uuid,
        price_plan_version_id=nullif(v_binding->>'price_plan_version_id','')::uuid,
        price_book_id=nullif(v_binding->>'price_book_id','')::uuid,
        legal_bundle_version_id=nullif(v_binding->>'legal_bundle_version_id','')::uuid,
        offer_reference=v_binding->>'offer_reference',
        commercial_snapshot=coalesce(v_binding->'commercial_snapshot','{}'::jsonb),
        legal_snapshot=coalesce(v_binding->'legal_snapshot','{}'::jsonb),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    raise exception using errcode='23514',message='signature_request_exact_contract_chain_missing';
  end if;

  if v_contract.contract_price_snapshot_id is null then
    select coalesce(cpv.pricing_model,'spot') into v_pricing_model
    from public.contract_product_versions cpv where cpv.id=v_contract.contract_product_version_id;
    v_base_components:=coalesce(
      v_contract.price_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_components',
      '[]'::jsonb
    );
    v_price_components:=coalesce(
      v_contract.price_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components',
      '[]'::jsonb
    );
    if jsonb_typeof(v_base_components)<>'array' then v_base_components:='[]'::jsonb; end if;
    if jsonb_typeof(v_price_components)<>'array' then v_price_components:='[]'::jsonb; end if;
    v_snapshot:=jsonb_strip_nulls(coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
      'source','signature_prepare',
      'company_id',v_contract.company_id,
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'customer_number',v_contract.customer_number,
      'contract_type',v_contract.contract_type,
      'energy_direction',v_contract.energy_direction,
      'price_area',v_contract.price_area_used,
      'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek',v_contract.monthly_fee_sek,
      'invoice_fee_sek',v_contract.invoice_fee_sek,
      'green_fee_mode',v_contract.green_fee_mode,
      'green_fee_value',v_contract.green_fee_value,
      'discount_value',v_contract.discount_value,
      'discount_unit',v_contract.discount_unit,
      'start_fee_sek',v_contract.start_fee_sek,
      'admin_fee_sek',v_contract.admin_fee_sek,
      'break_fee_sek',v_contract.break_fee_sek,
      'vat_rate',v_contract.vat_rate,
      'binding_months',v_contract.binding_months,
      'notice_months',v_contract.notice_months,
      'starts_at',v_contract.starts_at,
      'ends_at',v_contract.ends_at,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'base_price_components_snapshot',v_base_components,
      'price_components_snapshot',v_price_components
    ));
    v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);
    insert into public.contract_price_snapshots(
      company_id,contract_id,customer_id,price_plan_version_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,
      valid_from,valid_to,source,contract_number,customer_number,snapshot_hash,
      snapshot_quality,snapshot_schema_version
    ) values(
      p_company_id,v_contract.id,v_contract.customer_id,v_contract.price_plan_version_id,
      coalesce(v_pricing_model,'spot'),v_snapshot->'base_price_components_snapshot',
      coalesce(v_snapshot->'price_components_snapshot','[]'::jsonb),v_snapshot,
      coalesce(v_contract.starts_at::date,current_date),v_contract.ends_at::date,
      'signature_prepare',v_contract.contract_number,v_contract.customer_number,
      encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
      'canonical','gridex_contract_pricing_v7_signed_receipt'
    ) returning id into v_snapshot_id;
    update public.customer_contracts
    set contract_price_snapshot_id=v_snapshot_id,price_snapshot=v_snapshot,updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  if not exists(
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=p_company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps on cps.id=v_contract.contract_price_snapshot_id and cps.contract_id=v_contract.id and cps.company_id=p_company_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='signature_request_exact_locked_chain_invalid';
  end if;
  if not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id) then
    raise exception using errcode='23514',message='signature_request_legal_document_set_missing';
  end if;

  if v_contract.status in ('draft','signature_failed') then
    update public.customer_contracts
    set status='pending_signature',lifecycle_stage='agreement_ready',updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  update public.customer_contract_signature_requests
  set revoked_at=now()
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null;

  insert into public.customer_contract_signature_requests(
    company_id,customer_id,customer_contract_id,token_hash,recipient_email,
    channel,expires_at,created_by,metadata
  ) values(
    p_company_id,p_customer_id,p_contract_id,p_token_hash,lower(btrim(p_recipient_email)),
    p_channel,p_expires_at,p_actor_user_id,
    jsonb_build_object(
      'contract_number',v_contract.contract_number,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
    )
  ) returning * into v_request;

  v_event:=public.gridex_record_customer_contract_event_v1(
    p_company_id,v_contract.id,v_contract.customer_id,'signature_requested',now(),
    'Online-signering begärd',
    jsonb_build_object('signature_request_id',v_request.id,'channel',p_channel,'expires_at',p_expires_at),
    p_actor_user_id,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signature_requested'),'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'company_id',p_company_id,
    'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,
    'contract_number',v_contract.contract_number,
    'contract_name',v_contract.contract_name,
    'status',v_contract.status,
    'recipient_email',v_request.recipient_email,
    'expires_at',v_request.expires_at,
    'channel',v_request.channel,
    'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,
    'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
  );
end
$function$;

create or replace function public.gridex_mark_customer_contract_signature_request_sent_v1(
  p_request_id uuid,
  p_company_id uuid
) returns void
language sql
security definer
set search_path to 'public','pg_temp'
as $function$
  update public.customer_contract_signature_requests
  set sent_at=coalesce(sent_at,now())
  where id=p_request_id and company_id=p_company_id and revoked_at is null and used_at is null;
$function$;

create or replace function public.gridex_get_customer_contract_signature_receipt_v1(
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_request public.customer_contract_signature_requests%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_customer public.customers%rowtype;
  v_company public.companies%rowtype;
  v_price public.contract_price_snapshots%rowtype;
  v_legal_versions jsonb;
begin
  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash;
  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;
  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;
  if v_request.used_at is null and v_request.expires_at<=now() then raise exception using errcode='55000',message='signature_link_expired'; end if;
  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id;
  select * into v_customer from public.customers where id=v_request.customer_id and company_id=v_request.company_id;
  select * into v_company from public.companies where id=v_request.company_id;
  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_request.company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'module_key',d.module_key,'title',d.title,
    'version',coalesce(d.template_version,left(d.content_sha256,12)),
    'document_sha256',d.content_sha256,'body',d.rendered_body
  ) order by d.sort_order,d.id),'[]'::jsonb)
  into v_legal_versions
  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;
  return jsonb_build_object(
    'request_id',v_request.id,'company_id',v_request.company_id,'customer_id',v_request.customer_id,
    'contract_id',v_contract.id,'contract_number',v_contract.contract_number,'contract_name',v_contract.contract_name,
    'contract_type',v_contract.contract_type,'status',v_contract.status,'signed_at',v_contract.signed_at,
    'used_at',v_request.used_at,'expires_at',v_request.expires_at,'channel',v_request.channel,
    'customer_name',coalesce(v_customer.full_name,v_customer.company_name,concat_ws(' ',v_customer.first_name,v_customer.last_name),v_customer.email),
    'customer_email',v_customer.email,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),
    'company_name',v_company.name,'offer_reference',v_contract.offer_reference,
    'starts_at',v_contract.starts_at,'ends_at',v_contract.ends_at,'price_area',coalesce(v_contract.price_area_used,v_price.snapshot_json->>'price_area'),
    'pricing_snapshot',v_price.snapshot_json,'pricing_snapshot_sha256',v_price.snapshot_hash,
    'legal_versions',v_legal_versions,'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_publication_version_id',v_contract.contract_publication_version_id,'price_plan_version_id',v_contract.price_plan_version_id,
    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256
  );
end
$function$;

create or replace function public.gridex_finalize_customer_contract_signature_v1(
  p_token_hash text,
  p_signed_ip_hash text default null,
  p_signed_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $function$
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
$function$;

revoke all on function public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_mark_customer_contract_signature_request_sent_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_get_customer_contract_signature_receipt_v1(text) from public,anon,authenticated;
revoke all on function public.gridex_finalize_customer_contract_signature_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text) to service_role;
grant execute on function public.gridex_mark_customer_contract_signature_request_sent_v1(uuid,uuid) to service_role;
grant execute on function public.gridex_get_customer_contract_signature_receipt_v1(text) to service_role;
grant execute on function public.gridex_finalize_customer_contract_signature_v1(text,text,text) to service_role;

-- The internal create command intentionally creates only a draft. The exact
-- internal publication version is rebound in the following forward hotfix;
-- raw signed/active creation is forbidden here already.
create or replace function public.gridex_create_internal_customer_contract_v1(p_company_id uuid, p_customer_id uuid, p_contract_offer_id uuid, p_site_id uuid, p_metering_point_id uuid, p_selection jsonb, p_contract jsonb, p_actor_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_offer public.contract_offers%rowtype;
  v_option public.contract_price_options%rowtype;
  v_area public.contract_price_option_area_prices%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_snapshot_id uuid;
  v_selected_refs text[];
  v_resolved_count integer;
  v_pricing_model text;
  v_snapshot jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
  if p_selection->>'snapshot_schema'<>'gridex_contract_pricing_v6_selection'
    or jsonb_typeof(p_selection->'base_price_components_snapshot')<>'array'
    or jsonb_typeof(p_selection->'price_components_snapshot')<>'array'
    or nullif(p_selection->>'price_option_reference','') is null
    or nullif(p_selection->>'invoice_delivery_method','') is null then
    raise exception using errcode='22023',message='internal_contract_commercial_selection_incomplete';
  end if;
  if nullif(p_contract->>'signed_at','') is not null or coalesce(nullif(p_contract->>'status',''),'draft') in ('signed','active') then
    raise exception using errcode='23514',message='internal_contract_raw_signature_state_forbidden';
  end if;

  select offer.* into v_offer from public.contract_offers offer
  where offer.id=p_contract_offer_id and offer.company_id=p_company_id and offer.lifecycle_status='published' and offer.is_active for share;
  if not found then raise exception using errcode='P0002',message='internal_contract_offer_not_sellable'; end if;
  if not exists(select 1 from public.customers customer where customer.id=p_customer_id and customer.company_id=p_company_id) then
    raise exception using errcode='23514',message='internal_contract_customer_tenant_mismatch';
  end if;
  if p_site_id is not null and not exists(select 1 from public.customer_sites site where site.id=p_site_id and site.company_id=p_company_id and site.customer_id=p_customer_id) then
    raise exception using errcode='23514',message='internal_contract_site_tenant_mismatch';
  end if;
  if p_metering_point_id is not null and not exists(select 1 from public.metering_points point where point.id=p_metering_point_id and point.company_id=p_company_id and (p_site_id is null or point.site_id=p_site_id)) then
    raise exception using errcode='23514',message='internal_contract_metering_point_tenant_mismatch';
  end if;

  select option_row.* into v_option from public.contract_price_options option_row
  where option_row.company_id=p_company_id and option_row.contract_product_version_id=v_offer.contract_product_version_id
    and option_row.price_plan_version_id=v_offer.price_plan_version_id and option_row.option_reference=p_selection->>'price_option_reference' and option_row.status='active';
  if not found then raise exception using errcode='23514',message='internal_contract_price_option_not_available'; end if;
  if v_offer.contract_type='fixed' then
    select area_row.* into v_area from public.contract_price_option_area_prices area_row
    where area_row.company_id=p_company_id and area_row.contract_price_option_id=v_option.id
      and area_row.price_row_reference=p_selection->>'area_price_reference' and area_row.price_area=p_selection->>'price_area';
    if not found then raise exception using errcode='23514',message='internal_contract_area_price_not_available'; end if;
  end if;

  v_selected_refs:=array(select value from jsonb_array_elements_text(coalesce(p_selection->'selected_component_references','[]'::jsonb)));
  select count(*) into v_resolved_count from jsonb_array_elements(p_selection->'price_components_snapshot') component
  where coalesce(component->>'componentReference',component->>'component_reference',component#>>'{metadata,component_reference}')=any(v_selected_refs);
  if v_resolved_count<>coalesce(array_length(v_selected_refs,1),0) or exists(
    select 1 from unnest(v_selected_refs) reference where not exists(
      select 1 from public.price_components component where component.company_id=p_company_id
        and component.price_plan_version_id=v_offer.price_plan_version_id and component.component_reference=reference and component.status='active'
    )
  ) then raise exception using errcode='23514',message='internal_contract_component_selection_mismatch'; end if;

  select pricing_model into v_pricing_model from public.contract_product_versions where id=v_offer.contract_product_version_id;
  v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(p_selection);

  insert into public.customer_contracts(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_offer_id,contract_product_id,contract_product_version_id,
    price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,source_type,status,contract_name,contract_type,
    energy_direction,offer_reference,commercial_snapshot,price_snapshot,monthly_fee_sek,invoice_fee_sek,fixed_price_ore_per_kwh,
    binding_months,notice_months,optional_fee_lines,agreement_channel,starts_at,ends_at,signed_at,auto_renew_enabled,auto_renew_term_months,
    override_reason,metadata,created_by,updated_by
  ) values(
    p_company_id,p_customer_id,p_site_id,p_site_id,p_metering_point_id,v_offer.id,v_offer.contract_product_id,v_offer.contract_product_version_id,
    v_offer.price_plan_id,v_offer.price_plan_version_id,v_offer.price_book_id,v_offer.legal_bundle_version_id,'catalog','draft',
    coalesce(nullif(p_contract->>'contract_name',''),v_offer.name),v_offer.contract_type,v_offer.energy_direction,
    coalesce(nullif(v_offer.slug,''),v_offer.id::text),v_snapshot,v_snapshot,
    (select (component->>'amount')::numeric from jsonb_array_elements(v_snapshot->'price_components_snapshot') component where coalesce(component->>'componentCode',component->>'component_code',component#>>'{metadata,component_code}')='monthly_fee' limit 1),
    (select (component->>'amount')::numeric from jsonb_array_elements(v_snapshot->'price_components_snapshot') component where coalesce(component->>'componentCode',component->>'component_code',component#>>'{metadata,component_code}')='invoice_administration_fee' limit 1),
    case when v_offer.contract_type='fixed' then case when v_area.unit='sek_per_kwh' then v_area.amount*100 else v_area.amount end else null end,
    v_option.binding_months,v_option.notice_months,v_snapshot->'price_components_snapshot','internal',nullif(p_contract->>'starts_at','')::date,
    nullif(p_contract->>'ends_at','')::date,null,v_option.auto_renew_enabled,v_option.renewal_term_months,nullif(p_contract->>'override_reason',''),
    jsonb_build_object('source_of_truth','contract_price_options','price_option_reference',v_option.option_reference,'area_price_reference',v_area.price_row_reference,
      'invoice_delivery_method',p_selection->>'invoice_delivery_method','selected_component_references',to_jsonb(v_selected_refs)),p_actor_user_id,p_actor_user_id
  ) returning * into v_contract;

  insert into public.contract_price_snapshots(
    company_id,contract_id,customer_id,source,price_plan_version_id,pricing_model,base_price_components_snapshot,price_components_snapshot,
    snapshot_json,valid_from,valid_to,snapshot_schema_version,price_option_reference,area_price_reference,invoice_delivery_method,
    selected_component_references,snapshot_hash,snapshot_quality
  ) values(
    p_company_id,v_contract.id,p_customer_id,'internal_customer_contract_selection',v_offer.price_plan_version_id,coalesce(v_pricing_model,'spot'),
    v_snapshot->'base_price_components_snapshot',v_snapshot->'price_components_snapshot',v_snapshot,
    coalesce(nullif(p_contract->>'starts_at','')::date,current_date),nullif(p_contract->>'ends_at','')::date,
    'gridex_contract_pricing_v6_selection',v_option.option_reference,v_area.price_row_reference,p_selection->>'invoice_delivery_method',v_selected_refs,
    encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),'canonical'
  ) returning id into v_snapshot_id;

  update public.customer_contracts set contract_price_snapshot_id=v_snapshot_id,updated_at=now() where id=v_contract.id and company_id=p_company_id returning * into v_contract;
  return jsonb_build_object('ok',true,'contract',to_jsonb(v_contract),'contract_price_snapshot_id',v_snapshot_id,
    'price_option_reference',v_option.option_reference,'area_price_reference',v_area.price_row_reference,'selected_component_references',to_jsonb(v_selected_refs));
end
$function$;

revoke all on function public.gridex_create_internal_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_create_internal_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;
