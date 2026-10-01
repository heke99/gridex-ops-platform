-- Private authenticated scan evidence only. Public files remain quarantined;
-- a clean attestation never qualifies a provider or authorizes a download.
begin;
create table private.support_attachment_scanner_roots(
  company_id uuid not null references public.companies(id),
  issuer_hash text not null check(issuer_hash~'^[0-9a-f]{64}$'),
  subject_hash text not null check(subject_hash~'^[0-9a-f]{64}$'),
  key_hash text not null check(key_hash~'^[0-9a-f]{64}$'),
  status text not null default 'active' check(status in ('active','revoked')),
  valid_until timestamptz,
  primary key(company_id,issuer_hash,subject_hash,key_hash)
);
create table private.support_attachment_scan_challenges(
  nonce_id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.customer_support_attachments(id),
  company_id uuid not null references public.companies(id),
  binding jsonb not null check(jsonb_typeof(binding)='object'),
  issued_at bigint not null,expires_at bigint not null check(expires_at>issued_at and expires_at-issued_at<=300),
  consumed_at timestamptz
);
create index support_attachment_scan_challenges_lookup_idx on private.support_attachment_scan_challenges(attachment_id,issued_at desc);
create table private.support_attachment_scan_receipts(
  nonce_id uuid primary key references private.support_attachment_scan_challenges(nonce_id),
  attachment_id uuid not null references public.customer_support_attachments(id),
  company_id uuid not null references public.companies(id),
  verdict text not null check(verdict in ('clean','malicious','unknown')),
  proof_hash text not null check(proof_hash~'^[0-9a-f]{64}$'),
  proof jsonb not null,binding jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.support_attachment_scanner_roots enable row level security;
alter table private.support_attachment_scan_challenges enable row level security;
alter table private.support_attachment_scan_receipts enable row level security;
revoke all on private.support_attachment_scanner_roots,private.support_attachment_scan_challenges,private.support_attachment_scan_receipts from public,anon,authenticated;
grant select on private.support_attachment_scanner_roots to service_role;
grant select,insert,update on private.support_attachment_scan_challenges to service_role;
grant select,insert on private.support_attachment_scan_receipts to service_role;
create function private.gridex_support_scan_evidence_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='support_attachment_scanner_roots' then
    if (to_jsonb(new)-array['status','valid_until']) is distinct from (to_jsonb(old)-array['status','valid_until']) then
      raise exception 'scanner_root_identity_immutable' using errcode='55000'; end if;
    return new;
  elsif tg_table_name='support_attachment_scan_challenges' and tg_op='UPDATE' then
    if (to_jsonb(new)-'consumed_at') is distinct from (to_jsonb(old)-'consumed_at')
      or old.consumed_at is not null or new.consumed_at is null then
      raise exception 'scanner_challenge_immutable' using errcode='55000'; end if;
    return new;
  end if;
  raise exception 'scanner_receipt_immutable' using errcode='55000';
end;
$$;
revoke all on function private.gridex_support_scan_evidence_guard_v1() from public,anon,authenticated;
create trigger support_attachment_scanner_root_identity_guard before update on private.support_attachment_scanner_roots
  for each row execute function private.gridex_support_scan_evidence_guard_v1();
create trigger support_attachment_scan_challenge_guard before update or delete on private.support_attachment_scan_challenges
  for each row execute function private.gridex_support_scan_evidence_guard_v1();
create trigger support_attachment_scan_receipt_guard before update or delete on private.support_attachment_scan_receipts
  for each row execute function private.gridex_support_scan_evidence_guard_v1();

create function private.gridex_support_scanner_root_v1(p_company uuid,p_trust jsonb)
returns private.support_attachment_scanner_roots language plpgsql security definer set search_path=pg_catalog as $$
declare v_root private.support_attachment_scanner_roots%rowtype;
begin
  -- Narrow owner read/lock avoids granting UPDATE on the platform trust root
  -- merely to satisfy FOR SHARE. EXECUTE is service-only; outer commands also
  -- require current_user=service_role. This helper cannot configure a root.
  if jsonb_typeof(p_trust) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_trust))<>3
    or exists(select 1 from jsonb_object_keys(p_trust) k where k not in ('issuerHash','subjectHash','keyHash'))
    or coalesce(p_trust->>'issuerHash','')!~'^[0-9a-f]{64}$' or coalesce(p_trust->>'subjectHash','')!~'^[0-9a-f]{64}$'
    or coalesce(p_trust->>'keyHash','')!~'^[0-9a-f]{64}$' then
    raise exception 'invalid_support_scan' using errcode='22023'; end if;
  select * into v_root from private.support_attachment_scanner_roots where company_id=p_company
    and issuer_hash=p_trust->>'issuerHash' and subject_hash=p_trust->>'subjectHash' and key_hash=p_trust->>'keyHash'
    and status='active' and (valid_until is null or valid_until>clock_timestamp()) for share;
  if not found then raise exception 'support_scanner_unavailable' using errcode='42501'; end if;
  return v_root;
end;
$$;
revoke all on function private.gridex_support_scanner_root_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.gridex_support_scanner_root_v1(uuid,jsonb) to service_role;

create function private.gridex_support_scan_lineage_v1(p_company uuid,p_attachment uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.customer_support_attachments%rowtype;c public.canonical_command_results%rowtype;
  o public.canonical_event_outbox%rowtype;s storage.objects%rowtype;d public.canonical_domain_events%rowtype;
  v_customer uuid;v_case uuid;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  perform 1 from public.companies where id=p_company and is_active and status='active' for share;
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  select * into a from public.customer_support_attachments where company_id=p_company and id=p_attachment
    and uploaded_at is not null and revision is not null and scan_status='quarantined';
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  v_customer:=a.customer_id;v_case:=a.customer_case_id;
  -- Match intake's parent -> case -> attachment lock order. The first read is
  -- only a locator; reselect and bind the actual row after its parent locks.
  perform 1 from public.customers where id=v_customer and company_id=p_company and archived_at is null and status<>'archived' for share;
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  perform 1 from public.customer_cases where id=v_case and company_id=p_company and customer_id=v_customer for share;
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  select * into a from public.customer_support_attachments where company_id=p_company and id=p_attachment
    and customer_id=v_customer and customer_case_id=v_case and uploaded_at is not null
    and revision is not null and scan_status='quarantined' for share;
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  select * into c from public.canonical_command_results where company_id=p_company and command_type='customer.support.attachment.v1'
    and idempotency_key=a.intake_key and request_hash=a.request_hash for share;
  if not found or c.request_payload->>'customerId' is distinct from a.customer_id::text
    or c.request_payload->>'caseId' is distinct from a.customer_case_id::text
    or c.request_payload->>'mode' is distinct from a.channel
    or c.request_payload->>'actorUserId' is distinct from a.actor_user_id::text
    or c.request_payload->>'clientId' is distinct from a.api_client_id::text
    or c.actor_user_id is distinct from a.actor_user_id
    or c.request_payload->>'sha256' is distinct from a.content_sha256 or c.request_payload->>'byteSize' is distinct from a.byte_size::text
    or c.request_payload->>'visibility' is distinct from a.visibility or c.request_payload->>'fileName' is distinct from a.file_name
    or c.request_payload->>'mediaType' is distinct from a.media_type
    or c.result_payload->>'attachmentId' is distinct from a.id::text or c.result_payload->>'objectKey' is distinct from a.object_key
    or c.result_payload->>'companyId' is distinct from a.company_id::text
    or c.result_payload->>'customerId' is distinct from a.customer_id::text
    or c.result_payload->>'caseId' is distinct from a.customer_case_id::text
    or c.result_payload->>'scanStatus' is distinct from 'quarantined'
    or c.result_payload->>'phase' is distinct from 'stored' or c.result_payload->>'revision' is distinct from a.revision::text then
    raise exception 'support_scan_lineage_changed' using errcode='23503'; end if;
  select * into o from public.canonical_event_outbox where company_id=p_company and topic='customer.support.attachment.scan_requested'
    and idempotency_key=a.intake_key for share;
  if not found or o.payload is distinct from jsonb_build_object('customerId',a.customer_id,'caseId',a.customer_case_id,
    'attachmentId',a.id,'bucket',a.storage_bucket,'objectKey',a.object_key,'sha256',a.content_sha256,'visibility',a.visibility) then
    raise exception 'support_scan_lineage_changed' using errcode='23503'; end if;
  select * into d from public.canonical_domain_events where id=o.domain_event_id and company_id=p_company
    and event_type='CUSTOMER_SUPPORT_ATTACHMENT_QUARANTINED' and aggregate_type='customer_case' and aggregate_id=a.customer_case_id
    and aggregate_version=a.revision and idempotency_key=a.intake_key for share;
  if not found or d.created_by is distinct from a.actor_user_id
    or d.payload is distinct from jsonb_build_object('customerId',a.customer_id,'caseId',a.customer_case_id,'attachmentId',a.id) then
    raise exception 'support_scan_lineage_changed' using errcode='23503'; end if;
  select * into s from storage.objects where bucket_id=a.storage_bucket and name=a.object_key for share;
  if not found or s.metadata->>'size' is distinct from a.byte_size::text then
    raise exception 'support_scan_object_changed' using errcode='23503'; end if;
  return jsonb_build_object('companyId',p_company,'customerId',a.customer_id,'caseId',a.customer_case_id,'attachmentId',a.id,
    'scanIntentId',o.id,'reservationHash',a.request_hash,'revision',a.revision,
    'bucket',a.storage_bucket,'objectKey',a.object_key,'sha256',a.content_sha256,'byteSize',a.byte_size,
    'objectId',s.id,'objectVersion',to_jsonb(s)->'version','objectUpdatedAt',to_jsonb(s)->'updated_at');
end;
$$;
revoke all on function private.gridex_support_scan_lineage_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function private.gridex_support_scan_lineage_v1(uuid,uuid) to service_role;

create function public.gridex_reserve_support_attachment_scan_v1(p_company_id uuid,p_attachment_id uuid,p_trust jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_lineage jsonb;v_root private.support_attachment_scanner_roots%rowtype;
  v_challenge private.support_attachment_scan_challenges%rowtype;v_nonce uuid:=gen_random_uuid();v_now bigint;
begin
  v_lineage:=private.gridex_support_scan_lineage_v1(p_company_id,p_attachment_id);
  v_root:=private.gridex_support_scanner_root_v1(p_company_id,p_trust);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':scan:'||p_attachment_id::text,0));
  v_now:=floor(extract(epoch from clock_timestamp()))::bigint;
  select * into v_challenge from private.support_attachment_scan_challenges where company_id=p_company_id
    and attachment_id=p_attachment_id and consumed_at is null and expires_at>v_now
    and binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash']=v_lineage
    and binding->>'issuerHash'=v_root.issuer_hash and binding->>'subjectHash'=v_root.subject_hash and binding->>'keyHash'=v_root.key_hash
    order by issued_at desc,nonce_id limit 1 for update;
  v_now:=floor(extract(epoch from clock_timestamp()))::bigint;
  if v_root.valid_until is not null and v_root.valid_until<=clock_timestamp() then
    raise exception 'support_scanner_unavailable' using errcode='42501'; end if;
  if found and v_challenge.expires_at>v_now then return v_challenge.binding; end if;
  v_lineage:=v_lineage||jsonb_build_object('nonceId',v_nonce,'issuedAt',v_now,'expiresAt',v_now+300,
    'issuerHash',v_root.issuer_hash,'subjectHash',v_root.subject_hash,'keyHash',v_root.key_hash);
  insert into private.support_attachment_scan_challenges(nonce_id,attachment_id,company_id,binding,issued_at,expires_at)
    values(v_nonce,p_attachment_id,p_company_id,v_lineage,v_now,v_now+300);
  if v_root.valid_until is not null and v_root.valid_until<=clock_timestamp() then
    raise exception 'support_scanner_unavailable' using errcode='42501'; end if;
  if v_now+300<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_scan_proof_expired' using errcode='42501'; end if;
  return v_lineage;
end;
$$;
revoke all on function public.gridex_reserve_support_attachment_scan_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_reserve_support_attachment_scan_v1(uuid,uuid,jsonb) to service_role;

create function public.gridex_record_support_attachment_scan_v1(p_nonce_id uuid,p_proof jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare ch private.support_attachment_scan_challenges%rowtype;r private.support_attachment_scan_receipts%rowtype;
  root private.support_attachment_scanner_roots%rowtype;lineage jsonb;proof_hash text;v_now bigint;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  if jsonb_typeof(p_proof) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_proof))<>11
    or exists(select 1 from jsonb_object_keys(p_proof) k where k not in
      ('issuerHash','subjectHash','keyHash','nonceHash','issuedAt','expiresAt','bindingJson','requestHash','verdict','physicalSha256','physicalByteSize'))
    or coalesce(p_proof->>'verdict','') not in ('clean','malicious','unknown')
    or coalesce(p_proof->>'requestHash','')!~'^[0-9a-f]{64}$'
    or coalesce(p_proof->>'nonceHash','')!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_proof->'issuedAt') is distinct from 'number' or coalesce(p_proof->>'issuedAt','')!~'^[0-9]{1,12}$'
    or jsonb_typeof(p_proof->'expiresAt') is distinct from 'number' or coalesce(p_proof->>'expiresAt','')!~'^[0-9]{1,12}$'
    or jsonb_typeof(p_proof->'physicalByteSize') is distinct from 'number'
    or coalesce(p_proof->>'physicalByteSize','')!~'^[1-9][0-9]{0,6}$'
    or p_proof->>'bindingJson' is null or length(p_proof->>'bindingJson')>8192 then
    raise exception 'invalid_support_scan' using errcode='22023'; end if;
  select * into ch from private.support_attachment_scan_challenges where nonce_id=p_nonce_id;
  if not found then raise exception 'support_scan_nonce_unavailable' using errcode='42501'; end if;
  -- Consistent lock order: current lineage -> current root -> challenge.
  lineage:=private.gridex_support_scan_lineage_v1(ch.company_id,ch.attachment_id);
  root:=private.gridex_support_scanner_root_v1(ch.company_id,jsonb_build_object('issuerHash',p_proof->>'issuerHash',
    'subjectHash',p_proof->>'subjectHash','keyHash',p_proof->>'keyHash'));
  select * into ch from private.support_attachment_scan_challenges where nonce_id=p_nonce_id for update;
  if ch.binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash'] is distinct from lineage
    or ch.binding->>'issuerHash' is distinct from root.issuer_hash or ch.binding->>'subjectHash' is distinct from root.subject_hash
    or ch.binding->>'keyHash' is distinct from root.key_hash or (p_proof->>'bindingJson')::jsonb is distinct from ch.binding
    or encode(extensions.digest(p_proof->>'bindingJson','sha256'),'hex') is distinct from p_proof->>'requestHash'
    or encode(extensions.digest(ch.nonce_id::text,'sha256'),'hex') is distinct from p_proof->>'nonceHash'
    or p_proof->>'physicalSha256' is distinct from lineage->>'sha256'
    or p_proof->>'physicalByteSize' is distinct from lineage->>'byteSize' then
    raise exception 'support_scan_binding_conflict' using errcode='23505'; end if;
  v_now:=floor(extract(epoch from clock_timestamp()))::bigint;
  if (p_proof->>'issuedAt')::bigint<ch.issued_at or (p_proof->>'issuedAt')::bigint>v_now
    or (p_proof->>'expiresAt')::bigint>ch.expires_at or (p_proof->>'expiresAt')::bigint<=(p_proof->>'issuedAt')::bigint
    or (p_proof->>'expiresAt')::bigint<=v_now or ch.expires_at<=v_now
    or (root.valid_until is not null and root.valid_until<=clock_timestamp()) then
    raise exception 'support_scan_proof_expired' using errcode='42501'; end if;
  proof_hash:=public.canonical_json_sha256(p_proof);
  select * into r from private.support_attachment_scan_receipts where nonce_id=p_nonce_id;
  if found then
    if r.proof_hash is distinct from proof_hash then raise exception 'support_scan_binding_conflict' using errcode='23505'; end if;
    return jsonb_build_object('nonceId',p_nonce_id,'attachmentId',ch.attachment_id,'verdict',r.verdict,
      'outcome','blocked_provider_qualification','releaseAllowed',false,'replayed',true);
  end if;
  if ch.consumed_at is not null then raise exception 'support_scan_nonce_unavailable' using errcode='42501'; end if;
  insert into private.support_attachment_scan_receipts(nonce_id,attachment_id,company_id,verdict,proof_hash,proof,binding)
    values(p_nonce_id,ch.attachment_id,ch.company_id,p_proof->>'verdict',proof_hash,p_proof,ch.binding);
  update private.support_attachment_scan_challenges set consumed_at=clock_timestamp() where nonce_id=p_nonce_id;
  if (p_proof->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp()))::bigint
    or (root.valid_until is not null and root.valid_until<=clock_timestamp()) then
    raise exception 'support_scan_proof_expired' using errcode='42501'; end if;
  return jsonb_build_object('nonceId',p_nonce_id,'attachmentId',ch.attachment_id,'verdict',p_proof->>'verdict',
    'outcome','blocked_provider_qualification','releaseAllowed',false,'replayed',false);
end;
$$;
revoke all on function public.gridex_record_support_attachment_scan_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_record_support_attachment_scan_v1(uuid,jsonb) to service_role;

create function public.gridex_assess_support_attachment_scan_v1(p_context jsonb,p_attachment_id uuid,p_trust jsonb,p_witness jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare lineage jsonb;root private.support_attachment_scanner_roots%rowtype;r private.support_attachment_scan_receipts%rowtype;
  a public.customer_support_attachments%rowtype;c public.customer_cases%rowtype;selector jsonb;v_reference text;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  if jsonb_typeof(p_context) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_context) k
    where k not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject')) then
    raise exception 'invalid_support_scan' using errcode='22023'; end if;
  if not private.gridex_support_actor_v1(p_context,false) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  select * into a from public.customer_support_attachments where id=p_attachment_id and company_id=(p_context->>'companyId')::uuid
    and customer_id=(p_context->>'customerId')::uuid and (p_context->>'mode'='ops' or visibility='customer');
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  if p_context->>'mode'='ops' then selector:=jsonb_build_object('caseId',a.customer_case_id);
  else
    select public_reference into v_reference from public.customer_support_threads where id=a.customer_case_id
      and company_id=a.company_id and customer_id=a.customer_id;
    selector:=jsonb_build_object('caseReference',v_reference);
  end if;
  c:=private.gridex_support_attachment_case_v1(p_context,selector,p_context->>'mode'<>'ops');
  lineage:=private.gridex_support_scan_lineage_v1(a.company_id,a.id);
  perform 1 from public.customer_support_attachments where id=p_attachment_id and company_id=(p_context->>'companyId')::uuid
    and customer_id=(p_context->>'customerId')::uuid and customer_case_id=c.id
    and (p_context->>'mode'='ops' or visibility='customer') for share;
  if not found or lineage->>'caseId' is distinct from c.id::text then
    raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  root:=private.gridex_support_scanner_root_v1(a.company_id,p_trust);
  if p_witness is not null and p_witness is distinct from jsonb_build_object('objectId',lineage->'objectId',
    'objectVersion',lineage->'objectVersion','objectUpdatedAt',lineage->'objectUpdatedAt','sha256',lineage->'sha256','byteSize',lineage->'byteSize') then
    raise exception 'support_scan_object_changed' using errcode='23503'; end if;
  select * into r from private.support_attachment_scan_receipts where company_id=a.company_id and attachment_id=a.id
    and binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash']=lineage
    and binding->>'issuerHash'=root.issuer_hash and binding->>'subjectHash'=root.subject_hash and binding->>'keyHash'=root.key_hash
    order by recorded_at desc,nonce_id limit 1;
  if not private.gridex_support_clock_active_v1(p_context)
    or (root.valid_until is not null and root.valid_until<=clock_timestamp()) then
    raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  return jsonb_build_object('binding',lineage,'verdict',r.verdict,'releaseAllowed',false,'quarantine','quarantined',
    'physicalHashVerified',p_witness is not null,'outcome',case when r.nonce_id is null then 'blocked_unscanned'
      when r.verdict<>'clean' then 'blocked_scan_verdict' else 'blocked_provider_qualification' end);
end;
$$;
revoke all on function public.gridex_assess_support_attachment_scan_v1(jsonb,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_assess_support_attachment_scan_v1(jsonb,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
