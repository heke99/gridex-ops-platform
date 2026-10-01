-- CLI-created forward-only support contact verification boundary. No issuer,
-- risk policy, caller account, billing mandate or provider is provisioned.
begin;
set local lock_timeout='10s';

-- Keep spent nonces after actor/session/customer removal. This unexposed
-- append-only ledger stores hashes and historical IDs, never JWTs or contact
-- values. Ownership is checked against current canonical rows by the command.
create table private.gridex_support_sensitive_consumptions (
  issuer_hash text not null check(issuer_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null check(nonce_hash ~ '^[0-9a-f]{64}$'),
  subject_hash text not null check(subject_hash ~ '^[0-9a-f]{64}$'),
  company_id uuid not null,
  customer_id uuid not null,
  customer_case_id uuid not null,
  actor_user_id uuid not null,
  session_id uuid not null,
  action text not null check(action='customer.support.contact.change.v1'),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp(),
  primary key(issuer_hash,nonce_hash),
  check(expires_at>issued_at and expires_at<=issued_at+interval '5 minutes')
);
create index gridex_support_sensitive_consumptions_owner_idx on private.gridex_support_sensitive_consumptions(company_id,customer_id,customer_case_id);
alter table private.gridex_support_sensitive_consumptions enable row level security;
revoke all on private.gridex_support_sensitive_consumptions from public,anon,authenticated,service_role;
grant select,insert on private.gridex_support_sensitive_consumptions to service_role;

create function public.gridex_support_sensitive_contact_v1(p_command jsonb,p_proof jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $f$
declare
  v_company uuid; v_customer uuid; v_case uuid; v_actor uuid; v_session uuid;
  v_case_revision bigint; v_contact_revision bigint; v_contact uuid;
  v_context jsonb; v_binding jsonb; v_result jsonb; v_case_row public.customer_cases%rowtype;
  v_issued timestamptz; v_expires timestamptz; v_key text;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' or
    exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','caseId','actorUserId','sessionId','expectedCaseRevision','expectedContactRevision','idempotencyKey','reason','changes','bindingJson')) or
    exists(select 1 from unnest(array['companyId','customerId','caseId','actorUserId','sessionId']) k where
      jsonb_typeof(p_command->k) is distinct from 'string' or coalesce(p_command->>k,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') or
    exists(select 1 from unnest(array['expectedCaseRevision','expectedContactRevision']) k where
      jsonb_typeof(p_command->k) is distinct from 'number' or coalesce(p_command->>k,'') !~ '^(0|[1-9][0-9]{0,15})$' or (p_command->>k)::numeric>9007199254740991) or
    jsonb_typeof(p_command->'changes') is distinct from 'object' or p_command->'changes'='{}'::jsonb or
    exists(select 1 from jsonb_object_keys(p_command->'changes') k(key) where key not in ('email','phone')) or
    jsonb_typeof(p_command->'reason') is distinct from 'string' or length(btrim(p_command->>'reason')) not between 1 and 200 or
    jsonb_typeof(p_command->'idempotencyKey') is distinct from 'string' or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$' or
    jsonb_typeof(p_command->'bindingJson') is distinct from 'string' or octet_length(p_command->>'bindingJson')>16384
  then raise exception 'invalid_support_sensitive_command' using errcode='22023'; end if;
  if p_proof is null or jsonb_typeof(p_proof)<>'object' or
    exists(select 1 from jsonb_object_keys(p_proof) k(key) where key not in ('issuerHash','subjectHash','nonceHash','issuedAt','expiresAt','action','requestHash')) or
    p_proof->>'action' is distinct from 'customer.support.contact.change.v1' or
    exists(select 1 from unnest(array['issuerHash','subjectHash','nonceHash','requestHash']) k where
      jsonb_typeof(p_proof->k) is distinct from 'string' or coalesce(p_proof->>k,'') !~ '^[0-9a-f]{64}$') or
    exists(select 1 from unnest(array['issuedAt','expiresAt']) k where jsonb_typeof(p_proof->k) is distinct from 'number'
      or coalesce(p_proof->>k,'') !~ '^[0-9]{1,11}$')
  then raise exception 'support_sensitive_proof_invalid' using errcode='42501'; end if;
  begin v_binding:=(p_command->>'bindingJson')::jsonb;
  exception when invalid_text_representation then raise exception 'invalid_support_sensitive_command' using errcode='22023'; end;
  if v_binding is distinct from (p_command-'bindingJson')||jsonb_build_object('action','customer.support.contact.change.v1','channel','phone') or
    encode(extensions.digest(p_command->>'bindingJson','sha256'),'hex') is distinct from p_proof->>'requestHash'
  then raise exception 'support_sensitive_proof_invalid' using errcode='42501'; end if;
  v_company:=(p_command->>'companyId')::uuid; v_customer:=(p_command->>'customerId')::uuid;
  v_case:=(p_command->>'caseId')::uuid; v_actor:=(p_command->>'actorUserId')::uuid; v_session:=(p_command->>'sessionId')::uuid;
  v_case_revision:=(p_command->>'expectedCaseRevision')::bigint; v_contact_revision:=(p_command->>'expectedContactRevision')::bigint;
  v_issued:=to_timestamp((p_proof->>'issuedAt')::bigint); v_expires:=to_timestamp((p_proof->>'expiresAt')::bigint);
  v_context:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'mode','ops','actorUserId',v_actor,'sessionId',v_session,'clientId',null,'subject',null);
  -- Match existing command lock order: customer, current authority, then case.
  perform 1 from public.customers where id=v_customer and company_id=v_company for update;
  if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if not private.gridex_support_actor_v1(v_context,true) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  select * into v_case_row from public.customer_cases where id=v_case and company_id=v_company and customer_id=v_customer for update;
  if not found or not coalesce(v_case_row.metadata->>'support_case'='true' or v_case_row.source like 'tenant\_support\_%' escape '\',false)
  then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  -- Signature, trusted issuer/subject/customer binding and exact request hash
  -- are verified by the server before this service-only RPC. Database clocks
  -- are independently checked after every potentially waiting write below.
  if v_issued>clock_timestamp() or v_expires<=clock_timestamp() or v_expires<=v_issued or v_expires>v_issued+interval '5 minutes'
  then raise exception 'support_sensitive_proof_invalid' using errcode='42501'; end if;
  if exists(select 1 from private.gridex_support_sensitive_consumptions where issuer_hash=p_proof->>'issuerHash' and nonce_hash=p_proof->>'nonceHash')
  then raise exception 'support_sensitive_proof_replayed' using errcode='42501'; end if;
  if v_case_row.support_revision<>v_case_revision then raise exception 'support_revision_conflict' using errcode='PT409'; end if;
  if v_case_row.status in ('closed','cancelled') then raise exception 'support_case_closed' using errcode='P0001'; end if;
  -- Restrict to the current primary contact; v2 independently rechecks current
  -- masterdata.write/session, contact selection and optimistic revision.
  select id into v_contact from public.customer_contacts where company_id=v_company and customer_id=v_customer and is_primary for update;
  insert into private.gridex_support_sensitive_consumptions(issuer_hash,nonce_hash,subject_hash,company_id,customer_id,customer_case_id,
    actor_user_id,session_id,action,request_hash,issued_at,expires_at)
  values(p_proof->>'issuerHash',p_proof->>'nonceHash',p_proof->>'subjectHash',v_company,v_customer,v_case,v_actor,v_session,
    p_proof->>'action',p_proof->>'requestHash',v_issued,v_expires) on conflict(issuer_hash,nonce_hash) do nothing;
  if not found then raise exception 'support_sensitive_proof_replayed' using errcode='42501'; end if;
  if v_expires<=clock_timestamp() then raise exception 'support_sensitive_proof_invalid' using errcode='42501'; end if;
  -- Keep the caller key's conflict semantics. A freshly signed different
  -- payload with that same case/key must not create a second logical command.
  v_key:='support.contact:'||encode(extensions.digest(concat_ws(':',v_case::text,p_command->>'idempotencyKey'),'sha256'),'hex');
  v_result:=public.gridex_change_customer_contact_v2(jsonb_build_object('companyId',v_company,'customerId',v_customer,'mode','ops',
    'actorUserId',v_actor,'sessionId',v_session,'clientId',null,'subject',null,'requestJson',null,'contactId',v_contact,
    'reason',p_command->>'reason','idempotencyKey',v_key,'expectedRevision',v_contact_revision,'changes',p_command->'changes'));
  -- A fresh nonce cannot turn the reusable contact command's saved receipt
  -- into another sensitive execution. Raising here rolls back this nonce.
  if (v_result->>'replayed')::boolean then
    raise exception 'support_sensitive_command_already_completed' using errcode='PT409';
  end if;
  update public.customer_cases set support_revision=support_revision+1,updated_at=clock_timestamp(),updated_by=v_actor
    where id=v_case and company_id=v_company and customer_id=v_customer;
  insert into public.customer_case_events(company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by)
  values(v_company,v_customer,v_case,'support_verified_contact_change','info','Kontaktändring verkställd efter handlingsbunden verifiering.',
    jsonb_build_object('channel','phone','contactRevision',v_result->'revision','caseRevision',v_case_revision+1,'requestHash',p_proof->>'requestHash'),v_actor);
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'SUPPORT_SENSITIVE_CONTACT_COMMAND','customer_case',v_case,v_case_revision+1,v_actor,p_command->>'reason',v_key,
    jsonb_build_object('caseRevision',v_case_revision,'contactRevision',v_contact_revision),
    jsonb_build_object('caseRevision',v_case_revision+1,'contactRevision',v_result->'revision'),
    jsonb_build_object('channel','phone','issuerHash',p_proof->>'issuerHash','nonceHash',p_proof->>'nonceHash','requestHash',p_proof->>'requestHash'));
  if not private.gridex_profile_session_active_v1(v_actor,v_session) or v_expires<=clock_timestamp()
  then raise exception 'support_sensitive_proof_invalid' using errcode='42501'; end if;
  return jsonb_build_object('companyId',v_company,'customerId',v_customer,'caseId',v_case,'caseRevision',v_case_revision+1,
    'contactRevision',v_result->'revision','changed',v_result->'changed','replayed',v_result->'replayed');
end $f$;
revoke all on function public.gridex_support_sensitive_contact_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_sensitive_contact_v1(jsonb,jsonb) to service_role;
commit;
