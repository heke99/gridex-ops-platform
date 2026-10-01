-- Forward-only support channel safeguards. No provider or tenant policy enabled.
begin;
set local lock_timeout='10s';

-- OPS list queries need the same live session clock and current read permission
-- as case-specific RPCs. Auth getUser alone does not enforce not_after.
create function public.gridex_support_ops_read_access_v1(p_company_id uuid,p_user_id uuid,p_session_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $f$
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=p_company_id and c.is_active and c.status='active' for share;
  if not found or not private.gridex_support_session_active_v1(p_user_id,p_session_id) then return false; end if;
  perform 1 from public.user_profiles u where u.id=p_user_id and u.user_status='active' for share;
  if not found then return false; end if;
  perform 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=p_user_id
    and m.is_active and m.status='active' for share;
  if not found then return false; end if;
  perform private.gridex_profile_authority_lock_v1(p_user_id,p_company_id);
  return private.gridex_support_session_active_v1(p_user_id,p_session_id)
    and coalesce(public.gridex_actor_has_company_permission(p_user_id,p_company_id,'cases.read'),false);
end $f$;
revoke all on function public.gridex_support_ops_read_access_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_ops_read_access_v1(uuid,uuid,uuid) to service_role;

-- A phone intake stays internal/unverified. A separately authored staff
-- publication may appear in the conversation; it asserts no caller identity.
alter table public.customer_support_messages drop constraint customer_support_messages_phone_boundary_check;
alter table public.customer_support_messages add constraint customer_support_messages_phone_boundary_check check (
  (channel='phone' and caller_verification='unverified' and visibility='internal') or
  (channel='phone' and caller_verification='not_applicable' and visibility='customer' and author_kind='staff') or
  (channel<>'phone' and caller_verification='not_applicable')
);
create index customer_support_messages_publication_idx on public.customer_support_messages(publication_id) where publication_id is not null;

-- Publishing a current session's explicit text retains existing immutable
-- publication history. A staff UUID by itself is never a session proof.
alter function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text) set schema private;
alter function public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint) set schema private;
-- Keep the previous public signatures deterministic and fail closed. Private
-- cores are reachable only through the session checked public wrapper.
create function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text)
returns public.customer_case_publications language plpgsql security invoker set search_path=pg_catalog as $f$
begin raise exception 'support_session_required' using errcode='42501'; end $f$;
create function public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $f$
begin raise exception 'support_session_required' using errcode='42501'; end $f$;
revoke all on function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text),
  public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text),
  public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint) to service_role;
create function public.gridex_support_case_publication_v1(p_context jsonb,p_publication jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $f$
declare
  v_company uuid:=(p_context->>'companyId')::uuid;
  v_customer uuid:=(p_context->>'customerId')::uuid;
  v_case uuid:=(p_publication->>'caseId')::uuid;
  v_actor uuid:=(p_context->>'actorUserId')::uuid;
  v_result public.customer_case_publications;
  v_revision bigint; v_message uuid; v_event uuid; v_key text;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' or p_context->>'mode' is distinct from 'ops' or
    exists(select 1 from jsonb_object_keys(p_context) k(key) where key not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject')) or
    p_publication is null or jsonb_typeof(p_publication)<>'object' or
    exists(select 1 from jsonb_object_keys(p_publication) k(key) where key not in ('operation','caseId','title','body','status','expectedRevision','channel')) or
    p_publication->>'operation' is null or p_publication->>'operation' not in ('publish','revoke') or
    v_company is null or v_customer is null or v_case is null or
    p_publication->>'expectedRevision' is null or p_publication->>'expectedRevision' !~ '^(0|[1-9][0-9]{0,15})$' or
    (p_publication ? 'channel' and coalesce(p_publication->>'channel','') not in ('ops','phone'))
  then raise exception 'invalid_support_command' using errcode='22023'; end if;
  perform 1 from public.customers where id=v_customer and company_id=v_company for update;
  if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if not private.gridex_support_actor_v1(p_context,true) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  perform 1 from public.customer_cases where id=v_case and company_id=v_company and customer_id=v_customer for update;
  if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  if p_publication->>'operation'='publish' then
    v_result:=private.gridex_publish_customer_case_v1(v_company,v_case,v_actor,p_publication->>'title',p_publication->>'body',
      p_publication->>'status',(p_publication->>'expectedRevision')::bigint,coalesce(p_publication->>'channel','ops'));
    if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
    if exists(select 1 from public.customer_support_threads where id=v_case and company_id=v_company and customer_id=v_customer) then
      update public.customer_cases set support_revision=support_revision+1,updated_at=clock_timestamp(),updated_by=v_actor
        where id=v_case and company_id=v_company and customer_id=v_customer returning support_revision into v_revision;
      insert into public.customer_support_messages(company_id,customer_id,customer_case_id,visibility,author_kind,actor_user_id,channel,caller_verification,body,revision,publication_id)
      values(v_company,v_customer,v_case,'customer','staff',v_actor,v_result.channel,'not_applicable',v_result.public_body,v_revision,v_result.id) returning id into v_message;
      v_key:='support_publication:'||v_result.id::text;
      insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
      values(v_company,'CUSTOMER_SUPPORT_PUBLICATION','customer_case',v_case,v_revision,v_actor,'explicit_publication',v_key,
        jsonb_build_object('revision',v_revision-1),jsonb_build_object('revision',v_revision),
        jsonb_build_object('publicationId',v_result.id,'messageId',v_message,'channel',v_result.channel,'visibility','customer'));
      insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
      values(v_company,'CUSTOMER_SUPPORT_MESSAGE','customer_case',v_case,v_revision,v_key,
        jsonb_build_object('customerId',v_customer,'caseId',v_case,'messageId',v_message,'revision',v_revision),v_actor) returning id into v_event;
      insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
      values(v_company,v_event,'customer.support.changed',v_key,jsonb_build_object('customerId',v_customer,'caseId',v_case,'messageId',v_message,'revision',v_revision));
    end if;
    return to_jsonb(v_result);
  end if;
  select * into v_result from public.customer_case_publications where company_id=v_company and customer_id=v_customer
    and customer_case_id=v_case and revoked_at is null;
  perform private.gridex_revoke_customer_case_publication_v1(v_company,v_case,v_actor,(p_publication->>'expectedRevision')::bigint);
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.customer_support_threads where id=v_case and company_id=v_company and customer_id=v_customer) then
    update public.customer_cases set support_revision=support_revision+1,updated_at=clock_timestamp(),updated_by=v_actor
      where id=v_case and company_id=v_company and customer_id=v_customer returning support_revision into v_revision;
    v_key:='support_publication_revoke:'||v_result.id::text;
    insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
    values(v_company,'CUSTOMER_SUPPORT_PUBLICATION_REVOKED','customer_case',v_case,v_revision,v_actor,'explicit_withdrawal',v_key,
      jsonb_build_object('revision',v_revision-1),jsonb_build_object('revision',v_revision),jsonb_build_object('publicationId',v_result.id,'channel',v_result.channel));
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_SUPPORT_PUBLICATION_REVOKED','customer_case',v_case,v_revision,v_key,
      jsonb_build_object('customerId',v_customer,'caseId',v_case,'publicationId',v_result.id,'revision',v_revision),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.support.changed',v_key,jsonb_build_object('customerId',v_customer,'caseId',v_case,'revision',v_revision));
  end if;
  return to_jsonb(true);
end $f$;
revoke all on function public.gridex_support_case_publication_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_case_publication_v1(jsonb,jsonb) to service_role;

-- A pending reservation is durable even if Storage loses its upload response.
-- Only committed objects appear in the customer read. No clean status or
-- download capability exists until a verified scanner is configured separately.
create table public.customer_support_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  customer_case_id uuid not null,
  intake_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  visibility text not null check (visibility in ('internal','customer')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  api_client_id uuid references public.integration_api_clients(id) on delete restrict,
  channel text not null check (channel in ('ops','portal','api')),
  file_name text not null check (length(btrim(file_name)) between 1 and 180 and file_name !~ '[[:cntrl:]/\\]'),
  media_type text not null check (media_type in ('application/pdf','image/png','image/jpeg','text/plain')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'customer-support-quarantine' check (storage_bucket='customer-support-quarantine'),
  object_key text not null,
  scan_status text not null default 'quarantined' check (scan_status='quarantined'),
  created_at timestamptz not null default clock_timestamp(),
  uploaded_at timestamptz,
  revision bigint check (revision > 0),
  constraint customer_support_attachments_case_owner_fk foreign key(customer_case_id,company_id,customer_id)
    references public.customer_cases(id,company_id,customer_id) on delete cascade,
  constraint customer_support_attachments_customer_owner_fk foreign key(customer_id,company_id)
    references public.customers(id,company_id) on delete cascade,
  constraint customer_support_attachments_intake_key unique(company_id,intake_key),
  constraint customer_support_attachments_object_key unique(storage_bucket,object_key),
  constraint customer_support_attachments_storage_owner check (
    object_key=company_id::text||'/'||customer_id::text||'/'||customer_case_id::text||'/'||id::text),
  constraint customer_support_attachments_attribution check (
    (channel='api' and api_client_id is not null and actor_user_id is null and visibility='customer') or
    (channel in ('portal','ops') and api_client_id is null and actor_user_id is not null and (channel='ops' or visibility='customer'))),
  constraint customer_support_attachments_upload_state check ((uploaded_at is null)=(revision is null))
);
create index customer_support_attachments_case_idx on public.customer_support_attachments(company_id,customer_id,customer_case_id,created_at desc,id desc);
create index customer_support_attachments_actor_idx on public.customer_support_attachments(actor_user_id) where actor_user_id is not null;
create index customer_support_attachments_client_idx on public.customer_support_attachments(api_client_id) where api_client_id is not null;
alter table public.customer_support_attachments enable row level security;
revoke all on public.customer_support_attachments from public,anon,authenticated;
grant select,insert,update on public.customer_support_attachments to service_role;
insert into public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
values('customer_support_attachments','tenant','Private quarantine intake with composite case/customer owner, actual actor, immutable content hash and current-authority reserve/commit.',null,'migration:support_channel_safeguards');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('customer-support-quarantine','customer-support-quarantine',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policies also defeat any unrelated broad permissive Storage
-- policy. The service-role transport remains server-only.
create policy customer_support_quarantine_objects_no_client on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'customer-support-quarantine') with check(bucket_id<>'customer-support-quarantine');
create policy customer_support_quarantine_bucket_no_client on storage.buckets as restrictive for all to anon,authenticated
using(id<>'customer-support-quarantine') with check(id<>'customer-support-quarantine');

create function private.gridex_support_attachment_case_v1(p_context jsonb,p_selector jsonb,p_customer_visible boolean)
returns public.customer_cases language plpgsql security invoker set search_path=pg_catalog as $f$
declare
  v_case public.customer_cases%rowtype;
  v_id uuid:=nullif(p_selector->>'caseId','')::uuid;
  v_reference text:=nullif(p_selector->>'caseReference','');
  v_company uuid:=(p_context->>'companyId')::uuid;
  v_customer uuid:=(p_context->>'customerId')::uuid;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if (v_id is null)=(v_reference is null) or (v_reference is not null and v_reference !~ '^case_[A-Za-z0-9_-]{32}$')
    or (v_id is not null and p_context->>'mode'<>'ops') then raise exception 'invalid_support_attachment' using errcode='22023'; end if;
  if v_reference is not null then
    select id into v_id from public.customer_support_threads where company_id=v_company and customer_id=v_customer and public_reference=v_reference;
  end if;
  select * into v_case from public.customer_cases where id=v_id and company_id=v_company and customer_id=v_customer for update;
  if not found or not coalesce(v_case.metadata->>'support_case'='true' or v_case.source like 'tenant\_support\_%' escape '\',false) then
    raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if p_customer_visible and not exists(select 1 from public.customer_support_threads t where t.id=v_case.id and t.customer_title is not null)
    and not exists(select 1 from public.customer_case_publications p where p.company_id=v_company and p.customer_id=v_customer
      and p.customer_case_id=v_case.id and p.revoked_at is null) then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  return v_case;
end $f$;
revoke all on function private.gridex_support_attachment_case_v1(jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.gridex_support_attachment_case_v1(jsonb,jsonb,boolean) to service_role;

create function public.gridex_support_attachment_intake_v1(p_context jsonb,p_intake jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $f$
declare
  v_company uuid:=(p_context->>'companyId')::uuid;
  v_customer uuid:=(p_context->>'customerId')::uuid;
  v_actor uuid:=nullif(p_context->>'actorUserId','')::uuid;
  v_client uuid:=nullif(p_context->>'clientId','')::uuid;
  v_mode text:=p_context->>'mode';
  v_stage text:=p_intake->>'stage';
  v_expected bigint;
  v_case public.customer_cases%rowtype;
  v_attachment public.customer_support_attachments%rowtype;
  v_prior public.canonical_command_results%rowtype;
  v_key text; v_hash text; v_request jsonb; v_result jsonb; v_id uuid; v_event uuid;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' or
    exists(select 1 from jsonb_object_keys(p_context) k(key) where key not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject')) or
    p_intake is null or jsonb_typeof(p_intake)<>'object' or
    exists(select 1 from jsonb_object_keys(p_intake) k(key) where key not in ('stage','caseId','caseReference','expectedRevision','idempotencyKey','visibility','fileName','mediaType','byteSize','sha256')) or
    v_company is null or v_customer is null or coalesce(v_stage,'') not in ('reserve','commit') or
    coalesce(p_intake->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$' or
    jsonb_typeof(p_intake->'expectedRevision') is distinct from 'number' or p_intake->>'expectedRevision' !~ '^(0|[1-9][0-9]{0,15})$' or
    jsonb_typeof(p_intake->'byteSize') is distinct from 'number' or p_intake->>'byteSize' !~ '^[1-9][0-9]{0,6}$' or
    (p_intake->>'byteSize')::bigint>5242880 or coalesce(p_intake->>'sha256','') !~ '^[0-9a-f]{64}$' or
    coalesce(p_intake->>'mediaType','') not in ('application/pdf','image/png','image/jpeg','text/plain') or
    p_intake->>'fileName' is null or length(btrim(p_intake->>'fileName')) not between 1 and 180 or p_intake->>'fileName' ~ '[[:cntrl:]/\\]' or
    coalesce(p_intake->>'visibility','') not in ('customer','internal') or (v_mode is distinct from 'ops' and p_intake->>'visibility'<>'customer')
  then raise exception 'invalid_support_attachment' using errcode='22023'; end if;
  v_expected:=(p_intake->>'expectedRevision')::bigint;
  if v_expected>9007199254740991 then raise exception 'invalid_support_attachment' using errcode='22023'; end if;
  perform 1 from public.customers where id=v_customer and company_id=v_company for update;
  if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if not private.gridex_support_actor_v1(p_context,true) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  v_case:=private.gridex_support_attachment_case_v1(p_context,p_intake,p_intake->>'visibility'='customer');
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  v_key:=public.canonical_json_sha256(jsonb_build_object('customer',v_customer,'mode',v_mode,'actor',v_actor,'client',v_client,
    'subject',p_context->>'subject','key',p_intake->>'idempotencyKey'));
  v_request:=jsonb_build_object('customerId',v_customer,'caseId',v_case.id,'mode',v_mode,'actorUserId',v_actor,'clientId',v_client,
    'subjectHash',public.canonical_json_sha256(coalesce(p_context->'subject','null'::jsonb)),
    'expectedRevision',v_expected,'visibility',p_intake->>'visibility','fileName',p_intake->>'fileName',
    'mediaType',p_intake->>'mediaType','byteSize',(p_intake->>'byteSize')::integer,'sha256',p_intake->>'sha256');
  v_hash:=public.canonical_json_sha256(v_request);
  select * into v_prior from public.canonical_command_results where company_id=v_company and command_type='customer.support.attachment.v1' and idempotency_key=v_key;
  if found then
    if v_prior.request_hash is distinct from v_hash then raise exception 'support_idempotency_conflict' using errcode='23505'; end if;
    perform 1 from public.customer_support_attachments a join storage.objects o on o.bucket_id=a.storage_bucket and o.name=a.object_key
      where a.id=(v_prior.result_payload->>'attachmentId')::uuid and a.company_id=v_company and a.customer_id=v_customer and a.customer_case_id=v_case.id and a.uploaded_at is not null;
    if not found then raise exception 'support_attachment_unavailable' using errcode='P0001'; end if;
    if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
    return v_prior.result_payload||jsonb_build_object('replayed',true);
  end if;
  select * into v_attachment from public.customer_support_attachments where company_id=v_company and intake_key=v_key for update;
  if found and v_attachment.request_hash is distinct from v_hash then raise exception 'support_idempotency_conflict' using errcode='23505'; end if;
  if v_case.support_revision<>v_expected then raise exception 'support_revision_conflict' using errcode='PT409'; end if;
  if v_case.status in ('closed','cancelled') or (p_intake->>'visibility'='customer' and exists(
    select 1 from public.customer_case_publications p where p.company_id=v_company and p.customer_id=v_customer
      and p.customer_case_id=v_case.id and p.revoked_at is null and p.public_status='closed'))
    then raise exception 'support_case_closed' using errcode='P0001'; end if;
  if v_attachment.id is null then
    v_id:=gen_random_uuid();
    insert into public.customer_support_attachments(id,company_id,customer_id,customer_case_id,intake_key,request_hash,visibility,
      actor_user_id,api_client_id,channel,file_name,media_type,byte_size,content_sha256,object_key)
    values(v_id,v_company,v_customer,v_case.id,v_key,v_hash,p_intake->>'visibility',v_actor,v_client,v_mode,p_intake->>'fileName',p_intake->>'mediaType',
      (p_intake->>'byteSize')::integer,p_intake->>'sha256',v_company::text||'/'||v_customer::text||'/'||v_case.id::text||'/'||v_id::text)
    returning * into v_attachment;
  end if;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'caseId',v_case.id,'attachmentId',v_attachment.id,
    'objectKey',v_attachment.object_key,'phase','reserved','revision',v_case.support_revision,'scanStatus','quarantined','replayed',false);
  if v_stage='reserve' then
    if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
    return v_result;
  end if;
  perform 1 from storage.objects where bucket_id=v_attachment.storage_bucket and name=v_attachment.object_key
    and metadata->>'size'=v_attachment.byte_size::text for share;
  if not found then raise exception 'support_attachment_unavailable' using errcode='P0001'; end if;
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  update public.customer_cases set support_revision=support_revision+1,updated_at=clock_timestamp(),updated_by=v_actor
    where id=v_case.id and company_id=v_company and customer_id=v_customer returning * into v_case;
  update public.customer_support_attachments set uploaded_at=clock_timestamp(),revision=v_case.support_revision
    where id=v_attachment.id and company_id=v_company;
  v_result:=v_result||jsonb_build_object('phase','stored','revision',v_case.support_revision);
  insert into public.customer_case_events(company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by)
  values(v_company,v_customer,v_case.id,'support_attachment_quarantined','info','Privat bilaga mottagen i karantän.',
    jsonb_build_object('attachmentId',v_attachment.id,'channel',v_mode,'visibility',v_attachment.visibility,'revision',v_case.support_revision),v_actor);
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_SUPPORT_ATTACHMENT','customer_case',v_case.id,v_case.support_revision,v_actor,'private_attachment_intake',v_key,
    jsonb_build_object('revision',v_expected),jsonb_build_object('revision',v_case.support_revision),
    jsonb_build_object('attachmentId',v_attachment.id,'channel',v_mode,'clientId',v_client,'visibility',v_attachment.visibility,'scanStatus','quarantined'));
  insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
  values(v_company,'CUSTOMER_SUPPORT_ATTACHMENT_QUARANTINED','customer_case',v_case.id,v_case.support_revision,v_key,
    jsonb_build_object('customerId',v_customer,'caseId',v_case.id,'attachmentId',v_attachment.id),v_actor) returning id into v_event;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company,v_event,'customer.support.attachment.scan_requested',v_key,
    jsonb_build_object('customerId',v_customer,'caseId',v_case.id,'attachmentId',v_attachment.id,'bucket',v_attachment.storage_bucket,
      'objectKey',v_attachment.object_key,'sha256',v_attachment.content_sha256,'visibility',v_attachment.visibility));
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company,'customer.support.attachment.v1',v_key,v_request,v_result,v_actor);
  return v_result;
end $f$;
revoke all on function public.gridex_support_attachment_intake_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_attachment_intake_v1(jsonb,jsonb) to service_role;

create function public.gridex_support_attachment_read_v1(p_context jsonb,p_query jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $f$
declare
  v_case public.customer_cases%rowtype;
  v_limit integer:=coalesce((p_query->>'limit')::integer,25);
  v_before timestamptz:=nullif(p_query->>'before','')::timestamptz;
  v_before_id uuid:=nullif(p_query->>'beforeId','')::uuid;
  v_rows jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' or
    exists(select 1 from jsonb_object_keys(p_context) k(key) where key not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject')) or
    p_query is null or jsonb_typeof(p_query)<>'object' or
    exists(select 1 from jsonb_object_keys(p_query) k(key) where key not in ('reference','caseId','limit','before','beforeId')) or
    v_limit not between 1 and 101 or (v_before is null)<>(v_before_id is null) then raise exception 'invalid_support_attachment' using errcode='22023'; end if;
  if not private.gridex_support_actor_v1(p_context,false) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  v_case:=private.gridex_support_attachment_case_v1(p_context,jsonb_build_object('caseReference',p_query->'reference','caseId',p_query->'caseId'),p_context->>'mode'<>'ops');
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (
    select a.id,a.file_name,a.media_type,a.byte_size,a.scan_status,a.created_at,a.visibility from public.customer_support_attachments a
    where a.company_id=v_case.company_id and a.customer_id=v_case.customer_id and a.customer_case_id=v_case.id and a.uploaded_at is not null
      and (p_context->>'mode'='ops' or a.visibility='customer')
      and (v_before is null or (a.created_at,a.id)<(v_before,v_before_id)) order by a.created_at desc,a.id desc limit v_limit
  ) r;
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  return jsonb_build_object('items',v_rows);
end $f$;
revoke all on function public.gridex_support_attachment_read_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_attachment_read_v1(jsonb,jsonb) to service_role;
commit;
