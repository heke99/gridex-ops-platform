-- Canonical provisioning of the existing global-platform agreement feature.
-- No market activation, external delivery or support-quarantine release.
begin;
set local lock_timeout = '10s';

create table if not exists public.grid_owner_access_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  grid_owner_id uuid,
  agreement_type text not null default 'metering_access',
  agreement_scope text not null default 'metering_access',
  status text not null default 'draft',
  agreement_reference text,
  external_agreement_number text,
  valid_from date,
  valid_to date,
  signed_at timestamptz,
  document_id uuid,
  document_path text,
  requires_customer_authorization boolean not null default true,
  requires_metering_point_id boolean not null default true,
  requires_facility_id boolean not null default false,
  requires_customer_personal_number boolean not null default false,
  requires_report_period boolean not null default false,
  preferred_application_reference text,
  preferred_message_version text,
  preferred_receiver_ediel_id text,
  preferred_receiver_sub_address text,
  preferred_route_id uuid,
  reference_requirements jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing historical installations must have the exact compatible feature
-- shape. Do not silently patch unrelated or incompatible old data.
do $preflight$
declare v record;
begin
  for v in select * from (values
    ('id','uuid'),('company_id','uuid'),('grid_owner_id','uuid'),
    ('agreement_type','text'),('agreement_scope','text'),('status','text'),
    ('agreement_reference','text'),('external_agreement_number','text'),
    ('valid_from','date'),('valid_to','date'),('signed_at','timestamp with time zone'),
    ('document_id','uuid'),('document_path','text'),
    ('requires_customer_authorization','boolean'),('requires_metering_point_id','boolean'),
    ('requires_facility_id','boolean'),('requires_customer_personal_number','boolean'),('requires_report_period','boolean'),
    ('preferred_application_reference','text'),('preferred_message_version','text'),
    ('preferred_receiver_ediel_id','text'),('preferred_receiver_sub_address','text'),('preferred_route_id','uuid'),
    ('reference_requirements','jsonb'),('metadata','jsonb'),('created_by','uuid'),('updated_by','uuid'),
    ('created_at','timestamp with time zone'),('updated_at','timestamp with time zone')
  ) s(column_name,type_name) loop
    if not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.grid_owner_access_agreements'::regclass and a.attname=v.column_name
        and not a.attisdropped and pg_catalog.format_type(a.atttypid,a.atttypmod)=v.type_name) then
      raise exception 'agreement_schema_incompatible';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a
      on a.attrelid=c.conrelid and a.attname='id'
      where c.conrelid='public.grid_owner_access_agreements'::regclass and c.contype='p'
        and c.conkey=array[a.attnum])
    or exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.grid_owner_access_agreements'::regclass and not a.attisdropped
        and a.attname=any(array['id','agreement_type','agreement_scope','status','requires_customer_authorization',
          'requires_metering_point_id','requires_facility_id','requires_customer_personal_number','requires_report_period',
          'reference_requirements','metadata','created_at','updated_at']) and not a.attnotnull)
    or exists(select 1 from pg_catalog.pg_class c where c.oid='public.grid_owner_access_agreements'::regclass and c.relforcerowsecurity)
    or exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.grid_owner_access_agreements'::regclass and a.attname='revision' and not a.attisdropped
        and (pg_catalog.format_type(a.atttypid,a.atttypmod)<>'bigint' or not a.attnotnull)) then
    raise exception 'agreement_schema_incompatible';
  end if;
end
$preflight$;
alter table public.grid_owner_access_agreements add column if not exists revision bigint not null default 0;
alter table public.grid_owner_access_agreements add constraint grid_owner_access_agreements_revision_check check(revision>=0);
create index if not exists idx_grid_owner_access_agreements_company_scope
  on public.grid_owner_access_agreements(company_id,grid_owner_id,agreement_scope,status);
create index if not exists idx_grid_owner_access_agreements_active_metering
  on public.grid_owner_access_agreements(company_id,grid_owner_id,agreement_type,status,valid_from,valid_to);
create index if not exists grid_owner_access_agreements_document_path_idx
  on public.grid_owner_access_agreements(document_path) where document_path is not null;
alter table public.grid_owner_access_agreements enable row level security;
revoke all on public.grid_owner_access_agreements from public,anon,authenticated,service_role;
grant select on public.grid_owner_access_agreements to service_role;
create policy gridex_agreement_service_read_v1 on public.grid_owner_access_agreements
  for select to service_role using(true);

insert into public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
values('grid_owner_access_agreements','mixed','Existing global platform agreement feature; service reads and private current-session atomic writer.',
  'NULL identifies a global platform agreement; only actual global platform authority can create or mutate it.',
  'migration:grid_owner_access_agreement_atomic_provisioning')
on conflict(table_name) do update set kind=excluded.kind,rationale=excluded.rationale,
  null_company_meaning=excluded.null_company_meaning,classified_by=excluded.classified_by;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('grid-owner-agreements','grid-owner-agreements',false,52428800,
  array['application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false;

-- Only the guarded server reader/uploader uses this new private bucket.
-- Restrictive policies also defeat inherited permissive Storage policies.
create policy gridex_agreement_bucket_server_only_v1 on storage.objects
  as restrictive for all to anon,authenticated
  using(bucket_id<>'grid-owner-agreements') with check(bucket_id<>'grid-owner-agreements');
create policy gridex_agreement_bucket_metadata_server_only_v1 on storage.buckets
  as restrictive for all to anon,authenticated
  using(id<>'grid-owner-agreements') with check(id<>'grid-owner-agreements');

create table private.gridex_agreement_results_v1(
  id uuid primary key default gen_random_uuid(),actor_user_id uuid not null,idempotency_key text not null,
  request_hash text not null,result_payload jsonb not null,created_at timestamptz not null default clock_timestamp(),
  unique(actor_user_id,idempotency_key)
);
create table private.gridex_agreement_audit_v1(
  id uuid primary key default gen_random_uuid(),agreement_id uuid not null,company_id uuid,actor_user_id uuid not null,
  session_id uuid not null,revision bigint not null,operation text not null,idempotency_key text not null,
  request_hash text not null,before_state jsonb not null,after_state jsonb not null,audit_log_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(agreement_id,revision)
);
create table private.gridex_agreement_uploads_v1(
  id uuid primary key default gen_random_uuid(),cleanup_token uuid not null default gen_random_uuid(),
  actor_user_id uuid not null,idempotency_key text not null,request_hash text not null,company_id uuid,
  bucket text not null,object_key text not null,file_sha256 text not null,
  status text not null default 'prepared' check(status in ('prepared','attached','cleanup_required','cleaned')),
  result_id uuid references private.gridex_agreement_results_v1(id),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(bucket,object_key)
);
alter table private.gridex_agreement_results_v1 enable row level security;
alter table private.gridex_agreement_audit_v1 enable row level security;
alter table private.gridex_agreement_uploads_v1 enable row level security;
revoke all on private.gridex_agreement_results_v1,private.gridex_agreement_audit_v1,private.gridex_agreement_uploads_v1
  from public,anon,authenticated,service_role;

create function private.gridex_agreement_immutable_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin raise exception 'agreement_audit_immutable' using errcode='42501'; end;
$function$;
create trigger gridex_agreement_audit_immutable before update or delete on private.gridex_agreement_audit_v1
  for each row execute function private.gridex_agreement_immutable_v1();
create trigger gridex_agreement_result_immutable before update or delete on private.gridex_agreement_results_v1
  for each row execute function private.gridex_agreement_immutable_v1();
revoke all on function private.gridex_agreement_immutable_v1() from public,anon,authenticated,service_role;

create function private.gridex_agreement_authority_v1(p_actor uuid,p_session uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
begin
  if not private.gridex_profile_session_active_v1(p_actor,p_session) then return false; end if;
  perform 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null for share;
  if not found then return false; end if;
  perform 1 from public.admin_users a where a.user_id=p_actor order by a.id for share;
  perform 1 from public.user_roles u where u.user_id=p_actor and u.company_id is null order by u.id for share;
  perform 1 from public.roles r where r.id in(select u.role_id from public.user_roles u where u.user_id=p_actor and u.company_id is null)
    order by r.id for share;
  return private.gridex_profile_session_active_v1(p_actor,p_session)
    and public.canonical_actor_is_platform_admin(p_actor);
end;
$function$;
revoke all on function private.gridex_agreement_authority_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function private.gridex_agreement_object_path_v1(p_value text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $function$
  select p_value is not null and p_value<>'' and p_value ~ '^[A-Za-z0-9._/-]+$'
    and not exists(select 1 from unnest(string_to_array(p_value,'/')) s
      where s in ('','.','..'));
$function$;
revoke all on function private.gridex_agreement_object_path_v1(text) from public,anon,authenticated,service_role;

create function private.gridex_agreement_command_v1(p_command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $function$
declare
  v_operation text:=p_command->>'operation';
  v_actor uuid:=nullif(p_command->>'actorUserId','')::uuid;
  v_session uuid:=nullif(p_command->>'sessionId','')::uuid;
  v_company uuid:=nullif(p_command->>'companyId','')::uuid;
  v_id uuid:=nullif(p_command->>'id','')::uuid;
  v_key text:=p_command->>'idempotencyKey';
  v_expected bigint:=(p_command->>'expectedRevision')::bigint;
  v_payload jsonb:=coalesce(p_command->'payload','{}');
  v_hash text;
  v_existing private.gridex_agreement_results_v1%rowtype;
  v_upload private.gridex_agreement_uploads_v1%rowtype;
  v_row public.grid_owner_access_agreements%rowtype;
  v_before jsonb:='{}'; v_after jsonb; v_result jsonb; v_result_id uuid; v_audit uuid;
  v_owner uuid; v_owner_company uuid; v_route uuid; v_route_company uuid; v_route_owner uuid;
  v_name text; v_org text; v_ediel text; v_matches integer:=0; v_created boolean:=false;
  v_document text; v_bucket text; v_path text; v_upload_id uuid; v_warning text;
begin
  if v_actor is null or v_key is null or length(v_key) not between 8 and 200
    or v_key !~ '^[A-Za-z0-9._:+~-]+$' or jsonb_typeof(p_command)<>'object'
    or v_operation not in ('save','archive','prepare_upload','abort_upload','cleanup_complete')
    or v_expected is null or v_expected<0 or jsonb_typeof(v_payload)<>'object'
    or (p_command - array['operation','actorUserId','sessionId','companyId','id','idempotencyKey','expectedRevision','payload','uploadIntentId','cleanupToken'])<>'{}'::jsonb then
    raise exception 'invalid_agreement_command' using errcode='22023';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation',case when v_operation='archive' then 'archive' else 'save' end,
    'companyId',v_company,'id',v_id,'expectedRevision',v_expected,'payload',v_payload)::text,'UTF8')),'hex');
  if v_operation not in ('abort_upload','cleanup_complete') and not private.gridex_agreement_authority_v1(v_actor,v_session) then
    raise exception 'agreement_actor_forbidden' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grid-owner-agreement:'||v_actor::text||':'||v_key,0));
  select * into v_existing from private.gridex_agreement_results_v1
    where actor_user_id=v_actor and idempotency_key=v_key;
  if found and v_existing.request_hash<>v_hash then raise exception 'agreement_idempotency_conflict' using errcode='PT409'; end if;

  if v_operation in ('abort_upload','cleanup_complete') then
    select * into v_upload from private.gridex_agreement_uploads_v1
      where id=nullif(p_command->>'uploadIntentId','')::uuid and cleanup_token=nullif(p_command->>'cleanupToken','')::uuid
        and actor_user_id=v_actor and idempotency_key=v_key and request_hash=v_hash for update;
    if not found then raise exception 'agreement_upload_receipt_invalid' using errcode='42501'; end if;
    if v_operation='cleanup_complete' then
      if v_upload.status='attached' then raise exception 'agreement_upload_attached' using errcode='PT409'; end if;
      if v_upload.status<>'cleanup_required' then raise exception 'agreement_upload_receipt_invalid' using errcode='42501'; end if;
      update private.gridex_agreement_uploads_v1 set status='cleaned',updated_at=clock_timestamp() where id=v_upload.id;
      return jsonb_build_object('cleaned',true);
    end if;
    if v_upload.status<>'attached' then
      update private.gridex_agreement_uploads_v1 set status='cleanup_required',updated_at=clock_timestamp() where id=v_upload.id;
    end if;
    return jsonb_build_object('committed',case when v_existing.id is not null then v_existing.result_payload||jsonb_build_object('replayed',true) end,
      'cleanup',case when v_upload.status<>'attached' then jsonb_build_object('id',v_upload.id,'token',v_upload.cleanup_token,'bucket',v_upload.bucket,'path',v_upload.object_key) end);
  end if;

  if not private.gridex_agreement_authority_v1(v_actor,v_session) then raise exception 'agreement_actor_forbidden' using errcode='42501'; end if;
  if v_company is not null then
    perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active'
      and c.lifecycle_status='active' and c.archived_at is null for share;
    if not found then raise exception 'agreement_company_unavailable' using errcode='PT404'; end if;
  end if;
  if v_existing.id is not null then
    perform 1 from public.grid_owner_access_agreements a where a.id=(v_existing.result_payload->'agreement'->>'id')::uuid
      and a.company_id is not distinct from v_company for share;
    if not found then raise exception 'agreement_resource_unavailable' using errcode='PT404'; end if;
    if not private.gridex_agreement_authority_v1(v_actor,v_session) then raise exception 'agreement_actor_forbidden' using errcode='42501'; end if;
    if v_operation='prepare_upload' then
      return jsonb_build_object('committed',v_existing.result_payload||jsonb_build_object('replayed',true));
    end if;
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_operation='prepare_upload' then
    v_bucket:=v_payload->'documentFile'->>'bucket';
    v_name:=v_payload->'documentFile'->>'name';
    if v_bucket is null or v_bucket='customer-support-quarantine' or v_bucket !~ '^[A-Za-z0-9._-]+$'
      or v_bucket in ('.','..') or v_name is null or v_name !~ '^[A-Za-z0-9._-]+$'
      or v_name in ('.','..') or coalesce(v_payload->'documentFile'->>'sha256','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_payload->'documentFile')<>'object'
      or ((v_payload->'documentFile')-array['bucket','name','sha256','size','contentType'])<>'{}'::jsonb then
      raise exception 'invalid_agreement_document' using errcode='22023';
    end if;
    perform 1 from storage.buckets b where b.id=v_bucket and not b.public for share;
    if not found then raise exception 'agreement_bucket_unavailable' using errcode='PT404'; end if;
    v_upload_id:=gen_random_uuid();
    v_path:=coalesce(v_company::text,'platform')||'/'||coalesce(nullif(v_payload->>'gridOwnerId',''),'unknown-grid-owner')||'/'||v_upload_id::text||'-'||v_name;
    if not private.gridex_agreement_object_path_v1(v_path) then raise exception 'invalid_agreement_document' using errcode='22023'; end if;
    insert into private.gridex_agreement_uploads_v1(id,actor_user_id,idempotency_key,request_hash,company_id,bucket,object_key,file_sha256)
      values(v_upload_id,v_actor,v_key,v_hash,v_company,v_bucket,v_path,v_payload->'documentFile'->>'sha256') returning * into v_upload;
    if not private.gridex_agreement_authority_v1(v_actor,v_session) then raise exception 'agreement_actor_forbidden' using errcode='42501'; end if;
    return jsonb_build_object('intent',jsonb_build_object('id',v_upload.id,'token',v_upload.cleanup_token,'bucket',v_upload.bucket,'path',v_upload.object_key));
  end if;
  if v_id is not null then
    select * into v_row from public.grid_owner_access_agreements where id=v_id and company_id is not distinct from v_company for update;
    if not found then raise exception 'agreement_resource_unavailable' using errcode='PT404'; end if;
    if v_row.revision<>v_expected then raise exception 'agreement_revision_conflict' using errcode='PT409'; end if;
    v_before:=to_jsonb(v_row);
  elsif v_operation='archive' or v_expected<>0 then
    raise exception 'invalid_agreement_command' using errcode='22023';
  end if;
  if v_operation='archive' then
    if v_row.status='archived' then
      v_result:=jsonb_build_object('agreement',to_jsonb(v_row),'changed',false,'replayed',false,'gridOwnerCreated',false);
    else
      update public.grid_owner_access_agreements set status='archived',revision=revision+1,updated_by=v_actor,updated_at=clock_timestamp()
        where id=v_id returning * into v_row;
    end if;
  else
    if (v_payload-array['gridOwnerId','newGridOwner','agreementType','agreementScope','status','agreementReference','externalAgreementNumber',
      'validFrom','validTo','signedAt','documentId','documentPath','documentFile','requiresCustomerAuthorization','requiresMeteringPointId',
      'requiresFacilityId','requiresCustomerPersonalNumber','requiresReportPeriod','preferredApplicationReference','preferredMessageVersion',
      'preferredReceiverEdielId','preferredReceiverSubAddress','preferredRouteId','referenceRequirements','metadata'])<>'{}'::jsonb
      or coalesce(v_payload->>'status','draft') not in ('draft','active','expired','blocked','archived')
      or coalesce(v_payload->>'agreementScope','') not in ('supplier_switch','customer_masterdata','meter_values','billing_underlay','general_ediel','metering_access')
      or nullif(btrim(v_payload->>'agreementType'),'') is null
      or jsonb_typeof(coalesce(v_payload->'metadata','{}'))<>'object'
      or jsonb_typeof(coalesce(v_payload->'referenceRequirements','{}'))<>'object' then
      raise exception 'invalid_agreement_command' using errcode='22023';
    end if;
    v_owner:=nullif(v_payload->>'gridOwnerId','')::uuid;
    if v_owner is null and nullif(btrim(v_payload->'newGridOwner'->>'name'),'') is not null then
      v_name:=btrim(v_payload->'newGridOwner'->>'name');
      v_org:=nullif(btrim(v_payload->'newGridOwner'->>'orgNumber'),'');
      v_ediel:=nullif(btrim(v_payload->'newGridOwner'->>'edielId'),'');
      if length(v_name)>255 or length(coalesce(v_org,''))>255 or length(coalesce(v_ediel,''))>255
        or ((v_payload->'newGridOwner')-array['name','orgNumber','edielId','email','phone'])<>'{}'::jsonb then
        raise exception 'invalid_agreement_command' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('grid-owner-agreement-owner:'||coalesce(v_company::text,'platform'),0));
      for v_owner in select g.id from public.grid_owners g where (g.company_id is null or g.company_id=v_company)
        and ((v_ediel is not null and lower(btrim(g.ediel_id))=lower(v_ediel))
          or (v_org is not null and lower(btrim(g.org_number))=lower(v_org))
          or lower(regexp_replace(btrim(g.name),'\s+',' ','g'))=lower(regexp_replace(v_name,'\s+',' ','g')))
        order by g.id for share loop v_matches:=v_matches+1; end loop;
      if v_matches>1 then raise exception 'agreement_grid_owner_ambiguous' using errcode='PT409'; end if;
      if v_matches=0 then
        insert into public.grid_owners(company_id,name,owner_code,ediel_id,org_number,email,phone,country,notes,is_active,created_by,updated_by)
          values(v_company,v_name,coalesce(v_ediel,v_org,left(v_name,24)),v_ediel,v_org,
            nullif(btrim(v_payload->'newGridOwner'->>'email'),''),nullif(btrim(v_payload->'newGridOwner'->>'phone'),''),
            'SE','Skapad direkt från nätägaravtalet. Kontrollera route och Ediel-profil innan liveflöde skickas.',true,v_actor,v_actor)
          returning id into v_owner;
        v_created:=true;
        v_warning:='Ny nätägare skapades från avtalsformuläret.';
      else v_warning:='Möjlig dubblett på nätägare hittades. Befintlig nätägare används.'; end if;
    end if;
    if v_owner is not null then
      select g.company_id into v_owner_company from public.grid_owners g where g.id=v_owner for share;
      if not found or (v_owner_company is not null and v_owner_company is distinct from v_company) then
        raise exception 'agreement_grid_owner_unavailable' using errcode='PT404';
      end if;
    end if;
    v_route:=nullif(v_payload->>'preferredRouteId','')::uuid;
    if v_route is not null then
      select r.company_id,r.grid_owner_id into v_route_company,v_route_owner from public.communication_routes r where r.id=v_route for share;
      if not found or (v_route_company is not null and v_route_company is distinct from v_company)
        or (v_route_owner is not null and v_route_owner is distinct from v_owner) then
        raise exception 'agreement_route_unavailable' using errcode='PT404';
      end if;
    end if;
    v_document:=nullif(btrim(v_payload->>'documentPath'),'');
    if v_payload->'documentFile' is not null then
      if v_document is not null then raise exception 'invalid_agreement_document' using errcode='22023'; end if;
      select * into v_upload from private.gridex_agreement_uploads_v1 where id=nullif(p_command->>'uploadIntentId','')::uuid
        and cleanup_token=nullif(p_command->>'cleanupToken','')::uuid and actor_user_id=v_actor and idempotency_key=v_key
        and request_hash=v_hash and status='prepared' for update;
      if not found then raise exception 'agreement_upload_receipt_invalid' using errcode='42501'; end if;
      v_document:=v_upload.bucket||':'||v_upload.object_key;
    elsif v_document is not null then
      v_bucket:=case when strpos(v_document,':')>0 then split_part(v_document,':',1) else 'grid-owner-agreements' end;
      v_path:=case when strpos(v_document,':')>0 then substr(v_document,strpos(v_document,':')+1) else v_document end;
      if v_bucket='customer-support-quarantine' or v_bucket !~ '^[A-Za-z0-9._-]+$' or v_bucket in ('.','..')
        or not private.gridex_agreement_object_path_v1(v_path) then raise exception 'invalid_agreement_document' using errcode='22023'; end if;
      perform 1 from storage.buckets b where b.id=v_bucket and not b.public for share;
      if not found then raise exception 'agreement_bucket_unavailable' using errcode='PT404'; end if;
    end if;
    if v_payload->>'validFrom' is not null and v_payload->>'validTo' is not null
      and (v_payload->>'validFrom')::date>(v_payload->>'validTo')::date then raise exception 'invalid_agreement_command' using errcode='22023'; end if;
    if v_id is null then
      insert into public.grid_owner_access_agreements(company_id,created_by) values(v_company,v_actor) returning id into v_id;
    end if;
    update public.grid_owner_access_agreements set
      grid_owner_id=v_owner,agreement_type=btrim(v_payload->>'agreementType'),agreement_scope=v_payload->>'agreementScope',
      status=coalesce(v_payload->>'status','draft'),agreement_reference=nullif(btrim(v_payload->>'agreementReference'),''),
      external_agreement_number=nullif(btrim(v_payload->>'externalAgreementNumber'),''),
      valid_from=nullif(v_payload->>'validFrom','')::date,valid_to=nullif(v_payload->>'validTo','')::date,
      signed_at=nullif(v_payload->>'signedAt','')::timestamptz,document_id=nullif(v_payload->>'documentId','')::uuid,document_path=v_document,
      requires_customer_authorization=coalesce((v_payload->>'requiresCustomerAuthorization')::boolean,true),
      requires_metering_point_id=coalesce((v_payload->>'requiresMeteringPointId')::boolean,true),
      requires_facility_id=coalesce((v_payload->>'requiresFacilityId')::boolean,false),
      requires_customer_personal_number=coalesce((v_payload->>'requiresCustomerPersonalNumber')::boolean,false),
      requires_report_period=coalesce((v_payload->>'requiresReportPeriod')::boolean,false),
      preferred_application_reference=nullif(btrim(v_payload->>'preferredApplicationReference'),''),
      preferred_message_version=nullif(btrim(v_payload->>'preferredMessageVersion'),''),
      preferred_receiver_ediel_id=nullif(btrim(v_payload->>'preferredReceiverEdielId'),''),
      preferred_receiver_sub_address=nullif(btrim(v_payload->>'preferredReceiverSubAddress'),''),
      preferred_route_id=v_route,reference_requirements=coalesce(v_payload->'referenceRequirements','{}'),
      metadata=coalesce(v_payload->'metadata','{}')||jsonb_build_object('gridOwnerResolutionWarning',v_warning),
      revision=revision+1,updated_by=v_actor,updated_at=clock_timestamp()
      where id=v_id returning * into v_row;
  end if;
  v_after:=to_jsonb(v_row);
  if v_result is null then
    v_result:=jsonb_build_object('agreement',v_after,'changed',true,'replayed',false,'gridOwnerCreated',v_created,'warning',v_warning);
    v_audit:=gen_random_uuid();
    insert into public.audit_logs(id,company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata,
      actor_type,request_id,correlation_id,resource_type,resource_id,previous_status,new_status)
    values(v_audit,v_company,v_actor,'grid_owner_access_agreement',v_id::text,'grid_owner_agreement_'||v_operation,v_before,v_after,
      jsonb_build_object('source','admin_ui','revision',v_row.revision),'user',v_audit::text,v_audit::text,
      'grid_owner_access_agreement',v_id::text,v_before->>'status',v_row.status);
    insert into private.gridex_agreement_audit_v1(agreement_id,company_id,actor_user_id,session_id,revision,operation,idempotency_key,
      request_hash,before_state,after_state,audit_log_id)
    values(v_id,v_company,v_actor,v_session,v_row.revision,v_operation,v_key,v_hash,v_before,v_after,v_audit);
  end if;
  insert into private.gridex_agreement_results_v1(actor_user_id,idempotency_key,request_hash,result_payload)
    values(v_actor,v_key,v_hash,v_result) returning id into v_result_id;
  if v_upload.id is not null then
    update private.gridex_agreement_uploads_v1 set status='attached',result_id=v_result_id,updated_at=clock_timestamp() where id=v_upload.id;
  end if;
  if not private.gridex_agreement_authority_v1(v_actor,v_session) then raise exception 'agreement_actor_forbidden' using errcode='42501'; end if;
  return v_result;
end;
$function$;
revoke all on function private.gridex_agreement_command_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_agreement_command_v1(jsonb) to service_role;

create function public.gridex_grid_owner_agreement_command_v1(p_command jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'agreement_service_required' using errcode='42501'; end if;
  return private.gridex_agreement_command_v1(p_command);
end;
$function$;
revoke all on function public.gridex_grid_owner_agreement_command_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_grid_owner_agreement_command_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
