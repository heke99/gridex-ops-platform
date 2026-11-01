// Actual producer state machine with finite Auth/HTTP/APPEND/read ports. These
// fixtures are not native original data, real authentication or issuer approval.
import { beforeEach, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { PGlite } from '@electric-sql/pglite'
vi.mock('@supabase/ssr', () => ({ createServerClient: () => { throw Error('No Auth service in components') } }))
vi.mock('../scripts/simulation/track3/lib/seed.mjs', () => ({ adminClient: () => { throw Error('No privileged service in components') }, sqlJson: () => { throw Error('No database in components') }, lit: (value: string) => "'" + value.replaceAll("'", "''") + "'", newRunContext: () => ({ prefix: 'T3COMPONENT', runId: 'component' }), COUNTERPARTY_EDIEL_ID: '70007', OWN_EDIEL_ID: '16700' }))
vi.mock('../scripts/simulation/track3/lib/counterparty', () => ({ appendToInbox: () => { throw Error('No real APPEND in components') } }))
vi.mock('../scripts/simulation/track3/lib/app', () => ({ triggerInbound: () => { throw Error('No real HTTP in components') } }))
import { createIssuerUnderlay, issuerAuthorityFingerprint, buildUnapprovedChallenge, UNDERLAY_NAMES, UNDERLAY_MATRIX, underlayInput, type UnderlayPorts, type Foundation } from '../scripts/simulation/track3/lib/issuer-underlay'
type Row = Record<string, unknown>
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const input = underlayInput.parse({ schema: 'track3-controlled-issuer-underlay-input-v2', runLabel: 'component', validityHours: 1,
  measurementUsageFrom: '2026-01-01T00:00:00Z', measurementUsageUntil: '2027-01-01T00:00:00Z', periodStart: '202607010000', quantity: '1',
  meteringPoint: '735999260000000000', legalIdentity: ['88991', '160', 'SVK'], deliveryLegalIdentity: ['88993', '160', 'SVK'], negativeLegalIdentity: ['88992', '160', 'SVK'], transportSender: ['CONTROLLED', 'ZZ'] })
type Mode = 'ok' | 'foundation-unknown' | 'http-unknown' | 'denied-writes' | 'birth-held' | 'replay-changed' | 'equal-collapsed' | 'revocation-unobserved' | 'independence-bypassed' | 'reviewer-no-current-permission' | 'tombstone-erased' | 'damaged-accepted' | 'stale-approved' | 'uncovered-approved' | 'mismatch-approved' | 'missing-505' | 'tombstone-missing-505' | 'denied-bypassed' | 'delivery-first-held' | 'delivery-collision' | 'delivery-retrofit' | 'delivery-revoked' | 'delivery-immutable-changed'
function harness(mode: Mode = 'ok', actualInput = input) {
  let payloadForOriginal = ''
  const artifacts = new Map<string, { body: Row; receipt: Row; actor: string }>(), history = new Set<string>(), sources = new Map<string, Row>()
  const evidence = new Map<string, unknown>(), observed = new Map<string, unknown>(), calls: string[] = []
  const actors = { A: { id: randomUUID(), email: 'a@test.invalid' }, B: { id: randomUUID(), email: 'b@test.invalid' }, R: { id: randomUUID(), email: 'r@test.invalid' }, D: { id: randomUUID(), email: 'd@test.invalid' } }
  const companyId = randomUUID(), mailboxId = randomUUID(), epochId = randomUUID(), namespaceId = randomUUID(), issuerVersionId = randomUUID(), mandateVersionId = randomUUID(), negativeId = randomUUID(), originalId = randomUUID()
  const foundation: Foundation = { companyId, mailboxId, receiver: '16700', actors, applications: [{ applicationReference: 'A', actorUserId: actors.A.id }, { applicationReference: 'B', actorUserId: actors.B.id }] }
  const bindings = foundation.applications.map(value => ({ ...value, applicationId: randomUUID() }))
  let nativeWrites = 0, seq = 0, revoked = false, firstIssuance: Row | undefined, receiveCount = 0
  let delivery = false
  const deliveryIds = { epochId: randomUUID(), namespaceId: randomUUID(), issuerVersionId: randomUUID(), mandateVersionId: randomUUID() }
  const common = () => ({ companyId, environment: 'test', assurance: 'controlled_test_only', epochId, namespaceId, issuerVersionId, mandateVersionId,
    applicationBindings: bindings, applicationInventorySha256: digest('inventory'), ...(delivery ? deliveryIds : {}), legalIdentity: delivery ? input.deliveryLegalIdentity : input.legalIdentity, retentionArtifactId: randomUUID(), journalSequence: String(++seq), journalHeadSha256: digest(String(seq)), marketActivationGranted: false, productionAuthorityGranted: false })
  const ports: UnderlayPorts = {
    input: actualInput, prefix: 'T3COMPONENT', evidence: { save: (key, value) => { evidence.set(key, value); return key }, observe: (key, value) => { observed.set(key, value) } },
    preflight: async () => { calls.push('preflight') },
    foundation: async () => { calls.push('foundation'); if (mode === 'foundation-unknown') throw Error('unknown user creation'); return foundation },
    cleanup: async () => { calls.push('cleanup') },
    reviewerProof: async () => ({ actorId: actors.R.id, companyId, allowed: mode !== 'reviewer-no-current-permission' }),
    fingerprint: async () => ({ nativeWrites }),
    immutable: async id => ({ id, originalHash: digest(id + (mode === 'delivery-immutable-changed' && sources.get(id)?.delivery && [...sources.values()].filter(value => value.delivery).length === 3 ? String(++nativeWrites) : '')), originalAdmission: 'unchanged' }),
    challenge: async payload => { calls.push('actual-challenge-port'); const source = { sourceMessageId: negativeId, sourcePayloadSha256: digest(payload) }; sources.set(negativeId, source); return source },
    issuer: async id => ({ status: sources.get(id)?.delivery ? ((mode === 'delivery-first-held' && [...sources.values()].filter(value => value.delivery).length === 3 && sources.get(id)?.deliveryIndex === 0) || mode === 'delivery-revoked' ? 'held' : history.has(id) ? 'qualified' : 'held') : revoked && mode !== 'revocation-unobserved' ? 'held' : history.has(id) ? 'qualified' : 'held', authorityVersionId: id === negativeId ? null : sources.get(id)?.delivery ? deliveryIds.issuerVersionId : issuerVersionId,
      holdReason: revoked ? 'ediel_utilts_foreign_issuer_basis_revoked' : 'awaiting_source_history', messageReferenceCollision: sources.get(id)?.delivery ? mode === 'delivery-collision' : id !== negativeId && id !== originalId,
      transactionReferenceCollisions: !sources.get(id)?.delivery && mode !== 'missing-505' && !(mode === 'tombstone-missing-505' && [...artifacts.values()].some(value => value.receipt.kind === 'test_delete' && value.receipt.reviewed)) && id !== negativeId && id !== originalId ? [{ transactionIndex: 0, transactionId: /IDE\+24\+([^'\r\n]+)/.exec(payloadForOriginal)?.[1] }] : [] }),
    receive: async (issued, replay, payload) => {
      if (!payloadForOriginal) payloadForOriginal = payload
      calls.push(replay ? 'replay-APPEND-port' : 'issued-APPEND-port')
      if (replay) return sources.get(originalId)!
      const id = receiveCount++ === 0 ? originalId : randomUUID(), source = { sourceMessageId: id, sourcePayloadSha256: digest(payload), issuanceId: issued.issuanceId, delivery, deliveryIndex: [...sources.values()].filter(value => value.delivery).length }
      sources.set(id, source); return source
    },
    http: async (actor, path, value) => {
      calls.push(`${actor}:HTTP`)
      if (mode === 'http-unknown' && actor === 'A') throw Error('unknown mutation after request')
      if (actor === 'D' && mode !== 'denied-bypassed') { if (mode === 'denied-writes') nativeWrites++; return { status: 403, body: { error: 'denied' } } }
      if (path.includes('?artifactId=')) { const actual = artifacts.get(path.split('=')[1])!; return { status: 200, body: { ...actual.receipt, reviewId: null } } }
      const command = value as Row
      const originals = command.originals as Row[] | undefined
      if (mode !== 'damaged-accepted' && originals?.some(item => item.sha256 === '0'.repeat(64))) return { status: 400, body: { error: 'invalid original hash' } }
      if (path.endsWith('/review')) {
        const artifactId = path.split('/').at(-2)!, prior = artifacts.get(artifactId)!
        if (command.decision === 'approve' && prior.actor === actor && mode !== 'independence-bypassed') return { status: 403, body: { error: 'independent reviewer required' } }
        if (command.decision === 'revoke') { revoked = true; nativeWrites++; return { status: 200, body: { ...prior.receipt, ...common(), commandId: command.commandId, status: 'revoked' } } }
        if (command.decision === 'hold') return { status: 409, body: { ...prior.receipt, commandId: command.commandId, epochId: null, status: 'held' } }
        if (mode === 'birth-held' && prior.receipt.kind === 'test_birth') return { status: 409, body: { ...prior.receipt, commandId: command.commandId, status: 'held' } }
        if (prior.receipt.kind === 'test_checkpoint' && prior.body.expectedHeadSha256 === '0'.repeat(64) && mode !== 'stale-approved') return { status: 403, body: { error: 'checkpoint cutoff changed' } }
        if (prior.receipt.kind === 'history') {
          const checkpoint = artifacts.get(String(prior.body.checkpointArtifactId))
          const actual = sources.get(String(prior.body.sourceMessageId))
          if ((!checkpoint?.receipt.reviewed && mode !== 'uncovered-approved') || (actual?.issuanceId !== prior.body.currentIssuanceId && mode !== 'mismatch-approved')) return { status: 403, body: { error: 'source or checkpoint unqualified' } }
        }
        if (prior.receipt.kind === 'test_birth' && JSON.stringify(prior.body.legalIdentity) === JSON.stringify(input.deliveryLegalIdentity)) { delivery = true; if (mode === 'delivery-retrofit') deliveryIds.namespaceId = namespaceId }
        nativeWrites++
        prior.receipt.reviewed = true
        const approved = { ...prior.receipt, ...common(), commandId: command.commandId, status: 'approved' }
        if (prior.receipt.kind === 'history') { const id = String(prior.body.sourceMessageId); history.add(id); Object.assign(approved, { sourceMessageId: id, sourcePayloadSha256: sources.get(id)!.sourcePayloadSha256 }) }
        return { status: 200, body: approved }
      }
      if (revoked && command.kind !== 'test_birth' && !delivery) return { status: 403, body: { error: 'revoked' } }
      const kind = command.kind as string, body = command.body as Row, artifactId = randomUUID()
      const result: Row = { ...common(), commandId: command.commandId, kind, artifactId, artifactSha256: digest(artifactId), scopeSha256: digest('scope-' + artifactId), status: 'archived' }
      if (kind === 'test_birth') result.epochId = null
      if (['test_issue', 'test_replay', 'test_correction'].includes(kind)) {
        const issuanceId = kind === 'test_replay' ? body.issuanceId : mode === 'equal-collapsed' && firstIssuance && actor === 'A' ? firstIssuance.issuanceId : randomUUID()
        Object.assign(result, { status: 'issued', issuanceId, internetMessageId: `<${issuanceId}@test.gridex.invalid>`, mimeSha256: digest(String(issuanceId)) })
        if (kind === 'test_replay' && mode === 'replay-changed') result.internetMessageId = '<different@test.invalid>'
        result.originals = kind === 'test_replay' ? mode === 'tombstone-erased' && seq > 10 ? [] : firstIssuance?.originals : [{ role: 'issued_mime', bytesBase64: Buffer.from('FINITE MIME ' + issuanceId).toString('base64') }]
        firstIssuance ??= result
      }
      artifacts.set(artifactId, { body, receipt: result, actor }); return { status: 201, body: result }
    },
  }
  return { producer: createIssuerUnderlay(ports), calls, evidence, observed, artifacts }
}
beforeEach(() => vi.clearAllMocks())
it('executes all ten real producer callbacks through finite ports and emits only its separate underlay matrix', async () => {
  const c = harness(); for (let index = 0; index < UNDERLAY_NAMES.length; index++) await c.producer.step(index)
  expect(c.observed.get('evidenceMatrix')).toEqual(UNDERLAY_MATRIX)
  const effects = c.evidence.get('underlay/actual-effects.json') as { validation: { epoch: Row }; delivery: { epoch: Row; sources: Row[]; finalQualification: string } }
  expect(effects.delivery.sources).toHaveLength(3); expect(effects.delivery.epoch.namespaceId).not.toBe(effects.validation.epoch.namespaceId)
  expect(effects.delivery.sources.every(value => (value.currentRead as Row).status === 'qualified')).toBe(true)
  expect(effects.delivery.finalQualification).toBe('NOT_RUN')
  expect(c.calls).toContain('actual-challenge-port'); expect(c.calls.filter(value => value === 'issued-APPEND-port')).toHaveLength(6)
  expect(c.calls.filter(value => value === 'replay-APPEND-port')).toHaveLength(1)
  expect(UNDERLAY_NAMES).toHaveLength(10); expect(UNDERLAY_NAMES.some(name => /EDIEL\d/.test(name))).toBe(false)
  expect([...c.evidence.keys()].some(key => key.endsWith('/intent.json'))).toBe(true)
})
it.each(['foundation-unknown', 'http-unknown', 'denied-writes', 'birth-held', 'replay-changed', 'equal-collapsed', 'revocation-unobserved', 'independence-bypassed', 'reviewer-no-current-permission', 'tombstone-erased', 'damaged-accepted', 'stale-approved', 'uncovered-approved', 'mismatch-approved', 'missing-505', 'tombstone-missing-505', 'denied-bypassed', 'delivery-first-held', 'delivery-collision', 'delivery-retrofit', 'delivery-revoked', 'delivery-immutable-changed'] as const)('preserves %s failure with no implicit command, user, APPEND or prefix retry', async mode => {
  const c = harness(mode)
  let failed = false
  for (let index = 0; index < UNDERLAY_NAMES.length; index++) { try { await c.producer.step(index) } catch { failed = true; break } }
  expect(failed).toBe(true)
  const before = [...c.calls]
  await expect(c.producer.step(0)).rejects.toThrow('one-attempt')
  expect(c.calls).toEqual(before); expect(c.observed.has('evidenceMatrix')).toBe(false)
})
it('fails closed on an explicit failed assertion latch before any new operation', async () => {
  const c = harness(); await c.producer.step(0); c.producer.hold(); const before = [...c.calls]
  await expect(c.producer.step(1)).rejects.toThrow(); expect(c.calls).toEqual(before)
})
it('does not skip an unapproved physical source or substitute the main issuer identity', async () => {
  const c = harness(); await c.producer.step(0); await c.producer.step(1)
  expect(c.calls).toContain('actual-challenge-port')
  const evidence = c.evidence.get('underlay/unapproved-challenge.json') as Row
  expect(evidence.label).toContain('UNAPPROVED_CHALLENGE'); expect(evidence.label).toContain('never an approved managed issuance')
})

it('runs actual scenario hooks and retains the primary callback error alongside cleanup and evidence failures', async () => {
  const callbacks: Array<() => Promise<void>> = [], before: Array<() => Promise<void>> = [], after: Array<() => Promise<void>> = []
  const primary = Error('actual producer callback failure'), cleanup = Error('owned cleanup failure'), evidence = Error('private finalize failure')
  let held = false
  const source = readFileSync(new URL('../scripts/simulation/track3/scenarios/issuer-underlay.test.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const hook: Array<(value: { task: { result: { state: string } } }) => void> = []
  vm.runInNewContext(js, { exports: {}, AggregateError, Error, require: (id: string) => {
    if (id === 'vitest') return { beforeAll: (fn: () => Promise<void>) => before.push(fn), afterAll: (fn: () => Promise<void>) => after.push(fn), afterEach: (fn: typeof hook[number]) => hook.push(fn), describe: (_: string, fn: () => void) => fn(), it: (_: string, fn: () => Promise<void>) => callbacks.push(fn) }
    if (id.endsWith('/evidence')) return { Evidence: class { finalize() { throw evidence } } }
    if (id.endsWith('/issuer-underlay')) return { UNDERLAY_NAMES, createNativeIssuerUnderlay: async () => ({ step: async () => { throw primary }, hold: () => { held = true }, close: async () => { throw cleanup } }) }
    throw Error('Unexpected actual scenario dependency ' + id)
  } })
  expect(callbacks).toHaveLength(10)
  await before[0](); await expect(callbacks[0]()).rejects.toBe(primary)
  hook[0]({ task: { result: { state: 'fail' } } }); expect(held).toBe(true)
  try { await after[0](); throw Error('Expected combined original and cleanup failure') } catch (error) {
    expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([primary, cleanup, evidence])
  }
})

it('executes the actual native fingerprint queries against the actual migration DDL and observes namespace changes', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY);')
    const root = process.env.E03_REVIEW_SOURCE_ROOT ? new URL(`file://${process.env.E03_REVIEW_SOURCE_ROOT}/`) : new URL('../', import.meta.url)
    const migration = readFileSync(new URL('supabase/migrations/20261001015127_ediel_utilts_foreign_issuer_observed_identity_authority.sql', root), 'utf8')
    const ddl = migration.slice(migration.indexOf('CREATE SCHEMA'), migration.indexOf('CREATE FUNCTION'))
    await db.exec(ddl)
    const query = async (statement: string) => {
      const result = await db.query<Record<string, unknown>>(statement)
      return Object.values(result.rows[0])[0]
    }
    const before = await issuerAuthorityFingerprint(query)
    expect(before).toHaveLength(4)
    expect(before.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))).toBe(true)
    expect(new Set(before).size).toBe(1)
    await db.exec("INSERT INTO gridex_utilts_issuer.namespaces(environment,registry_actor_key) VALUES('test','finite-component-only')")
    const after = await issuerAuthorityFingerprint(query)
    expect(after[0]).not.toBe(before[0]); expect(after.slice(1)).toEqual(before.slice(1))
  } finally { await db.close() }
}, 60_000)

it('independently decodes the actual prebirth challenge MIME into its exact authored EDIFACT payload', () => {
  const raw = "UNB+UNOC:3+CONTROLLED:ZZ+16700:ZZ+261101:1200+PHYSICAL'\r\nUNH+1+UTILTS:D:04B:UN:S4'\r\nBGM+E66+PHYSICAL+9'\r\nUNT+3+1'\r\nUNZ+1+PHYSICAL'"
  const built = buildUnapprovedChallenge(raw, 'ediel@t3.sim.invalid', 'T3PHYSICAL')
  const actual = parseInboundEmailContent({ rawEmail: built.mime.toString('utf8') })
  expect(actual?.rawPayload).toBe(raw)
})

it('rejects duplicate whole delivery legal identity before fixture or HTTP effects', async () => {
  const c = harness('ok', { ...input, deliveryLegalIdentity: [...input.legalIdentity] })
  await expect(c.producer.step(0)).rejects.toThrow('three distinct full legal identities')
  expect(c.calls).toEqual([])
})
