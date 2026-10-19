// OPS-04 / AT-OPS-04 prospective native qualification. NOT EXECUTED.
// Real local Supabase, GoTrue/current tenant context, canonical received UTILTS,
// service permission, ACK creation, incident read, MIME archive and entered
// generic transport attempt and real authenticated loopback SMTP over verified
// TLS. No fake provider acceptance or external SMTP host is used.
// The client/cookie bridge is the existing native HTTP-test adapter, not a
// permission mock. The RPC barrier forwards the original SDK request unchanged.
// Scope: generic test-environment normal trial, plan.resend=null. This suite
// makes no sealed-Z08, production-mandate or explicit-resend proof claim.
import type {SupabaseClient} from '@supabase/supabase-js'
import {spawn} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createServer, type TLSSocket} from 'node:tls'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest'

const current = vi.hoisted(() => ({client: null as SupabaseClient | null, company: ''}))
const smtpBridge = vi.hoisted(() => ({port: 0, calls: 0, observe: null as null | ((result: unknown) => void)}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: async () => {
  if (!current.client) throw Error('actual_local_gotrue_client_required')
  return current.client
}}))
vi.mock('next/headers', () => ({cookies: async () => ({get: () => ({value: current.company})})}))
// Observation wrapper only: delegate to the actual installed transporter with
// unchanged production TLS/auth options and return its actual network result.
// Shared ESCO helpers' legacy mock counter is observed AFTER real SMTP success;
// its return value never supplies acceptance or any result to the send path.
vi.mock('nodemailer', async importOriginal => {
  const original = await importOriginal<typeof import('nodemailer')>()
  return {...original, default: {...original.default, createTransport: (options: SMTPTransport.Options) => {
    if (options.host !== '127.0.0.1' || options.port !== smtpBridge.port || options.secure !== true
      || options.requireTLS !== true || options.tls?.rejectUnauthorized !== true
      || options.tls?.minVersion !== 'TLSv1.2') throw Error('actual_native_smtp_tls_loopback_options_required')
    const transport = original.default.createTransport(options)
    const send = transport.sendMail.bind(transport)
    transport.sendMail = (async (input: Parameters<typeof send>[0]) => {
      smtpBridge.calls++
      const result = await send(input)
      smtpBridge.observe?.(result)
      return result
    }) as typeof transport.sendMail
    return transport
  }}}
})

import {supabaseService} from '@/lib/supabase/service'
import {sendControlledLiveEdielMessage, type ControlledLiveSendRequest} from '@/lib/ediel/orchestrator'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {isSmtpDeliveryUncertain} from '@/lib/ediel/transport/smtpOutcome'
import {assessControlledLiveSend} from '@/lib/ediel/transport/controlledLiveSendGuard'
import {evaluateEdielRouteContract} from '@/lib/ediel/outbox/routeContract'
import {reportFreshEdielBusinessIncident, readFreshEdielBusinessIncident} from '@/lib/ediel/incidents/freshBusinessIncident'
import {seedNativeEscoFixture, qualifyNativeEscoFixture, resetNativeEscoFixture,
  nativeEscoSql as sql, nativeEscoLiteral as lit, nativeEscoExternal as external,
  NATIVE_ESCO_DB as DB} from './fixtures/ediel-service-evidence-native'
import {createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'
import {publishSyntheticRecipientTrust} from './helpers/syntheticCertificateTrust'
import {nativeLockProcess, nativeLockProcessEnv} from './helpers/native-lock-process'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Json = Record<string, unknown>
type RpcResult = {data: unknown; error: {code?: string; message: string} | null}
type ConsumeArguments = {
  p_company_id: string; p_environment: 'test'; p_actor_user_id: string;
  p_message_id: string; p_incident_id: string; p_route_profile_id: string;
  p_agreement_id: string; p_mandate_id: null; p_resend: false;
  p_binding: Json & {message: Json; provider: Json}
}
const CONSUME = 'gridex_ediel_ops04_consume_controlled_live_v1'
const tables = ['incident_corrections', 'counterparty_agreements', 'live_mandates',
  'relay_captures', 'revocations', 'consumptions'] as const
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const actorPermissions = ['communication.read', 'communication.write', 'communication.send']
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const rpc = (name: string, args: Json) => (supabaseService.rpc as unknown as
  (name: string, args: Json) => PromiseLike<RpcResult>)(name, args)
const realRpc = supabaseService.rpc.bind(supabaseService)
type ConsumeGate = {reach: (args: ConsumeArguments) => void; barrier: Promise<void>; abort: AbortController;
  calls: number; response?: RpcResult}
const consumeGates = new Map<string, ConsumeGate>()
let consumeObserver: {mockRestore(): void} | undefined
let siblings: Fixture[] | undefined
let siblingImages: unknown[] = []
let loopback: Awaited<ReturnType<typeof startLoopbackSmtp>>

beforeAll(async () => {
  loopback = await startLoopbackSmtp()
  smtpBridge.port = loopback.port
})
afterAll(async () => {smtpBridge.observe = null; await loopback?.close()})

beforeEach(async () => {
  resetNativeEscoFixture()
  external.send.mockReset()
  external.send.mockImplementation(() => undefined) // observation only
  smtpBridge.observe = result => {external.send(result)}
  vi.stubEnv('EDIEL_SMTP_HOST', '127.0.0.1')
  vi.stubEnv('EDIEL_SMTP_PORT', String(loopback.port))
  vi.stubEnv('EDIEL_SMTP_SECURE', 'true')
  vi.stubEnv('EDIEL_SMTP_PASS', loopback.password)
  vi.stubEnv('EDIEL_SMTP_REPLY_TO', 'esco-native@example.invalid')
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', 'esco-native@example.invalid')
  vi.stubEnv('EMAIL_PROVIDER', 'resend')
  // Two independent, nonempty foreign authority scopes stay exact across all
  // target operations. They are real fixtures, never empty-row control images.
  siblings ??= [await fixture(), await fixture()]
  for (const sibling of siblings) {
    const rows = history(sibling.companyId)
    for (const table of ['incident_corrections', 'counterparty_agreements', 'relay_captures'])
      expect((rows[table] as unknown[]).length).toBeGreaterThan(0)
  }
  siblingImages = siblings.map(f => ({history: history(f.companyId),
    original: originalImage(f.sourceId, f.originalAckId)}))
})
afterEach(() => {
  try {
    if (siblings && siblingImages.length) expect(siblings.map(f => ({history: history(f.companyId),
      original: originalImage(f.sourceId, f.originalAckId)}))).toEqual(siblingImages)
  } finally {
    current.client = null; current.company = ''; consumeGates.clear()
    consumeObserver = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs()
  }
})

function history(company: string) {
  return sql<Json>(`SELECT jsonb_build_object(${tables.map(table => `${lit(table)},
    (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb)
     FROM gridex_ediel_ops04.${table} x WHERE company_id=${lit(company)})`).join(',')})`)
}
function originalImage(source: string, ack: string) {
  return sql(`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id)
    FROM public.ediel_messages m WHERE id IN(${lit(source)},${lit(ack)})),
    'routeProfile',(SELECT to_jsonb(p) FROM public.ediel_route_profiles p JOIN public.ediel_messages m
      ON m.route_profile_id=p.id WHERE m.id=${lit(ack)}),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb)
      FROM gridex_ediel_transport.attempts a WHERE message_id=${lit(ack)}),
    'payloads',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb)
      FROM public.ediel_message_payloads p WHERE ediel_message_id=${lit(ack)}))`)
}
async function record(company: string, actor: string, input: Record<string, string>) {
  const result = await rpc('gridex_ediel_ops04_record_v1', {
    p_company_id: company, p_actor_user_id: actor, p_input: {commandId: randomUUID(), ...input},
  })
  expect(result.error, JSON.stringify(result.error)).toBeNull()
  expect(result.data).toMatchObject({companyId: company, kind: input.kind, id: expect.any(String)})
  return String((result.data as Json).id)
}
async function revoke(f: Fixture, kind: string, id: string) {
  const result = await rpc('gridex_ediel_ops04_revoke_v1', {p_company_id: f.companyId,
    p_actor_user_id: f.sender.id, p_input: {commandId: randomUUID(), subjectKind: kind,
      subjectId: id, reasonRef: 'SYNTHETIC native current-authority withdrawal'}})
  expect(result.error, JSON.stringify(result.error)).toBeNull()
}

async function actualSmtpPremise<T>(label: string, action: () => Promise<T>, messageId: (result: T) => string) {
  const before = loopback.image()
  const result = await action()
  expect(loopback.image(), `${label}: real TLS/authenticated DATA premise required`).toEqual({
    providerCalls: before.providerCalls + 1, connections: before.connections + 1,
    authenticated: before.authenticated + 1, accepted: before.accepted + 1,
  })
  const received = loopback.messages.at(-1)!
  expect(received).toMatchObject({from: 'esco-native@example.invalid', to: ['dso-native@example.invalid'],
    authUser: 'esco-native@example.invalid', tlsVersion: expect.stringMatching(/^TLSv1\.[23]$/)})
  const mimeHash = createHash('sha256').update(received.raw).digest('hex')
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads
    WHERE ediel_message_id=${lit(messageId(result))} AND payload_kind='raw_mime'
      AND metadata->>'archive_verified'='true' AND metadata->>'archived_mime_sha256'=${lit(mimeHash)}
      AND metadata->>'archived_mime_bytes'=${lit(String(received.raw.length))}`),
    `${label}: actual accepted socket MIME must equal the committed archive`).toBe(1)
  return result
}

// configureTuple is implemented below from public prospective configuration.
// It does not insert any private approval, source receipt, archive or attempt.

async function fixture(options: {agreementSeconds?: number} = {}): Promise<Fixture> {
  const base = await seedNativeEscoFixture()
  // Both public profiles are prospective here; no outbound original exists.
  // Their current SMTP configuration agrees with the real loopback account.
  sql(`UPDATE public.ediel_route_profiles SET smtp_host='127.0.0.1',smtp_port=${loopback.port}
    WHERE company_id=${lit(base.ids.company)} AND id IN(${lit(base.ids.routeProfile)},${lit(base.ids.ackProfile)})`)
  await actualSmtpPremise('ESCO Z13 permission original', () => qualifyNativeEscoFixture(base), result => result.z13.id)
  // Qualification sends Z13 on the separate metering route. Configure the sole
  // public ACK profile prospectively before ANY incident ACK/source is born.
  const sender = await createBilateralSourceOperator(base.ids.company, actorPermissions)
  expect(sender.id).not.toBe(base.ids.actor) // reporter != independent corrector
  const tuple = configureTuple({companyId: base.ids.company, actorUserId: sender.id,
    receiverEdielId: base.receiver, routeId: base.ids.ackRoute, routeProfileId: base.ids.ackProfile})
  const reference = `OPS-INC-${randomUUID().slice(0, 8)}`
  const received = await base.utilts('accepted', reference)
  await received.persist()
  const originalAck = await received.ack()
  await received.finalize(originalAck)
  await actualSmtpPremise('accepted incident ACK original',
    () => sendEdielMessageViaSmtp(originalAck, {actorUserId: base.ids.actor, smtpMimeMode: 'nodemailer-attachment'}),
    () => originalAck.id)
  const incident = await reportFreshEdielBusinessIncident({companyId: base.ids.company,
    actorUserId: base.ids.actor, command: {commandId: randomUUID(), sourceMessageId: received.source.id,
      ackMessageId: originalAck.id, scopeReference: reference,
      finding: {code: 'late_internal_business_error', summary: 'SYNTHETIC independent operator check for a bounded trial.'}}})
  expect(await readFreshEdielBusinessIncident({companyId: base.ids.company,
    actorUserId: sender.id, incidentId: incident.incidentId})).toEqual(incident)
  const retainedOriginal = originalImage(received.source.id, originalAck.id)
  const correctionId = await record(base.ids.company, sender.id, {kind: 'incident_correction',
    incidentId: incident.incidentId, correctionRef: `SYNTHETIC-CORRECTION-${randomUUID()}`})
  const captureId = await record(base.ids.company, sender.id, {kind: 'relay_capture',
    routeProfileId: tuple.routeProfileId, evidenceRef: `SYNTHETIC-RELAY-${randomUUID()}`,
    rawHeaders: 'Received: from a.example.invalid by b.example.invalid with ESMTPS id x; Mon, 05 Oct 2026 10:00:01 +0200\r\nAuthentication-Results: b.example.invalid; spf=pass'})
  // Generate a genuinely new exchange under the same real service assignment.
  // The old incident source/accepted ACK stay unchanged. This is no resend.
  const trial = await trialAck(base, tuple)
  const clock = sql<{from: string; to: string}>(`SELECT jsonb_build_object(
    'from',clock_timestamp()-interval '1 minute',
    'to',clock_timestamp()+${lit(String(options.agreementSeconds ?? 180))}::double precision*interval '1 second')`)
  const agreementId = await record(base.ids.company, sender.id, {kind: 'counterparty_agreement',
    routeProfileId: tuple.routeProfileId, counterpartyId: tuple.counterpartyId,
    agreementRef: `SYNTHETIC-AGREED-TRIAL-${randomUUID()}`, validFrom: clock.from, validTo: clock.to})
  const f = {base, companyId: base.ids.company, sender, tuple, incidentId: incident.incidentId,
    sourceId: received.source.id, originalAckId: originalAck.id, retainedOriginal,
    correctionId, captureId, agreementId, agreementExpiresAt: clock.to, trial}
  expect(originalImage(f.sourceId, f.originalAckId)).toEqual(retainedOriginal)
  await requirePositive(f, trial)
  return f
}
type Fixture = {
  base: Awaited<ReturnType<typeof seedNativeEscoFixture>>; companyId: string;
  sender: Awaited<ReturnType<typeof createBilateralSourceOperator>>; tuple: ReturnType<typeof configureTuple>;
  incidentId: string; sourceId: string; originalAckId: string; retainedOriginal: unknown;
  correctionId: string; captureId: string; agreementId: string; agreementExpiresAt: string; trial: EdielMessageRow
}
async function trialAck(base: Awaited<ReturnType<typeof seedNativeEscoFixture>>, tuple: ReturnType<typeof configureTuple>) {
  const next = await base.utilts('accepted', `OPS-TRIAL-${randomUUID().slice(0, 8)}`)
  await next.persist()
  const ack = await next.ack()
  await next.finalize(ack)
  expect(ack).toMatchObject({company_id: base.ids.company, direction: 'outbound',
    environment: 'test', message_family: 'APERAK', communication_route_id: tuple.routeId, route_profile_id: tuple.routeProfileId})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE message_id=${lit(ack.id)}`)).toBe(0)
  return ack
}
function request(f: Fixture, message = f.trial): ControlledLiveSendRequest {
  return {messageId: message.id, incidentId: f.incidentId, actorUserId: f.sender.id,
    plan: {references: [message.id], source: 'single_controlled', resend: null}}
}
async function requirePositive(f: Fixture, message: EdielMessageRow) {
  const selection = request(f, message)
  const assessment = await assessControlledLiveSend(message, f.sender.id,
    {incidentId: selection.incidentId, plan: selection.plan})
  expect(assessment, JSON.stringify(assessment)).toMatchObject({ready: true, reasons: [],
    incidentId: f.incidentId, agreementId: f.agreementId, mandateId: null})
  const contract = await evaluateEdielRouteContract(message)
  expect(contract, JSON.stringify(contract)).toMatchObject({ok: true,
    routeId: message.communication_route_id, certificateId: f.tuple.certificateId})
}

async function pausedSend(f: Fixture, message = f.trial) {
  current.client = f.sender.client; current.company = f.companyId
  const providerBaseline = external.send.mock.calls.length
  const smtpBaseline = loopback.image()
  let reach!: (args: ConsumeArguments) => void, release!: () => void
  const reached = new Promise<ConsumeArguments>(resolve => {reach = resolve})
  const barrier = new Promise<void>(resolve => {release = resolve})
  const gate: ConsumeGate = {reach, barrier, abort: new AbortController(), calls: 0}
  expect(consumeGates.has(message.id)).toBe(false)
  consumeGates.set(message.id, gate)
  consumeObserver ??= vi.spyOn(supabaseService, 'rpc').mockImplementation((name, args, options) => {
    const actual = realRpc(name, args, options)
    const selected = name === CONSUME ? consumeGates.get(String((args as Json)?.p_message_id)) : undefined
    if (selected) {
      // Existing public PostgREST cancellation API. Never changes RPC input or
      // supplies an authorization response; used only to own failed cleanup.
      actual.abortSignal(selected.abort.signal)
      selected.calls++
      const then = actual.then.bind(actual)
      actual.then = ((resolve, reject) => selected.barrier.then(() => then(response => {
        selected.response = response as RpcResult
        return response
      })).then(resolve, reject)) as typeof actual.then
      selected.reach(structuredClone(args) as ConsumeArguments)
    }
    return actual
  })
  const restore = () => {consumeGates.delete(message.id); if (!consumeGates.size) {
    consumeObserver?.mockRestore(); consumeObserver = undefined
  }}
  const sending = sendControlledLiveEdielMessage(request(f, message)).then(
    value => ({value, error: undefined}), error => ({value: undefined, error}))
  let settled = false
  const settle = async () => {release(); const result = await sending; settled = true; restore(); return result}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const args = await Promise.race([reached, sending.then(result => {
      throw Error(`positive_native_send_never_reached_final_consume:${JSON.stringify(result)}`)
    }), new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error('native_final_consume_barrier_timeout')), 30000)})])
    expect(gate.calls).toBe(1)
    expect(external.send).toHaveBeenCalledTimes(providerBaseline)
    expect(args).toMatchObject({p_company_id: f.companyId, p_environment: 'test',
      p_actor_user_id: f.sender.id, p_message_id: message.id, p_incident_id: f.incidentId,
      p_route_profile_id: f.tuple.routeProfileId, p_agreement_id: f.agreementId,
      p_mandate_id: null, p_resend: false})
    const binding = args.p_binding.provider
    expect(args.p_binding.message).toMatchObject({id: message.id, sourcePayloadHash: sha(message.raw_payload!)} )
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts a
      JOIN gridex_ediel_transport.reservations r ON r.attempt_id=a.id AND r.message_id=a.message_id
      WHERE a.message_id=${lit(message.id)} AND a.company_id=${lit(f.companyId)} AND r.state='entered'
      AND a.entered_at IS NOT NULL AND a.observed_at IS NULL AND a.classification IS NULL
      AND a.binding @> ${lit(binding)}::jsonb`)).toBe(1)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads p
      WHERE p.id=${lit(binding.mimePayloadSnapshotId)} AND p.company_id=${lit(f.companyId)}
      AND p.ediel_message_id=${lit(message.id)} AND p.encrypted_payload_ref=${lit(binding.mimeArchiveRef)}
      AND p.metadata->>'archived_mime_sha256'=${lit(binding.mimeSha256)}
      AND (p.metadata->>'archive_verified')::boolean`)).toBe(1)
    expect(loopback.image()).toEqual(smtpBaseline)
    return {args, providerBaseline, smtpBaseline, sending, release,
      response: () => gate.response,
      settle,
      async cleanup() {
        // Cancellation is cleanup only, never a qualification/refusal oracle.
        // The intended negative cases call settle() and assert the real SQL
        // response first; a failing test aborts its still-unforwarded request.
        if (!settled) gate.abort.abort()
        await settle()
      }}
  } catch (error) {
    // Never release an otherwise authorized trial just to settle a failed
    // setup. Abort the actual SDK request before unblocking its forwarding.
    gate.abort.abort()
    await settle()
    throw error
  }
  finally {clearTimeout(timer)}
}

function consumeSql(a: ConsumeArguments) {
  return `public.${CONSUME}(${lit(a.p_company_id)}::uuid,${lit(a.p_environment)},
    ${lit(a.p_actor_user_id)}::uuid,${lit(a.p_message_id)}::uuid,${lit(a.p_incident_id)}::uuid,
    ${lit(a.p_route_profile_id)}::uuid,${lit(a.p_agreement_id)}::uuid,NULL::uuid,false,${lit(a.p_binding)}::jsonb)`
}
function positiveRollback(a: ConsumeArguments) {
  const before = history(a.p_company_id)
  const receipt = sql<Json>(`BEGIN;SET LOCAL ROLE service_role;SELECT ${consumeSql(a)};ROLLBACK;`)
  expect(receipt).toMatchObject({replayed: false, companyId: a.p_company_id,
    environment: 'test', messageId: a.p_message_id, agreementId: a.p_agreement_id, mandateId: null,
    consumptionId: expect.any(String)})
  expect(history(a.p_company_id)).toEqual(before)
}

function consumeConnection(a: ConsumeArguments, application: string, role: 'service_role' | 'anon' | 'authenticated' = 'service_role') {
  const child = spawn('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    {stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv()})
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => {stdout += String(chunk)})
  child.stderr.on('data', chunk => {stderr += String(chunk)})
  const done = new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({code, stdout, stderr}))
  })
  child.stdin.end(`SET application_name=${lit(application)};BEGIN;SET LOCAL ROLE ${role};
    SELECT ${consumeSql(a)};COMMIT;`)
  let disposed = false
  return {done, async dispose() {
    if (disposed) return; disposed = true
    if (child.exitCode === null) child.kill('SIGTERM')
    await done
  }}
}
function holding(statement: string, application = `ops04-holder-${randomUUID()}`) {
  const child = spawn('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    {stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv()})
  let output = ''
  child.stdout.on('data', chunk => {output += String(chunk)})
  const owned = nativeLockProcess(child, {marker: 'OPS04_HOLDER_READY',
    markerError: 'native_ops04_holder_not_ready', markerTimeoutMs: 10000, lifetimeMs: 60000})
  child.stdin.write(`SET application_name=${lit(application)};SELECT pg_backend_pid();BEGIN;
    ${statement}\n\\echo OPS04_HOLDER_READY\n`)
  return {...owned, async pid() {await owned.ready; const id = Number(output.split('\n')[0]);
    expect(Number.isInteger(id) && id > 0).toBe(true); return id}}
}
async function eventually(predicate: () => boolean, message: string, milliseconds = 10000) {
  const deadline = Date.now() + milliseconds
  do {if (predicate()) return; await wait(25)} while (Date.now() < deadline)
  throw Error(message)
}
function blocked(application: string, holderPid: number, relation?: string) {
  return sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity a
    WHERE a.application_name=${lit(application)} AND a.wait_event_type='Lock'
      AND ${holderPid}=ANY(pg_blocking_pids(a.pid)) ${relation ? `AND EXISTS(SELECT FROM pg_locks l
      WHERE l.pid=a.pid AND l.relation=${lit(relation)}::regclass AND NOT l.granted)` : ''}))`)
}
function expectRefusal(result: {code: number | null; stderr: string}, reason: string, sqlstate = 'P0001') {
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain(reason)
  expect(result.stderr).toContain(sqlstate)
  expect(result.stderr).not.toContain('57014')
}
async function expectLateHold(p: Awaited<ReturnType<typeof pausedSend>>, reason: string) {
  const result = await p.settle()
  expect(p.response()?.error?.message).toContain(reason)
  expect(result.value).toBeUndefined()
  expect(isSmtpDeliveryUncertain(result.error)).toBe(true)
  expect(external.send).toHaveBeenCalledTimes(p.providerBaseline)
  expect(loopback.image()).toEqual(p.smtpBaseline)
  // Late failures retain the actual entered attempt/audit. They are not early
  // zero-attempt holds, and never become authority for an automatic resend.
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts
    WHERE message_id=${lit(p.args.p_message_id)} AND entered_at IS NOT NULL`)).toBe(1)
}

it('actual authenticated normal trial consumes once after real entered MIME, sends once, preserves old incident originals and projects accepted replay', async () => {
  const f = await fixture(), providerBefore = external.send.mock.calls.length
  const before = loopback.image()
  current.client = f.sender.client; current.company = f.companyId
  const result = await sendControlledLiveEdielMessage(request(f))
  expect(result).toMatchObject({status: 'transport_observed', messageId: f.trial.id,
    productionApproved: false, reasons: []})
  expect(external.send).toHaveBeenCalledTimes(providerBefore + 1)
  expect(loopback.image()).toEqual({providerCalls: before.providerCalls + 1, connections: before.connections + 1,
    authenticated: before.authenticated + 1, accepted: before.accepted + 1})
  const delivered = loopback.messages.at(-1)!
  expect(delivered).toMatchObject({from: 'esco-native@example.invalid', to: ['dso-native@example.invalid'],
    authUser: 'esco-native@example.invalid', tlsVersion: expect.stringMatching(/^TLSv1\.[23]$/)})
  const rows = sql<Json[]>(`SELECT jsonb_agg(to_jsonb(c)) FROM gridex_ediel_ops04.consumptions c
    WHERE company_id=${lit(f.companyId)}`)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({message_id: f.trial.id, agreement_id: f.agreementId,
    mandate_id: null, binding: {lane: 'generic_journal', attemptId: expect.any(String)}})
  const bound = (rows[0].binding as Json).provider as Json
  expect(createHash('sha256').update(delivered.raw).digest('hex')).toBe(bound.mimeSha256)
  expect(delivered.raw.length).toBe(bound.mimeLength)
  const stable = history(f.companyId)
  expect(await sendControlledLiveEdielMessage(request(f))).toMatchObject({status: 'already_observed',
    messageId: f.trial.id, productionApproved: false})
  expect(history(f.companyId)).toEqual(stable)
  expect(external.send).toHaveBeenCalledTimes(providerBefore + 1)
  expect(loopback.image()).toEqual({providerCalls: before.providerCalls + 1, connections: before.connections + 1,
    authenticated: before.authenticated + 1, accepted: before.accepted + 1})
  expect(originalImage(f.sourceId, f.originalAckId)).toEqual(f.retainedOriginal)
})

it('positive dry rollback precedes real two-connection agreement expiry after the waiter has blocked while current', async () => {
  const f = await fixture({agreementSeconds: 30}), p = await pausedSend(f)
  let holder: ReturnType<typeof holding> | undefined, waiter: ReturnType<typeof consumeConnection> | undefined
  try {
    positiveRollback(p.args)
    const before = history(f.companyId)
    const validity = () => sql<{current: boolean; expired: boolean}>(`SELECT jsonb_build_object(
      'current',valid_from<=clock_timestamp() AND clock_timestamp()<valid_to,
      'expired',clock_timestamp()>=valid_to) FROM gridex_ediel_ops04.counterparty_agreements WHERE id=${lit(f.agreementId)}`)
    expect(validity()).toEqual({current: true, expired: false})
    holder = holding('LOCK TABLE gridex_ediel_ops04.consumptions IN SHARE ROW EXCLUSIVE MODE;')
    const pid = await holder.pid(), application = `ops04-expiry-${randomUUID()}`
    waiter = consumeConnection(p.args, application)
    await eventually(() => blocked(application, pid, 'gridex_ediel_ops04.consumptions'), 'actual_consume_lock_wait_required')
    expect(validity()).toEqual({current: true, expired: false})
    await eventually(() => {
      expect(blocked(application, pid)).toBe(true)
      expect(external.send).toHaveBeenCalledTimes(p.providerBaseline)
      return validity().expired
    }, 'actual_db_clock_expiry_while_blocked_required', 40000)
    await holder.release('COMMIT')
    expectRefusal(await waiter.done, 'ediel_ops04_current_agreement_required')
    expect(history(f.companyId)).toEqual(before)
    await expectLateHold(p, 'ediel_ops04_current_agreement_required')
    expect(history(f.companyId)).toEqual(before)
    expect(originalImage(f.sourceId, f.originalAckId)).toEqual(f.retainedOriginal)
  } finally {await holder?.dispose(); await waiter?.dispose(); await p.cleanup()}
})

it.each(['company', 'global'] as const)('pending real %s sender DENY is observed on the actual permission graph after a positive consume preflight', async scope => {
  const f = await fixture(), p = await pausedSend(f)
  let holder: ReturnType<typeof holding> | undefined, waiter: ReturnType<typeof consumeConnection> | undefined
  try {
    positiveRollback(p.args)
    holder = holding(`LOCK TABLE public.user_permission_overrides IN SHARE ROW EXCLUSIVE MODE;
      INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from)
      VALUES(${lit(f.sender.id)},${scope === 'company' ? lit(f.companyId) : 'NULL'},'communication.send','deny',true,clock_timestamp());`)
    const pid = await holder.pid(), application = `ops04-deny-${randomUUID()}`
    waiter = consumeConnection(p.args, application)
    await eventually(() => blocked(application, pid, 'public.user_permission_overrides'), 'actual_permission_graph_wait_required')
    expect(external.send).toHaveBeenCalledTimes(p.providerBaseline)
    await holder.release('COMMIT')
    const beforeFailedConsume = history(f.companyId)
    expectRefusal(await waiter.done, 'ediel_ops04_actor_forbidden', '42501')
    expect(history(f.companyId)).toEqual(beforeFailedConsume)
    const permission = await rpc('gridex_actor_has_company_permission', {p_actor_user_id: f.sender.id,
      p_company_id: f.companyId, p_permission: 'communication.send'})
    expect(permission.error).toBeNull(); expect(permission.data).toBe(false)
    await expectLateHold(p, 'ediel_ops04_actor_forbidden')
    expect(history(f.companyId)).toEqual(beforeFailedConsume)
  } finally {await holder?.dispose(); await waiter?.dispose(); await p.cleanup()}
})

it('two genuinely entered messages sharing one agreement serialize to exactly one consumption; both paused normal sends remain no-provider after direct consume', async () => {
  const f = await fixture(), second = await trialAck(f.base, f.tuple)
  await requirePositive(f, second)
  const first = await pausedSend(f)
  let secondPending: Awaited<ReturnType<typeof pausedSend>> | undefined
  let owner: ReturnType<typeof holding> | undefined, loser: ReturnType<typeof consumeConnection> | undefined
  try {
    secondPending = await pausedSend(f, second)
    positiveRollback(first.args); positiveRollback(secondPending.args)
    const before = history(f.companyId)
    owner = holding(`SET LOCAL ROLE service_role;CREATE TEMP TABLE native_ops04_receipt ON COMMIT DROP AS
      SELECT ${consumeSql(first.args)} AS receipt;
      SELECT 1/CASE WHEN (receipt->>'replayed')::boolean IS FALSE THEN 1 ELSE 0 END FROM native_ops04_receipt;`)
    const pid = await owner.pid(), application = `ops04-oneuse-${randomUUID()}`
    loser = consumeConnection(secondPending.args, application)
    await eventually(() => blocked(application, pid, 'gridex_ediel_ops04.consumptions'), 'actual_oneuse_wait_required')
    expect(external.send).toHaveBeenCalledTimes(first.providerBaseline)
    await owner.release('COMMIT')
    // Serialization can produce P0001 authorization_consumed. A 23505 is not
    // required, and timeout/early hold cannot satisfy the one-use oracle.
    expectRefusal(await loser.done, 'ediel_ops04_authorization_consumed')
    const after = history(f.companyId)
    for (const table of tables.filter(table => table !== 'consumptions')) expect(after[table]).toEqual(before[table])
    expect(after.consumptions).toEqual([expect.objectContaining({message_id: f.trial.id, agreement_id: f.agreementId})])
    const replay = sql<Json>(`BEGIN;SET LOCAL ROLE service_role;SELECT ${consumeSql(first.args)};ROLLBACK;`)
    expect(replay).toMatchObject({replayed: true, messageId: f.trial.id})
    const a = await first.settle()
    expect(first.response()?.data).toMatchObject({replayed: true})
    expect(isSmtpDeliveryUncertain(a.error)).toBe(true)
    await expectLateHold(secondPending, 'ediel_ops04_authorization_consumed')
    expect(history(f.companyId)).toEqual(after)
    expect(external.send).toHaveBeenCalledTimes(first.providerBaseline)
  } finally {await owner?.dispose(); await loser?.dispose(); await first.cleanup(); await secondPending?.cleanup()}
})

it.each(['relay_capture', 'incident_correction'] as const)('real %s revocation after entered positive preflight refuses final consume and preserves retained originals', async kind => {
  const f = await fixture(), p = await pausedSend(f)
  try {
    positiveRollback(p.args)
    await revoke(f, kind, kind === 'relay_capture' ? f.captureId : f.correctionId)
    const before = history(f.companyId)
    await expectLateHold(p, kind === 'relay_capture' ? 'ediel_ops04_current_capture_required' : 'ediel_ops04_current_correction_required')
    expect(history(f.companyId)).toEqual(before)
    expect(originalImage(f.sourceId, f.originalAckId)).toEqual(f.retainedOriginal)
  } finally {await p.cleanup()}
})

it('exact source and committed MIME fields reject forged copies of genuine captured arguments after positive dry rollback', async () => {
  const f = await fixture(), p = await pausedSend(f)
  try {
    positiveRollback(p.args)
    const before = history(f.companyId)
    for (const [mutate, reason] of [
      [(copy: ConsumeArguments) => {copy.p_binding.message.sourcePayloadHash = '0'.repeat(64)}, 'ediel_ops04_source_binding_changed'],
      [(copy: ConsumeArguments) => {copy.p_binding.message.recipient = 'foreign@example.invalid'}, 'ediel_ops04_source_binding_changed'],
      [(copy: ConsumeArguments) => {copy.p_binding.provider.mimeSha256 = '0'.repeat(64)}, 'ediel_ops04_entered_archive_required'],
      [(copy: ConsumeArguments) => {copy.p_binding.provider.mimePayloadSnapshotId = randomUUID()}, 'ediel_ops04_entered_archive_required'],
    ] as const) {
      const copy = structuredClone(p.args); mutate(copy)
      const probe = consumeConnection(copy, `ops04-forged-${randomUUID()}`)
      try {expectRefusal(await probe.done, reason)} finally {await probe.dispose()}
      expect(history(f.companyId)).toEqual(before)
    }
    // These are untrusted-input checks against real unchanged DB rows, not a
    // claim that immutable source bytes were physically mutated.
    await revoke(f, 'relay_capture', f.captureId)
    await expectLateHold(p, 'ediel_ops04_current_capture_required')
    expect(originalImage(f.sourceId, f.originalAckId)).toEqual(f.retainedOriginal)
  } finally {await p.cleanup()}
})

it('real native anon/authenticated RPC denial and private-schema/RLS boundaries coexist with genuine positive service-role consume admission', async () => {
  const f = await fixture(), p = await pausedSend(f)
  try {
    positiveRollback(p.args)
    const before = history(f.companyId)
    for (const role of ['anon', 'authenticated'] as const) {
      const probe = consumeConnection(p.args, `ops04-role-${role}-${randomUUID()}`, role)
      try {expectRefusal(await probe.done, 'permission denied for function', '42501')}
      finally {await probe.dispose()}
      expect(history(f.companyId)).toEqual(before)
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const boundary = sql<Json>(`SELECT jsonb_build_object(
        'schemaUsage',has_schema_privilege(${lit(role)},'gridex_ediel_ops04','USAGE'),
        'directSelect',EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='gridex_ediel_ops04' AND c.relkind='r' AND has_table_privilege(${lit(role)},c.oid,'SELECT')),
        'directInsert',EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='gridex_ediel_ops04' AND c.relkind='r' AND has_table_privilege(${lit(role)},c.oid,'INSERT')))`)
      expect(boundary).toEqual({schemaUsage: false, directSelect: false, directInsert: false})
      expect(() => sql(`BEGIN;SET LOCAL ROLE ${role};SELECT to_jsonb(x)
        FROM gridex_ediel_ops04.incident_corrections x WHERE id=${lit(f.correctionId)};ROLLBACK;`))
        .toThrow('permission denied for schema gridex_ediel_ops04')
    }
    expect(sql(`SELECT jsonb_build_object('tables',count(*),'allRlsForced',bool_and(c.relrowsecurity AND c.relforcerowsecurity),
      'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='gridex_ediel_ops04'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gridex_ediel_ops04' AND c.relkind='r'`))
      .toEqual({tables: 6, allRlsForced: true, policies: 0})
    for (const [table, id] of [['incident_corrections', f.correctionId],
      ['counterparty_agreements', f.agreementId], ['relay_captures', f.captureId]] as const) {
      expect(() => sql(`BEGIN;UPDATE gridex_ediel_ops04.${table} SET id=id WHERE id=${lit(id)};ROLLBACK;`))
        .toThrow('ediel_ops04_evidence_immutable')
      expect(() => sql(`BEGIN;DELETE FROM gridex_ediel_ops04.${table} WHERE id=${lit(id)};ROLLBACK;`))
        .toThrow('ediel_ops04_evidence_immutable')
      expect(history(f.companyId)).toEqual(before)
    }
    await revoke(f, 'relay_capture', f.captureId)
    await expectLateHold(p, 'ediel_ops04_current_capture_required')
  } finally {await p.cleanup()}
})



type Row = Record<string, unknown>
type Ops04TestTupleInput = {
  companyId: string
  actorUserId: string
  receiverEdielId: string
  /** Existing public ACK route/profile; prospective profile configuration only. */
  routeId: string
  routeProfileId: string
}
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`ops04_tuple_missing:${field}`)
  return value.trim()
}

/** Disposable prospective TEST configuration only. No incident, correction,
 * agreement, mandate, accepted receipt or readiness result is seeded here.
 * Configures the existing PUBLIC ACK profile BEFORE a new trial source/ACK
 * is born. Old accepted incident messages, archives and attempts stay exact.
 * A second active same-grid-owner ACK route is deliberately never inserted: the
 * actual canonical selector refuses ambiguous routes. No private source changes.
 * Existing synthetic CA publisher supplies real throwaway public X.509/CRL
 * material. This is not an external counterparty or market certification.
 */
function configureTuple(input: Ops04TestTupleInput) {
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'receiverEdielId') expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  }
  const sourceImage = () => sql<unknown>(`SELECT jsonb_build_object(
    'route',(SELECT to_jsonb(r) FROM public.communication_routes r WHERE r.id=${lit(input.routeId)} AND r.company_id=${lit(input.companyId)}),
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.ediel_messages m WHERE m.communication_route_id=${lit(input.routeId)} AND m.company_id=${lit(input.companyId)}))`)
  const before = sourceImage()
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE
    communication_route_id=${lit(input.routeId)} OR route_profile_id=${lit(input.routeProfileId)}`)).toBe(0)
  const source = sql<{route: Row; profile: Row}>(`SELECT jsonb_build_object('route',to_jsonb(r),'profile',to_jsonb(p))
    FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
    WHERE r.id=${lit(input.routeId)} AND r.company_id=${lit(input.companyId)} AND r.is_active AND r.route_scope='ediel_ack'
      AND r.environment_type='bilateral_test' AND p.id=${lit(input.routeProfileId)} AND p.environment='test' AND p.is_enabled AND p.is_active IS NOT FALSE`)
  expect(source).toBeTruthy()
  expect(source.profile.receiver_ediel_id).toBe(input.receiverEdielId)
  const recipientEmail = text(source.profile.smtp_to ?? source.route.target_email, 'recipientEmail')
  const senderEmail = text(source.profile.mailbox, 'senderEmail')
  const smtpHost = text(source.profile.smtp_host, 'smtpHost')
  const smtpPort = source.profile.smtp_port
  expect(Number.isInteger(smtpPort) && Number(smtpPort) > 0).toBe(true)
  const trust = publishSyntheticRecipientTrust({companyId: input.companyId, actorUserId: input.actorUserId,
    environment: 'test', receiverEdielId: input.receiverEdielId, recipientEmail})
  const certificateId = randomUUID(), counterpartyId = randomUUID(), transportProfileId = randomUUID()
  const routeId = input.routeId, routeProfileId = input.routeProfileId
  const validFrom = new Date(trust.leaf.validFrom).toISOString(), validTo = new Date(trust.leaf.validTo).toISOString()
  sql(`BEGIN;
    INSERT INTO public.ediel_counterparties(id,company_id,environment,counterparty_name,counterparty_ediel_id,counterparty_role,
      email,is_active,lifecycle_status,source,source_verified_at,created_by,updated_by)
    VALUES(${lit(counterpartyId)},${lit(input.companyId)},'test','Synthetic OPS04 receiver',${lit(input.receiverEdielId)},'grid_owner',
      ${lit(recipientEmail)},true,'verified','synthetic_native_test_configuration',clock_timestamp(),${lit(input.actorUserId)},${lit(input.actorUserId)});
    INSERT INTO public.ediel_transport_profiles(id,company_id,environment,name,transport_channel,direction,sender_email,receiver_email,
      host,port,is_platform_shared,is_active,created_by,updated_by)
    VALUES(${lit(transportProfileId)},${lit(input.companyId)},'test','Synthetic OPS04 outbound transport','smtp','outbound',
      ${lit(senderEmail)},${lit(recipientEmail)},${lit(smtpHost)},${lit(smtpPort)},false,true,${lit(input.actorUserId)},${lit(input.actorUserId)});
    INSERT INTO public.ediel_certificates(id,company_id,scope,environment,certificate_fingerprint,secret_reference,status,
      subject,issuer,serial_number,fingerprint_sha256,public_certificate_pem,valid_from,valid_to,certificate_valid_from,certificate_valid_to,
      owner_ediel_id,message_family,message_type,purpose,usage,created_by,updated_by)
    VALUES(${lit(certificateId)},${lit(input.companyId)},'tenant','test',${lit(trust.leaf.fingerprint256)},'public://synthetic-ops04-test','active',
      ${lit(trust.leaf.subject)},${lit(trust.leaf.issuer)},${lit(trust.leaf.serialNumber)},${lit(trust.fingerprint)},${lit(trust.leafPem)},
      ${lit(validFrom)},${lit(validTo)},${lit(validFrom)},${lit(validTo)},${lit(input.receiverEdielId)},'APERAK','APERAK','encryption','outbound_recipient',
      ${lit(input.actorUserId)},${lit(input.actorUserId)});
    UPDATE public.ediel_route_profiles SET
      counterparty_id=${lit(counterpartyId)},transport_profile_id=${lit(transportProfileId)},
      receiver_certificate_id=${lit(certificateId)},certificate_id=${lit(certificateId)},certificate_environment='test',
      encryption_mode='none',transport_security_mode='unencrypted',certificate_required=true,
      signing_mode='none',tls_required=true,is_test_route=true,is_production_route=false,
      production_mode='disabled',allow_unencrypted_production=false,updated_by=${lit(input.actorUserId)},updated_at=clock_timestamp()
    WHERE id=${lit(routeProfileId)} AND communication_route_id=${lit(routeId)} AND company_id=${lit(input.companyId)};
    COMMIT;`)
  expect(sourceImage()).toEqual(before)
  expect(sql(`SELECT jsonb_build_object('route',count(*)=1,'profile',bool_and(p.is_enabled AND p.is_active AND p.environment='test'
      AND p.counterparty_id=${lit(counterpartyId)}::uuid AND p.transport_profile_id=${lit(transportProfileId)}::uuid
      AND p.receiver_certificate_id=${lit(certificateId)}::uuid AND p.certificate_required AND p.communication_route_id=${lit(routeId)}::uuid))
    FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
    WHERE r.id=${lit(routeId)} AND p.id=${lit(routeProfileId)} AND r.company_id=${lit(input.companyId)}`)).toEqual({route: true, profile: true})
  return {companyId: input.companyId, environment: 'test' as const, routeId, routeProfileId, counterpartyId, transportProfileId,
    certificateId, certificateFingerprint: trust.fingerprint, certificateValidFrom: validFrom, certificateValidTo: validTo,
    trustRegistrationId: trust.registrationId, receiverEdielId: input.receiverEdielId, recipientEmail,
    sourceRouteId: input.routeId, sourceRouteProfileId: input.routeProfileId}
}

/** Test-owned TLS SMTP recipient, not a provider response stub. It binds only
 * IPv4 loopback on a kernel-assigned port and never opens outbound connections.
 * Actual Node TLS verifies the ephemeral server chain/127.0.0.1 SAN via worker
 * startup trust from this suite's config. AUTH and MAIL/RCPT/DATA must all really
 * complete before 250 acceptance; retain the dot-unstuffed exact MIME bytes.
 */
async function startLoopbackSmtp() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
    || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('owned_local_verified_tls_required')
  const directory = process.env.GRIDEX_OPS04_LOOPBACK_PKI
  const password = process.env.GRIDEX_OPS04_LOOPBACK_PASSWORD
  if (!directory || !password || process.env.NODE_EXTRA_CA_CERTS !== join(directory, 'worker-ca.pem'))
    throw Error('actual_worker_startup_loopback_trust_required')
  const username = 'esco-native@example.invalid', recipient = 'dso-native@example.invalid'
  const stats = {connections: 0, authenticated: 0, accepted: 0}
  const messages: Array<{from: string; to: string[]; raw: Buffer; authUser: string; tlsVersion: string}> = []
  const sockets = new Set<TLSSocket>()
  const errors: string[] = []
  const server = createServer({key: readFileSync(join(directory, 'server.key')),
    cert: readFileSync(join(directory, 'server.pem')), minVersion: 'TLSv1.2'}, socket => {
    if (socket.remoteAddress !== '127.0.0.1') {socket.destroy(); return}
    sockets.add(socket); stats.connections++
    socket.setTimeout(10000, () => socket.destroy())
    socket.on('error', error => {errors.push(error.message)})
    socket.on('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0), authenticated = false, from: string | null = null
    let recipients: string[] = [], data: Buffer[] | null = null, dataBytes = 0
    let challenge: 'plain' | 'username' | 'password' | null = null, loginUser = ''
    const reply = (text: string) => socket.write(text + '\r\n')
    const resetEnvelope = () => {from = null; recipients = []; data = null; dataBytes = 0}
    const verify = (user: string, candidate: string) => {
      if (user === username && candidate === password) {
        if (!authenticated) stats.authenticated++
        authenticated = true; reply('235 2.7.0 authentication successful')
      } else {authenticated = false; reply('535 5.7.8 authentication failed')}
    }
    const plain = (encoded: string) => {
      const values = Buffer.from(encoded, 'base64').toString('utf8').split('\0')
      if (values.length !== 3 || values[0] !== '' && values[0] !== username) {
        authenticated = false; reply('535 5.7.8 authentication failed'); return
      }
      verify(values[1], values[2])
    }
    reply('220 localhost ESMTP SYNTHETIC OPS04 LOOPBACK')
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      // This finite synthetic fixture is small. An unbounded/non-SMTP client
      // cannot retain the producer process or accumulate unlimited memory.
      if (buffer.length > 1024 * 1024) {socket.destroy(Error('native_smtp_line_limit')); return}
      for (;;) {
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const physical = buffer.subarray(0, end)
        buffer = buffer.subarray(end + 2)
        if (data) {
          if (physical.length === 1 && physical[0] === 46) {
            if (!authenticated || !from || recipients.length !== 1) {
              reply('554 5.5.1 qualified authenticated envelope required'); resetEnvelope(); continue
            }
            const tlsVersion = socket.getProtocol() ?? ''
            if (!/^TLSv1\.[23]$/.test(tlsVersion)) {socket.destroy(Error('native_smtp_tls_version_required')); return}
            messages.push({from, to: [...recipients], raw: Buffer.concat(data), authUser: username, tlsVersion})
            stats.accepted++
            resetEnvelope(); reply(`250 2.0.0 loopback accepted ${stats.accepted}`)
          } else {
            const line = physical[0] === 46 ? physical.subarray(1) : physical
            dataBytes += line.length + 2
            if (dataBytes > 8 * 1024 * 1024) {socket.destroy(Error('native_smtp_message_limit')); return}
            data.push(Buffer.from(line), Buffer.from('\r\n'))
          }
          continue
        }
        const line = physical.toString('ascii')
        if (challenge) {
          const stage = challenge; challenge = null
          if (stage === 'plain') plain(line)
          else if (stage === 'username') {loginUser = Buffer.from(line, 'base64').toString('utf8');
            challenge = 'password'; reply('334 UGFzc3dvcmQ6')}
          else verify(loginUser, Buffer.from(line, 'base64').toString('utf8'))
          continue
        }
        const command = line.split(' ', 1)[0].toUpperCase()
        if (command === 'EHLO' || command === 'HELO') {
          reply('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SIZE 8388608')
        } else if (command === 'AUTH') {
          const [, mechanism, value] = line.split(/\s+/)
          if (mechanism?.toUpperCase() === 'PLAIN') {
            if (value) plain(value); else {challenge = 'plain'; reply('334 ')}
          } else if (mechanism?.toUpperCase() === 'LOGIN') {
            if (value) {loginUser = Buffer.from(value, 'base64').toString('utf8');
              challenge = 'password'; reply('334 UGFzc3dvcmQ6')}
            else {challenge = 'username'; reply('334 VXNlcm5hbWU6')}
          } else reply('504 5.5.4 authentication mechanism unsupported')
        } else if (command === 'MAIL') {
          const sender = /^MAIL FROM:<([^>]+)>(?:\s.*)?$/i.exec(line)?.[1]
          if (!authenticated) reply('530 5.7.0 authentication required')
          else if (sender !== username) reply('550 5.7.1 synthetic sender required')
          else {resetEnvelope(); from = sender; reply('250 2.1.0 sender accepted')}
        } else if (command === 'RCPT') {
          const target = /^RCPT TO:<([^>]+)>(?:\s.*)?$/i.exec(line)?.[1]
          if (!authenticated || !from) reply('503 5.5.1 authenticated MAIL required')
          else if (target !== recipient || recipients.length) reply('550 5.1.1 synthetic single recipient required')
          else {recipients.push(target); reply('250 2.1.5 recipient accepted')}
        } else if (command === 'DATA') {
          if (!authenticated || !from || recipients.length !== 1) reply('503 5.5.1 qualified envelope required')
          else {data = []; dataBytes = 0; reply('354 end data with <CRLF>.<CRLF>')}
        } else if (command === 'RSET') {resetEnvelope(); reply('250 2.0.0 reset')}
        else if (command === 'NOOP') reply('250 2.0.0 ok')
        else if (command === 'QUIT') {reply('221 2.0.0 bye'); socket.end()}
        else reply('500 5.5.2 command unsupported')
      }
    })
  })
  server.on('tlsClientError', error => {errors.push(error.message)})
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({host: '127.0.0.1', port: 0}, () => {server.off('error', reject); resolve()})
  })
  server.on('error', error => {errors.push(error.message)})
  const address = server.address()
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close(); throw Error('actual_loopback_listener_required')
  }
  return {port: address.port, password, messages, errors, image: () => ({providerCalls: smtpBridge.calls, ...stats}),
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('native_loopback_smtp_cleanup_timeout')), 5000)
        server.close(error => {clearTimeout(timer); if (error) reject(error); else resolve()})
      })
    }}
}
