// masterplan: P-11, SC-037 — finite component only; no whole-ID/native credit.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/* DECLARED LOWER PORTS: committed ACK/canonical/capture/correlation and immutable
 * original/confirmation/activation issuers are seeded protected-history rows.
 * We execute the ACTUAL committed reader, actor guard, raw-wire parser closure,
 * graph table-lock function, atomic request/event predecessor and its event
 * tenant-owner trigger, dispatch guard/trigger and readiness assertion unchanged.
 * Its lifecycle-readiness view is a declared finite relation port carrying the
 * actual consumed company/contract/switch_ready/blockers/lifecycle_stage fields.
 * Other status, correction-history,
 * immutable-producer triggers, ALTER FK/unique constraints and RLS are not
 * installed; their provenance is a declared lower port, not a runtime proof.
 * The RBAC permission resolver and auth.role use a finite permission relation
 * and service role. Graph-only relations carry just id: their relation locks
 * are real, their business semantics are outside this component. Sources omits
 * its unrelated generated scope_point. No RLS, issuer qualification, native,
 * two-session concurrency, market clock or activation-flow claim is made.
 * Transport is replaced by a PGlite query; no production DB is contacted.
 */
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const migrationPath = new URL('../supabase/migrations/20261013155649_ediel_ack_bound_switch_transition.sql', import.meta.url)
const ids = {
  company: '10000000-0000-4000-8000-000000000001', actor: '20000000-0000-4000-8000-000000000001',
  source: '30000000-0000-4000-8000-000000000001', ack: '30000000-0000-4000-8000-000000000002',
  z04: '30000000-0000-4000-8000-000000000003', switch: '40000000-0000-4000-8000-000000000001',
  customer: '50000000-0000-4000-8000-000000000001', point: '50000000-0000-4000-8000-000000000002',
  site: '50000000-0000-4000-8000-000000000003', contract: '50000000-0000-4000-8000-000000000004',
  intent: '60000000-0000-4000-8000-000000000001', request: '60000000-0000-4000-8000-000000000002',
  canonical: '70000000-0000-4000-8000-000000000001', period: '80000000-0000-4000-8000-000000000001',
  wrong: '90000000-0000-4000-8000-000000000001',
}
const raw = "UNB+UNOC:3+S+G+261013:1600+I'UNH+M+PRODAT:D:96B:UN:E2SE5A'BGM+Z03+DOC'"
  + "NAD+FR+S:160:SVK'NAD+DO+G:160:SVK'LIN+1++735999999999999999::9:9'RFF+LI:OWN-LI'"
  + "NAD+UD+5560000000:SE1:260'D TM+92:203001010000:203'CCI++Z13'CAV+Z22'UNT+12+M'UNZ+1+I'"
const originalRaw = raw.replace('D TM', 'DTM')
const ackRaw = 'finite opaque negative ACK: raw bytes belong to declared canonical issuer port'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const sourceHash = hash(originalRaw), ackHash = hash(ackRaw)
let db: PGlite
let transport: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: (_name: string, args: Record<string, unknown>) => transport(args),
} }))

function definition(name: string, kind = 'FUNCTION'): string {
  const start = schema.indexOf(`CREATE ${kind} ${name}(`)
  const tableStart = kind === 'TABLE' ? schema.indexOf(`CREATE TABLE ${name} (`) : start
  const pos = kind === 'TABLE' ? tableStart : start
  if (pos < 0) throw new Error(`actual_schema_missing:${name}`)
  if (kind === 'TABLE') return schema.slice(pos, schema.indexOf('\n);', pos) + 3)
  const tail = schema.slice(pos)
  const delimiter = tail.match(/\bAS (\$[a-z_]*\$)/)?.[1]
  if (!delimiter) throw new Error(`actual_body_missing:${name}`)
  const open = tail.indexOf(delimiter), close = tail.indexOf(delimiter, open + delimiter.length)
  return tail.slice(0, close + delimiter.length + 1)
}
const actualFunctions = [
  'gridex_received_sources.wire_tokens_bounded_v1', 'gridex_received_sources.closure_wire_tokens_v2',
  'gridex_received_sources.supply_wire_v1', 'gridex_received_sources.normal_switch_wire_v1',
  'gridex_received_sources.switch_origin_wire_v1', 'gridex_ediel_ack_replay.lock_current_graph_v2',
  'gridex_ack_authority.require_physical_actor_v1', 'gridex_ack_authority.read_committed_v1',
  'gridex_ack_authority.read_committed_by_source_v2', 'public.gridex_assert_switch_writer_v1',
  'public.gridex_transition_supplier_switch_v1',
  'gridex_correction_process.bind_switch_event_owner_v1',
  'public.gridex_assert_supplier_switch_ready', 'public.gridex_guard_supplier_switch_dispatch',
]
const actualTables = ['public.ediel_messages', 'public.supplier_switch_requests', 'public.supplier_switch_events',
  'gridex_received_sources.sources', 'gridex_received_sources.validation_assessments',
  'gridex_received_sources.switch_originals', 'gridex_received_sources.normal_switch_confirmations',
  'gridex_received_sources.supply_source_transitions', 'gridex_received_sources.normal_supply_activations',
  'gridex_ack_authority.source_correlations', 'gridex_ack_authority.applied_receipts']

async function initialize() {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA gridex_received_sources;
    CREATE SCHEMA gridex_ack_authority; CREATE SCHEMA gridex_ediel_ack_replay;
    CREATE SCHEMA gridex_utilts_binding; CREATE SCHEMA gridex_service_administration;
    CREATE SCHEMA gridex_correction_process;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.companies(id uuid, is_active boolean, status text);
    CREATE TABLE public.user_profiles(id uuid, user_status text);
    CREATE TABLE public.company_memberships(id uuid DEFAULT gen_random_uuid(), company_id uuid,
      user_id uuid, status text, is_active boolean, accepted_at timestamptz);
    CREATE TABLE public.finite_permissions(actor uuid, company uuid, permission text);
    CREATE TABLE public.customer_contract_lifecycle_readiness_v(company_id uuid,customer_contract_id uuid,
      switch_ready boolean,blockers text[],lifecycle_stage text);
    CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean
      LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.finite_permissions WHERE actor=$1 AND company=$2 AND permission=$3)$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
    CREATE FUNCTION public.gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
  for (const name of actualTables) {
    let ddl = definition(name, 'TABLE')
    if (name === 'gridex_received_sources.sources') ddl = ddl.replace(/^.*scope_point text GENERATED.*\n/m, '')
    await db.exec(ddl)
  }
  // Full ACTUAL lock relation list, discovered from the executed function.
  const lock = definition('gridex_ediel_ack_replay.lock_current_graph_v2')
  for (const name of lock.matchAll(/\b(?:auth|public|gridex_utilts_binding|gridex_service_administration|gridex_received_sources)\.[a-z_]+/g)) {
    if (name[0] !== 'gridex_ediel_ack_replay.lock_current_graph_v2') await db.exec(`CREATE TABLE IF NOT EXISTS ${name[0]}(id uuid)`)
  }
  for (const name of actualFunctions) await db.exec(definition(name))
  await db.exec(`CREATE TRIGGER e035_bind_switch_event_owner BEFORE INSERT OR UPDATE ON public.supplier_switch_events
    FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.bind_switch_event_owner_v1()`)
  await db.exec(`CREATE TRIGGER zz_supplier_switch_dispatch_readiness BEFORE INSERT OR UPDATE OF status,contract_id,customer_contract_id,metadata
    ON public.supplier_switch_requests FOR EACH ROW EXECUTE FUNCTION public.gridex_guard_supplier_switch_dispatch()`)
  // A missing scaffold/function is reported as SETUP ERROR, not behavioral RED.
  if (!existsSync(migrationPath)) throw new Error('setup_missing_new_migration')
  await db.exec(readFileSync(migrationPath, 'utf8'))
}
async function insert(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row)
  await db.query(`INSERT INTO ${table}(${keys.join(',')}) SELECT ${keys.join(',')}
    FROM jsonb_populate_record(NULL::${table},$1::jsonb)`, [JSON.stringify(row)])
}
async function request() {
  return (await db.query<{ row: Record<string, unknown> }>('SELECT to_jsonb(s) row FROM public.supplier_switch_requests s')).rows[0].row
}
async function state() {
  return (await db.query<{ state: unknown }>(`SELECT jsonb_build_object('request',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM public.supplier_switch_events e),
    'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.ediel_messages m),
    'receipts',(SELECT jsonb_agg(to_jsonb(r)) FROM gridex_ack_authority.applied_receipts r)) state`)).rows[0].state
}
async function seed() {
  await db.exec(`TRUNCATE public.companies,public.user_profiles,public.company_memberships,public.finite_permissions,public.customer_contract_lifecycle_readiness_v,
    ${actualTables.join(',')};`)
  await insert('public.companies', { id: ids.company, is_active: true, status: 'active' })
  await insert('public.user_profiles', { id: ids.actor, user_status: 'active' })
  await insert('public.company_memberships', { id: ids.wrong, company_id: ids.company, user_id: ids.actor, status: 'active', is_active: true, accepted_at: '2026-10-13T10:00:00Z' })
  for (const permission of ['communication.read', 'communication.write']) await insert('public.finite_permissions', { actor: ids.actor, company: ids.company, permission })
  await insert('public.customer_contract_lifecycle_readiness_v', { company_id: ids.company, customer_contract_id: ids.contract,
    switch_ready: true, blockers: [], lifecycle_stage: 'switch_ready' })
  await insert('public.supplier_switch_requests', { id: ids.switch, company_id: ids.company, customer_id: ids.customer,
    metering_point_id: ids.point, site_id: ids.site, contract_id: ids.contract, requested_start_date: '2030-01-01',
    status: 'prepared', outbound_z03_message_id: ids.source, rff_li_reference: 'OWN-LI', updated_at: '2026-10-13T10:00:00Z' })
  await insert('public.ediel_messages', { id: ids.source, company_id: ids.company, environment: 'test', direction: 'outbound',
    message_family: 'PRODAT', message_code: 'Z03', status: 'failed', raw_payload: originalRaw, immutable_payload_hash: sourceHash,
    immutable_rendered_at: '2026-10-13T10:00:00Z', message_sent_at: '2026-10-13T10:01:00Z', intent_id: ids.intent,
    outbound_request_id: ids.request, switch_request_id: ids.switch, source_operation_id: ids.switch,
    customer_id: ids.customer, site_id: ids.site, metering_point_id: ids.point, aperak_status: 'negative', failure_reason: 'negative wire reason' })
  await insert('public.ediel_messages', { id: ids.ack, company_id: ids.company, environment: 'test', direction: 'inbound',
    message_family: 'APERAK', message_code: 'APERAK', raw_payload: ackRaw, immutable_payload_hash: ackHash })
  await insert('gridex_received_sources.sources', { source_message_id: ids.ack, company_id: ids.company, environment: 'test',
    origin: 'database_insert', message_code: 'APERAK', raw_payload: ackRaw, payload_hash: ackHash, received_context: { version: 1 }, source_received_at: '2026-10-13T10:02:00Z' })
  const facts = JSON.stringify({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
  await insert('gridex_received_sources.validation_assessments', { id: ids.canonical, source_message_id: ids.ack, company_id: ids.company,
    environment: 'test', source_payload_hash: ackHash, facts_text: facts, facts_hash: hash(facts) })
  await insert('gridex_ack_authority.source_correlations', { ack_message_id: ids.ack, source_message_id: ids.source, company_id: ids.company,
    environment: 'test', ack_payload_hash: ackHash, source_payload_hash: sourceHash, canonical_assessment_id: ids.canonical,
    ack_family: 'APERAK', ack_outcome: 'negative', ack_scope: 'message', acknowledged_references: [], scope_outcomes: [], actor_user_id: ids.wrong })
  await db.query(`INSERT INTO gridex_ack_authority.applied_receipts(ack_message_id,result) SELECT $1,
    jsonb_build_object('version',1,'sourceMessage',to_jsonb(m),'outcome','negative','scope','message','scopeOutcomes','[]'::jsonb,
      'finalAckReached',true,'wholeSourceRejected',true,'sourceAccepted',false,'failureReason','negative wire reason','idempotent',false)
    FROM public.ediel_messages m WHERE id=$2`, [ids.ack, ids.source])
  await db.query(`INSERT INTO gridex_received_sources.switch_originals(message_id,company_id,switch_id,intent_id,outbound_request_id,
    payload_hash,contract_id,contract_hash,original_object,previous_switch,resulting_switch,actor_user_id)
    SELECT $1,$2,s.id,$3,$4,$5,$6,$7,gridex_received_sources.switch_origin_wire_v1($8)#>'{objects,0}',
      to_jsonb(s)||jsonb_build_object('status','ready','outbound_z03_message_id',null),to_jsonb(s),$9
    FROM public.supplier_switch_requests s`, [ids.source, ids.company, ids.intent, ids.request, sourceHash, ids.contract, 'c'.repeat(64), originalRaw, ids.wrong])
}
async function confirmation(completed = false) {
  const zRaw = originalRaw.replace('BGM+Z03', 'BGM+Z04').replace('NAD+FR+S:160:SVK', 'NAD+FR+G:160:SVK').replace('NAD+DO+G:160:SVK', 'NAD+DO+S:160:SVK')
  await insert('public.ediel_messages', { id: ids.z04, company_id: ids.company, environment: 'test', direction: 'inbound',
    message_family: 'PRODAT', message_code: 'Z04', raw_payload: zRaw, immutable_payload_hash: hash(zRaw) })
  await insert('gridex_received_sources.sources', { source_message_id: ids.z04, company_id: ids.company, environment: 'test',
    origin: 'database_insert', message_code: 'Z04', raw_payload: zRaw, payload_hash: hash(zRaw), received_context: { version: 1 }, source_received_at: '2026-10-13T10:03:00Z' })
  await db.query(`UPDATE public.supplier_switch_requests SET status='accepted',inbound_z04_message_id=$1,confirmed_start_date='2030-01-01'`, [ids.z04])
  const confirmedSwitch = await request()
  const period = { id: ids.period, company_id: ids.company, source_message_id: ids.z04, source_switch_request_id: ids.switch,
    customer_id: ids.customer, metering_point_id: ids.point, contract_id: ids.contract, source_process: 'supplier_switch_confirmation',
    status: 'confirmed_by_grid_owner', market_start_at: '2030-01-01T00:00:00+00:00' }
  const object = (await db.query<{ own: unknown }>(`SELECT gridex_received_sources.normal_switch_wire_v1($1)#>'{objects,0}' own`, [zRaw])).rows[0].own
  await insert('gridex_received_sources.normal_switch_confirmations', { source_message_id: ids.z04, period_id: ids.period, company_id: ids.company,
    switch_id: ids.switch, original_message_id: ids.source, original_payload_hash: sourceHash, contract_id: ids.contract,
    protected_contract_hash: 'c'.repeat(64), source_object: object, legal_context: { actorRole: 'electricity_supplier' },
    market_start_at: '2030-01-01T00:00:00Z', confirmed_period: period, confirmed_switch: confirmedSwitch })
  await insert('gridex_received_sources.supply_source_transitions', { source_message_id: ids.z04, company_id: ids.company, payload_hash: hash(zRaw),
    source_code: 'Z04', source_objects: [object], previous_states: [], resulting_states: [period], qualified_switch_ids: [ids.switch], actor_user_id: ids.wrong })
  if (completed) {
    await insert('gridex_received_sources.normal_supply_activations', { period_id: ids.period, company_id: ids.company, source_message_id: ids.z04,
      actor_user_id: ids.wrong, previous_period: period, resulting_period: { ...period, status: 'active' },
      result: { supplier_switch_request_id: ids.switch, supply_period_id: ids.period, contract_id: ids.contract } })
    await db.exec("UPDATE public.supplier_switch_requests SET status='completed',completed_at='2030-01-01T00:00:00Z'")
  }
}
async function input() {
  return { companyId: ids.company, environment: 'test' as const, actorUserId: ids.actor, ackMessageId: ids.ack,
    ackPayloadHash: ackHash, sourceMessageId: ids.source, sourcePayloadHash: sourceHash, switchRequestId: ids.switch,
    negativeStatus: 'failed' as 'failed' | 'rejected', expectedRequest: await request() }
}
async function call(overrides: Record<string, unknown> = {}) {
  const value = { ...await input(), ...overrides }
  const { applyInboundAckSwitchTransition } = await import('../lib/ediel/ack/switchRequestAckTransition')
  return applyInboundAckSwitchTransition(value)
}

beforeAll(initialize, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await seed()
  transport = async args => {
    const keys = ['p_company_id', 'p_environment', 'p_actor_user_id', 'p_ack_message_id', 'p_ack_payload_hash',
      'p_source_message_id', 'p_source_payload_hash', 'p_switch_request_id', 'p_negative_status', 'p_expected_request']
    const params = keys.map(k => args[k])
    const result = await db.query<{ result: unknown }>(`SELECT public.gridex_apply_inbound_ack_switch_transition_v1(
      $1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,$9::text,$10::text) result`, params)
    return { data: result.rows[0].result, error: null }
  }
})

describe('receipt-bound negative switch transition', () => {
  it('mutates an own unconfirmed edge once; interrupted projection replay remains reachable', async () => {
    // ACK was already committed by the declared lower issuer; no TS projection ran.
    const result = await call()
    expect(result.disposition).toBe('mutated_failure')
    expect(result.changed).toBe(true)
    expect((await request()).status).toBe('failed')
    const after = await state()
    expect((await db.query('SELECT * FROM public.supplier_switch_events')).rows).toHaveLength(1)
    expect((await call()).disposition).toBe('already_terminal')
    expect(await state()).toEqual(after)
  })
  it('allows only the bounded rejected projection and binds its single event', async () => {
    const result = await call({ negativeStatus: 'rejected' })
    expect(result.request?.status).toBe('rejected')
    const events = (await db.query<{ event_type: string; payload: Record<string, unknown> }>('SELECT * FROM public.supplier_switch_events')).rows
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('ack_rejected')
    expect(events[0].payload).toMatchObject({ ackMessageId: ids.ack, sourceMessageId: ids.source, ackPayloadHash: ackHash, sourcePayloadHash: sourceHash })
  })
  it.each([false, true])('preserves qualified confirmation/completion (%s) and negative ACK diagnostics', async completed => {
    const discovered = await input()
    await confirmation(completed)
    const before = await state()
    const result = await call({ expectedRequest: discovered.expectedRequest })
    expect(result.disposition).toBe('preserved_confirmation')
    expect(result.changed).toBe(false)
    expect(result.request?.status).toBe(completed ? 'completed' : 'accepted')
    expect(await state()).toEqual(before)
  })
  it.each(['failed', 'rejected', 'cancelled', 'cancelled_before_start', 'accepted', 'completed', 'unknown', 'cancellation_requested'])('never revives or mutates unsupported current status %s', async status => {
    await db.query('UPDATE public.supplier_switch_requests SET status=$1', [status])
    const before = await state()
    expect((await call()).changed).toBe(false)
    expect(await state()).toEqual(before)
  })
  it.each(["lifecycle_blocked=true", "pause_reason='held'", "requested_start_date='2031-01-01'", "outbound_z03_message_id='90000000-0000-4000-8000-000000000001'", "customer_id='90000000-0000-4000-8000-000000000001'"] )('refuses current held/changed edge: %s', async set => {
    await db.exec(`UPDATE public.supplier_switch_requests SET ${set}`)
    const before = await state()
    expect((await call()).changed).toBe(false)
    expect(await state()).toEqual(before)
  })
  it('compares the complete discovered preimage after locking the current recipient', async () => {
    const discovered = await input()
    await db.exec("UPDATE public.supplier_switch_requests SET status='submitted',submitted_at='2026-10-13T10:05:00Z'")
    const before = await state()
    expect((await call({ expectedRequest: discovered.expectedRequest })).disposition).toBe('stale_preimage')
    expect(await state()).toEqual(before)
    expect((await call()).changed).toBe(true)
  })
  it.each(['queued', 'submitted', 'sent'])('projects a genuine %s dispatch postimage and replays without another event', async status => {
    await db.query('UPDATE public.supplier_switch_requests SET status=$1', [status])
    const dispatched = await request()
    expect(dispatched.contract_id).toBe(ids.contract)
    expect(dispatched.customer_contract_id).toBe(ids.contract)
    expect(dispatched.readiness_snapshot).toMatchObject({ ready: true, contract_id: ids.contract, lifecycle_stage: 'switch_ready' })
    expect(dispatched.readiness_checked_at).toEqual(expect.any(String))
    const result = await call()
    expect(result.disposition).toBe('mutated_failure')
    expect(result.request).toMatchObject({ contract_id: ids.contract, customer_contract_id: ids.contract,
      readiness_snapshot: dispatched.readiness_snapshot, readiness_checked_at: dispatched.readiness_checked_at })
    expect((await db.query('SELECT * FROM public.supplier_switch_events')).rows).toHaveLength(1)
    const after = await state()
    expect((await call()).disposition).toBe('already_terminal')
    expect(await state()).toEqual(after)
  })
  it('refuses foreign contract aliases normalized by the actual dispatch guard', async () => {
    await insert('public.customer_contract_lifecycle_readiness_v', { company_id: ids.company, customer_contract_id: ids.wrong,
      switch_ready: true, blockers: [], lifecycle_stage: 'switch_ready' })
    await db.query("UPDATE public.supplier_switch_requests SET status='sent',customer_contract_id=$1", [ids.wrong])
    expect((await request()).contract_id).toBe(ids.wrong)
    const before = await state()
    expect((await call()).disposition).toBe('not_applicable')
    expect(await state()).toEqual(before)
  })
  it.each([
    "readiness_snapshot=jsonb_set(readiness_snapshot,'{ready}','false')",
    "readiness_snapshot=jsonb_set(readiness_snapshot,'{contract_id}','\"90000000-0000-4000-8000-000000000001\"')",
    "readiness_snapshot=jsonb_set(readiness_snapshot,'{checked_at}','null')",
    "readiness_snapshot=jsonb_set(readiness_snapshot,'{checked_at}','\"invalid\"')",
    "readiness_snapshot=jsonb_set(readiness_snapshot,'{lifecycle_stage}','null')",
    "readiness_snapshot=readiness_snapshot||'{\"unbound_extra\":true}'::jsonb",
    'readiness_checked_at=null',
  ])('holds a dispatched row with invalid readiness diagnostics: %s', async set => {
    await db.exec("UPDATE public.supplier_switch_requests SET status='sent'")
    await db.exec(`UPDATE public.supplier_switch_requests SET ${set}`)
    const before = await state()
    expect((await call()).disposition).toBe('not_applicable')
    expect(await state()).toEqual(before)
  })
  it('keeps a dispatched complete preimage CAS when guard readiness is refreshed after discovery', async () => {
    await db.exec("UPDATE public.supplier_switch_requests SET status='queued'")
    const discovered = await input()
    await db.exec("UPDATE public.supplier_switch_requests SET status='sent'")
    const before = await state()
    expect((await call({ expectedRequest: discovered.expectedRequest })).disposition).toBe('stale_preimage')
    expect(await state()).toEqual(before)
    expect((await call()).changed).toBe(true)
  })
  it.each(["DELETE FROM public.finite_permissions WHERE permission='communication.write'", "UPDATE public.user_profiles SET user_status='inactive'", "UPDATE public.company_memberships SET is_active=false", "UPDATE public.company_memberships SET accepted_at=null", "UPDATE public.companies SET status='paused'"])('requires current mutation-grade actor: %s', async change => {
    await db.exec(change)
    const before = await state()
    await expect(call()).rejects.toThrow('ack_execution_actor_unqualified')
    expect(await state()).toEqual(before)
  })
  it.each([{ ackMessageId: ids.wrong }, { sourceMessageId: ids.wrong }, { switchRequestId: ids.wrong },
    { sourcePayloadHash: 'b'.repeat(64) }, { ackPayloadHash: 'b'.repeat(64) }, { companyId: ids.wrong }, { environment: 'production' }])('refuses fake/wrong execution pins %j', async pins => {
    const before = await state()
    try { expect((await call(pins)).changed).toBe(false) } catch (e) {
      expect(String(e)).toMatch(/ack_(immutable_correlation_conflict|execution_actor_unqualified|switch_)/)
    }
    expect(await state()).toEqual(before)
  })
  it.each([
    'DELETE FROM gridex_ack_authority.applied_receipts',
    "UPDATE gridex_ack_authority.applied_receipts SET result=jsonb_set(result,'{wholeSourceRejected}','false')",
    "UPDATE gridex_ack_authority.applied_receipts SET result=jsonb_set(result,'{sourceAccepted}','true')",
    "UPDATE gridex_ack_authority.applied_receipts SET result=jsonb_set(result,'{version}','2')",
    'DELETE FROM gridex_received_sources.switch_originals',
  ])('refuses legacy/partial/unsupported/absent recipient authority: %s', async change => {
    await db.exec(change)
    const before = await state()
    expect((await call()).changed).toBe(false)
    expect(await state()).toEqual(before)
  })
  it.each([
    "UPDATE gridex_received_sources.switch_originals SET intent_id='90000000-0000-4000-8000-000000000001'",
    "UPDATE gridex_received_sources.switch_originals SET outbound_request_id='90000000-0000-4000-8000-000000000001'",
    "UPDATE gridex_received_sources.switch_originals SET payload_hash=repeat('b',64)",
    "UPDATE gridex_received_sources.switch_originals SET previous_switch=jsonb_set(previous_switch,'{requested_start_date}','\"2031-01-01\"')",
    "UPDATE gridex_received_sources.switch_originals SET original_object=jsonb_set(original_object,'{li}','\"OTHER-LI\"')",
  ])('refuses changed immutable recipient provenance: %s', async change => {
    await db.exec(change)
    const before = await state()
    expect((await call()).changed).toBe(false)
    expect(await state()).toEqual(before)
  })
  it('refuses ambiguous confirmation history even when one candidate qualifies', async () => {
    await confirmation()
    await db.exec(`INSERT INTO gridex_received_sources.normal_switch_confirmations SELECT source_message_id,
      '${ids.wrong}'::uuid,company_id,switch_id,original_message_id,repeat('b',64),contract_id,
      protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch,created_at
      FROM gridex_received_sources.normal_switch_confirmations`)
    const before = await state()
    expect((await call()).disposition).toBe('not_applicable')
    expect(await state()).toEqual(before)
  })
  it('rechecks current actor revocation after the adapter has awaited its transport', async () => {
    const originalTransport = transport, before = await state()
    transport = async args => {
      await db.exec("DELETE FROM public.finite_permissions WHERE permission='communication.write'")
      return originalTransport(args)
    }
    await expect(call()).rejects.toThrow('ack_execution_actor_unqualified')
    expect(await state()).toEqual(before)
  })
  it('exposes only the service wrapper: private execute and private table reads stay denied', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      try {
        await expect(db.query(`SELECT public.gridex_apply_inbound_ack_switch_transition_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`)).rejects.toThrow('permission denied')
      } finally { await db.exec('RESET ROLE') }
    }
    await db.exec('SET ROLE service_role')
    try {
      await expect(db.query(`SELECT gridex_ack_authority.apply_switch_transition_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`)).rejects.toThrow('permission denied')
      await expect(db.query('SELECT * FROM gridex_ack_authority.applied_receipts')).rejects.toThrow('permission denied')
    } finally { await db.exec('RESET ROLE') }
    const value = await input()
    await db.exec('SET ROLE service_role')
    try {
      const { applyInboundAckSwitchTransition } = await import('../lib/ediel/ack/switchRequestAckTransition')
      expect((await applyInboundAckSwitchTransition(value)).changed).toBe(true)
    } finally { await db.exec('RESET ROLE') }
  })
  it('refuses a positive committed outcome even with caller negative target', async () => {
    await db.exec("UPDATE gridex_ack_authority.source_correlations SET ack_outcome='positive'; UPDATE gridex_ack_authority.applied_receipts SET result=jsonb_set(result,'{outcome}','\"positive\"')")
    const before = await state()
    expect((await call()).changed).toBe(false)
    expect(await state()).toEqual(before)
  })
  it.each([
    "UPDATE gridex_received_sources.sources SET received_context=null",
    "UPDATE gridex_received_sources.validation_assessments SET source_payload_hash=repeat('b',64)",
    "UPDATE gridex_received_sources.validation_assessments SET facts_text='{}',facts_hash=encode(sha256(convert_to('{}','UTF8')),'hex')",
    "UPDATE public.ediel_messages SET raw_payload='changed' WHERE direction='outbound'",
  ])('actual committed reader refuses changed capture/canonical/raw: %s', async change => {
    await db.exec(change)
    const before = await state()
    await expect(call()).rejects.toThrow('ack_immutable_correlation_conflict')
    expect(await state()).toEqual(before)
  })
  it.each([
    "UPDATE gridex_received_sources.supply_source_transitions SET qualified_switch_ids='{}'",
    "UPDATE gridex_received_sources.supply_source_transitions SET resulting_states='[]'",
    "UPDATE gridex_received_sources.normal_switch_confirmations SET original_payload_hash=repeat('b',64)",
    "UPDATE gridex_received_sources.sources SET environment='production' WHERE message_code='Z04'",
    "UPDATE public.supplier_switch_requests SET lifecycle_blocked=true",
  ])('does not treat unqualified confirmation/changed current state as applicable: %s', async change => {
    await confirmation()
    await db.exec(change)
    const before = await state()
    expect((await call()).disposition).toBe('not_applicable')
    expect(await state()).toEqual(before)
  })
  it('rolls back the request if its atomic event cannot be inserted', async () => {
    await db.exec("ALTER TABLE public.supplier_switch_events ADD CONSTRAINT finite_event_failure CHECK(event_type<>'ack_failed')")
    const before = await state()
    await expect(call()).rejects.toThrow('finite_event_failure')
    expect(await state()).toEqual(before)
    await db.exec('ALTER TABLE public.supplier_switch_events DROP CONSTRAINT finite_event_failure')
  })
  it.each(['companyId', 'environment', 'actorUserId', 'ackMessageId', 'ackPayloadHash', 'sourceMessageId', 'sourcePayloadHash', 'switchRequestId', 'negativeStatus', 'expectedRequestHash', 'changed', 'disposition', 'request'])('adapter rejects a forged response %s without a fallback write', async key => {
    const originalTransport = transport
    transport = async args => {
      const result = await originalTransport(args)
      return { ...result, data: { ...(result.data as Record<string, unknown>), [key]: key === 'changed' ? false : null } }
    }
    await expect(call()).rejects.toThrow('ack_switch_transition_invalid')
    expect((await db.query('SELECT * FROM public.supplier_switch_events')).rows).toHaveLength(1)
  })
  it.each([['not_applicable'], null, false, 42, {}, ['not_applicable', 'mutated_failure']])('adapter refuses a non-string no-op disposition %j', async disposition => {
    await db.exec('UPDATE public.supplier_switch_requests SET lifecycle_blocked=true')
    const originalTransport = transport, before = await state()
    transport = async args => {
      const result = await originalTransport(args)
      return { ...result, data: { ...(result.data as Record<string, unknown>), disposition } }
    }
    await expect(call()).rejects.toThrow('ack_switch_transition_invalid')
    expect(await state()).toEqual(before)
  })
  it('pins nested request/input before await; caller mutation cannot redirect the operation', async () => {
    const value = await input(), originalTransport = transport
    transport = async args => {
      value.companyId = ids.wrong
      value.expectedRequest.status = 'accepted'
      return originalTransport(args)
    }
    const { applyInboundAckSwitchTransition } = await import('../lib/ediel/ack/switchRequestAckTransition')
    expect((await applyInboundAckSwitchTransition(value)).request?.company_id).toBe(ids.company)
  })
})

it('differential: generic negative caller projection downgrades confirmation; bound operation preserves it', async () => {
  await confirmation()
  await db.query(`SELECT public.gridex_transition_supplier_switch_v1($1,$2,'{"status":"failed"}', '{"event_type":"failed"}')`, [ids.company, ids.switch])
  expect((await request()).status).toBe('failed')
  await seed()
  await confirmation()
  expect((await call()).disposition).toBe('preserved_confirmation')
  expect((await request()).status).toBe('accepted')
})
