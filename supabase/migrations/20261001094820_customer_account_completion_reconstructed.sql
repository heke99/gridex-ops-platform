-- Reconstructed completion command. Historical rows are never rewritten.
-- No Auth table privilege is added: the existing narrow current-session and
-- confirmed-email helpers retain their existing owners and grants.
begin;
create table private.customer_portal_account_completion_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  user_id uuid not null,
  account_id uuid not null,
  claim_id uuid not null,
  event_id uuid not null,
  creating_session_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  account_binding_hash text not null check (account_binding_hash ~ '^[0-9a-f]{64}$'),
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id, customer_id, user_id)
);
-- No cascading graph/Auth/session FK: existing explicitly test-only harddelete
-- may remove its graph. Such a missing graph invalidates replay and cannot be
-- recreated by this command. The append-only receipt remains provenance.
alter table private.customer_portal_account_completion_receipts enable row level security;
alter table private.customer_portal_account_completion_receipts force row level security;
revoke all on private.customer_portal_account_completion_receipts from public, anon, authenticated, service_role;
grant select, insert on private.customer_portal_account_completion_receipts to service_role;

create function private.gridex_account_completion_receipt_immutable_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $receipt$
begin
  raise exception 'portal_completion_receipt_immutable' using errcode = '23514';
end;
$receipt$;
revoke all on function private.gridex_account_completion_receipt_immutable_v1() from public, anon, authenticated, service_role;
create trigger customer_portal_account_completion_receipt_immutable
before update or delete on private.customer_portal_account_completion_receipts
for each row execute function private.gridex_account_completion_receipt_immutable_v1();

-- Match the existing JS NFKD/combining-mark/ASCII normalization exactly. In
-- particular this does not use unaccent's broader transliteration policy.
create function private.gridex_account_completion_name_v1(p_name text)
returns text language sql immutable security invoker set search_path = pg_catalog as $name$
  select regexp_replace(regexp_replace(normalize(lower(coalesce(p_name, '')), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9åäö]', '', 'g');
$name$;
revoke all on function private.gridex_account_completion_name_v1(text) from public, anon, authenticated, service_role;
grant execute on function private.gridex_account_completion_name_v1(text) to service_role;

create function private.gridex_account_completion_candidate_hash_v1(p_variants text[], p_slug text)
returns text language sql volatile security invoker set search_path=pg_catalog as $candidates$
  select public.canonical_json_sha256(coalesce(jsonb_agg(jsonb_build_object('company',jsonb_build_object('id',c.id,'slug',c.slug,'isActive',c.is_active,'status',c.status),'customer',to_jsonb(x),'contacts',
    (select coalesce(jsonb_agg(to_jsonb(cc) order by cc.id),'[]') from public.customer_contacts cc where cc.company_id=x.company_id and cc.customer_id=x.id),
    'sites',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.customer_sites s where s.company_id=x.company_id and s.customer_id=x.id),
    'points',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.metering_points p where p.site_id in
      (select id from public.customer_sites s where s.company_id=x.company_id and s.customer_id=x.id) or p.customer_site_id in
      (select id from public.customer_sites s where s.company_id=x.company_id and s.customer_id=x.id))) order by x.company_id,x.id),'[]'))
    from public.customers x join public.companies c on c.id=x.company_id where x.normalized_personal_number=any(p_variants) and (p_slug='' or c.slug=p_slug);
$candidates$;
revoke all on function private.gridex_account_completion_candidate_hash_v1(text[],text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_account_completion_candidate_hash_v1(text[],text) to service_role;

create function public.gridex_complete_customer_portal_account_v1(p_command jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog as $completion$
declare
  v_company uuid; v_customer uuid; v_user uuid; v_session uuid;
  v_email jsonb; v_final_email jsonb; v_input jsonb; v_source jsonb;
  v_digits text; v_pn_variants text[]; v_install_variants text[];
  v_full_name text; v_first text; v_last text; v_slug text;
  v_customer_row public.customers%rowtype; v_site public.customer_sites%rowtype;
  v_point public.metering_points%rowtype; v_account public.customer_portal_accounts%rowtype;
  v_claim public.customer_portal_claims%rowtype; v_event public.customer_portal_events%rowtype;
  v_final_account public.customer_portal_accounts%rowtype; v_final_claim public.customer_portal_claims%rowtype; v_final_event public.customer_portal_events%rowtype;
  v_receipt private.customer_portal_account_completion_receipts%rowtype;
  v_candidate public.customers%rowtype; v_candidate_site public.customer_sites%rowtype;
  v_candidate_point public.metering_points%rowtype;
  v_contacts jsonb; v_current_source jsonb; v_request_hash text; v_source_hash text;
  v_candidate_hash text; v_final_candidate_hash text; v_account_hash text;
  v_matches integer := 0; v_account_count integer; v_site_id uuid; v_point_id uuid;
  v_names text[]; v_name text; v_name_ok boolean; v_email_ok boolean; v_install_ok boolean;
  v_now timestamptz; v_status text; v_metadata jsonb; v_verification jsonb; v_event_payload jsonb; v_event_metadata jsonb;
begin
  if jsonb_typeof(p_command) is distinct from 'object' or
     (select count(*) from jsonb_object_keys(p_command)) <> 7 or
     not p_command ?& array['companyId','customerId','userId','sessionId','authEmail','input','source'] then
    raise exception 'portal_completion_invalid' using errcode = '22023';
  end if;
  v_company := (p_command->>'companyId')::uuid;
  v_customer := (p_command->>'customerId')::uuid;
  v_user := (p_command->>'userId')::uuid;
  v_session := (p_command->>'sessionId')::uuid;
  v_input := p_command->'input'; v_source := p_command->'source';
  if v_company is null or v_customer is null or v_user is null or v_session is null or
     jsonb_typeof(v_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_input)) <> 7 or
     not v_input ?& array['email','personalNumber','firstName','lastName','fullName','installationId','companySlug'] or
     exists(select 1 from jsonb_each(v_input) where jsonb_typeof(value) <> 'string' or length(value #>> '{}') > 512) or
     jsonb_typeof(v_source) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_source)) <> 4 or
     not v_source ?& array['customer','contacts','site','point'] or pg_column_size(v_source)>262144 or
     jsonb_typeof(v_source->'customer') is distinct from 'object' or jsonb_typeof(v_source->'site') is distinct from 'object' or
     jsonb_typeof(v_source->'contacts') is distinct from 'array' or jsonb_array_length(v_source->'contacts')>1000 or
     jsonb_typeof(v_source->'point') not in ('object','null') then
    raise exception 'portal_completion_invalid' using errcode = '22023';
  end if;
  if not private.gridex_support_session_active_v1(v_user, v_session) then
    raise exception 'portal_completion_current_session_required' using errcode = '42501';
  end if;
  v_email := private.gridex_invoice_redelivery_auth_email_v1(v_user);
  if lower(btrim(p_command->>'authEmail')) is distinct from v_email->>'email' or
     (btrim(v_input->>'email') <> '' and lower(btrim(v_input->>'email')) is distinct from v_email->>'email') then
    raise exception 'portal_completion_current_email_required' using errcode = '42501';
  end if;
  v_digits := regexp_replace(v_input->>'personalNumber', '[^0-9]', '', 'g');
  if length(v_digits) not in (10,12) or btrim(v_input->>'installationId') = '' then
    raise exception 'portal_completion_invalid' using errcode = '22023';
  end if;
  v_pn_variants := array[v_digits];
  if length(v_digits) = 12 then v_pn_variants := v_pn_variants || substr(v_digits,3);
  else v_pn_variants := v_pn_variants || ('19'||v_digits) || ('20'||v_digits); end if;
  v_install_variants := array[btrim(v_input->>'installationId'), regexp_replace(v_input->>'installationId','\s','','g'),regexp_replace(v_input->>'installationId','[^0-9]','','g')];
  v_slug := lower(btrim(v_input->>'companySlug'));
  v_full_name := private.gridex_account_completion_name_v1(coalesce(nullif(btrim(v_input->>'fullName'),''), concat_ws(' ',nullif(btrim(v_input->>'firstName'),''),nullif(btrim(v_input->>'lastName'),''))));
  v_first := private.gridex_account_completion_name_v1(v_input->>'firstName');
  v_last := private.gridex_account_completion_name_v1(v_input->>'lastName');
  if length(v_full_name) < 4 then raise exception 'portal_completion_invalid' using errcode = '22023'; end if;

  -- Stable effect, not a previous session's authority. All commands for this
  -- normalized identity also serialize their complete ambiguity calculation.
  perform pg_advisory_xact_lock(hashtextextended('portal-completion-match:'||v_digits, 0));
  perform pg_advisory_xact_lock(hashtextextended('portal-completion-effect:'||v_company||':'||v_customer||':'||v_user, 0));
  perform 1 from public.companies c where c.id in
    (select x.company_id from public.customers x where x.normalized_personal_number = any(v_pn_variants))
    order by c.id for share;
  if not exists(select 1 from public.companies where id=v_company and is_active=true and status='active' and (v_slug='' or slug=v_slug)) then
    raise exception 'portal_completion_company_changed' using errcode = 'PT409';
  end if;
  v_candidate_hash:=private.gridex_account_completion_candidate_hash_v1(v_pn_variants,v_slug);
  -- Never inherit the outer customer's limit(10) or point's limit(1).
  for v_candidate in select x.* from public.customers x join public.companies c on c.id=x.company_id
      where x.normalized_personal_number=any(v_pn_variants) and (v_slug='' or c.slug=v_slug)
      order by x.company_id,x.id for share of x loop
    perform 1 from public.customer_contacts where company_id=v_candidate.company_id and customer_id=v_candidate.id order by id for share;
    perform 1 from public.customer_sites where company_id=v_candidate.company_id and customer_id=v_candidate.id order by id for share;
    perform 1 from public.metering_points p where p.site_id in
      (select id from public.customer_sites where company_id=v_candidate.company_id and customer_id=v_candidate.id)
      or p.customer_site_id in (select id from public.customer_sites where company_id=v_candidate.company_id and customer_id=v_candidate.id)
      order by p.id for share;
    v_email_ok := lower(btrim(v_candidate.email))=v_email->>'email' or exists
      (select 1 from public.customer_contacts where company_id=v_candidate.company_id and customer_id=v_candidate.id and lower(btrim(email))=v_email->>'email');
    select array_agg(n) into v_names from (
      select concat_ws(' ',v_candidate.first_name,v_candidate.last_name) n union all select v_candidate.full_name
      union all select v_candidate.company_name union all select name from public.customer_contacts
      where company_id=v_candidate.company_id and customer_id=v_candidate.id) names;
    v_name_ok := false;
    foreach v_name in array v_names loop
      v_name := private.gridex_account_completion_name_v1(v_name);
      if v_name=v_full_name or (v_first<>'' and v_last<>'' and strpos(v_name,v_first)>0 and strpos(v_name,v_last)>0) then v_name_ok:=true; end if;
    end loop;
    v_install_ok := false;
    if coalesce(v_email_ok,false) and v_name_ok then
      for v_candidate_site in select * from public.customer_sites where company_id=v_candidate.company_id and customer_id=v_candidate.id order by id loop
        if btrim(v_candidate_site.facility_id)=any(v_install_variants) then v_install_ok:=true; end if;
        for v_candidate_point in select * from public.metering_points p where
          (p.site_id=v_candidate_site.id or p.customer_site_id=v_candidate_site.id) and
          (p.meter_point_id=any(v_install_variants) or p.metering_point_id=any(v_install_variants)) order by id loop
          if v_candidate_point.company_id is distinct from v_candidate.company_id or
             (v_candidate_point.customer_id is not null and v_candidate_point.customer_id<>v_candidate.id) or
             (v_candidate_point.site_id is not null and v_candidate_point.site_id<>v_candidate_site.id) or
             (v_candidate_point.customer_site_id is not null and v_candidate_point.customer_site_id<>v_candidate_site.id) then
            raise exception 'portal_completion_point_alias_conflict' using errcode='PT409';
          end if;
          v_install_ok:=true;
        end loop;
      end loop;
    end if;
    if coalesce(v_email_ok,false) and v_name_ok and v_install_ok then
      v_matches:=v_matches+1;
      if v_candidate.id=v_customer and v_candidate.company_id=v_company then v_customer_row:=v_candidate; end if;
    end if;
  end loop;
  if v_matches<>1 or v_customer_row.id is null then raise exception 'portal_completion_match_changed' using errcode='PT409'; end if;
  -- Capture all candidate matching facts, including absent/new children, so a
  -- late insertion outside this command cannot be silently accepted on replay.

  if v_customer_row.status='archived' or v_customer_row.archived_at is not null then raise exception 'portal_completion_customer_archived' using errcode='PT409'; end if;
  v_site_id := (v_source->'site'->>'id')::uuid;
  select * into v_site from public.customer_sites where id=v_site_id and company_id=v_company and customer_id=v_customer;
  if not found or v_site.archived_at is not null then raise exception 'portal_completion_site_changed' using errcode='PT409'; end if;
  v_point_id := (v_source->'point'->>'id')::uuid;
  if v_point_id is not null then
    select * into v_point from public.metering_points where id=v_point_id;
    if not found or v_point.company_id is distinct from v_company or
       (v_point.customer_id is not null and v_point.customer_id<>v_customer) or
       (v_point.site_id is not null and v_point.site_id<>v_site_id) or
       (v_point.customer_site_id is not null and v_point.customer_site_id<>v_site_id) or
       (v_point.site_id is null and v_point.customer_site_id is null) or
       not (coalesce(v_point.meter_point_id=any(v_install_variants),false) or coalesce(v_point.metering_point_id=any(v_install_variants),false)) or
       (v_source->'point'->>'updatedAt')::timestamptz is distinct from v_point.updated_at then
      raise exception 'portal_completion_point_changed' using errcode='PT409';
    end if;
  elsif not coalesce(btrim(v_site.facility_id)=any(v_install_variants),false) then
    raise exception 'portal_completion_installation_changed' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'customerId',customer_id,'name',name,'email',email) order by id),'[]')
    into v_contacts from public.customer_contacts where company_id=v_company and customer_id=v_customer;
  v_current_source:=jsonb_build_object('customer',jsonb_build_object('id',v_customer_row.id,'companyId',v_customer_row.company_id,
    'customerType',v_customer_row.customer_type,'firstName',v_customer_row.first_name,'lastName',v_customer_row.last_name,'fullName',v_customer_row.full_name,
    'companyName',v_customer_row.company_name,'email',v_customer_row.email,'personalNumber',v_customer_row.personal_number,'customerNumber',v_customer_row.customer_number,
    'profileRevision',v_customer_row.profile_revision::text,'contactRevision',v_customer_row.contact_revision::text),'contacts',v_contacts,
    'site',jsonb_build_object('id',v_site.id,'companyId',v_site.company_id,'customerId',v_site.customer_id,'facilityId',v_site.facility_id,'siteRevision',v_site.site_revision::text,'addressRevision',v_site.address_revision::text),
    'point',case when v_point_id is null then 'null'::jsonb else jsonb_build_object('id',v_point.id,'companyId',v_point.company_id,'customerId',v_point.customer_id,
      'siteId',v_point.site_id,'customerSiteId',v_point.customer_site_id,'meterPointId',v_point.meter_point_id,'meteringPointId',v_point.metering_point_id,'updatedAt',v_source->'point'->>'updatedAt') end);
  if v_source is distinct from v_current_source then raise exception 'portal_completion_source_changed' using errcode='PT409'; end if;
  v_source_hash:=public.canonical_json_sha256(v_current_source);
  v_request_hash:=public.canonical_json_sha256(jsonb_build_object('companyId',v_company,'customerId',v_customer,'userId',v_user,'authEmail',v_email->>'email','input',v_input,'sourceHash',v_source_hash));
  select count(*) into v_account_count from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer and (user_id=v_user or portal_user_id=v_user);
  if v_account_count>1 then raise exception 'portal_completion_account_ambiguous' using errcode='PT409'; end if;
  select * into v_receipt from private.customer_portal_account_completion_receipts where company_id=v_company and customer_id=v_customer and user_id=v_user;
  if v_account_count=1 then
    select * into v_account from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer and (user_id=v_user or portal_user_id=v_user) for update;
    if v_account.user_id is distinct from v_user or v_account.status<>'active' or v_account.is_active is distinct from true or v_account.role not in ('owner','billing','viewer') then
      raise exception 'portal_completion_saved_account_held' using errcode='PT409';
    end if;
    v_status:='existing';
    if v_receipt.id is not null then
      v_account_hash:=public.canonical_json_sha256(jsonb_build_object('id',v_account.id,'companyId',v_account.company_id,'customerId',v_account.customer_id,'userId',v_account.user_id,'portalUserId',v_account.portal_user_id,'externalAccountId',v_account.external_account_id,'status',v_account.status,'isActive',v_account.is_active,'verifiedAt',v_account.verified_at,'matchMethod',v_account.match_method,'verifiedIdentitySnapshot',v_account.verified_identity_snapshot));
      select * into v_claim from public.customer_portal_claims where id=v_receipt.claim_id for share;
      select * into v_event from public.customer_portal_events where id=v_receipt.event_id for share;
      if v_receipt.account_id<>v_account.id or v_receipt.request_hash<>v_request_hash or v_receipt.source_hash<>v_source_hash or
         v_receipt.account_binding_hash<>v_account_hash or v_claim.id is null or v_event.id is null or
         v_claim.company_id is distinct from v_company or v_claim.customer_id is distinct from v_customer or v_claim.user_id is distinct from v_user or v_claim.status<>'approved' or
         v_event.company_id is distinct from v_company or v_event.customer_id is distinct from v_customer or v_event.user_id is distinct from v_user or v_event.event_type<>'portal_account_verified' or
         v_receipt.claim_hash<>public.canonical_json_sha256(to_jsonb(v_claim)) or v_receipt.event_hash<>public.canonical_json_sha256(to_jsonb(v_event)) then
        raise exception 'portal_completion_receipt_changed' using errcode='PT409';
      end if;
      v_status:='replayed';
    end if;
  else
    if v_receipt.id is not null then raise exception 'portal_completion_deleted_graph_held' using errcode='PT409'; end if;
    v_now:=clock_timestamp();
    v_metadata:=jsonb_build_object('schemaVersion',1,'source','native_account_completion_reconstructed_v1','user_email',v_email->>'email','match_method','self_claim_strict_identity','personal_number_last4',right(v_digits,4),
      'email_matched',true,'name_matched',true,'personal_number_matched',true,'installation_matched',true,'matched_site_id',v_site_id,'matched_metering_point_id',v_point_id,
      'failure_reason',null,'input_snapshot',jsonb_build_object('email',v_email->>'email','firstName',v_input->>'firstName','lastName',v_input->>'lastName','fullName',v_input->>'fullName',
      'personalNumberLast4',right(v_digits,4),'installationId',v_input->>'installationId','companySlug',nullif(v_slug,'')),
      'match_snapshot',jsonb_build_object('customerId',v_customer,'customerNumber',v_customer_row.customer_number,'emailMatched',true,'nameMatched',true,'personalNumberMatched',true,
      'installationMatched',true,'matchedSiteId',v_site_id,'matchedMeteringPointId',v_point_id),'reviewed_at',v_now);
    v_verification:=(v_metadata->'match_snapshot')||jsonb_build_object('inputName',coalesce(nullif(btrim(v_input->>'fullName'),''),concat_ws(' ',nullif(btrim(v_input->>'firstName'),''),nullif(btrim(v_input->>'lastName'),''))),
      'inputInstallationId',v_input->>'installationId','personalNumberLast4',right(v_digits,4),'userEmail',v_email->>'email');
    v_event_payload:=jsonb_build_object('message','Kundkonto verifierat och kopplat genom strikt identitetsmatchning.');
    v_event_metadata:=jsonb_build_object('userEmail',v_email->>'email','matchMethod','self_claim_strict_identity','matchedSiteId',v_site_id,'matchedMeteringPointId',v_point_id);
    begin
    insert into public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,customer_number,user_email,email,role,status,is_active,activated_at,verified_at,match_method,verified_identity_snapshot)
      values(v_company,v_customer,v_user,null,v_customer_row.customer_number,v_email->>'email',v_email->>'email','owner','active',true,v_now,v_now,'self_claim_strict_identity',v_verification) returning * into v_account;
    exception when unique_violation then
      -- Only an actual INSERT 23505 permits current-row readback. A competing
      -- legacy writer is not a new approved completion or an owner promotion.
      select count(*) into v_account_count from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer and (user_id=v_user or portal_user_id=v_user);
      if v_account_count<>1 then raise exception 'portal_completion_account_collision_held' using errcode='PT409'; end if;
      select * into v_account from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer and (user_id=v_user or portal_user_id=v_user) for update;
      if v_account.user_id is distinct from v_user or v_account.status<>'active' or v_account.is_active is distinct from true or v_account.role not in ('owner','billing','viewer') then
        raise exception 'portal_completion_account_collision_held' using errcode='PT409';
      end if;
      v_status:='existing';
    end;
    if v_status is distinct from 'existing' then
    insert into public.customer_portal_claims(company_id,customer_id,user_id,claim_type,status,claimed_at,metadata)
      values(v_company,v_customer,v_user,'customer_access','approved',v_now,v_metadata) returning * into v_claim;
    insert into public.customer_portal_events(company_id,customer_id,user_id,event_type,payload,metadata)
      values(v_company,v_customer,v_user,'portal_account_verified',v_event_payload,v_event_metadata) returning * into v_event;
    v_account_hash:=public.canonical_json_sha256(jsonb_build_object('id',v_account.id,'companyId',v_account.company_id,'customerId',v_account.customer_id,'userId',v_account.user_id,'portalUserId',v_account.portal_user_id,'externalAccountId',v_account.external_account_id,'status',v_account.status,'isActive',v_account.is_active,'verifiedAt',v_account.verified_at,'matchMethod',v_account.match_method,'verifiedIdentitySnapshot',v_account.verified_identity_snapshot));
    insert into private.customer_portal_account_completion_receipts(company_id,customer_id,user_id,account_id,claim_id,event_id,creating_session_id,request_hash,source_hash,account_binding_hash,claim_hash,event_hash)
      values(v_company,v_customer,v_user,v_account.id,v_claim.id,v_event.id,v_session,v_request_hash,v_source_hash,v_account_hash,public.canonical_json_sha256(to_jsonb(v_claim)),public.canonical_json_sha256(to_jsonb(v_event))) returning * into v_receipt;
    v_status:='created';
    end if;
  end if;
  select count(*) into v_account_count from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer and (user_id=v_user or portal_user_id=v_user);
  select * into v_final_account from public.customer_portal_accounts where id=v_account.id for share;
  if v_account_count<>1 or v_final_account.id is null or v_final_account.company_id is distinct from v_company or v_final_account.customer_id is distinct from v_customer or
     v_final_account.user_id is distinct from v_user or v_final_account.status<>'active' or v_final_account.is_active is distinct from true or
     v_final_account.role is distinct from v_account.role or v_final_account.role not in ('owner','billing','viewer') or (v_status='created' and v_final_account.role<>'owner') or
     public.canonical_json_sha256(to_jsonb(v_final_account))<>public.canonical_json_sha256(to_jsonb(v_account)) then
    raise exception 'portal_completion_final_account_changed' using errcode='PT409';
  end if;
  if v_status<>'existing' then
    select * into v_final_claim from public.customer_portal_claims where id=v_claim.id for share;
    select * into v_final_event from public.customer_portal_events where id=v_event.id for share;
    if (v_status='created' and (v_final_account.portal_user_id is not null or v_final_account.external_account_id is not null or
       v_final_account.user_email is distinct from v_email->>'email' or v_final_account.email is distinct from v_email->>'email' or
       v_final_account.match_method is distinct from 'self_claim_strict_identity' or v_final_account.activated_at is distinct from v_now or v_final_account.verified_at is distinct from v_now or
       v_final_account.customer_number is distinct from v_customer_row.customer_number or v_final_account.verified_identity_snapshot is distinct from v_verification or
       v_final_claim.metadata is distinct from v_metadata or v_final_claim.claim_type is distinct from 'customer_access' or v_final_claim.claimed_at is distinct from v_now or
       v_final_event.payload is distinct from v_event_payload or v_final_event.metadata is distinct from v_event_metadata)) or
       v_receipt.company_id is distinct from v_company or v_receipt.customer_id is distinct from v_customer or v_receipt.user_id is distinct from v_user or
       v_receipt.account_id is distinct from v_account.id or v_receipt.claim_id is distinct from v_claim.id or v_receipt.event_id is distinct from v_event.id or
       (v_status='created' and v_receipt.creating_session_id is distinct from v_session) or
       v_receipt.request_hash is distinct from v_request_hash or v_receipt.source_hash is distinct from v_source_hash or v_receipt.account_binding_hash is distinct from v_account_hash or
       v_final_claim.id is null or v_final_event.id is null or
       v_final_claim.company_id is distinct from v_company or v_final_claim.customer_id is distinct from v_customer or v_final_claim.user_id is distinct from v_user or v_final_claim.status<>'approved' or
       v_final_event.company_id is distinct from v_company or v_final_event.customer_id is distinct from v_customer or v_final_event.user_id is distinct from v_user or v_final_event.event_type<>'portal_account_verified' or
       v_receipt.claim_hash<>public.canonical_json_sha256(to_jsonb(v_final_claim)) or
       v_receipt.event_hash<>public.canonical_json_sha256(to_jsonb(v_final_event)) then
      raise exception 'portal_completion_final_receipt_changed' using errcode='PT409';
    end if;
  end if;
  -- Repeat complete candidate facts after the final potentially waiting write.
  v_final_candidate_hash:=private.gridex_account_completion_candidate_hash_v1(v_pn_variants,v_slug);
  if v_final_candidate_hash is distinct from v_candidate_hash then raise exception 'portal_completion_source_changed' using errcode='PT409'; end if;
  if not private.gridex_support_session_active_v1(v_user,v_session) then raise exception 'portal_completion_current_session_required' using errcode='42501'; end if;
  v_final_email:=private.gridex_invoice_redelivery_auth_email_v1(v_user);
  if v_final_email is distinct from v_email then raise exception 'portal_completion_current_email_required' using errcode='42501'; end if;
  return jsonb_build_object('status',v_status,'companyId',v_company,'customerId',v_customer,'userId',v_user,'accountId',v_account.id,'role',v_account.role,
    'receiptId',case when v_status='existing' then null else v_receipt.id end,'claimId',case when v_status='existing' then null else v_receipt.claim_id end,'eventId',case when v_status='existing' then null else v_receipt.event_id end);
end;
$completion$;
revoke all on function public.gridex_complete_customer_portal_account_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.gridex_complete_customer_portal_account_v1(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
