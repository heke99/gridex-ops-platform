import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it, vi } from 'vitest'

// Only the bundler marker is mocked. Real signed isolated issuer tokens,
// current migrated authority rows, PostgREST and independent SQL connections.
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { SUPPORT_CONTACT_PROOF_ACTION, supportContactRequestBinding, verifySupportSensitiveContactProof } from '@/lib/customer-portal/supportSensitiveProof'
import type { SupportSensitiveContactInput } from '@/lib/customer-operations/supportSensitiveContact'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') throw new Error('support_sensitive_disposable_ci_required')
  try { return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe','pipe','pipe'] }).trim() }
  catch { throw new Error('support_sensitive_native_database_failed') }
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
async function fixture() {
  const companyId = randomUUID(), customerId = randomUUID(), otherCustomerId = randomUUID(), caseId = randomUUID()
  const userId = randomUUID(), sessionId = randomUUID(), sessionB = randomUUID(), nonce = randomUUID()
  raw(`insert into companies(id,name,status) values(${quote(companyId)},'Synthetic one-time support proof','active');
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      values(${quote(userId)},'authenticated','authenticated',${quote(`${userId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    insert into user_profiles(id,email,full_name,user_status) values(${quote(userId)},${quote(`${userId}@example.invalid`)},'Synthetic support staff','active');
    insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(${quote(sessionId)},${quote(userId)},now(),now(),clock_timestamp()+interval '1 hour'),
      (${quote(sessionB)},${quote(userId)},now(),now(),clock_timestamp()+interval '1 hour');
    insert into company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      values(${quote(companyId)},${quote(userId)},'viewer','active',now(),'viewer',true,now(),'finance_readonly');
    insert into permissions(key,name) values('cases.write','Synthetic support write'),('masterdata.write','Synthetic contact write') on conflict(key) do nothing;
    insert into user_permissions(user_id,company_id,permission_id,permission_key)
      select ${quote(userId)},${quote(companyId)},id,key from permissions where key in ('cases.write','masterdata.write');
    insert into customers(id,company_id,customer_number,name,customer_type,email,phone) values
      (${quote(customerId)},${quote(companyId)},${quote(customerId)},'Synthetic caller without portal account','private','old@example.invalid','+4600000'),
      (${quote(otherCustomerId)},${quote(companyId)},${quote(otherCustomerId)},'Synthetic other customer','private','other@example.invalid','+4600001');`)
  const created = await supabaseService.rpc('gridex_support_case_command_v1', { p_command: { companyId, customerId, mode:'ops', channel:'phone', actorUserId:userId,
    sessionId, clientId:null, subject:null, operation:'create', expectedRevision:0, idempotencyKey:`sensitive-native-case-${caseId}`,
    payload:{title:'Synthetic verified contact help',body:'Internal phone intake remains unverified'} } })
  if (created.error || !created.data?.caseId) throw new Error('support_sensitive_native_case_create_failed')
  const request: Omit<SupportSensitiveContactInput, 'proofToken'> = { companyId, customerId, caseId: created.data.caseId,
    expectedCaseRevision:1, expectedContactRevision:0, idempotencyKey:`sensitive-native-command-${caseId}`,
    reason:'Explicit isolated verified phone contact change', changes:{phone:'+4600999'} }
  const keys = await generateKeyPair('RS256', { extractable:true })
  const issuer = 'https://isolated-support-identity.example.test', subject = `isolated-subject-${randomUUID()}`
  const configuration = JSON.stringify({ [companyId]: { issuer,audience:'gridex-support-sensitive-contact',actions:[SUPPORT_CONTACT_PROOF_ACTION],
    bindings:{[issuer]:{[subject]:customerId}},jwks:{keys:[{...await exportJWK(keys.publicKey),kid:'isolated-native-support',alg:'RS256',use:'sig'}]} } })
  async function signed(actor = {userId,sessionId}, target = request, expiresAt = Math.floor(Date.now()/1000)+120, proofNonce = nonce) {
    const bindingJson = supportContactRequestBinding(target,actor)
    const token = await new SignJWT({purpose:'gridex_support_sensitive_contact_v1',channel:'phone',action:SUPPORT_CONTACT_PROOF_ACTION,
      company_id:companyId,customer_id:target.customerId,case_id:target.caseId,actor_user_id:actor.userId,session_id:actor.sessionId,
      request_sha256:createHash('sha256').update(bindingJson).digest('hex')})
      .setProtectedHeader({alg:'RS256',kid:'isolated-native-support',typ:'gridex-support-sensitive+jwt'})
      .setIssuer(issuer).setAudience('gridex-support-sensitive-contact').setSubject(subject).setJti(proofNonce)
      .setIssuedAt().setExpirationTime(expiresAt).sign(keys.privateKey)
    const proof = await verifySupportSensitiveContactProof({token,configuration,request:target,actor})
    if (!proof) throw new Error('support_sensitive_isolated_proof_verification_failed')
    return {p_command:{...target,actorUserId:actor.userId,sessionId:actor.sessionId,bindingJson},p_proof:proof}
  }
  return {companyId,customerId,otherCustomerId,userId,sessionId,sessionB,request,signed}
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function snapshot(f: Fixture) {
  return sql(`select jsonb_build_object(
    'customers',(select jsonb_agg(to_jsonb(t) order by id) from customers t where company_id=${quote(f.companyId)}),
    'contacts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from customer_contacts t where company_id=${quote(f.companyId)}),
    'cases',(select jsonb_agg(to_jsonb(t) order by id) from customer_cases t where company_id=${quote(f.companyId)}),
    'messages',(select jsonb_agg(to_jsonb(t) order by id) from customer_support_messages t where company_id=${quote(f.companyId)}),
    'caseEvents',(select jsonb_agg(to_jsonb(t) order by id) from customer_case_events t where company_id=${quote(f.companyId)}),
    'results',(select jsonb_agg(to_jsonb(t) order by id) from canonical_command_results t where company_id=${quote(f.companyId)}),
    'audits',(select jsonb_agg(to_jsonb(t) order by id) from canonical_audit_events t where company_id=${quote(f.companyId)}),
    'events',(select jsonb_agg(to_jsonb(t) order by id) from canonical_domain_events t where company_id=${quote(f.companyId)}),
    'outbox',(select jsonb_agg(to_jsonb(t) order by id) from canonical_event_outbox t where company_id=${quote(f.companyId)}),
    'proofs',(select coalesce(jsonb_agg(to_jsonb(t) order by nonce_hash),'[]') from private.gridex_support_sensitive_consumptions t where company_id=${quote(f.companyId)}));`)
}
function connection(name: string) {
  const child = spawn('psql',[`${db}?application_name=${name}`,'-XAtq','-v','ON_ERROR_STOP=1'])
  let stdout = '', replayDenied = false
  child.stdout.setEncoding('utf8').on('data',(part:string)=>{stdout+=part})
  child.stderr.on('data',(part:Buffer)=>{if(part.toString().includes('support_sensitive_proof_replayed'))replayDenied=true})
  const exited = new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??-1))})
  return {child,exited,output:()=>stdout,replayDenied:()=>replayDenied}
}
async function until(predicate:()=>boolean,message:string) {
  const deadline=Date.now()+15_000
  while(!predicate()){if(Date.now()>deadline)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,30))}
}

it('applies a signed exact action without a portal account and denies replay/wrong binding/expired DB proof without effects', async () => {
  const f = await fixture(), args = await f.signed(), before = snapshot(f)
  for (const bad of [{...args,p_command:{...args.p_command,customerId:f.otherCustomerId}},
    {...args,p_proof:{...args.p_proof,action:'customer.billing.change'}},
    {...args,p_proof:{...args.p_proof,issuedAt:Math.floor(Date.now()/1000)-100,expiresAt:Math.floor(Date.now()/1000)-1}}]) {
    const denied=await supabaseService.rpc('gridex_support_sensitive_contact_v1',bad)
    expect(denied.error?.code).toBe('42501');expect(snapshot(f)).toEqual(before)
  }
  const accepted=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
  expect(accepted.error).toBeNull();expect(accepted.data).toMatchObject({companyId:f.companyId,customerId:f.customerId,caseId:f.request.caseId,caseRevision:2,contactRevision:1})
  const after=snapshot(f)
  const replay=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
  expect(replay.error?.message).toBe('support_sensitive_proof_replayed');expect(snapshot(f)).toEqual(after)
  expect(sql<number>(`select to_jsonb(count(*)) from customer_portal_accounts where company_id=${quote(f.companyId)};`)).toBe(0)
  expect(sql(`select jsonb_build_object('email',email,'phone',phone) from customers where id=${quote(f.customerId)};`)).toEqual({email:'old@example.invalid',phone:'+4600999'})
  expect(sql<number>(`select to_jsonb(count(*)) from customer_support_messages where company_id=${quote(f.companyId)} and channel='phone' and visibility='internal' and caller_verification='unverified';`)).toBe(1)
  console.log('SUPPORT_SENSITIVE_CONTACT_NATIVE_PASS signed_exact_contact=true no_portal_account=true same_proof_replay_denied=true expired_wrong_binding_denied=true internal_phone_intake_preserved=true')
})

it('a new signed nonce cannot re-execute a completed primary-contact command; a fresh no-change command is distinct', async () => {
  const f=await fixture()
  raw(`insert into customer_contacts(company_id,customer_id,type,is_primary,email,phone)
    values(${quote(f.companyId)},${quote(f.customerId)},'primary',true,'old@example.invalid','+4600000');`)
  const first=await supabaseService.rpc('gridex_support_sensitive_contact_v1',await f.signed())
  expect(first.error).toBeNull();expect(first.data).toMatchObject({caseRevision:2,contactRevision:1})
  const saved=snapshot(f)
  const duplicate=await supabaseService.rpc('gridex_support_sensitive_contact_v1',await f.signed(undefined,
    {...f.request,expectedCaseRevision:2},undefined,randomUUID()))
  expect(duplicate.error?.message).toBe('support_sensitive_command_already_completed');expect(snapshot(f)).toEqual(saved)
  const noChange=await supabaseService.rpc('gridex_support_sensitive_contact_v1',await f.signed(undefined,
    {...f.request,expectedCaseRevision:2,expectedContactRevision:1,idempotencyKey:`${f.request.idempotencyKey}-no-change`},undefined,randomUUID()))
  expect(noChange.error).toBeNull();expect(noChange.data).toMatchObject({caseRevision:3,contactRevision:1,changed:false,replayed:false})
  expect(sql<number>(`select to_jsonb(count(*)) from canonical_event_outbox where company_id=${quote(f.companyId)} and topic='customer.contact.changed';`)).toBe(1)
  expect(sql<number>(`select to_jsonb(count(*)) from private.gridex_support_sensitive_consumptions where company_id=${quote(f.companyId)};`)).toBe(2)
  console.log('SUPPORT_SENSITIVE_CONTACT_FRESH_NONCE_NATIVE_PASS preexisting_primary=true completed_command_reexecution_denied=true distinct_no_change=true no_duplicate_contact_outbox=true')
})

it('two actual auth sessions race the same issuer nonce through separate transactions and produce one contact effect', async () => {
  const f=await fixture(), firstArgs=await f.signed(), secondArgs=await f.signed({userId:f.userId,sessionId:f.sessionB})
  const suffix=randomUUID(), waiterName=`support-proof-wait-${suffix}`
  const first=connection(`support-proof-first-${suffix}`), second=connection(waiterName)
  try {
    first.child.stdin.write(`begin;set local role service_role;select public.gridex_support_sensitive_contact_v1(${quote(JSON.stringify(firstArgs.p_command))}::jsonb,${quote(JSON.stringify(firstArgs.p_proof))}::jsonb);select 'sensitive-first-uncommitted';\n`)
    await until(()=>first.output().includes('sensitive-first-uncommitted'),'support_sensitive_first_not_held')
    second.child.stdin.end(`set role service_role;select public.gridex_support_sensitive_contact_v1(${quote(JSON.stringify(secondArgs.p_command))}::jsonb,${quote(JSON.stringify(secondArgs.p_proof))}::jsonb);\n`)
    await until(()=>sql<boolean>(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${quote(waiterName)} and wait_event_type='Lock'));`),'support_sensitive_second_not_waiting')
    first.child.stdin.end('commit;\n')
    expect(await first.exited).toBe(0);expect(await second.exited).not.toBe(0);expect(second.replayDenied()).toBe(true)
    expect(sql(`select jsonb_build_object('proofs',(select count(*) from private.gridex_support_sensitive_consumptions where company_id=${quote(f.companyId)}),
      'contactResults',(select count(*) from canonical_command_results where company_id=${quote(f.companyId)} and command_type='customer.contact.change.v1'),
      'contactOutbox',(select count(*) from canonical_event_outbox where company_id=${quote(f.companyId)} and topic='customer.contact.changed'),
      'caseRevision',(select support_revision from customer_cases where id=${quote(f.request.caseId)}));`)).toEqual({proofs:1,contactResults:1,contactOutbox:1,caseRevision:2})
    console.log('SUPPORT_SENSITIVE_CONTACT_CONCURRENCY_NATIVE_PASS actual_sessions=2 actual_connections=2 observed_lock=true nonce_consumptions=1 contact_effects=1')
  } finally {first.child.kill('SIGTERM');second.child.kill('SIGTERM')}
})

it('current session and independent permissions are rechecked without consuming a denied proof', async () => {
  const f=await fixture(),args=await f.signed()
  raw(`delete from user_permissions where company_id=${quote(f.companyId)} and user_id=${quote(f.userId)} and permission_key='masterdata.write';`)
  const before=snapshot(f)
  const denied=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
  expect(denied.error?.message).toBe('profile_actor_forbidden');expect(snapshot(f)).toEqual(before)
  raw(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${quote(f.sessionId)};`)
  const revoked=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
  expect(revoked.error?.message).toBe('support_actor_forbidden');expect(snapshot(f)).toEqual(before)
  console.log('SUPPORT_SENSITIVE_CONTACT_AUTHORITY_NATIVE_PASS contact_permission_denied=true expired_staff_session_denied=true nonce_unspent=true')
})

it('database proof expiry after a real case lock wait denies the entire command', async () => {
  const f=await fixture(),args=await f.signed(undefined,undefined,Math.floor(Date.now()/1000)+3)
  const holder=connection(`support-proof-clock-${randomUUID()}`),before=snapshot(f)
  try {
    holder.child.stdin.write(`begin;select id from customer_cases where id=${quote(f.request.caseId)} for update;select 'sensitive-case-held';\n`)
    await until(()=>holder.output().includes('sensitive-case-held'),'support_sensitive_case_not_held')
    const pending=supabaseService.rpc('gridex_support_sensitive_contact_v1',args).then(result=>result)
    await until(()=>sql<boolean>(`select to_jsonb(exists(select 1 from pg_stat_activity where usename='authenticator' and wait_event_type='Lock' and query like '%gridex_support_sensitive_contact_v1%'));`),'support_sensitive_postgrest_not_waiting')
    await until(()=>Date.now()/1000>args.p_proof.expiresAt,'support_sensitive_clock_not_elapsed')
    holder.child.stdin.end('commit;\n');expect(await holder.exited).toBe(0)
    const denied=await pending;expect(denied.error?.message).toBe('support_sensitive_proof_invalid');expect(snapshot(f)).toEqual(before)
    console.log('SUPPORT_SENSITIVE_CONTACT_CLOCK_NATIVE_PASS observed_case_lock=true real_proof_expiry=true zero_effect=true nonce_unspent=true')
  } finally {holder.child.kill('SIGTERM')}
})

it('a late actual audit failure rolls back contact and nonce; current ACL denies low-role reuse and ledger rewrite', async () => {
  const f=await fixture(),args=await f.signed(),name=`support_proof_fault_${randomUUID().replaceAll('-','')}`
  raw(`create function public.${name}() returns trigger language plpgsql as $fault$
    begin if new.company_id=${quote(f.companyId)}::uuid and new.event_type='SUPPORT_SENSITIVE_CONTACT_COMMAND' then
      raise exception 'support_sensitive_native_audit_fault'; end if; return new; end $fault$;
    create trigger ${name} before insert on canonical_audit_events for each row execute function public.${name}();`)
  try {
    const before=snapshot(f)
    const failed=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
    expect(failed.error?.message).toBe('support_sensitive_native_audit_fault');expect(snapshot(f)).toEqual(before)
  } finally {raw(`drop trigger ${name} on canonical_audit_events;drop function public.${name}();`)}
  const retried=await supabaseService.rpc('gridex_support_sensitive_contact_v1',args)
  expect(retried.error).toBeNull();expect(retried.data?.contactRevision).toBe(1)
  expect(sql(`select jsonb_build_object(
    'anonExecute',has_function_privilege('anon','public.gridex_support_sensitive_contact_v1(jsonb,jsonb)','EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated','public.gridex_support_sensitive_contact_v1(jsonb,jsonb)','EXECUTE'),
    'serviceUpdate',has_table_privilege('service_role','private.gridex_support_sensitive_consumptions','UPDATE'),
    'serviceDelete',has_table_privilege('service_role','private.gridex_support_sensitive_consumptions','DELETE'),
    'serviceAuthSessionSelect',has_table_privilege('service_role','auth.sessions','SELECT'));`))
    .toEqual({anonExecute:false,authenticatedExecute:false,serviceUpdate:false,serviceDelete:false,serviceAuthSessionSelect:false})
  console.log('SUPPORT_SENSITIVE_CONTACT_ROLLBACK_ACL_NATIVE_PASS late_audit_rollback=true nonce_retry_after_rollback=true low_role_rpc_denied=true ledger_append_only=true no_auth_session_grant=true')
})
