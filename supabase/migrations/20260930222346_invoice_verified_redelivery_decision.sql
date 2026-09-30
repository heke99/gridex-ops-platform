-- Separate local decision only. No provider request, invoice rewrite, new
-- invoice, email or transport is authorized by recording this decision.
begin;
create table public.invoice_redelivery_decisions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  customer_id uuid not null, invoice_id uuid not null,
  account_id uuid not null, verified_auth_user_id uuid not null,
  destination_email text not null, email_confirmed_at timestamptz not null,
  billing_profile_revision bigint not null, contract_override_revision bigint not null,
  email_source text not null check(email_source in ('customer_default','contract_override')),
  original_provider_guid text not null, provider text not null, environment text not null,
  financial_snapshot_sha256 text not null check(financial_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  document_references_sha256 text not null check(document_references_sha256 ~ '^[a-f0-9]{64}$'),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null, reason text not null,
  actor_user_id uuid not null, session_id uuid not null,
  status text not null default 'verified_delivery_decision' check(status='verified_delivery_decision'),
  delivery_status text not null default 'blocked_provider_adapter' check(delivery_status='blocked_provider_adapter'),
  audit_event_id uuid not null references public.domain_events(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id,idempotency_key),
  foreign key(company_id,invoice_id) references public.customer_invoices(company_id,id)
);
comment on table public.invoice_redelivery_decisions is
  'Immutable separate decisions. Auth email ownership is verified for the current active customer owner only. Document hashes seal database references, not remote PDF bytes. No delivery adapter is activated.';
alter table public.invoice_redelivery_decisions enable row level security;
alter table public.invoice_redelivery_decisions force row level security;
revoke all on public.invoice_redelivery_decisions from public,anon,authenticated,service_role;
grant select,insert on public.invoice_redelivery_decisions to service_role;

-- service_role cannot lock auth.users directly. Follow the existing narrow
-- contact/session helper boundary instead of widening Auth table privileges.
create function private.gridex_invoice_redelivery_auth_email_v1(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $auth$
declare v_email text; v_confirmed timestamptz;
begin
  select lower(btrim(u.email)),u.email_confirmed_at into v_email,v_confirmed
    from auth.users u where u.id=p_user and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and u.email_confirmed_at is not null and u.email_confirmed_at<=clock_timestamp()
    for share;
  if not found or v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'redelivery_destination_unverified' using errcode='42501'; end if;
  return jsonb_build_object('userId',p_user,'email',v_email,'emailConfirmedAt',v_confirmed);
end;
$auth$;
revoke all on function private.gridex_invoice_redelivery_auth_email_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function private.gridex_invoice_redelivery_auth_email_v1(uuid) to service_role;

create function private.gridex_invoice_redelivery_immutable_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
begin
  if tg_op<>'INSERT' then raise exception 'redelivery_decision_immutable' using errcode='55000'; end if;
  if current_user<>'service_role' or coalesce(current_setting('gridex.invoice_redelivery_command',true),'')<>'on' then
    raise exception 'redelivery_command_required' using errcode='42501'; end if;
  return new;
end;
$guard$;
revoke all on function private.gridex_invoice_redelivery_immutable_v1() from public,anon,authenticated;
grant execute on function private.gridex_invoice_redelivery_immutable_v1() to service_role;
create trigger invoice_redelivery_decision_immutable before insert or update or delete on public.invoice_redelivery_decisions
  for each row execute function private.gridex_invoice_redelivery_immutable_v1();

create function public.gridex_record_invoice_redelivery_decision_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $command$
declare
  v_company uuid:=nullif(p_command->>'companyId','')::uuid;
  v_customer_id uuid:=nullif(p_command->>'customerId','')::uuid;
  v_invoice_id uuid:=nullif(p_command->>'invoiceId','')::uuid;
  v_account_id uuid:=nullif(p_command->>'accountId','')::uuid;
  v_actor uuid:=nullif(p_command->>'actorUserId','')::uuid;
  v_session uuid:=nullif(p_command->>'sessionId','')::uuid;
  v_expected bigint; v_override_expected bigint;
  v_key text:=p_command->>'idempotencyKey'; v_reason text:=btrim(p_command->>'reason');
  v_customer public.customers%rowtype; v_contract public.customer_contracts%rowtype;
  v_company_row public.companies%rowtype; v_invoice public.customer_invoices%rowtype;
  v_item public.invoice_export_items%rowtype; v_account public.customer_portal_accounts%rowtype;
  v_existing public.invoice_redelivery_decisions%rowtype; v_identity record; v_row record; v_identity_count integer:=0;
  v_auth jsonb; v_final_auth jsonb; v_email text; v_method text; v_source text;
  v_lines jsonb:='[]'::jsonb; v_documents jsonb:='[]'::jsonb;
  v_financial_hash text; v_documents_hash text; v_request_hash text;
  v_decision uuid:=gen_random_uuid(); v_event uuid:=gen_random_uuid(); v_result jsonb;
begin
  if current_user<>'service_role' then raise exception 'redelivery_service_required' using errcode='42501'; end if;
  if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k(key)
    where key not in ('companyId','customerId','invoiceId','accountId','actorUserId','sessionId','expectedRevision',
      'expectedOverrideRevision','idempotencyKey','reason'))
    or v_company is null or v_customer_id is null or v_invoice_id is null or v_account_id is null
    or v_actor is null or v_session is null or v_key is null or v_key !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or v_reason is null or length(v_reason) not between 1 and 200
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
    or jsonb_typeof(p_command->'expectedOverrideRevision') is distinct from 'number'
    or coalesce(p_command->>'expectedRevision','') !~ '^[0-9]{1,16}$'
    or coalesce(p_command->>'expectedOverrideRevision','') !~ '^[0-9]{1,16}$'
    or (p_command->>'expectedRevision')::numeric>9007199254740991
    or (p_command->>'expectedOverrideRevision')::numeric>9007199254740991 then
    raise exception 'invalid_redelivery_command' using errcode='22023'; end if;
  v_expected:=(p_command->>'expectedRevision')::bigint;
  v_override_expected:=(p_command->>'expectedOverrideRevision')::bigint;
  -- Same tenant key is one decision even across competing resource selections.
  -- Authority is checked after this wait, including on completed replays.
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':invoice-redelivery:'||v_key,0));
  select * into v_customer from public.customers where company_id=v_company and id=v_customer_id for update;
  if not found or v_customer.archived_at is not null or v_customer.status='archived' then
    raise exception 'redelivery_resource_unavailable' using errcode='42501'; end if;
  select * into v_company_row from public.companies where id=v_company and is_active and status='active' for share;
  if not found then raise exception 'redelivery_resource_unavailable' using errcode='42501'; end if;
  if not private.gridex_support_session_active_v1(v_actor,v_session) then
    raise exception 'redelivery_actor_forbidden' using errcode='42501'; end if;
  perform 1 from public.user_profiles where id=v_actor and user_status='active' for share;
  if not found then raise exception 'redelivery_actor_forbidden' using errcode='42501'; end if;
  perform 1 from public.company_memberships where company_id=v_company and user_id=v_actor
    and is_active and status='active' for share;
  if not found then raise exception 'redelivery_actor_forbidden' using errcode='42501'; end if;
  perform private.gridex_profile_authority_lock_v1(v_actor,v_company);
  if not private.gridex_support_session_active_v1(v_actor,v_session)
    or not coalesce(public.gridex_actor_has_company_permission(v_actor,v_company,'billing_underlay.export'),false) then
    raise exception 'redelivery_actor_forbidden' using errcode='42501'; end if;
  select * into v_invoice from public.customer_invoices where id=v_invoice_id and company_id=v_company and customer_id=v_customer_id;
  if not found or v_invoice.invoice_export_item_id is null then
    raise exception 'redelivery_resource_unavailable' using errcode='42501'; end if;
  select * into v_contract from public.customer_contracts where id=v_invoice.customer_contract_id
    and company_id=v_company and customer_id=v_customer_id for share;
  if not found or v_invoice.contract_id is distinct from v_contract.id then
    raise exception 'redelivery_resource_unavailable' using errcode='42501'; end if;
  -- Same item -> invoice lock order as provider event application.
  select * into v_item from public.invoice_export_items where id=v_invoice.invoice_export_item_id
    and company_id=v_company and customer_id=v_customer_id and customer_contract_id=v_contract.id for share;
  if not found then raise exception 'redelivery_resource_unavailable' using errcode='42501'; end if;
  select * into v_invoice from public.customer_invoices where id=v_invoice_id and company_id=v_company
    and customer_id=v_customer_id and customer_contract_id=v_contract.id and contract_id=v_contract.id
    and invoice_export_item_id=v_item.id for update;
  if not found or v_invoice.status not in ('issued','sent','paid','overdue') or v_invoice.issued_at is null
    or v_item.status<>'sent' or v_item.provider is null or v_item.environment is null or nullif(btrim(v_item.provider_invoice_guid),'') is null
    or v_invoice.partner_invoice_reference is distinct from v_item.provider_invoice_guid
    or coalesce(v_item.request_payload,'{}'::jsonb)='{}'::jsonb then
    raise exception 'redelivery_original_unavailable' using errcode='55000'; end if;
  if v_customer.billing_profile_revision<>v_expected or v_contract.billing_profile_override_revision<>v_override_expected then
    raise exception 'redelivery_revision_conflict' using errcode='40001'; end if;
  -- Match the shared resolver's canonical per-field presence semantics.
  -- Contact/login email is never a fallback or proof of invoice destination.
  v_source:=case when v_contract.billing_profile_override ? 'email' then 'contract_override' else 'customer_default' end;
  v_email:=lower(nullif(btrim(case when v_source='contract_override' then v_contract.billing_profile_override->>'email'
    else v_customer.billing_profile->>'email' end),''));
  v_method:=case when v_contract.billing_profile_override ? 'distributionMethod' then v_contract.billing_profile_override->>'distributionMethod'
    when v_customer.billing_profile ? 'distributionMethod' then v_customer.billing_profile->>'distributionMethod'
    else v_company_row.billing_settings#>>'{invoice_profile,distribution_method}' end;
  if lower(v_method) not in ('email','e-mail') or v_method is null or v_email is null then
    raise exception 'redelivery_email_destination_required' using errcode='55000'; end if;
  select * into v_account from public.customer_portal_accounts where id=v_account_id and company_id=v_company
    and customer_id=v_customer_id and status='active' and is_active and role='owner'
    and user_id is not null and (portal_user_id is null or portal_user_id=user_id) for share;
  if not found then raise exception 'redelivery_destination_owner_required' using errcode='42501'; end if;
  for v_identity in select * from public.customer_portal_identities where company_id=v_company and customer_id=v_customer_id
    and (auth_user_id=v_account.user_id or customer_portal_user_id=v_account.user_id) order by id for share
  loop
    v_identity_count:=v_identity_count+1;
    if v_identity.status<>'active' or v_identity_count>1 then raise exception 'redelivery_destination_owner_required' using errcode='42501'; end if;
  end loop;
  v_auth:=private.gridex_invoice_redelivery_auth_email_v1(v_account.user_id);
  if v_auth->>'email' is distinct from v_email then
    raise exception 'redelivery_destination_mismatch' using errcode='42501'; end if;
  for v_row in select * from public.customer_invoice_lines where company_id=v_company and customer_id=v_customer_id
    and invoice_id=v_invoice_id order by id for share
  loop v_lines:=v_lines||jsonb_build_array(to_jsonb(v_row)); end loop;
  for v_row in select * from public.customer_invoice_documents where company_id=v_company and customer_id=v_customer_id
    and invoice_id=v_invoice_id order by id for share
  loop
    if nullif(btrim(v_row.file_path),'') is null then
      raise exception 'redelivery_document_references_unavailable' using errcode='55000'; end if;
    v_documents:=v_documents||jsonb_build_array(to_jsonb(v_row));
  end loop;
  if v_documents='[]'::jsonb then raise exception 'redelivery_document_references_unavailable' using errcode='55000'; end if;
  v_financial_hash:=public.canonical_json_sha256(jsonb_build_object('invoice',to_jsonb(v_invoice)-array['status','paid_at','updated_at'],
    'originalProviderGuid',v_item.provider_invoice_guid,'requestPayload',v_item.request_payload,'lines',v_lines));
  v_documents_hash:=public.canonical_json_sha256(v_documents);
  v_request_hash:=public.canonical_json_sha256(p_command-'sessionId');
  select * into v_existing from public.invoice_redelivery_decisions where company_id=v_company and idempotency_key=v_key;
  if found then
    if v_existing.request_hash is distinct from v_request_hash or v_existing.destination_email is distinct from v_email
      or v_existing.email_confirmed_at is distinct from (v_auth->>'emailConfirmedAt')::timestamptz
      or v_existing.verified_auth_user_id is distinct from v_account.user_id
      or v_existing.financial_snapshot_sha256 is distinct from v_financial_hash
      or v_existing.document_references_sha256 is distinct from v_documents_hash then
      raise exception 'redelivery_idempotency_conflict' using errcode='23505'; end if;
    v_decision:=v_existing.id;
  else
    insert into public.domain_events(id,company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,payload,idempotency_key)
      values(v_event,v_company,'invoice.redelivery.decision_verified','invoice_redelivery_decision',v_decision::text,
        v_customer_id,v_actor,'invoice_redelivery_decision_v1',jsonb_build_object('invoice_id',v_invoice_id,
          'delivery_status','blocked_provider_adapter','financial_snapshot_sha256',v_financial_hash,
          'document_references_sha256',v_documents_hash),'invoice-redelivery-decision:'||v_company::text||':'||v_key);
    perform set_config('gridex.invoice_redelivery_command','on',true);
    insert into public.invoice_redelivery_decisions(id,company_id,customer_id,invoice_id,account_id,verified_auth_user_id,
      destination_email,email_confirmed_at,billing_profile_revision,contract_override_revision,email_source,
      original_provider_guid,provider,environment,financial_snapshot_sha256,document_references_sha256,
      request_hash,idempotency_key,reason,actor_user_id,session_id,audit_event_id)
      values(v_decision,v_company,v_customer_id,v_invoice_id,v_account_id,v_account.user_id,v_email,
        (v_auth->>'emailConfirmedAt')::timestamptz,v_expected,v_override_expected,v_source,v_item.provider_invoice_guid,
        v_item.provider,v_item.environment,v_financial_hash,v_documents_hash,v_request_hash,v_key,v_reason,v_actor,v_session,v_event);
    perform set_config('gridex.invoice_redelivery_command','off',true);
  end if;
  -- Clock may advance while any of the resource/identity locks is acquired.
  if not private.gridex_support_session_active_v1(v_actor,v_session) then
    raise exception 'redelivery_actor_forbidden' using errcode='42501'; end if;
  v_final_auth:=private.gridex_invoice_redelivery_auth_email_v1(v_account.user_id);
  if v_final_auth is distinct from v_auth then raise exception 'redelivery_destination_unverified' using errcode='42501'; end if;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'invoiceId',v_invoice_id,'decisionId',v_decision,
    'invoiceExportItemId',v_item.id,
    'destinationEmail',v_email,'revision',v_expected,'contractOverrideRevision',v_override_expected,
    'status','verified_delivery_decision','deliveryStatus','blocked_provider_adapter',
    'financialSnapshotSha256',v_financial_hash,'documentReferencesSha256',v_documents_hash,'replayed',v_existing.id is not null);
  return v_result;
end;
$command$;
revoke all on function public.gridex_record_invoice_redelivery_decision_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_record_invoice_redelivery_decision_v1(jsonb) to service_role;
commit;
