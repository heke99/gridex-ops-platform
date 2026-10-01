import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') throw new Error('profile_native_local_only')
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 30_000 }).trim()
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
function denied(statement: string, code: string) {
  let observed = ''
  try { raw(statement) } catch (error) { observed = String((error as { stderr?: string | Buffer }).stderr ?? '') }
  expect(observed).toContain(code)
}
const companyA = randomUUID(), companyB = randomUUID(), clientA = randomUUID(), clientB = randomUUID()
const actor = randomUUID(), session = randomUUID()
const customers = [
  { companyId: companyA, customerId: randomUUID(), clientId: clientA, subject: randomUUID(), siteId: randomUUID(), facilityReference: `facility_${randomUUID()}` },
  { companyId: companyA, customerId: randomUUID(), clientId: clientA, subject: randomUUID(), siteId: randomUUID(), facilityReference: `facility_${randomUUID()}` },
  { companyId: companyB, customerId: randomUUID(), clientId: clientB, subject: randomUUID(), siteId: randomUUID(), facilityReference: `facility_${randomUUID()}` },
]
type Customer = typeof customers[number]
type Result = { statusCode: number; replayed: boolean; body: { data: { profile_revision?: number; profile_updated?: boolean; address_revision?: number; facility_updated?: boolean; status: string; address_result?: Record<string, unknown> } } }
// Hand-written compact JSON fixture strings avoid deriving SQL expectations
// from a production serializer/hash helper.
const preferences = '{"expected_profile_revision":0,"profile":{"language_code":"en","timezone":"Europe/Stockholm"}}'
function call(c: Customer, kind: 'preferences' | 'facility', key: string, requestJson: string, candidate?: Record<string, unknown>, ops = false) {
  return `public.gridex_change_customer_${kind === 'preferences' ? 'profile_preferences' : 'facility_profile'}_v1(${quote(JSON.stringify({
    companyId: c.companyId, customerId: c.customerId, mode: ops ? 'ops' : 'api',
    actorUserId: ops ? actor : null, sessionId: ops ? session : null, clientId: ops ? null : c.clientId,
    subject: ops ? null : c.subject, reason: ops ? 'Synthetic verified profile correction' : null,
    idempotencyKey: key, requestJson, ...(candidate === undefined ? {} : { candidate }),
  }))}::jsonb)`
}
function run(c: Customer, kind: 'preferences' | 'facility', key: string, requestJson: string, candidate?: Record<string, unknown>, ops = false) {
  return sql<Result>(`SET ROLE service_role; SELECT ${call(c, kind, key, requestJson, candidate, ops)};`)
}
function candidate(c: Customer, city: string, revision = 0) {
  const normalized = `testgatan 1|1001|12345|${city.toLocaleLowerCase('sv-SE')}|se`
  return { siteId: c.siteId, snapshotRevision: revision, street: 'Testgatan 1', postal_code: '12345', city,
    country: 'SE', care_of: 'Synthetic Care', apartment_number: '1001', complete: true, normalized,
    address_hash: createHash('sha256').update(normalized).digest('hex') }
}
function facilityPayload(c: Customer, city: string, revision = 0) {
  return JSON.stringify({ facility_data: { address: { city }, expected_address_revision: revision, facility_reference: c.facilityReference } })
}
function contact(c: Customer, key: string, email: string, revision?: number, ops = false) {
  const changes = { email }
  return `public.gridex_change_customer_contact_v2(${quote(JSON.stringify({
    companyId: c.companyId, customerId: c.customerId, contactId: null, mode: ops ? 'ops' : 'api',
    actorUserId: ops ? actor : null, sessionId: ops ? session : null, clientId: ops ? null : c.clientId,
    subject: ops ? null : c.subject, reason: ops ? 'Synthetic verified contact correction' : null,
    expectedRevision: revision, changes, idempotencyKey: key,
    requestJson: ops ? null : `${revision === undefined ? '{' : `{"expected_contact_revision":${revision},`}\"profile\":${JSON.stringify(changes)}}`,
  }))}::jsonb)`
}
function connection(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => resolve(code ?? -1))
  })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 75))
  }
}
function extraCustomer(): Customer {
  const c = { ...customers[0], customerId: randomUUID(), subject: randomUUID(), siteId: randomUUID(), facilityReference: `facility_${randomUUID()}` }
  sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,preferred_language,metadata)
    VALUES(${quote(c.customerId)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic profile race','private','sv','{}');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES(${quote(c.subject)},'authenticated','authenticated',${quote(`${c.subject}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role)
    VALUES(${quote(c.companyId)},${quote(c.customerId)},${quote(c.subject)},${quote(c.subject)},'active',true,'owner'); SELECT to_jsonb(true);`)
  return c
}
function opsActor(permission = 'customers.write') {
  const userId = randomUUID(), sessionId = randomUUID()
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES(${quote(userId)},'authenticated','authenticated',${quote(`${userId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(userId)},${quote(`${userId}@example.invalid`)},'Synthetic customer policy actor','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(sessionId)},${quote(userId)},now(),now(),now()+interval '1 hour');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(companyA)},${quote(userId)},'support','active',now(),'support',true,now(),'support');
    INSERT INTO public.permissions(key,name) VALUES(${quote(permission)},'Synthetic explicit customer permission') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(userId)},${quote(companyA)},id,key FROM public.permissions WHERE key=${quote(permission)};
    SELECT to_jsonb(true);`)
  return { userId, sessionId }
}
type OpsActor = ReturnType<typeof opsActor>
type LegalResult = { companyId: string; customerId: string; revision: number; changed: boolean; replayed: boolean }
const legalChanges = { customer_type: 'private', first_name: 'Synthetic', last_name: 'Legal Customer',
  company_name: null, personal_number: null, org_number: null, apartment_number: '1002' }
function legal(c: Customer, user: OpsActor, key: string, revision = 0, changes: Record<string, unknown> = legalChanges,
  extra: Record<string, unknown> = {}) {
  return `public.gridex_change_customer_legal_profile_v1(${quote(JSON.stringify({ companyId: c.companyId, customerId: c.customerId,
    actorUserId: user.userId, sessionId: user.sessionId, reason: 'Synthetic verified legal correction',
    expectedRevision: revision, idempotencyKey: key, changes, ...extra }))}::jsonb)`
}
type LifecycleResult = LegalResult & { affectedSiteCount: number; affectedMeteringPointCount: number; affectedContractCount: number;
  cancelledSwitchCount: number; followUpTaskCount: number }
function lifecycle(c: Customer, user: OpsActor, key: string, revision = 0, extra: Record<string, unknown> = {}) {
  return `public.gridex_close_customer_lifecycle_v1(${quote(JSON.stringify({ companyId: c.companyId, customerId: c.customerId,
    actorUserId: user.userId, sessionId: user.sessionId, reason: 'Synthetic verified lifecycle closure',
    expectedRevision: revision, idempotencyKey: key, mode: 'move_out', moveOutDate: '2026-09-30', createFollowUpTask: true, ...extra }))}::jsonb)`
}
function lifecycleCustomer() {
  const c = extraCustomer(), pointId = randomUUID(), contractId = randomUUID(), switchId = randomUUID(), oldTaskId = randomUUID()
  sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,facility_reference,status,street,postal_code,city,country)
    VALUES(${quote(c.siteId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.facilityReference)},'active','Synthetic 1','12345','Malmö','SE');
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,status,meter_point_id)
    VALUES(${quote(pointId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.siteId)},'active',${quote(`synthetic_${pointId}`)});
    INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,status,contract_name,version_snapshot)
    VALUES(${quote(contractId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.siteId)},${quote(pointId)},'draft','Synthetic lifecycle contract','{"immutableFixture":"retained"}');
    INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,status)
    VALUES(${quote(switchId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.siteId)},${quote(pointId)},'draft');
    INSERT INTO public.customer_operation_tasks(id,company_id,customer_id,site_id,task_type,status,title)
    VALUES(${quote(oldTaskId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.siteId)},'synthetic_prior_work','open','Synthetic prior work'); SELECT to_jsonb(true);`)
  return { ...c, pointId, contractId, switchId, oldTaskId }
}

describe.sequential('actual profile/facility commands', () => {
  beforeAll(() => {
    sql(`INSERT INTO public.companies(id,name,status) VALUES (${quote(companyA)},'Synthetic profile A','active'),(${quote(companyB)},'Synthetic profile B','active');
      INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,preferred_language,metadata) VALUES
      ${customers.map(c => `(${quote(c.customerId)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic profile customer','private','sv','{"keep":"unchanged"}')`).join(',')};
      INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES
      ${[actor, ...customers.map(c => c.subject)].map(id => `(${quote(id)},'authenticated','authenticated',${quote(`${id}@example.invalid`)},now(),'{}','{}',now(),now(),false,false)`).join(',')};
      INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(`${actor}@example.invalid`)},'Synthetic profile actor','active');
      INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(session)},${quote(actor)},now(),now(),now()+interval '1 hour');
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
        VALUES(${quote(companyA)},${quote(actor)},'company_admin','active',now(),'company_admin',true,now(),'company_admin');
      INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic masterdata write') ON CONFLICT(key) DO NOTHING;
      INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
        SELECT ${quote(actor)},${quote(companyA)},id,key FROM public.permissions WHERE key='masterdata.write';
      INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes) VALUES
      ${[[clientA, companyA], [clientB, companyB]].map(([id, company]) => `(${quote(id)},${quote(company)},'Synthetic profile client',${quote(`pf_${id.slice(0, 12)}`)},${quote(createHash('sha256').update(id).digest('hex'))},'active',ARRAY['customer_contact.write','customer_facility_data.write'])`).join(',')};
      INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role) VALUES
      ${customers.map(c => `(${quote(c.companyId)},${quote(c.customerId)},${quote(c.subject)},${quote(c.subject)},'active',true,'owner')`).join(',')};
      INSERT INTO public.customer_sites(id,company_id,customer_id,facility_reference,street,postal_code,city,country,care_of,apartment_number) VALUES
      ${customers.map(c => `(${quote(c.siteId)},${quote(c.companyId)},${quote(c.customerId)},${quote(c.facilityReference)},'Testgatan 1','12345','Malmö','SE','Synthetic Care','1001')`).join(',')};
      SELECT to_jsonb(true);`)
  })

  it('persists API preferences, preserves unrelated metadata, increments one revision and replays exactly', () => {
    const c = customers[0], result = run(c, 'preferences', 'profile-native-preferences-key', preferences)
    expect(result).toMatchObject({ statusCode: 200, replayed: false, body: { data: { status: 'accepted', profile_updated: true, profile_revision: 1 } } })
    expect(run(c, 'preferences', 'profile-native-preferences-key', preferences)).toEqual({ ...result, replayed: true })
    expect(sql<{ revision: number; language: string; metadata: Record<string, string> }>(`SELECT jsonb_build_object('revision',profile_revision,
      'language',preferred_language,'metadata',metadata) FROM public.customers WHERE id=${quote(c.customerId)};`))
      .toEqual({ revision: 1, language: 'en', metadata: { keep: 'unchanged', portal_timezone: 'Europe/Stockholm' } })
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', 'profile-native-stale-revision', preferences)};`, 'profile_revision_conflict')
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', 'profile-native-invalid-timezone', '{"expected_profile_revision":1,"profile":{"timezone":"Unknown/Timezone"}}')};`, 'invalid_profile_preferences')
    console.log('PROFILE_PREFERENCES_NATIVE_PASS persist=true metadata_preserved=true replay=true revision_conflict=true')
  })

  it('keeps legacy compact hashes/completed bodies and fails safely for legacy failed/processing and fresh missing revision', () => {
    const c = customers[0], request = '{"metadata":{"a":"Ä","z":1e-7},"profile":{"language_code":"sv"}}'
    const body = { data: { status: 'accepted', profile_updated: true, legacy_marker: 'exact stored result' } }
    for (const status of ['completed', 'failed', 'processing']) sql(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,
      idempotency_key,request_hash,status,response_status,response_body) VALUES(${quote(c.companyId)},${quote(c.clientId)},${quote(c.customerId)},'/api/v1/customer/profile-update',
      ${quote(`profile-native-legacy-${status}`)},${quote(createHash('sha256').update(request).digest('hex'))},${quote(status)},200,${quote(JSON.stringify(body))}::jsonb); SELECT to_jsonb(true);`)
    expect(run(c, 'preferences', 'profile-native-legacy-completed', request)).toEqual({ statusCode: 200, body, replayed: true })
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', 'profile-native-legacy-failed', request)};`, 'idempotency_previous_attempt_failed')
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', 'profile-native-legacy-processing', request)};`, 'idempotency_in_progress')
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', 'profile-native-no-revision-key', '{"profile":{"language_code":"sv"}}')};`, 'profile_revision_required')
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(c.companyId)} AND idempotency_key='profile-native-no-revision-key';`)).toBe(0)
    console.log('PROFILE_LEGACY_NATIVE_PASS compact_number_hash=true completed_exact=true unsafe_retry_denied=true no_revision_no_claim=true')
  })

  it('applies site address/history/mirror/job/snapshot/completion atomically and denies cross-customer/tenant resources', () => {
    const c = customers[0], request = facilityPayload(c, 'Göteborg'), result = run(c, 'facility', 'profile-native-facility-key', request, candidate(c, 'Göteborg'))
    expect(result).toMatchObject({ replayed: false, body: { data: { status: 'accepted', facility_updated: true, address_revision: 1,
      address_result: { status: 'updated' } } } })
    expect(Object.keys(result.body.data.address_result!).sort()).toEqual(['address_hash', 'status'])
    expect(run(c, 'facility', 'profile-native-facility-key', request, candidate(c, 'Göteborg'))).toEqual({ ...result, replayed: true })
    expect(sql<{ city: string; apartment: string; history: number; mirror: number; jobs: number; snapshots: number }>(`SELECT jsonb_build_object(
      'city',(SELECT city FROM public.customer_sites WHERE id=${quote(c.siteId)}),'apartment',(SELECT apartment_number FROM public.customer_sites WHERE id=${quote(c.siteId)}),
      'history',(SELECT count(*) FROM public.customer_site_address_history WHERE customer_site_id=${quote(c.siteId)}),
      'mirror',(SELECT count(*) FROM public.customer_addresses WHERE customer_id=${quote(c.customerId)} AND type='facility'),
      'jobs',(SELECT count(*) FROM public.customer_operation_jobs WHERE customer_site_id=${quote(c.siteId)} AND job_type='request_customer_data'),
      'snapshots',(SELECT count(*) FROM public.customer_operation_request_snapshots WHERE customer_site_id=${quote(c.siteId)}));`))
      .toEqual({ city: 'Göteborg', apartment: '1001', history: 1, mirror: 1, jobs: 1, snapshots: 1 })
    for (const foreign of customers.slice(1)) denied(`SET ROLE service_role; SELECT ${call(c, 'facility', 'profile-native-foreign-resource', facilityPayload(foreign, 'Uppsala'), candidate(foreign, 'Uppsala'))};`, 'facility_resource_not_found')
    denied(`SET ROLE service_role; SELECT ${call(c, 'facility', 'profile-native-preferences-key', request, candidate(c, 'Göteborg'))};`, 'idempotency_conflict')
    console.log('FACILITY_PROFILE_NATIVE_PASS history_mirror_job_snapshot_completion=true own_resource_only=true cross_category_conflict=true')
  })

  it('holds owner/delegation/current session boundaries before fresh writes and replay', () => {
    const c = customers[0]
    for (const mutation of [
      `UPDATE public.customer_portal_accounts SET role='viewer' WHERE customer_id=${quote(c.customerId)};`,
      `UPDATE public.customer_portal_accounts SET role='billing' WHERE customer_id=${quote(c.customerId)};`,
      `UPDATE public.integration_api_clients SET revoked_at=now() WHERE id=${quote(c.clientId)};`,
      `UPDATE public.integration_api_clients SET scopes=ARRAY['customer_profile.read'] WHERE id=${quote(c.clientId)};`,
    ]) {
      expect(sql<boolean>(`BEGIN; ${mutation} SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${call(c, 'preferences', 'profile-native-preferences-key', preferences)}; RAISE EXCEPTION 'replay_authorized_after_revocation';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_delegation_forbidden' THEN RAISE; END IF; END;
        BEGIN PERFORM ${call(c, 'preferences', 'profile-native-forbidden-fresh', preferences)}; RAISE EXCEPTION 'fresh_authorized_after_revocation';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_delegation_forbidden' THEN RAISE; END IF; END;
        END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    }
    const ownOps = customers[1], ops = run(ownOps, 'preferences', 'profile-native-ops-session-key', preferences, undefined, true)
    expect(ops.body.data.profile_revision).toBe(1)
    expect(sql<boolean>(`BEGIN; DELETE FROM auth.sessions WHERE id=${quote(session)}; SET LOCAL ROLE service_role; DO $proof$ BEGIN
      BEGIN PERFORM ${call(ownOps, 'preferences', 'profile-native-ops-session-key', preferences, undefined, true)};
        RAISE EXCEPTION 'session_revoked_replay_authorized';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_actor_forbidden' THEN RAISE; END IF; END;
      END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    for (const role of ['anon', 'authenticated']) denied(`SET ROLE ${role}; SELECT ${call(c, 'preferences', 'profile-native-preferences-key', preferences)};`, 'permission denied for function')
    console.log('PROFILE_AUTH_NATIVE_PASS viewer_billing_scope_client_denied=true revoked_ops_session_replay_denied=true unprivileged_rpc_denied=true')
  })

  it('rolls back a late audit failure with no profile revision, completion, claim or external intent', () => {
    const c = customers[0], key = 'profile-native-late-rollback', request = '{"expected_profile_revision":1,"profile":{"language_code":"sv"}}'
    expect(sql<{ language: string; revision: number; claims: number; completions: number }>(`BEGIN;
      CREATE TEMP TABLE profile_failure_fixture(marker boolean);
      CREATE FUNCTION pg_temp.profile_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF NEW.aggregate_id=${quote(c.customerId)}::uuid AND NEW.event_type='CUSTOMER_PROFILE_PREFERENCES_COMMAND'
        THEN RAISE EXCEPTION 'profile_fixture_late_audit'; END IF; RETURN NEW; END; $fn$;
      CREATE TRIGGER profile_fixture_audit_failure BEFORE INSERT ON public.canonical_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.profile_audit_failure();
      SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${call(c, 'preferences', key, request)}; RAISE EXCEPTION 'late_audit_failure_absent';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_fixture_late_audit' THEN RAISE; END IF; END;
      END; $proof$; RESET ROLE;
      SELECT jsonb_build_object('language',(SELECT preferred_language FROM public.customers WHERE id=${quote(c.customerId)}),
        'revision',(SELECT profile_revision FROM public.customers WHERE id=${quote(c.customerId)}),
        'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(c.companyId)} AND idempotency_key=${quote(key)}),
        'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE company_id=${quote(c.companyId)} AND idempotency_key=${quote(key)})); ROLLBACK;`))
      .toEqual({ language: 'en', revision: 1, claims: 0, completions: 0 })
    expect(run(c, 'preferences', key, request).replayed).toBe(false)
    console.log('PROFILE_ROLLBACK_NATIVE_PASS late_audit=true profile_completion_claim_rolled_back=true same_key_retry_after_rollback=true')
  })

  it('protects verified address/provenance from a conflicting or incomplete lower-ranked submission', () => {
    const c = customers[2], verified = candidate(c, 'Malmö')
    sql(`UPDATE public.customer_sites SET address_hash=${quote(verified.address_hash)},address_normalized=${quote(verified.normalized)},
      address_source='grid_owner_response',address_verified_at='2026-09-29T11:00:00.123456Z',address_verification_method='grid_owner_response',
      address_status='verified',address_quality_status='complete' WHERE id=${quote(c.siteId)}; SELECT to_jsonb(true);`)
    const conflict = run(c, 'facility', 'profile-native-verified-conflict', facilityPayload(c, 'Uppsala', 1), candidate(c, 'Uppsala', 1))
    expect(conflict.body.data).toMatchObject({ status: 'submitted', address_revision: 1, facility_updated: false,
      address_result: { status: 'conflict', reason: 'verified_address_conflict' } })
    const incomplete = { ...verified, snapshotRevision: 1, country: 'NO', complete: false, normalized: null, address_hash: null }
    const request = JSON.stringify({ facility_data: { address: { country: 'NO' }, expected_address_revision: 1, facility_reference: c.facilityReference } })
    expect(run(c, 'facility', 'profile-native-verified-incomplete', request, incomplete).body.data)
      .toMatchObject({ status: 'submitted', address_revision: 1, facility_updated: false, address_result: { status: 'incomplete' } })
    expect(run(c, 'facility', 'profile-native-verified-unchanged', facilityPayload(c, 'Malmö', 1), { ...verified, snapshotRevision: 1 }).body.data)
      .toMatchObject({ status: 'accepted', address_revision: 1, address_result: { status: 'unchanged' } })
    expect(sql<{ city: string; source: string; status: string; revision: number; firstVerification: boolean; conflicts: number }>(`SELECT jsonb_build_object(
      'city',city,'source',address_source,'status',address_status,'revision',address_revision,
      'firstVerification',address_verified_at='2026-09-29T11:00:00.123456Z'::timestamptz,
      'conflicts',(SELECT count(*) FROM public.customer_site_address_conflicts WHERE customer_site_id=${quote(c.siteId)}))
      FROM public.customer_sites WHERE id=${quote(c.siteId)};`))
      .toEqual({ city: 'Malmö', source: 'grid_owner_response', status: 'verified', revision: 1, firstVerification: true, conflicts: 1 })
    console.log('FACILITY_SOURCE_POLICY_NATIVE_PASS verified_address_preserved=true conflicting_candidate_review=true incomplete_candidate_review=true')
  })

  it('uses current contact authority, scoped claims and legacy compact replay without a fabricated revision', () => {
    const c = customers[0], email = 'contact-native@example.invalid', key = 'profile-native-contact-v2-key'
    const result = sql<{ revision: number; changed: boolean; replayed: boolean; completionReference: string; createdAt: string }>(
      `SET ROLE service_role; SELECT ${contact(c, key, email, 0)};`)
    expect(result).toMatchObject({ revision: 1, changed: true, replayed: false })
    const replay = sql<{ replayed: boolean; statusCode: number; publicBody: Record<string, unknown> }>(`SET ROLE service_role; SELECT ${contact(c, key, email, 0)};`)
    expect(replay).toMatchObject({ replayed: true, statusCode: 200, publicBody: { data: { contact_revision: 1, completion_reference: result.completionReference } } })
    denied(`SET ROLE service_role; SELECT ${contact(c, key, 'changed@example.invalid', 0)};`, 'idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${call(c, 'preferences', key, '{"expected_profile_revision":2,"profile":{"language_code":"en"}}')};`, 'idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${contact(c, 'profile-native-preferences-key', email, 1)};`, 'idempotency_conflict')
    const legacyKey = 'profile-native-contact-legacy-no-revision', request = '{"profile":{"email":"legacy@example.invalid"}}'
    const body = { data: { completion_reference: 'completion_legacy_native', status: 'accepted', profile_updated: true, created_at: '2026-09-29T12:00:00.123Z' } }
    for (const status of ['completed', 'failed', 'processing']) sql(`INSERT INTO public.customer_portal_write_idempotency(
      company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status,response_status,response_body)
      VALUES(${quote(c.companyId)},${quote(c.clientId)},${quote(c.customerId)},'/api/v1/customer/profile-update',${quote(`${legacyKey}-${status}`)},
      ${quote(createHash('sha256').update(request).digest('hex'))},${quote(status)},200,${quote(JSON.stringify(body))}::jsonb); SELECT to_jsonb(true);`)
    expect(sql(`SET ROLE service_role; SELECT ${contact(c, `${legacyKey}-completed`, 'legacy@example.invalid')};`))
      .toEqual({ companyId: c.companyId, customerId: c.customerId, replayed: true, publicBody: body, statusCode: 200 })
    denied(`SET ROLE service_role; SELECT ${contact(c, `${legacyKey}-failed`, 'legacy@example.invalid')};`, 'idempotency_previous_attempt_failed')
    denied(`SET ROLE service_role; SELECT ${contact(c, `${legacyKey}-processing`, 'legacy@example.invalid')};`, 'idempotency_in_progress')
    denied(`SET ROLE service_role; SELECT ${contact(c, 'profile-native-contact-fresh-no-revision', 'legacy@example.invalid')};`, 'contact_revision_required')
    for (const role of ['viewer', 'billing']) expect(sql<boolean>(`BEGIN; UPDATE public.customer_portal_accounts SET role=${quote(role)} WHERE customer_id=${quote(c.customerId)};
      SET LOCAL ROLE service_role; DO $proof$ BEGIN
      BEGIN PERFORM ${contact(c, key, email, 0)}; RAISE EXCEPTION 'contact_owner_replay_bypass';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_delegation_forbidden' THEN RAISE; END IF; END;
      END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    expect(sql<{ email: string; revision: number; claims: number }>(`SELECT jsonb_build_object('email',email,'revision',contact_revision,
      'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(c.companyId)} AND idempotency_key='profile-native-contact-fresh-no-revision'))
      FROM public.customers WHERE id=${quote(c.customerId)};`)).toEqual({ email, revision: 1, claims: 0 })
    console.log('CONTACT_V2_NATIVE_PASS current_owner=true compact_legacy=true unsafe_attempts_denied=true route_category_conflict=true')
  })

  it('retains known v1 results after authorization and blocks a deleted real OPS session before replay', () => {
    const c = customers[1], key = 'profile-native-contact-v1-legacy', email = 'known-v1@example.invalid'
    const v1 = { companyId: c.companyId, customerId: c.customerId, contactId: null, mode: 'api', actorUserId: null,
      clientId: c.clientId, subject: c.subject, reason: null, idempotencyKey: key, expectedRevision: 0, changes: { email } }
    const result = sql<Record<string, unknown>>(`SET ROLE service_role; SELECT private.gridex_apply_customer_contact_v1(${quote(JSON.stringify(v1))}::jsonb);`)
    expect(sql(`SET ROLE service_role; SELECT ${contact(c, key, email, 0)};`)).toEqual({ ...result, replayed: true })
    const primary = sql<string>(`SELECT to_jsonb(id) FROM public.customer_contacts WHERE customer_id=${quote(c.customerId)} AND is_primary;`)
    const ops = { ...v1, contactId: primary, mode: 'ops', actorUserId: actor, sessionId: session, clientId: null, subject: null,
      requestJson: null, reason: 'Synthetic verified telephone correction', idempotencyKey: 'profile-native-contact-ops-session', expectedRevision: 1,
      changes: { phone: '+46700000001' } }
    const statement = `public.gridex_change_customer_contact_v2(${quote(JSON.stringify(ops))}::jsonb)`
    const legacyStatement = `public.gridex_change_customer_contact_v1(${quote(JSON.stringify(ops))}::jsonb)`
    for (const role of ['service_role', 'anon', 'authenticated']) {
      denied(`SET ROLE ${role}; SELECT ${legacyStatement};`, 'permission denied for function')
      denied(`SET ROLE ${role}; SELECT public.gridex_change_customer_contact_v1(${quote(JSON.stringify(v1))}::jsonb);`, 'permission denied for function')
    }
    denied(`SELECT ${legacyStatement};`, 'contact_legacy_entrypoint_disabled')
    expect(sql(`SET ROLE service_role; SELECT ${statement};`)).toMatchObject({ revision: 2, replayed: false })
    expect(sql(`SET ROLE service_role; SELECT ${statement};`)).toMatchObject({ revision: 2, replayed: true })
    expect(sql<boolean>(`BEGIN; DELETE FROM auth.sessions WHERE id=${quote(session)}; SET LOCAL ROLE service_role; DO $proof$ BEGIN
      BEGIN PERFORM ${statement}; RAISE EXCEPTION 'contact_revoked_session_replay_bypass';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'profile_actor_forbidden' THEN RAISE; END IF; END;
      END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    for (const role of ['anon', 'authenticated']) denied(`SET ROLE ${role}; SELECT ${statement};`, 'permission denied for function')
    console.log('CONTACT_V2_LEGACY_SESSION_NATIVE_PASS known_v1_replayed=true real_session_required=true revoked_replay_denied=true public_v1_disabled=true')
  })

  it('rolls contact back after a late route-claim completion failure, including revision/history/outbox', () => {
    const c = customers[0], key = 'profile-native-contact-late-completion', email = 'rollback@example.invalid'
    const baseline = sql<Record<string, number>>(`SELECT jsonb_build_object('audit',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id=${quote(c.customerId)}),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(c.companyId)}),'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(c.companyId)}));`)
    expect(sql<Record<string, unknown>>(`BEGIN; CREATE TEMP TABLE contact_failure_fixture(marker boolean);
      CREATE FUNCTION pg_temp.contact_completion_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF NEW.idempotency_key=${quote(key)} AND NEW.status='completed' THEN RETURN NULL; END IF; RETURN NEW; END; $fn$;
      CREATE TRIGGER contact_fixture_completion_failure BEFORE UPDATE ON public.customer_portal_write_idempotency FOR EACH ROW EXECUTE FUNCTION pg_temp.contact_completion_failure();
      SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${contact(c, key, email, 1)}; RAISE EXCEPTION 'late_contact_completion_failure_absent';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'contact_completion_failed' THEN RAISE; END IF; END;
      END; $proof$; RESET ROLE; SELECT jsonb_build_object('revision',(SELECT contact_revision FROM public.customers WHERE id=${quote(c.customerId)}),
        'email',(SELECT email FROM public.customers WHERE id=${quote(c.customerId)}),
        'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(c.companyId)} AND idempotency_key=${quote(key)}),
        'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE company_id=${quote(c.companyId)} AND idempotency_key=${quote(key)}),
        'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id=${quote(c.customerId)}),
        'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(c.companyId)}),
        'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(c.companyId)})); ROLLBACK;`))
      .toEqual({ ...baseline, revision: 1, email: 'contact-native@example.invalid', claims: 0, completions: 0 })
    console.log('CONTACT_V2_ROLLBACK_NATIVE_PASS late_completion=true revision_contact_audit_outbox_claim_rolled_back=true')
  })

  for (const otherCategory of [false, true]) it(otherCategory ? 'rejects a concurrent category change before any second effect' : 'replays one result for concurrent identical preference commands', async () => {
    const c = extraCustomer(), key = 'profile-native-concurrent-shared-key'
    const first = connection(`profile_first_${randomUUID()}`), secondName = `profile_second_${randomUUID()}`, second = connection(secondName)
    const firstCall = otherCategory ? contact(c, key, 'concurrent@example.invalid', 0) : call(c, 'preferences', key, preferences)
    const secondCall = call(c, 'preferences', key, preferences)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT id FROM public.customers WHERE id=${quote(c.customerId)} FOR UPDATE;
        \\echo PROFILE_CUSTOMER_LOCKED
      `)
      await until(() => first.output().stdout.includes('PROFILE_CUSTOMER_LOCKED'), 'first_profile_session_did_not_lock_customer')
      second.child.stdin.end(`SET ROLE service_role; SELECT ${secondCall};\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(secondName)} AND wait_event_type='Lock'));`),
        'second_profile_session_did_not_wait')
      first.child.stdin.end(`SELECT ${firstCall}; COMMIT;\n`)
      expect(await first.exited).toBe(0)
      if (otherCategory) {
        expect(await second.exited).not.toBe(0); expect(second.output().stderr).toContain('idempotency_conflict')
      } else {
        expect(await second.exited).toBe(0)
        const result = JSON.parse(first.output().stdout.split('\n').find(row => row.startsWith('{'))!) as Result
        expect(JSON.parse(second.output().stdout.trim())).toEqual({ ...result, replayed: true })
      }
      expect(sql<{ claims: number; completions: number; profileRevision: number; contactRevision: number }>(`SELECT jsonb_build_object(
        'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(c.customerId)} AND idempotency_key=${quote(key)}),
        'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE customer_id=${quote(c.customerId)} AND idempotency_key=${quote(key)}),
        'profileRevision',profile_revision,'contactRevision',contact_revision) FROM public.customers WHERE id=${quote(c.customerId)};`))
        .toEqual({ claims: 1, completions: 1, profileRevision: otherCategory ? 0 : 1, contactRevision: otherCategory ? 1 : 0 })
      console.log(`PROFILE_CONCURRENCY_NATIVE_PASS sessions=2 cross_category=${otherCategory} claims=1 completions=1 effect=1`)
    } finally { for (const item of [first, second]) if (item.child.exitCode === null) item.child.kill('SIGTERM') }
  })

  for (const { stage, replay } of [
    { stage: 'owner', replay: false }, { stage: 'owner', replay: true }, { stage: 'claim', replay: true },
  ] as const) it(`denies ${replay ? 'completed replay' : 'fresh execution'} when the API client expires during a ${stage} lock wait`, async () => {
    const c = { ...extraCustomer(), clientId: randomUUID() }, key = 'profile-native-client-expiry-wait'
    sql(`INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,expires_at)
      VALUES(${quote(c.clientId)},${quote(c.companyId)},'Synthetic expiring profile client',${quote(`expiry-${c.clientId}`)},
        repeat('e',64),'active',ARRAY['customer_contact.write'],clock_timestamp()+interval '1 hour'); SELECT to_jsonb(true);`)
    if (replay) expect(run(c, 'preferences', key, preferences)).toMatchObject({ replayed: false, body: { data: { profile_revision: 1 } } })
    const before = sql(`SELECT jsonb_build_object('revision',profile_revision,'language',preferred_language,
      'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(c.customerId)}),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId'=${quote(c.customerId)}),
      'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE customer_id=${quote(c.customerId)}),
      'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id=${quote(c.customerId)}),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId'=${quote(c.customerId)}))
      FROM public.customers WHERE id=${quote(c.customerId)};`)
    const owner = connection(`profile_owner_blocker_${randomUUID()}`), commandName = `profile_expiry_command_${randomUUID()}`, command = connection(commandName)
    try {
      const lock = stage === 'owner' ? `SELECT id FROM public.customer_portal_accounts
        WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} FOR UPDATE;`
        : `SELECT id FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(c.customerId)} AND idempotency_key=${quote(key)} FOR UPDATE;`
      owner.child.stdin.write(`BEGIN; ${lock}
        \\echo PROFILE_OWNER_ACCOUNT_LOCKED
      `)
      await until(() => owner.output().stdout.includes('PROFILE_OWNER_ACCOUNT_LOCKED'), 'profile_expiry_owner_did_not_lock')
      sql(`UPDATE public.integration_api_clients SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=${quote(c.clientId)}; SELECT to_jsonb(true);`)
      command.child.stdin.end(`SET ROLE service_role; SELECT ${call(c, 'preferences', key, preferences)};\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name=${quote(commandName)} AND wait_event_type='Lock'));`), 'profile_expiry_command_did_not_wait_on_owner')
      await until(() => sql<boolean>(`SELECT to_jsonb(expires_at<=clock_timestamp()) FROM public.integration_api_clients WHERE id=${quote(c.clientId)};`),
        'profile_expiry_clock_did_not_elapse')
      owner.child.stdin.end('COMMIT;\n')
      expect(await owner.exited).toBe(0)
      expect(await command.exited).not.toBe(0)
      expect(command.output().stderr).toContain('profile_delegation_forbidden')
      expect(sql(`SELECT jsonb_build_object('revision',profile_revision,'language',preferred_language,
        'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(c.customerId)}),
        'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId'=${quote(c.customerId)}),
        'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE customer_id=${quote(c.customerId)}),
        'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id=${quote(c.customerId)}),
        'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId'=${quote(c.customerId)}))
        FROM public.customers WHERE id=${quote(c.customerId)};`)).toEqual(before)
      console.log(`PROFILE_API_EXPIRY_WAIT_NATIVE_PASS sessions=2 stage=${stage} completed_replay=${replay} expired_denied=true effects_unchanged=true`)
    } finally { for (const item of [owner, command]) if (item.child.exitCode === null) item.child.kill('SIGTERM') }
  })

  // Removing either grant/role lock must let the revoker commit too early and
  // fail this assertion. These are real concurrent database transactions.
  for (const grantKind of ['direct', 'role'] as const) it(`serializes ${grantKind} permission revocation with an OPS result and denies its next replay`, async () => {
    const c = extraCustomer(), user = randomUUID(), userSession = randomUUID(), role = randomUUID()
    sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(user)},'authenticated','authenticated',${quote(`${user}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
      INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(user)},${quote(`${user}@example.invalid`)},'Synthetic isolated permission actor','active');
      INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(userSession)},${quote(user)},now(),now(),now()+interval '1 hour');
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
        VALUES(${quote(c.companyId)},${quote(user)},'support','active',now(),'support',true,now(),'support');
      ${grantKind === 'direct' ? `INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
        SELECT ${quote(user)},${quote(c.companyId)},id,key FROM public.permissions WHERE key='masterdata.write';`
        : `INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(role)},${quote(`fixture_role_${role}`)},'Synthetic isolated profile role','company');
        INSERT INTO public.user_roles(user_id,company_id,role_id) VALUES(${quote(user)},${quote(c.companyId)},${quote(role)});
        INSERT INTO public.role_permissions(role_id,permission_id,permission_key)
          SELECT ${quote(role)},id,key FROM public.permissions WHERE key='masterdata.write';`}
      SELECT to_jsonb(true);`)
    const key = `profile-native-${grantKind}-permission-lock`
    const statement = `public.gridex_change_customer_profile_preferences_v1(${quote(JSON.stringify({
      companyId: c.companyId, customerId: c.customerId, mode: 'ops', actorUserId: user, sessionId: userSession,
      clientId: null, subject: null, reason: 'Synthetic permission revocation proof', idempotencyKey: key, requestJson: preferences,
    }))}::jsonb)`
    const first = connection(`profile_permission_${randomUUID()}`), revokeName = `profile_permission_revoke_${randomUUID()}`
    const revoker = connection(revokeName)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT ${statement};
        \\echo PROFILE_PERMISSION_LOCKED
      `)
      await until(() => first.output().stdout.includes('PROFILE_PERMISSION_LOCKED'), 'profile_command_did_not_finish_authorization')
      revoker.child.stdin.end(grantKind === 'direct'
        ? `UPDATE public.user_permissions SET effect='deny' WHERE user_id=${quote(user)} AND company_id=${quote(c.companyId)};\n`
        : `UPDATE public.role_permissions SET effect='deny' WHERE role_id=${quote(role)};\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name=${quote(revokeName)} AND wait_event_type='Lock'));`), 'permission_revocation_committed_before_profile_result')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited).toBe(0)
      expect(await revoker.exited).toBe(0)
      denied(`SET ROLE service_role; SELECT ${statement};`, 'profile_actor_forbidden')
      expect(sql<{ revision: number; commands: number }>(`SELECT jsonb_build_object('revision',profile_revision,
        'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(c.companyId)}
          AND request_payload->>'customerId'=${quote(c.customerId)})) FROM public.customers WHERE id=${quote(c.customerId)};`))
        .toEqual({ revision: 1, commands: 1 })
      console.log(`PROFILE_PERMISSION_REVOKE_NATIVE_PASS grant=${grantKind} revoke_waits_until_commit=true replay_denied=true effects=1`)
    } finally { for (const item of [first, revoker]) if (item.child.exitCode === null) item.child.kill('SIGTERM') }
  })
})

describe.sequential('actual OPS legal profile command', () => {
  let user: OpsActor, support: OpsActor, c: Customer
  beforeAll(() => { user = opsActor(); support = opsActor('masterdata.write'); c = extraCustomer() })

  // Missing legal SQL/revision, mixed contact writes, or a contact grant used
  // as legal authority must fail these real database assertions.
  it('requires explicit legal authority and persists one separate revision/result/audit/outbox', () => {
    denied(`SET ROLE service_role; SELECT ${legal(c, support, 'legal-native-support-denied')};`, 'legal_profile_actor_forbidden')
    denied(`SET ROLE service_role; SELECT ${legal(c, user, 'legal-native-api-denied', 0, legalChanges, { mode: 'api' })};`, 'invalid_legal_profile_command')
    for (const field of ['email', 'invoice_email', 'status', 'user_id']) {
      denied(`SET ROLE service_role; SELECT ${legal(c, user, 'legal-native-mixed-field', 0, { ...legalChanges, [field]: 'forbidden' })};`, 'invalid_legal_profile_field')
    }
    const before = sql<Record<string, unknown>>(`SELECT jsonb_build_object('email',email,'phone',phone,'contactRevision',contact_revision,
      'billingProfile',billing_profile,'billingRevision',billing_profile_revision,'lifecycleRevision',lifecycle_revision,
      'account',(SELECT to_jsonb(a) FROM public.customer_portal_accounts a WHERE a.customer_id=c.id),
      'authUser',(SELECT to_jsonb(u) FROM auth.users u WHERE u.id=${quote(c.subject)})) FROM public.customers c WHERE c.id=${quote(c.customerId)};`)
    const key = 'legal-native-command-key', statement = legal(c, user, key)
    const result = sql<LegalResult>(`SET ROLE service_role; SELECT ${statement};`)
    expect(result).toEqual({ companyId: c.companyId, customerId: c.customerId, revision: 1, changed: true, replayed: false })
    expect(sql(`SET ROLE service_role; SELECT ${statement};`)).toEqual({ ...result, replayed: true })
    expect(sql<Record<string, unknown>>(`SELECT jsonb_build_object('email',email,'phone',phone,'contactRevision',contact_revision,
      'billingProfile',billing_profile,'billingRevision',billing_profile_revision,'lifecycleRevision',lifecycle_revision,
      'account',(SELECT to_jsonb(a) FROM public.customer_portal_accounts a WHERE a.customer_id=c.id),
      'authUser',(SELECT to_jsonb(u) FROM auth.users u WHERE u.id=${quote(c.subject)})) FROM public.customers c WHERE c.id=${quote(c.customerId)};`)).toEqual(before)
    expect(sql(`SELECT jsonb_build_object('name',name,'fullName',full_name,'apartment',apartment_number,'revision',legal_profile_revision,
      'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id=c.id AND event_type='CUSTOMER_LEGAL_PROFILE_COMMAND'),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId'=c.id::text AND topic='customer.legal.profile.changed'),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId'=c.id::text AND command_type='customer.legal.profile.change.v1'))
      FROM public.customers c WHERE id=${quote(c.customerId)};`))
      .toEqual({ name: 'Synthetic Legal Customer', fullName: 'Synthetic Legal Customer', apartment: '1002', revision: 1, audit: 1, outbox: 1, commands: 1 })
    denied(`SET ROLE service_role; SELECT ${legal(c, user, key, 0, { ...legalChanges, last_name: 'Different' })};`, 'legal_profile_idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${legal(c, user, 'legal-native-stale-key')};`, 'legal_profile_revision_conflict')
    expect(sql(`SET ROLE service_role; SELECT ${legal(c, user, 'legal-native-no-change-key', 1)};`))
      .toMatchObject({ revision: 1, changed: false, replayed: false })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_event_outbox WHERE payload->>'customerId'=${quote(c.customerId)} AND topic='customer.legal.profile.changed';`)).toBe(1)
    console.log('LEGAL_PROFILE_COMMAND_NATIVE_PASS explicit_permission=true separate_revision=true replay=true contact_billing_login_preserved=true audit_outbox=1')
  })

  it('rechecks real session, current grants and exact tenant/customer relation before replay', () => {
    const statement = legal(c, user, 'legal-native-command-key')
    for (const mutation of [
      `DELETE FROM auth.sessions WHERE id=${quote(user.sessionId)};`,
      `UPDATE public.user_profiles SET user_status='disabled' WHERE id=${quote(user.userId)};`,
      `UPDATE public.company_memberships SET is_active=false WHERE company_id=${quote(c.companyId)} AND user_id=${quote(user.userId)};`,
      `UPDATE public.user_permissions SET effect='deny' WHERE company_id=${quote(c.companyId)} AND user_id=${quote(user.userId)};`,
    ]) expect(sql<boolean>(`BEGIN; ${mutation} SET LOCAL ROLE service_role; DO $proof$ BEGIN
      BEGIN PERFORM ${statement}; RAISE EXCEPTION 'legal_revoked_replay_authorized';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'legal_profile_actor_forbidden' THEN RAISE; END IF; END;
      END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    denied(`SET ROLE service_role; SELECT ${legal({ ...c, customerId: customers[2].customerId }, user, 'legal-native-foreign-resource')};`, 'legal_profile_customer_unavailable')
    denied(`SET ROLE service_role; SELECT ${legal(customers[2], user, 'legal-native-foreign-tenant')};`, 'legal_profile_actor_forbidden')
    for (const role of ['anon', 'authenticated']) denied(`SET ROLE ${role}; SELECT ${statement};`, 'permission denied for function')
    console.log('LEGAL_PROFILE_AUTH_NATIVE_PASS session_membership_grant_replay_denied=true cross_tenant_denied=true service_only=true')
  })

  it('rolls a late audit failure back with no legal data, revision, event, intent or command result', () => {
    const isolated = extraCustomer(), key = 'legal-native-late-audit-key'
    const before = sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(isolated.customerId)};`)
    expect(sql(`BEGIN; CREATE TEMP TABLE legal_failure_fixture(marker boolean);
      CREATE FUNCTION pg_temp.legal_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF NEW.aggregate_id=${quote(isolated.customerId)}::uuid AND NEW.event_type='CUSTOMER_LEGAL_PROFILE_COMMAND'
        THEN RAISE EXCEPTION 'legal_fixture_late_audit'; END IF; RETURN NEW; END; $fn$;
      CREATE TRIGGER legal_fixture_audit_failure BEFORE INSERT ON public.canonical_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.legal_audit_failure();
      SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${legal(isolated, user, key)}; RAISE EXCEPTION 'legal_late_failure_absent';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'legal_fixture_late_audit' THEN RAISE; END IF; END;
      END; $proof$; RESET ROLE; SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(isolated.customerId)}),
        'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId'=${quote(isolated.customerId)}),
        'events',(SELECT count(*) FROM public.canonical_domain_events WHERE aggregate_id=${quote(isolated.customerId)}),
        'intents',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId'=${quote(isolated.customerId)})); ROLLBACK;`))
      .toEqual({ customer: before, commands: 0, events: 0, intents: 0 })
    expect(sql(`SET ROLE service_role; SELECT ${legal(isolated, user, key)};`)).toMatchObject({ revision: 1, replayed: false })
    console.log('LEGAL_PROFILE_ROLLBACK_NATIVE_PASS legal_data_revision_command_event_intent_rolled_back=true same_key_retry=true')
  })
})

describe.sequential('actual OPS customer lifecycle closure', () => {
  let user: OpsActor, c: ReturnType<typeof lifecycleCustomer>
  beforeAll(() => { user = opsActor(); c = lifecycleCustomer() })

  // Sequential legacy writes left partially closed graphs and cancelled the
  // switch follow-up inserted moments earlier. Both faults are caught here.
  it('soft closes one owned graph, retains snapshots and leaves its new follow-ups open', () => {
    const foreign = sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(customers[2].customerId)};`)
    const key = 'lifecycle-native-graph-key', statement = lifecycle(c, user, key)
    const result = sql<LifecycleResult>(`SET ROLE service_role; SELECT ${statement};`)
    expect(result).toEqual({ companyId: c.companyId, customerId: c.customerId, revision: 1, changed: true, replayed: false,
      affectedSiteCount: 1, affectedMeteringPointCount: 1, affectedContractCount: 1, cancelledSwitchCount: 1, followUpTaskCount: 2 })
    expect(sql(`SET ROLE service_role; SELECT ${statement};`)).toEqual({ ...result, replayed: true })
    expect(sql(`SELECT jsonb_build_object('customer',(SELECT status FROM public.customers WHERE id=${quote(c.customerId)}),
      'site',(SELECT status FROM public.customer_sites WHERE id=${quote(c.siteId)}),'point',(SELECT status FROM public.metering_points WHERE id=${quote(c.pointId)}),
      'contract',(SELECT status FROM public.customer_contracts WHERE id=${quote(c.contractId)}),
      'snapshot',(SELECT version_snapshot FROM public.customer_contracts WHERE id=${quote(c.contractId)}),
      'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${quote(c.switchId)}),
      'oldTask',(SELECT status FROM public.customer_operation_tasks WHERE id=${quote(c.oldTaskId)}),
      'openFollowUps',(SELECT count(*) FROM public.customer_operation_tasks WHERE customer_id=${quote(c.customerId)} AND status='open'),
      'notes',(SELECT count(*) FROM public.customer_internal_notes WHERE customer_id=${quote(c.customerId)}),
      'journal',(SELECT count(*) FROM public.customer_lifecycle_events WHERE customer_id=${quote(c.customerId)}),
      'confirmationIntents',(SELECT count(*) FROM public.canonical_event_outbox WHERE topic='customer.lifecycle.confirmation.requested'
        AND payload->>'customerId'=${quote(c.customerId)} AND payload->>'templateKey'='move_out_confirmation' AND status='pending'),
      'usage',(SELECT count(*) FROM public.platform_usage_events WHERE customer_id=${quote(c.customerId)} AND event_key='switch.cancelled'));`))
      .toEqual({ customer: 'moved', site: 'closed', point: 'closed', contract: 'cancelled', snapshot: { immutableFixture: 'retained' },
        switch: 'failed', oldTask: 'cancelled', openFollowUps: 2, notes: 1, journal: 1, confirmationIntents: 1, usage: 1 })
    expect(sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(customers[2].customerId)};`)).toEqual(foreign)
    denied(`SET ROLE service_role; SELECT ${lifecycle(c, user, key, 0, { mode: 'terminate' })};`, 'lifecycle_idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${lifecycle(c, user, 'lifecycle-native-new-closed-key', 1)};`, 'lifecycle_state_conflict')
    console.log('CUSTOMER_LIFECYCLE_COMMAND_NATIVE_PASS graph=1 replay=true snapshots_retained=true followups_open=2 pending_confirmation_intent=1')
  })

  it('requires an explicit calendar date/reason/revision/current session and tenant-specific permission', () => {
    const isolated = extraCustomer(), support = opsActor('masterdata.write')
    denied(`SET ROLE service_role; SELECT ${lifecycle(isolated, support, 'lifecycle-native-support-denied')};`, 'lifecycle_actor_forbidden')
    denied(`SET ROLE service_role; SELECT ${lifecycle(isolated, user, 'lifecycle-native-invalid-date', 0, { moveOutDate: '2026-02-30' })};`, 'invalid_lifecycle_command')
    denied(`SET ROLE service_role; SELECT ${lifecycle(isolated, user, 'lifecycle-native-blank-reason', 0, { reason: '' })};`, 'invalid_lifecycle_command')
    denied(`SET ROLE service_role; SELECT ${lifecycle(isolated, user, 'lifecycle-native-forged-field', 0, { deleteRecords: true })};`, 'invalid_lifecycle_command')
    denied(`SET ROLE service_role; SELECT ${lifecycle(customers[2], user, 'lifecycle-native-foreign-tenant')};`, 'lifecycle_actor_forbidden')
    const statement = lifecycle(c, user, 'lifecycle-native-graph-key')
    expect(sql<boolean>(`BEGIN; DELETE FROM auth.sessions WHERE id=${quote(user.sessionId)}; SET LOCAL ROLE service_role; DO $proof$ BEGIN
      BEGIN PERFORM ${statement}; RAISE EXCEPTION 'lifecycle_revoked_session_replay_authorized';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'lifecycle_actor_forbidden' THEN RAISE; END IF; END;
      END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    for (const role of ['anon', 'authenticated']) denied(`SET ROLE ${role}; SELECT ${statement};`, 'permission denied for function')
    console.log('CUSTOMER_LIFECYCLE_AUTH_NATIVE_PASS invalid_calendar_reason_denied=true cross_tenant_denied=true revoked_session_replay_denied=true')
  })

  it('rolls the entire graph and every result/task/journal/intent back after a late audit failure', () => {
    const isolated = lifecycleCustomer(), key = 'lifecycle-native-late-audit-key'
    const snapshot = `SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(isolated.customerId)}),
      'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${quote(isolated.siteId)}),
      'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${quote(isolated.pointId)}),
      'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${quote(isolated.contractId)}),
      'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${quote(isolated.switchId)}),
      'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.customer_operation_tasks t WHERE customer_id=${quote(isolated.customerId)}),
      'contractEvents',(SELECT count(*) FROM public.customer_contract_events WHERE customer_contract_id=${quote(isolated.contractId)}),
      'contractDomainEvents',(SELECT count(*) FROM public.domain_events WHERE aggregate_id=${quote(isolated.contractId)}),
      'contractOutbox',(SELECT count(*) FROM public.event_outbox o JOIN public.domain_events e ON e.id=o.domain_event_id
        WHERE e.aggregate_id=${quote(isolated.contractId)} AND e.company_id=${quote(isolated.companyId)}),
      'journal',(SELECT count(*) FROM public.customer_lifecycle_events WHERE customer_id=${quote(isolated.customerId)}),
      'notes',(SELECT count(*) FROM public.customer_internal_notes WHERE customer_id=${quote(isolated.customerId)}),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId'=${quote(isolated.customerId)}),
      'intents',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId'=${quote(isolated.customerId)}),
      'usage',(SELECT count(*) FROM public.platform_usage_events WHERE customer_id=${quote(isolated.customerId)}));`
    const before = sql(snapshot)
    expect(sql(`BEGIN; CREATE TEMP TABLE lifecycle_failure_fixture(marker boolean);
      CREATE FUNCTION pg_temp.lifecycle_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF NEW.aggregate_id=${quote(isolated.customerId)}::uuid AND NEW.event_type='CUSTOMER_LIFECYCLE_COMMAND'
        THEN RAISE EXCEPTION 'lifecycle_fixture_late_audit'; END IF; RETURN NEW; END; $fn$;
      CREATE TRIGGER lifecycle_fixture_audit_failure BEFORE INSERT ON public.canonical_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.lifecycle_audit_failure();
      SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${lifecycle(isolated, user, key)}; RAISE EXCEPTION 'lifecycle_late_failure_absent';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'lifecycle_fixture_late_audit' THEN RAISE; END IF; END;
      END; $proof$; RESET ROLE; ${snapshot} ROLLBACK;`)).toEqual(before)
    expect(sql(`SET ROLE service_role; SELECT ${lifecycle(isolated, user, key)};`)).toMatchObject({ revision: 1, replayed: false, followUpTaskCount: 2 })
    console.log('CUSTOMER_LIFECYCLE_ROLLBACK_NATIVE_PASS full_graph_result_tasks_usage_journal_intents_rolled_back=true same_key_retry=true')
  })
})
