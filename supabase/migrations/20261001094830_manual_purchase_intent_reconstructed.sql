-- A permanent local one-attempt barrier; it is not provider approval or an
-- idempotency contract with Capway. No expiry, reset or lease permits another POST.
begin;
create table public.invoice_manual_purchase_intents (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  invoice_export_item_id uuid not null, actor_user_id uuid not null, session_id uuid not null,
  financing_mode text not null check(financing_mode in ('factoring_without_recourse','factoring_with_recourse')),
  purchase_payload jsonb not null, item_binding jsonb not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  connection_sha256 text not null check(connection_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check(status in ('dispatch_started','response_observed','rejected','uncertain')),
  observation jsonb, purchase_event_id uuid, audit_event_id uuid,
  created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  unique(company_id,invoice_export_item_id),
  foreign key(company_id,invoice_export_item_id) references public.invoice_export_items(company_id,id),
  foreign key(purchase_event_id) references public.invoice_purchase_events(id),
  foreign key(audit_event_id) references public.domain_events(id),
  check((status='dispatch_started' and observation is null and completed_at is null and purchase_event_id is null and audit_event_id is null)
    or (status<>'dispatch_started' and jsonb_typeof(observation)='object' and completed_at is not null and purchase_event_id is not null and audit_event_id is not null))
);
comment on table public.invoice_manual_purchase_intents is
  'Permanent manual purchase one-attempt barrier. Fulfilled transport is response_observed, never proof of purchased finance status. Unknown legacy approval provenance is locally held. No automatic retry/reset.';
alter table public.invoice_manual_purchase_intents enable row level security;
alter table public.invoice_manual_purchase_intents force row level security;
revoke all on public.invoice_manual_purchase_intents from public,anon,authenticated,service_role;
grant select,insert,update on public.invoice_manual_purchase_intents to service_role;
insert into public.platform_table_classification(table_name,kind,rationale,classified_by)
values('invoice_manual_purchase_intents','tenant','Private durable item-scoped one-attempt barrier; observed response is separate from provider financing truth.','migration:manual_purchase_intent_reconstructed');

create function private.gridex_manual_purchase_item_binding_v1(p_item public.invoice_export_items)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $binding$
  select jsonb_build_object('id',p_item.id,'company_id',p_item.company_id,'export_run_id',p_item.export_run_id,
    'customer_id',p_item.customer_id,'customer_contract_id',p_item.customer_contract_id,
    'billing_underlay_id',p_item.billing_underlay_id,'pricing_run_id',p_item.pricing_run_id,
    'provider',p_item.provider,'environment',p_item.environment,'financing_mode',p_item.financing_mode,
    'provider_invoice_guid',p_item.provider_invoice_guid,'provider_invoice_id',p_item.provider_invoice_id,
    'provider_request_id',p_item.provider_request_id,'provider_idempotency_key',p_item.provider_idempotency_key,
    'idempotency_key',p_item.idempotency_key,'request_payload',p_item.request_payload,
    'amount_ex_vat',p_item.amount_ex_vat,'vat_amount',p_item.vat_amount,'amount_inc_vat',p_item.amount_inc_vat,
    'rounding_amount',p_item.rounding_amount,'total_kwh',p_item.total_kwh,'currency',p_item.currency,
    'period_start',p_item.period_start,'period_end',p_item.period_end,
    'sent_at',p_item.sent_at,'provider_confirmed_at',p_item.provider_confirmed_at);
$binding$;

-- Use the same active role and explicit allow semantics as the actual scoped
-- canonical API guard. Neither legacy alias helper nor deny role_permissions
-- can authorize this new command. Existing narrow Auth/session helper is reused.
create function private.gridex_manual_purchase_authorize_v1(p_actor uuid,p_session uuid,p_company uuid,p_dispatch boolean)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $authority$
declare v_company public.companies%rowtype; v_platform boolean;
begin
  if current_user<>'service_role' or not private.gridex_profile_session_active_v1(p_actor,p_session) then
    raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  perform 1 from public.user_profiles where id=p_actor and user_status='active' for share;
  if not found then raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  select * into v_company from public.companies where id=p_company for share;
  if not found then raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  perform 1 from public.company_memberships where company_id=p_company and user_id=p_actor
    and status='active' and coalesce(is_active,true) for share;
  perform private.gridex_profile_authority_lock_v1(p_actor,p_company);
  v_platform:=public.canonical_actor_is_platform_admin(p_actor);
  if not v_platform and (not exists(select 1 from public.company_memberships where company_id=p_company
    and user_id=p_actor and status='active' and coalesce(is_active,true)) or not exists(
      select 1 from public.user_roles ur where ur.user_id=p_actor and ur.company_id=p_company
        and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)) or not exists(
      select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id and coalesce(r.is_active,true)
      join public.role_permissions rp on rp.role_id=r.id and coalesce(rp.effect,'allow')='allow'
      join public.permissions p on p.id=rp.permission_id
      where ur.user_id=p_actor and (ur.company_id=p_company or ur.company_id is null)
        and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)
        and p.key in ('billing.write','billing.export'))) then
    raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  if p_dispatch and (not coalesce(v_company.is_active,true) or v_company.status<>'active'
    or coalesce(v_company.outbound_frozen,false)
    or coalesce(v_company.outbound_frozen_channels,'{}'::text[]) && array['invoice_export','*']::text[]) then
    raise exception 'manual_purchase_dispatch_held' using errcode='55000'; end if;
  if not private.gridex_profile_session_active_v1(p_actor,p_session) then
    raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
end;
$authority$;

create function private.gridex_manual_purchase_receipt_v1(p_intent public.invoice_manual_purchase_intents,p_post boolean)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $receipt$
  select jsonb_build_object('companyId',p_intent.company_id,'itemId',p_intent.invoice_export_item_id,
    'intentId',p_intent.id,'actorUserId',p_intent.actor_user_id,'sessionId',p_intent.session_id,
    'requestHash',p_intent.request_hash,'snapshotHash',p_intent.snapshot_sha256,'connectionHash',p_intent.connection_sha256,
    'invoiceGuid',p_intent.item_binding->>'provider_invoice_guid','environment',p_intent.item_binding->>'environment',
    'status',p_intent.status,'shouldPost',p_post,'response',p_intent.observation,
    'payload',p_intent.purchase_payload,'financingMode',p_intent.financing_mode,'itemBinding',p_intent.item_binding);
$receipt$;

-- Exact flat review facts used by approveItem's stable JSON hash. This does
-- not create approval; it qualifies already saved matching approval evidence.
create function private.gridex_manual_purchase_review_hash_v1(p_item public.invoice_export_items,
  p_invoice public.customer_invoices,p_underlay public.billing_underlays)
returns text language sql immutable security invoker set search_path=pg_catalog as $review$
  select encode(extensions.digest(convert_to('{'||string_agg(to_jsonb(key)::text||':'||
    case when jsonb_typeof(value)='number' then trim_scale((value#>>'{}')::numeric)::text else value::text end,
    ',' order by key collate "C")||'}','UTF8'),'sha256'),'hex') from jsonb_each(jsonb_build_object(
      'invoice_export_item_id',p_item.id,'billing_underlay_id',p_underlay.id,'pricing_run_id',p_item.pricing_run_id,
      'calculation_snapshot_sha256',p_invoice.calculation_snapshot_sha256,'total_kwh',p_underlay.total_kwh,
      'total_inc_vat',p_invoice.amount_inc_vat,'price_area',coalesce(p_invoice.price_area_code,p_underlay.price_area)));
$review$;
create function private.gridex_manual_purchase_extra_v1(p_fields jsonb,p_name text)
returns text language plpgsql immutable security invoker set search_path=pg_catalog as $extra$
declare v_field jsonb;
begin
  if jsonb_typeof(p_fields) is distinct from 'array' then return null; end if;
  if (select count(*) from jsonb_array_elements(p_fields) f where f->>'name'=p_name)<>1 then return null; end if;
  select f into v_field from jsonb_array_elements(p_fields) f where f->>'name'=p_name;
  if jsonb_typeof(v_field->'value') is distinct from 'array' then return null; end if;
  if jsonb_array_length(v_field->'value')<>1 or jsonb_typeof(v_field#>'{value,0}') is distinct from 'string' then return null; end if;
  return nullif(btrim(v_field#>>'{value,0}'),'');
end;
$extra$;
create function private.gridex_manual_purchase_snapshot_v1(p_item public.invoice_export_items,p_invoice public.customer_invoices,
  p_run public.invoice_export_runs,p_price public.pricing_runs,p_underlay public.billing_underlays)
returns text language sql immutable security invoker set search_path=pg_catalog as $snapshot$
  select encode(extensions.digest(convert_to(jsonb_build_object('item',private.gridex_manual_purchase_item_binding_v1(p_item),
    'invoice',to_jsonb(p_invoice)-array['status','paid_at','updated_at','updated_by','metadata'],
    'invoiceApproval',p_invoice.metadata->'approval','itemApproval',p_item.metadata->'approval',
    'run',jsonb_build_object('id',p_run.id,'provider',p_run.provider,'environment',p_run.environment,'financingMode',p_run.financing_mode),
    'price',jsonb_build_object('id',p_price.id,'underlay',p_price.billing_underlay_id,'status',p_price.status,'lockedAt',p_price.locked_at,
      'exVat',p_price.total_ex_vat,'vat',p_price.vat_amount,'incVat',p_price.total_inc_vat),
    'underlay',jsonb_build_object('id',p_underlay.id,'customer',p_underlay.customer_id,'contract',coalesce(p_underlay.customer_contract_id,p_underlay.contract_id),
      'status',p_underlay.status,'readiness',p_underlay.readiness_status,'missing',p_underlay.missing_values_count,
      'kwh',p_underlay.total_kwh,'priceArea',p_underlay.price_area))::text,'UTF8'),'sha256'),'hex');
$snapshot$;

create function private.gridex_manual_purchase_guard_v1()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $guard$
begin
  if current_user<>'service_role' or coalesce(current_setting('gridex.manual_purchase_command',true),'')<>'on' then
    raise exception 'manual_purchase_command_required' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if new.status<>'dispatch_started' then raise exception 'manual_purchase_intent_immutable' using errcode='55000'; end if;
    return new;
  end if;
  if tg_op<>'UPDATE' or old.status<>'dispatch_started' or new.status='dispatch_started'
    or (to_jsonb(new)-array['status','observation','purchase_event_id','audit_event_id','completed_at'])
      is distinct from (to_jsonb(old)-array['status','observation','purchase_event_id','audit_event_id','completed_at']) then
    raise exception 'manual_purchase_intent_immutable' using errcode='55000'; end if;
  return new;
end;
$guard$;
create trigger invoice_manual_purchase_intent_guard before insert or update or delete on public.invoice_manual_purchase_intents
  for each row execute function private.gridex_manual_purchase_guard_v1();

create function public.gridex_claim_manual_invoice_purchase_v1(p_command jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $claim$
declare
  v_company uuid:=(p_command->>'companyId')::uuid; v_id uuid:=(p_command->>'itemId')::uuid;
  v_actor uuid:=(p_command->>'actorUserId')::uuid; v_session uuid:=(p_command->>'sessionId')::uuid;
  v_mode text:=p_command->>'financingMode'; v_payload jsonb:=p_command->'payload';
  v_item public.invoice_export_items%rowtype; v_invoice public.customer_invoices%rowtype;
  v_run public.invoice_export_runs%rowtype; v_price public.pricing_runs%rowtype; v_underlay public.billing_underlays%rowtype;
  v_connection public.billing_provider_connections%rowtype; v_intent public.invoice_manual_purchase_intents%rowtype;
  v_binding jsonb; v_request_hash text; v_snapshot text; v_fresh boolean:=false; v_result jsonb;
  v_connection_binding jsonb; v_connection_hash text; v_debt jsonb;
begin
  if current_user<>'service_role' or v_company is null or v_id is null or v_actor is null or v_session is null then
    raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k(key)
    where key not in ('companyId','itemId','actorUserId','sessionId','financingMode','payload','itemBinding','connectionJson'))
    or jsonb_typeof(p_command->'connectionJson') is distinct from 'string'
    or v_mode not in ('factoring_without_recourse','factoring_with_recourse') or v_mode is null
    or jsonb_typeof(v_payload) is distinct from 'object' or v_payload->'approved' is distinct from 'true'::jsonb
    or exists(select 1 from jsonb_object_keys(v_payload) k(key) where key not in
      ('approved','purchaseFeePercentage','purchaseFeeAmount','purchaseFeeCurrency','recourseDays','depositAmount','note'))
    or not v_payload ?& array['approved','purchaseFeePercentage','purchaseFeeAmount','purchaseFeeCurrency','recourseDays','depositAmount','note']
    or v_payload->'purchaseFeePercentage' is distinct from 'null'::jsonb or v_payload->'purchaseFeeAmount' is distinct from 'null'::jsonb
    or v_payload->'purchaseFeeCurrency' is distinct from 'null'::jsonb or v_payload->'depositAmount' is distinct from 'null'::jsonb
    or jsonb_typeof(v_payload->'note') not in ('string','null')
    or (v_mode='factoring_without_recourse' and v_payload->'recourseDays' is distinct from 'null'::jsonb)
    or (v_mode='factoring_with_recourse' and jsonb_typeof(v_payload->'recourseDays') is distinct from 'number') then
    raise exception 'invalid_manual_purchase_command' using errcode='22023'; end if;
  -- Item-scoped serialization, not a caller-key-scoped lease. Authority and
  -- the final live clock are checked after every resource/unique-index wait.
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':manual-purchase:'||v_id::text,0));
  perform private.gridex_manual_purchase_authorize_v1(v_actor,v_session,v_company,true);
  select * into v_item from public.invoice_export_items where company_id=v_company and id=v_id for update;
  if not found then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  v_binding:=private.gridex_manual_purchase_item_binding_v1(v_item);
  if p_command->'itemBinding' is distinct from v_binding then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_invoice from public.customer_invoices where company_id=v_company and invoice_export_item_id=v_id for update;
  if not found or v_invoice.customer_id is distinct from v_item.customer_id
    or v_invoice.customer_contract_id is distinct from v_item.customer_contract_id or v_invoice.contract_id is distinct from v_item.customer_contract_id
    or v_invoice.partner_invoice_reference is distinct from v_item.provider_invoice_guid then
    raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  select * into v_run from public.invoice_export_runs where id=v_item.export_run_id and company_id=v_company for share;
  if not found or v_run.provider is distinct from v_item.provider or v_run.environment is distinct from v_item.environment then
    raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  select * into v_underlay from public.billing_underlays where id=v_item.billing_underlay_id and company_id=v_company for share;
  if not found or v_underlay.customer_id is distinct from v_item.customer_id
    or coalesce(v_underlay.customer_contract_id,v_underlay.contract_id) is distinct from v_item.customer_contract_id then
    raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  select * into v_price from public.pricing_runs where id=v_item.pricing_run_id and company_id=v_company for share;
  if not found or v_price.billing_underlay_id is distinct from v_underlay.id then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  perform 1 from public.customers where id=v_item.customer_id and company_id=v_company and archived_at is null and status<>'archived' for share;
  if not found then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  perform 1 from public.customer_contracts where id=v_item.customer_contract_id and company_id=v_company and customer_id=v_item.customer_id for share;
  if not found then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  select * into v_connection from public.billing_provider_connections where company_id=v_company and provider=v_item.provider
    and environment=v_item.environment and status in ('ready','active') order by updated_at desc limit 1 for share;
  if not found then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
  v_connection_binding:=jsonb_build_object('id',v_connection.id,'company_id',v_connection.company_id,'provider',v_connection.provider,
    'environment',v_connection.environment,'status',v_connection.status,'settings',v_connection.settings,'secret_reference',v_connection.secret_reference);
  if (p_command->>'connectionJson')::jsonb is distinct from v_connection_binding then
    raise exception 'manual_purchase_configuration_conflict' using errcode='40001'; end if;
  v_connection_hash:=encode(extensions.digest(convert_to(p_command->>'connectionJson','UTF8'),'sha256'),'hex');
  v_request_hash:=encode(extensions.digest(convert_to(jsonb_build_object('companyId',v_company,'itemId',v_id,
    'actorUserId',v_actor,'sessionId',v_session,'financingMode',v_mode,'payload',v_payload,'itemBinding',v_binding,
    'connectionHash',v_connection_hash)::text,'UTF8'),'sha256'),'hex');
  v_snapshot:=private.gridex_manual_purchase_snapshot_v1(v_item,v_invoice,v_run,v_price,v_underlay);
  select * into v_intent from public.invoice_manual_purchase_intents where company_id=v_company and invoice_export_item_id=v_id for update;
  if found then
    if v_intent.request_hash<>v_request_hash or v_intent.snapshot_sha256<>v_snapshot then
      raise exception 'manual_purchase_conflict' using errcode='23505'; end if;
  else
    -- Only fully sent exports are eligible. Both existing automatic senders
    -- accept pending/failed/failed_retryable; they cannot enter this sent lane.
    -- Missing legacy approval provenance is held, never manufactured here.
    if v_item.status<>'sent' or v_item.provider<>'capway_aptic' or v_item.environment not in ('test','production')
      or v_item.sent_at is null or v_item.provider_confirmed_at is null
      or nullif(btrim(v_item.provider_invoice_guid),'') is null or v_item.request_payload='{}'::jsonb
      or coalesce(v_item.provider_request_id,v_item.provider_idempotency_key,v_item.idempotency_key) is null
      or v_invoice.status not in ('issued','sent','overdue') or v_invoice.issued_at is null
      or v_item.provider_status in ('paid','credited','cancelled','rejected','disputed')
      or v_item.purchase_status in ('requested','purchased_without_recourse','purchased_with_recourse','recoursed','pledged')
      or v_item.provider_purchase_confirmed_at is not null or v_item.response_payload->'purchase' is distinct from 'null'::jsonb and v_item.response_payload ? 'purchase'
      or v_item.metadata#>>'{approval,status}' is distinct from 'approved' or v_invoice.metadata#>>'{approval,status}' is distinct from 'approved'
      or coalesce(v_item.metadata#>>'{approval,review_hash}','') !~ '^[a-f0-9]{64}$'
      or v_item.metadata#>>'{approval,review_hash}' is distinct from v_invoice.metadata#>>'{approval,review_hash}'
      or v_item.metadata#>>'{approval,review_hash}' is distinct from private.gridex_manual_purchase_review_hash_v1(v_item,v_invoice,v_underlay)
      or coalesce(v_invoice.calculation_snapshot_sha256,'') !~ '^[a-f0-9]{64}$'
      or v_item.metadata#>>'{approval,calculation_snapshot_sha256}' is distinct from v_invoice.calculation_snapshot_sha256
      or v_invoice.metadata#>>'{approval,calculation_snapshot_sha256}' is distinct from v_invoice.calculation_snapshot_sha256
      or v_underlay.status is distinct from 'validated' or v_underlay.readiness_status is distinct from 'ready' or coalesce(v_underlay.missing_values_count,0)>0
      or v_price.status<>'locked' or v_price.locked_at is null
      or coalesce(v_invoice.price_area_code,v_underlay.price_area) is null or coalesce(v_invoice.price_area_code,v_underlay.price_area) not in ('SE1','SE2','SE3','SE4')
      or v_underlay.total_kwh is null or v_item.total_kwh is null or abs(v_underlay.total_kwh-v_item.total_kwh)>0.001
      or v_invoice.amount_inc_vat is null or abs(v_item.amount_ex_vat-v_price.total_ex_vat)>0.01
      or abs(v_item.vat_amount-v_price.vat_amount)>0.01 or abs(v_item.amount_inc_vat-v_price.total_inc_vat)>0.01
      or abs(v_invoice.amount_inc_vat-v_price.total_inc_vat)>0.01 or v_item.currency is distinct from v_invoice.currency
      or exists(select 1 from public.invoice_purchase_events where company_id=v_company and invoice_export_item_id=v_id
        and (event_type in ('purchase_requested','purchase_requested_manual') or purchase_status in ('requested','purchased_without_recourse','purchased_with_recourse','recoursed','pledged'))) then
      raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    if jsonb_typeof(v_item.request_payload->'customer') is distinct from 'object'
      or jsonb_typeof(v_item.request_payload->'debts') is distinct from 'array' then
      raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    if jsonb_array_length(v_item.request_payload->'debts')<>1 then raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    v_debt:=v_item.request_payload#>'{debts,0}';
    if private.gridex_manual_purchase_extra_v1(v_item.request_payload->'extraFields','gridex_company_id') is distinct from v_company::text
      or private.gridex_manual_purchase_extra_v1(v_item.request_payload->'extraFields','gridex_pricing_run_id') is distinct from v_item.pricing_run_id::text
      or v_item.request_payload->>'externalReferenceCode' is distinct from v_item.pricing_run_id::text
      or private.gridex_manual_purchase_extra_v1(v_item.request_payload->'extraFields','gridex_financing_mode') is distinct from v_item.financing_mode
      or private.gridex_manual_purchase_extra_v1(v_item.request_payload#>'{customer,extraFields}','gridex_customer_id') is distinct from v_item.customer_id::text
      or private.gridex_manual_purchase_extra_v1(v_debt->'extraFields','gridex_billing_underlay_id') is distinct from v_item.billing_underlay_id::text
      or nullif(btrim(v_item.request_payload->>'invoiceDate'),'') is null or nullif(btrim(v_debt->>'dueDate'),'') is null
      or v_debt->>'invoiceDate' is distinct from v_item.request_payload->>'invoiceDate'
      or v_debt->>'currencyCode' is distinct from v_item.currency
      or jsonb_typeof(v_debt->'originalPrincipal') is distinct from 'number' or jsonb_typeof(v_debt->'originalVat') is distinct from 'number'
      or (v_debt ? 'rounding' and jsonb_typeof(v_debt->'rounding') is distinct from 'number') then
      raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    if abs((v_debt->>'originalPrincipal')::numeric-v_item.amount_ex_vat)>0.01
      or abs((v_debt->>'originalVat')::numeric-v_item.vat_amount)>0.01
      or abs((v_debt->>'originalPrincipal')::numeric+(v_debt->>'originalVat')::numeric+coalesce((v_debt->>'rounding')::numeric,0)-v_item.amount_inc_vat)>0.01
      or (v_item.provider_invoice_id is not null and v_item.provider_invoice_id is distinct from v_item.provider_invoice_guid)
      or (v_item.provider_request_id is not null and v_item.provider_idempotency_key is not null and v_item.provider_request_id is distinct from v_item.provider_idempotency_key) then
      raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    -- Supported canonical capture dates are ISO/date-only. Unsupported legacy
    -- date spellings are held rather than emulating an arbitrary JS parser.
    if v_item.request_payload->>'invoiceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
      or v_debt->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?)?$' then
      raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    begin
      if not isfinite((v_item.request_payload->>'invoiceDate')::timestamptz) or not isfinite((v_debt->>'dueDate')::timestamptz) then
        raise exception 'manual_purchase_ineligible' using errcode='55000'; end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'manual_purchase_ineligible' using errcode='55000';
    end;
    perform set_config('gridex.manual_purchase_command','on',true);
    insert into public.invoice_manual_purchase_intents(company_id,invoice_export_item_id,actor_user_id,session_id,financing_mode,
      purchase_payload,item_binding,request_hash,snapshot_sha256,connection_sha256,status)
      values(v_company,v_id,v_actor,v_session,v_mode,v_payload,v_binding,v_request_hash,v_snapshot,v_connection_hash,'dispatch_started') returning * into v_intent;
    perform set_config('gridex.manual_purchase_command','off',true);
    v_fresh:=true;
  end if;
  v_result:=private.gridex_manual_purchase_receipt_v1(v_intent,v_fresh);
  -- After the INSERT and every receipt/lock wait: expiry rolls the barrier back.
  perform private.gridex_manual_purchase_authorize_v1(v_actor,v_session,v_company,true);
  return v_result;
end;
$claim$;

create function public.gridex_complete_manual_invoice_purchase_v1(p_command jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $complete$
declare
  v_company uuid:=(p_command->>'companyId')::uuid; v_item_id uuid:=(p_command->>'itemId')::uuid;
  v_actor uuid:=(p_command->>'actorUserId')::uuid; v_session uuid:=(p_command->>'sessionId')::uuid;
  v_intent public.invoice_manual_purchase_intents%rowtype; v_item public.invoice_export_items%rowtype;
  v_invoice public.customer_invoices%rowtype; v_outcome text:=p_command->>'outcome'; v_event uuid:=gen_random_uuid();
  v_run public.invoice_export_runs%rowtype; v_price public.pricing_runs%rowtype; v_underlay public.billing_underlays%rowtype;
  v_audit uuid:=gen_random_uuid(); v_result jsonb;
begin
  if current_user<>'service_role' or v_company is null or v_item_id is null or v_actor is null or v_session is null then
    raise exception 'manual_purchase_actor_forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k(key)
    where key not in ('companyId','itemId','actorUserId','sessionId','financingMode','payload','itemBinding',
      'intentId','requestHash','snapshotHash','outcome','observation','connectionJson'))
    or v_outcome is null or v_outcome not in ('response_observed','rejected','uncertain')
    or jsonb_typeof(p_command->'observation') is distinct from 'object' then
    raise exception 'invalid_manual_purchase_command' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':manual-purchase:'||v_item_id::text,0));
  -- A pause/freeze after dispatch does not erase the response. Live actor,
  -- session and billing permission remain required for any local completion.
  perform private.gridex_manual_purchase_authorize_v1(v_actor,v_session,v_company,false);
  select * into v_item from public.invoice_export_items where company_id=v_company and id=v_item_id for update;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_invoice from public.customer_invoices where company_id=v_company and invoice_export_item_id=v_item_id for update;
  if not found or v_invoice.partner_invoice_reference is distinct from v_item.provider_invoice_guid then
    raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_run from public.invoice_export_runs where id=v_item.export_run_id and company_id=v_company for share;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_underlay from public.billing_underlays where id=v_item.billing_underlay_id and company_id=v_company for share;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_price from public.pricing_runs where id=v_item.pricing_run_id and company_id=v_company for share;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  perform 1 from public.customers where id=v_item.customer_id and company_id=v_company and archived_at is null and status<>'archived' for share;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  perform 1 from public.customer_contracts where id=v_item.customer_contract_id and company_id=v_company and customer_id=v_item.customer_id for share;
  if not found then raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  select * into v_intent from public.invoice_manual_purchase_intents where company_id=v_company and invoice_export_item_id=v_item_id for update;
  if not found or v_intent.id::text is distinct from p_command->>'intentId'
    or v_intent.actor_user_id is distinct from v_actor or v_intent.session_id is distinct from v_session
    or v_intent.request_hash is distinct from p_command->>'requestHash' or v_intent.snapshot_sha256 is distinct from p_command->>'snapshotHash'
    or v_intent.financing_mode is distinct from p_command->>'financingMode' or v_intent.purchase_payload is distinct from p_command->'payload'
    or v_intent.item_binding is distinct from p_command->'itemBinding'
    or v_intent.connection_sha256 is distinct from encode(extensions.digest(convert_to(p_command->>'connectionJson','UTF8'),'sha256'),'hex')
    or v_intent.item_binding is distinct from private.gridex_manual_purchase_item_binding_v1(v_item) then
    raise exception 'manual_purchase_conflict' using errcode='23505'; end if;
  if v_intent.snapshot_sha256 is distinct from private.gridex_manual_purchase_snapshot_v1(v_item,v_invoice,v_run,v_price,v_underlay) then
    raise exception 'manual_purchase_snapshot_conflict' using errcode='40001'; end if;
  if v_intent.status<>'dispatch_started' then
    if v_intent.status<>v_outcome or v_intent.observation is distinct from p_command->'observation' then
      raise exception 'manual_purchase_conflict' using errcode='23505'; end if;
  else
    insert into public.invoice_purchase_events(id,company_id,invoice_export_item_id,event_type,payload,created_by)
      values(v_event,v_company,v_item_id,'purchase_'||v_outcome||'_manual',jsonb_build_object('intent_id',v_intent.id,
        'requested_financing_mode',v_intent.financing_mode,'local_intent_status',v_outcome,'observation',p_command->'observation'),v_actor);
    -- Preserve create financing_mode and every issued financial/request/GUID
    -- byte. A fulfilled transport may project only a nonterminal request.
    if v_outcome='response_observed' and v_item.status='sent' and v_invoice.status in ('issued','sent','overdue')
      and coalesce(v_item.provider_status,'') not in ('paid','credited','cancelled','rejected','disputed')
      and coalesce(v_item.purchase_status,'') not in ('purchased_without_recourse','purchased_with_recourse','recoursed','pledged')
      and v_item.provider_purchase_confirmed_at is null then
      update public.invoice_export_items set purchase_status='requested',updated_at=clock_timestamp()
        where company_id=v_company and id=v_item_id;
    end if;
    insert into public.domain_events(id,company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,idempotency_key,payload)
      values(v_audit,v_company,'invoice.manual_purchase.'||v_outcome,'invoice_manual_purchase_intent',v_intent.id::text,
        v_item.customer_id,v_actor,'manual_purchase_intent_reconstructed_v1','manual-purchase-complete:'||v_intent.id::text,
        jsonb_build_object('intent_id',v_intent.id,'invoice_export_item_id',v_item_id,'status',v_outcome,'requested_financing_mode',v_intent.financing_mode));
    perform set_config('gridex.manual_purchase_command','on',true);
    update public.invoice_manual_purchase_intents set status=v_outcome,observation=p_command->'observation',
      purchase_event_id=v_event,audit_event_id=v_audit,completed_at=clock_timestamp()
      where id=v_intent.id returning * into v_intent;
    perform set_config('gridex.manual_purchase_command','off',true);
  end if;
  v_result:=private.gridex_manual_purchase_receipt_v1(v_intent,false);
  perform private.gridex_manual_purchase_authorize_v1(v_actor,v_session,v_company,false);
  return v_result;
end;
$complete$;
revoke all on function private.gridex_manual_purchase_item_binding_v1(public.invoice_export_items),
  private.gridex_manual_purchase_review_hash_v1(public.invoice_export_items,public.customer_invoices,public.billing_underlays),
  private.gridex_manual_purchase_snapshot_v1(public.invoice_export_items,public.customer_invoices,public.invoice_export_runs,public.pricing_runs,public.billing_underlays),
  private.gridex_manual_purchase_extra_v1(jsonb,text),
  private.gridex_manual_purchase_authorize_v1(uuid,uuid,uuid,boolean),
  private.gridex_manual_purchase_receipt_v1(public.invoice_manual_purchase_intents,boolean),
  private.gridex_manual_purchase_guard_v1(),public.gridex_claim_manual_invoice_purchase_v1(jsonb),
  public.gridex_complete_manual_invoice_purchase_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_manual_purchase_item_binding_v1(public.invoice_export_items),
  private.gridex_manual_purchase_review_hash_v1(public.invoice_export_items,public.customer_invoices,public.billing_underlays),
  private.gridex_manual_purchase_snapshot_v1(public.invoice_export_items,public.customer_invoices,public.invoice_export_runs,public.pricing_runs,public.billing_underlays),
  private.gridex_manual_purchase_extra_v1(jsonb,text),
  private.gridex_manual_purchase_authorize_v1(uuid,uuid,uuid,boolean),
  private.gridex_manual_purchase_receipt_v1(public.invoice_manual_purchase_intents,boolean),
  private.gridex_manual_purchase_guard_v1(),public.gridex_claim_manual_invoice_purchase_v1(jsonb),
  public.gridex_complete_manual_invoice_purchase_v1(jsonb) to service_role;
commit;
