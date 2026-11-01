// Component regressions for actual T3 callbacks/helpers with finite I/O ports.
// No service, database, native scenario or campaign PASS is produced.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../scripts/simulation/track3/', import.meta.url))
const refused = () => { throw new Error('Undeclared service operation') }
const lit = (x: unknown) => "'" + String(x).replaceAll("'", "''") + "'"
class Evidence {
  observations: Record<string, unknown> = {}
  save() { return 'memory-only' }
  observe(key: string, value: unknown) { this.observations[key] = value }
  finalize() { return 'memory-only' }
}
type DeclaredSource = { outboxId: string | null; ackMessageId: string | null; sourceMessageId: string; companyId: string }
type ControlledSteps = {
  Timing: new () => object
  drain: (id: string, timing: object, label: string, ids?: readonly string[]) => Promise<unknown>
  flushQueuedInAcceptMode: (timing: object) => Promise<unknown>
  seedWithRetry: <T extends DeclaredSource>(timing: object, label: string, make: (attempt: number) => Promise<T>, log: unknown[]) => Promise<T>
}
function load<T = Record<string, unknown>>(file: string, ports: Record<string, unknown>, bridge = '', globals: Record<string, unknown> = {}): T {
  const exports: Record<string, unknown> = {}
  const filename = path.join(root, file)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code + '\n' + bridge, {
    exports, Buffer, process: { env: { T3_E01_N: '28', EDIEL_AUTOMATION_ACTOR_USER_ID: 'synthetic-actor' } },
    require: (name: string) => {
      if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name)
      return ports[name]
    }, console: { info() {}, log() {} },
    // Actual Timing.sleep takes the same branch while its timer is a finite port.
    setTimeout: (f: () => void) => { f(); return 1 }, ...globals,
  }, { filename, timeout: 5000 })
  return exports as T
}
function register() {
  const tests = new Map<string, () => Promise<void>>()
  const test = Object.assign((name: string, fn: () => Promise<void>) => tests.set(name, fn), {
    each: () => () => {}, skip() {},
  })
  return { tests, ports: { expect, it: test, describe: (_: string, fn: () => void) => fn(),
    beforeAll() {}, afterAll() {}, afterEach() {} } }
}
function legacy(mode: 'stable' | 'changed' | 'missing' | 'empty' | 'read-rejected' | 'missing-path' | 'missing-manifest') {
  const r = register(); let reads = 0
  const sqlIn = (q: string) => {
    if (q.includes("metadata->>'archive_path' AS path")) return mode === 'missing-manifest' ? [] : [{ path: mode === 'missing-path' ? '' : 'synthetic/archive.eml' }]
    if (q.includes('SELECT id FROM public.ediel_messages WHERE related_message_id')) return [{ id: 'ack-source' }]
    if (q.includes("jsonb_build_object('k',k,'j',j)")) return [{ k: 'stable-row', j: { id: 'stable-row', value: 1 } }]
    if (q.includes('LEGACY-%')) return []
    throw new Error('Undeclared SQL read')
  }
  const adminClient = () => ({ storage: { from: () => ({ download: async () => {
    reads++
    if (mode === 'missing') return { data: null, error: { message: 'synthetic archive unavailable' } }
    const bytes = Buffer.from(mode === 'empty' ? '' : mode === 'changed' && reads > 1 ? 'changed MIME' : 'original MIME')
    return { data: { arrayBuffer: async () => { if (mode === 'read-rejected') throw new Error('synthetic byte read failed'); return bytes } }, error: null }
  } }) } })
  const unit = load<{ controlledBaseline: () => Promise<void> }>('scenarios/ediel01.test.ts', {
    'node:crypto': crypto, 'node:fs': { readFileSync: refused }, vitest: r.ports,
    '../lib/app': { triggerInbound: refused, triggerOutbox: refused },
    '../lib/counterparty': { setSmtpMode: refused, receivedMail: refused, counterpartyState: async () => ({ stored: 0 }) },
    '../lib/db': { lit, resetMailboxSchedule: refused },
    '../lib/e01-chain': { sourceRows: () => [{ id: 'source' }], Timer: class {} },
    '../lib/e01-fixture': { sqlIn, OWN_EDIEL_ID: '16701' },
    '../lib/e01-tls': {}, '../lib/evidence': { Evidence }, '../lib/inprocess': {},
    '../lib/seed.mjs': { adminClient, newRunContext: () => ({ prefix: 'synthetic' }), DSO_EMAIL: 'dso@example.invalid', COUNTERPARTY_EDIEL_ID: '70007' },
  }, "exports.controlledBaseline=async()=>{legacyBaseline=await legacyHashes('source')};")
  const callback = [...r.tests].find(([n]) => n.startsWith('EDIEL01.06 post: äldre failed'))?.[1]
  if (!callback) throw new Error('Actual legacy callback missing')
  return { prepare: unit.controlledBaseline, callback, get reads() { return reads } }
}
function steps(queueCount: number) {
  let triggerCalls = 0, modeCalls = 0
  const source = { prefix: 'fixture', seq: 1, companyId: 'own-company', outboxId: 'own', ackMessageId: 'ack', sourceMessageId: 'source' }
  let inventory: unknown = [{ id: 'own', companyId: 'own-company', ackMessageId: 'ack', sourceMessageId: 'source', environment: 'test', status: 'queued',
    ackCompanyId: 'own-company', ackSourceMessageId: 'source', sourceCompanyId: 'own-company', sourceEnvironment: 'test', direction: 'outbound', family: 'CONTRL' },
  ...(queueCount ? [{ id: 'foreign', status: 'queued' }] : [])]
  const unit = load<ControlledSteps>('lib/e03-steps.ts', {
    'node:crypto': crypto,
    './app': { triggerOutbox: async () => { triggerCalls++; return { status: 200, ms: 1, body: { result: { processed: queueCount } } } } },
    './counterparty': { setSmtpMode: async () => { modeCalls++ }, receivedMail: refused, readReceivedEml: refused },
    './e03-fixture': { otherClaimable: () => queueCount, mode: () => 'test' },
    './seed.mjs': { lit, sql: () => String(queueCount), sqlJson: () => inventory },
  })
  return { unit, source, setInventory: (value: unknown) => { inventory = value },
    ownRow: { id: 'own', companyId: 'own-company', ackMessageId: 'ack', sourceMessageId: 'source', environment: 'test', status: 'queued',
      ackCompanyId: 'own-company', ackSourceMessageId: 'source', sourceCompanyId: 'own-company', sourceEnvironment: 'test', direction: 'outbound', family: 'CONTRL' },
    prepare: () => unit.seedWithRetry(new unit.Timing(), 'own', async () => source, []), get triggerCalls() { return triggerCalls }, get modeCalls() { return modeCalls } }
}
function lostResponse(extra: 'none' | 'same-rfc' | 'new-rfc' | 'generic-error' | 'bad-byte-hash' | 'wrong-company') {
  const r = register()
  const messages: Array<{ n: number; raw: Buffer; sha256: string; envelopeFrom: string; envelopeTo: string[]; disposition: string; sha256Matches: boolean }> = []
  const events: Record<string, unknown>[] = []
  let transportCalls = 0, drainCalls = 0
  const raw = (rfc: string) => Buffer.from('Message-ID: ' + rfc + '\r\n\r\nSAME ACK PAYLOAD')
  const attempt = { id: 'attempt1', classification: 'unknown', entered_at: '2026-01-01T00:00:00Z',
    observed_at: '2026-01-01T00:00:01Z', binding: { rfcMessageId: '<original@example.invalid>',
      mimeSha256: crypto.createHash('sha256').update(raw('<original@example.invalid>')).digest('hex'),
      originalHash: crypto.createHash('sha256').update('SAME ACK PAYLOAD').digest('hex') } }
  const addMail = (rfc: string) => messages.push({ n: messages.length + 1, raw: raw(rfc),
    sha256: extra === 'bad-byte-hash' ? '0'.repeat(64) : crypto.createHash('sha256').update(raw(rfc)).digest('hex'), envelopeFrom: 'own@example.invalid', envelopeTo: ['dso@example.invalid'],
    disposition: 'received-no-reply-connection-dropped', sha256Matches: true })
  const fixture = { prefix: 'synthetic', seq: 1, companyId: 'own-company', sourceMessageId: 'source', ackMessageId: 'ack', outboxId: 'outbox' }
  const outbox = () => ({ status: 'delivery_uncertain', last_error: 'unknown' })
  const counterpart = {
    setSmtpMode: async () => ({}), receivedMail: async () => messages,
    readReceivedEml: (n: number) => ({ raw: messages[n - 1].raw, sha256: crypto.createHash('sha256').update(messages[n - 1].raw).digest('hex'), sha256Matches: true }),
  }
  // Execute the real capture, rfcIdOf, mimeCopiesFor, drain and Timing helpers.
  const helper = load('lib/e03-steps.ts', {
    'node:crypto': crypto, './counterparty': counterpart,
    './app': { triggerOutbox: async () => { drainCalls++; if (drainCalls === 1) addMail('<original@example.invalid>');
      return { status: 200, ms: 1, body: { result: { processed: drainCalls === 1 ? 1 : 0, results: [] } } } } },
    './e03-fixture': { mode: () => 'test', otherClaimable: () => 0, outboxRow: outbox,
      attemptsFor: () => [attempt], eventsFor: async () => [] },
    './seed.mjs': { lit, sql: () => '0', sqlJson: () => [{ id: fixture.outboxId, companyId: fixture.companyId,
      ackMessageId: fixture.ackMessageId, sourceMessageId: fixture.sourceMessageId, environment: 'test', status: outbox().status,
      ackCompanyId: fixture.companyId, ackSourceMessageId: fixture.sourceMessageId, sourceCompanyId: fixture.companyId,
      sourceEnvironment: 'test', direction: 'outbound', family: 'CONTRL' }] },
  })
  const finiteHelper = { ...helper,
    operatorVisibility: () => ({ deadLetters: [], tasks: [] }),
  }
  const collectEvidence = class extends Evidence {
    observe(key: string, value: unknown) { events.push({ key, value }); super.observe(key, value) }
  }
  load('scenarios/ediel03-03.test.ts', {
    'node:crypto': crypto, vitest: r.ports, '../lib/counterparty': counterpart,
    '../lib/evidence': { Evidence: collectEvidence },
    '../lib/seed.mjs': { newRunContext: () => ({ prefix: 'synthetic' }) },
    '../lib/e03-fixture': { outboxRow: outbox, seedInboundSource: async () => fixture },
    '../lib/e03-steps': finiteHelper,
    '@/lib/ediel/outbox/sendOutboxItem': { sendOutboxItem: async () => ({ status: 'blocked' }) },
    '@/lib/ediel/db': { getEdielMessageById: async () => ({ id: 'ack', company_id: extra === 'wrong-company' ? 'foreign-company' : fixture.companyId,
      related_message_id: fixture.sourceMessageId, message_family: 'CONTRL', direction: 'outbound', raw_payload: 'SAME ACK PAYLOAD' }) },
    '@/lib/ediel/transport': { sendEdielMessageViaSmtp: async () => {
      transportCalls++
      if (extra === 'same-rfc' || extra === 'new-rfc') addMail(extra === 'same-rfc' ? '<original@example.invalid>' : '<new-rfc@example.invalid>')
      throw new Error(extra === 'generic-error' ? 'synthetic connection error before admission' : 'ediel_transport_resend_suppressed')
    } },
    '@/lib/ediel/recovery/prodatRecovery': { prepareAndQueueProdatRecovery: async () => ({ status: 'hold', reason: 'verified_transfer_loss_required' }) },
  })
  const callback = [...r.tests].find(([n]) => n.startsWith('EDIEL03.03 drop-after-data'))?.[1]
  if (!callback) throw new Error('Actual unknown-outcome callback missing')
  return { callback, messages, events, get transportCalls() { return transportCalls } }
}
describe('T3 actual legacy byte-preservation oracle', () => {
  it('accepts actual stable bytes', async () => { const c = legacy('stable'); await c.prepare(); await c.callback(); expect(c.reads).toBe(2) })
  it('rejects actual changed bytes', async () => { const c = legacy('changed'); await c.prepare(); await expect(c.callback()).rejects.toThrow() })
  it('must refuse unavailable original bytes before claiming unchanged archive', async () => {
    const c = legacy('missing'); await expect(async () => { await c.prepare(); await c.callback() }).rejects.toThrow('T3_HARNESS_PRECONDITION')
  })
})
describe('T3 actual queue-effect admission', () => {
  it('permits an own-only drain', async () => { const c = steps(0); await c.prepare(); await c.unit.drain('own', new c.unit.Timing(), 'own'); expect(c.triggerCalls).toBe(1) })
  it('must refuse foreign queued rows before calling the environment-wide worker', async () => {
    const c = steps(1); await c.prepare(); await expect(c.unit.drain('own', new c.unit.Timing(), 'foreign')).rejects.toThrow('T3_HARNESS_PRECONDITION'); expect(c.triggerCalls).toBe(0)
  })
})
describe('T3 actual unknown-outcome physical-copy oracle', () => {
  it('accepts one original MIME and blocked retry', async () => { const c = lostResponse('none'); await c.callback(); expect(c.messages).toHaveLength(1); expect(c.transportCalls).toBe(1) })
  it('rejects a second physical MIME with the same RFC ID', async () => { const c = lostResponse('same-rfc'); await expect(c.callback()).rejects.toThrow(); expect(c.messages).toHaveLength(2) })
  it('must also reject the second physical MIME with a fresh RFC ID', async () => {
    const c = lostResponse('new-rfc'); await expect(c.callback()).rejects.toThrow('all owned physical MIME copies')
  })
})

function unknownIssuer(mode: 'denied' | 'poll-failed' | 'business-effect' | 'healthy-diagnostics' | 'missing-source' | 'foreign-email' | 'unrelated-source' | 'wrong-hash' | 'missing-denial' | 'infrastructure-denial' | 'processing-error' | 'failed-parse') {
  const r = register()
  const polls: unknown[] = []
  let drains = 0
  const fixture = { companyId: 'own-company', customerId: 'own-customer', pointId: 'own-point', meteringPoint: 'synthetic-point' }
  const parsed = mode === 'poll-failed' || mode === 'missing-source' ? [] : ['own-source']
  const summary = mode === 'poll-failed'
    ? { error: 'synthetic IMAP connection failed', storedIds: [] }
    : { storedIds: ['own-email'], stored: 1, edielMessageIds: ['own-source'], errorsByMailbox: mode === 'healthy-diagnostics' ? [{ errors: [] }] : [] }
  const mime = Buffer.from('synthetic MIME'), mimeSha = crypto.createHash('sha256').update(mime).digest('hex')
  const flow = {
    inject: async () => ({ mime, sha256: mimeSha }),
    poll: async () => { polls.push(summary); return { out: { ok: mode !== 'poll-failed' }, summary } },
    groundAndReprocess: async () => ({ 'own-source': { reprocess: mode === 'processing-error' ? { ok: false, error: 'synthetic timeout; unknown outcome' } : { ok: true } } }),
    drain: async () => { drains++; return { mails: [] } },
  }
  // Execute actual deliverE02, including empty storedIds -> empty ids on failed poll.
  const flowModule = load('lib/e02-flow.ts', {
    'node:crypto': crypto, './counterparty': {}, './app': {}, './evidence': {}, './inprocess': {}, './mime': {},
    './e02-seed': {}, './seed.mjs': { lit, sqlJson: () => parsed },
  })
  const sql = (q: string) => {
    if (q.includes('processing_status'))
      return JSON.stringify(mode === 'poll-failed' ? [] : [{ id: 'own-email', status: mode === 'failed-parse' ? 'failed' : 'manual_review', company: mode === 'foreign-email' ? 'foreign-company' : fixture.companyId, sender: '70099', rawSha256: mimeSha }])
    if (q.includes('FROM gridex_utilts_issuer.source_admissions')) return JSON.stringify(mode === 'missing-denial' ? [] : [{ sourceId: 'own-source', companyId: fixture.companyId,
      environment: 'test', sourceHash: mode === 'wrong-hash' ? '0'.repeat(64) : crypto.createHash('sha256').update('synthetic EDIFACT').digest('hex'), namespaceId: null,
      issuerVersionId: null, mandateVersionId: null, holdReason: mode === 'infrastructure-denial' ? 'ediel_utilts_issuer_identity_read_failed' : 'ediel_utilts_foreign_issuer_basis_unavailable', emailId: 'own-email' }])
    if (q.includes('FROM public.ediel_messages')) return JSON.stringify(mode === 'poll-failed' ? [] : [{ id: mode === 'unrelated-source' ? 'unrelated-source' : 'own-source', dir: 'inbound', family: 'UTILTS', company: fixture.companyId }])
    if (q.includes('FROM public.customer_operation_tasks')) return '[]'
    throw new Error('Undeclared SQL read')
  }
  const unit = load<{ controlledPrime: (context: unknown) => void }>('scenarios/ediel02-auth.test.ts', {
    'node:crypto': crypto, vitest: r.ports, '../lib/counterparty': { purgeInbox: async () => 0, receivedMail: async () => [] },
    '../lib/e02-edifact': { buildE02Utilts: () => ({ raw: 'synthetic EDIFACT', transactionRef: 'synthetic-tx' }) },
    '../lib/e02-flow': { deliverE02: flowModule.deliverE02, lit, sql },
    '../lib/e02-seed': { e02MeteringPoint: () => fixture.meteringPoint, seedE02Routable: () => fixture,
      masterDataFingerprint: () => 'unchanged', reprocessInbound: async () => ({ ok: true }) },
    '../lib/e02-state': { e02Counts: () => ({ series: mode === 'business-effect' ? 1 : 0,
      meteringValues: 0, normalized: 0, billingUnderlays: 0, invoices: 0 }), e02Quantities: () => ({ metering: [], billing: [] }) },
    '../lib/e02-setup': { setupE02: refused },
  }, 'exports.controlledPrime=s=>S=s;')
  unit.controlledPrime({ flow, run: { prefix: 'synthetic' }, mode: 'test', ev: new Evidence() })
  const callback = [...r.tests].find(([n]) => n.startsWith('EDIEL02.05b '))?.[1]
  if (!callback) throw new Error('Actual unknown-issuer callback missing')
  return { callback, polls, get drains() { return drains } }
}
describe('T3 actual unknown-issuer denial must reach qualified reception', () => {
  it('accepts controlled reception with actual refusal and no business effects', async () => { const c = unknownIssuer('denied'); await c.callback(); expect(c.polls).toHaveLength(1) })
  it('rejects physical business effects', async () => { await expect(unknownIssuer('business-effect').callback()).rejects.toThrow() })
  it('must refuse failed IMAP setup with no email or source before drain', async () => {
    const c = unknownIssuer('poll-failed')
    await expect(c.callback()).rejects.toThrow('T3_HARNESS_PRECONDITION: actual IMAP reception')
    expect(c.drains).toBe(0)
  })
  it('permits an empty-error mailbox diagnostic from healthy reception', async () => { await expect(unknownIssuer('healthy-diagnostics').callback()).resolves.toBeUndefined() })
  it.each(['missing-source','foreign-email','unrelated-source','wrong-hash','missing-denial','infrastructure-denial','processing-error','failed-parse'] as const)('refuses %s as a supported issuer denial', async mode => {
    await expect(unknownIssuer(mode).callback()).rejects.toThrow()
  })
})

describe('T3 byte acquisition fails before preservation assertions', () => {
  it.each(['empty', 'read-rejected', 'missing-path', 'missing-manifest'] as const)('refuses %s', async mode => {
    const c = legacy(mode)
    await expect(async () => { await c.prepare(); await c.callback() }).rejects.toThrow()
  })
})
describe('T3 complete explicit active outbox ownership', () => {
  it.each(['prepared', 'queued', 'sending'])('refuses foreign %s including a still-valid sending lease', async status => {
    const c = steps(0); await c.prepare()
    c.setInventory([c.ownRow, { ...c.ownRow, id: 'foreign', status, lockedAt: new Date().toISOString() }])
    await expect(c.unit.drain('own', new c.unit.Timing(), 'foreign')).rejects.toThrow('unassigned active')
    expect(c.triggerCalls).toBe(0)
  })
  it('permits exactly the two explicitly seeded and assigned sending rows', async () => {
    const c = steps(0); await c.prepare()
    await c.unit.seedWithRetry(new c.unit.Timing(), 'own2', async () => ({ ...c.source, outboxId: 'own2', ackMessageId: 'ack2', sourceMessageId: 'source2' }), [])
    c.setInventory([{ ...c.ownRow, status: 'sending' }, { ...c.ownRow, id: 'own2', ackMessageId: 'ack2', sourceMessageId: 'source2', ackSourceMessageId: 'source2', status: 'sending' }])
    await c.unit.drain('own', new c.unit.Timing(), 'own2', ['own', 'own2'])
    expect(c.triggerCalls).toBe(1)
  })
  it('does not infer assignment from a second known fixture or shared company', async () => {
    const c = steps(0); await c.prepare()
    await c.unit.seedWithRetry(new c.unit.Timing(), 'own2', async () => ({ ...c.source, outboxId: 'own2', ackMessageId: 'ack2', sourceMessageId: 'source2' }), [])
    c.setInventory([c.ownRow, { ...c.ownRow, id: 'own2', status: 'sending' }])
    await expect(c.unit.drain('own', new c.unit.Timing(), 'incomplete', ['own'])).rejects.toThrow()
    expect(c.triggerCalls).toBe(0)
  })
  it.each([null, {}, [], [{ id: 'own' }]])('refuses malformed or incomplete backend inventory %j', async inventory => {
    const c = steps(0); await c.prepare(); c.setInventory(inventory)
    await expect(c.unit.drain('own', new c.unit.Timing(), 'bad')).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.triggerCalls).toBe(0)
  })
  it('refuses duplicate IDs before invoking worker', async () => {
    const c = steps(0); await c.prepare()
    await expect(c.unit.drain('own', new c.unit.Timing(), 'bad', ['own', 'own'])).rejects.toThrow()
    expect(c.triggerCalls).toBe(0)
  })
  it('does no worker/mode mutation for an empty fresh phase', async () => {
    const c = steps(0); c.setInventory([])
    await expect(c.unit.flushQueuedInAcceptMode(new c.unit.Timing())).resolves.toMatchObject({ workerInvoked: false, claimed: 0 })
    expect(c.triggerCalls).toBe(0); expect(c.modeCalls).toBe(0)
  })
  it('preserves unknown prefixture sending rows without flushing or changing SMTP mode', async () => {
    const c = steps(0); c.setInventory([{ ...c.ownRow, id: 'foreign', status: 'sending' }])
    await expect(c.unit.flushQueuedInAcceptMode(new c.unit.Timing())).rejects.toThrow()
    expect(c.triggerCalls).toBe(0); expect(c.modeCalls).toBe(0)
  })
  it('does not retry or flush after a partial seed times out', async () => {
    const c = steps(0), error = new Error('statement timeout; outcome unknown'); let attempts = 0
    await expect(c.unit.seedWithRetry(new c.unit.Timing(), 'partial', async () => { attempts++; throw error }, [])).rejects.toBe(error)
    expect(attempts).toBe(1); expect(c.triggerCalls).toBe(0); expect(c.modeCalls).toBe(0)
  })
  it('preserves SLA-only successful fixtures without inventing an ACK or worker assignment', async () => {
    const c = steps(0), fixture = { ...c.source, outboxId: null, ackMessageId: null }
    await expect(c.unit.seedWithRetry(new c.unit.Timing(), 'sla', async () => fixture, [])).resolves.toEqual(fixture)
    expect(c.triggerCalls).toBe(0)
  })
})
describe('T3 capture and semantic fence preconditions', () => {
  it.each(['generic-error', 'bad-byte-hash', 'wrong-company'] as const)('refuses %s as evidence of safe no-resend', async mode => {
    await expect(lostResponse(mode).callback()).rejects.toThrow()
  })
})
