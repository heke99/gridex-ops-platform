// Execute the real E01 drain helper and legacy callback with finite service
// ports. Input receipt admission needs its own tests; this is no scenario PASS.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'

const filename = fileURLToPath(new URL('../scripts/simulation/track3/scenarios/ediel01.test.ts', import.meta.url))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(101), mailboxId = id(102), sourceId = id(1), emailId = id(2), ackId = id(3), outboxId = id(4)
const raw = "UNB+UNOC:3+70007:ZZ+16701:ZZ+261101:1200+OWNREF++23-DDQ-E66-T++1++1'\r\nUNH+1+UTILTS:D:02B:UN:E5SE5A'\r\nBGM+E66::260+OWNDOC+9+AB'\r\nIDE+24+OWNTX'\r\nUNT+4+1'\r\nUNZ+1+OWNREF'"
const eml = Buffer.from('Message-ID: <own@t3.sim.invalid>\r\nContent-Type: application/edifact\r\n\r\n' + raw + '\r\n')
const hash = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex')
const input = { seq: 0, spec: { seq: 0, raw, interchangeRef: 'OWNREF', documentRef: 'OWNDOC', transactionRef: 'OWNTX', meteringPoint: '735999260000000000' },
  subject: 'E66 synthetic 000', messageId: '<own@t3.sim.invalid>', eml, mailId: emailId, sourceId }
type Variant = 'exact' | 'http500' | 'http500-restore-fails' | 'throw' | 'unknown' | 'sending' | 'pre-sending' | 'http-intake-failure' | 'http-intake-incomplete' | 'http-batched'
type Status = 'prepared' | 'queued' | 'sending'
const binding = {
  id: outboxId, companyId, environment: 'test', ackMessageId: ackId, sourceMessageId: sourceId, status: 'queued',
  ackCompanyId: companyId, ackEnvironment: 'test', ackSourceMessageId: sourceId, ackDirection: 'outbound', ackFamily: 'CONTRL',
  outboxFamily: 'CONTRL', ackPayloadSha256: hash("UNH+1+CONTRL:D:3:UN'"), sourceCompanyId: companyId, sourceEnvironment: 'test',
  direction: 'inbound', inboundEmailMessageId: emailId, mailboxId, mimeSha256: hash(eml), sourcePayloadSha256: hash(parseInboundEmailContent({ rawEmail: eml.toString('utf8') })!.rawPayload),
  emailCompanyId: companyId, emailEnvironment: 'test',
}

function harness(variant: Variant = 'exact', foreignStatus?: Status, foreignEnvironment = 'test') {
  const callbacks = new Map<string, () => Promise<void>>()
  const beforeHooks: Array<() => Promise<void>> = [], afterHooks: Array<() => Promise<void>> = []
  type HookContext = { task: { result: { state: 'pass' | 'fail' } } }
  const eachHooks: Array<(context: HookContext) => unknown> = []
  const modes: string[] = [], requests: unknown[] = []
  const evidence = new Map<string, unknown>()
  const serviceEffects: string[] = []
  let engineCalls = 0
  let httpCalls = 0
  const secondRaw = raw.replaceAll('OWNREF', 'SECONDREF').replaceAll('OWNDOC', 'SECONDDOC').replaceAll('OWNTX', 'SECONDTX')
  const secondMime = Buffer.from('Message-ID: <second@t3.sim.invalid>\r\nContent-Type: application/edifact\r\n\r\n' + secondRaw + '\r\n')
  const secondBinding = { ...binding, id: id(8), ackMessageId: id(7), sourceMessageId: id(5), ackSourceMessageId: id(5), inboundEmailMessageId: id(6),
    mimeSha256: hash(secondMime), sourcePayloadSha256: hash(parseInboundEmailContent({ rawEmail: secondMime.toString('utf8') })!.rawPayload) }
  const sourceRows = () => [{ id: sourceId, inbound_email_message_id: emailId, interchange_reference: 'OWNREF', external_reference: 'OWNDOC' },
    ...(variant === 'http-batched' && httpCalls >= 2 ? [{ id: id(5), inbound_email_message_id: id(6), interchange_reference: 'SECONDREF', external_reference: 'SECONDDOC' }] : [])]
  let legacy = false
  const actualBinding = () => ({ ...binding, status: requests.length ? legacy ? 'failed' : variant === 'unknown' ? 'delivery_uncertain' : variant === 'sending' ? 'sending' : 'sent' : variant === 'pre-sending' ? 'sending' : 'queued' })
  const inventory = () => [actualBinding(), ...(foreignStatus && foreignEnvironment === 'test' ? [{ ...binding, id: id(99), ackMessageId: id(98), status: foreignStatus, lockedAt: '2026-11-01T12:00:00Z' }] : [])]
  const ackRow = () => ({ id: ackId, company_id: companyId, environment: 'test', message_family: 'CONTRL', status: requests.length ? legacy ? 'failed' : 'sent' : 'queued',
    ack_outcome: 'positive', related_message_id: sourceId, interchange_reference: 'ACKREF', external_reference: null,
    raw_payload: "UNH+1+CONTRL:D:3:UN'", outbox_id: outboxId,
    outbox_status: requests.length ? legacy ? 'failed' : 'sent' : 'queued', send_attempt_count: requests.length })
  const sql = (query: string): unknown => {
    if (query.includes('t3-e01:startup-inventory') || query.includes('t3-e01:smtp-inventory')) return foreignStatus ? 1 : 0
    if (query.includes('FROM public.ediel_mailboxes')) return { id: mailboxId, imap_port: 3993, metadata: {} }
    if (query.includes('UPDATE public.ediel_mailboxes')) { serviceEffects.push('mailbox-update'); return 0 }
    if (query.includes('FROM public.inbound_email_messages WHERE subject')) return sourceRows().map(row => ({ id: row.inbound_email_message_id, subject: 'synthetic' }))
    if (query.includes('FROM public.ediel_messages m JOIN')) return variant === 'http-intake-incomplete' ? [] : sourceRows()
    if (query.includes('FROM public.inbound_processing_jobs')) return []
    if (query.includes('t3-e01:inventory') || query.includes('t3-e02:inventory')) return inventory()
    if (query.includes('t3-e01:dispatch-status')) return [{ id: outboxId, status: actualBinding().status }]
    if (query.includes('t3-e02:emails') || query.includes('t3-e02:sources')) return [binding, ...(variant === 'http-batched' ? [secondBinding] : [])]
      .filter(row => query.includes(`'${row.inboundEmailMessageId}'`) || query.includes(`'${row.sourceMessageId}'`))
    if (query.includes('t3-e02:outputs')) return [actualBinding()]
    if (query.includes('FROM public.ediel_outbox') && query.includes('SELECT count(*)')) {
      if (query.includes('NOT IN')) return foreignStatus ? 1 : 0
      return variant === 'exact' || variant === 'throw' ? 0 : 1
    }
    if (query.includes("m.message_family='CONTRL'")) return [ackRow()]
    if (query.includes('SELECT id FROM public.ediel_messages WHERE related_message_id')) return [{ id: ackId }]
    if (query.includes("jsonb_build_object('k',k,'j',j)")) return [{ k: 'own-row', j: { id: sourceId } }]
    if (query.includes("metadata->>'archive_path' AS path")) return [{ path: 'synthetic/legacy.eml' }]
    if (query.includes('INSERT INTO public.outbound_requests')) return 0
    throw new Error('Undeclared SQL operation: finite E01 drain port')
  }
  class Evidence { dir = '/private/synthetic'; save(name: string, value: unknown) { evidence.set(name, value) } observe() {} finalize() {} }
  class Timer { async p<T>(_label: string, fn: () => Promise<T>): Promise<T> { return fn() } summary() { return {} } }
  const admissionExports: { E02OutboxAdmission?: new (scope: unknown, query: unknown) => { rememberMime: (mime: Buffer) => void; observePoll: (stored: string[], source: string[]) => void } } = {}
  const admissionCode = ts.transpileModule(readFileSync(fileURLToPath(new URL('../scripts/simulation/track3/lib/e02-outbox.ts', import.meta.url)), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(admissionCode, { exports: admissionExports, Buffer, require: (name: string) => {
    if (name === 'node:crypto') return crypto
    if (name === '@/lib/inbound-mail/edielEmailParser') return { parseInboundEmailContent }
    if (name === './seed.mjs') return { sqlJson: sql, lit: (x: string) => "'" + x.replaceAll("'", "''") + "'" }
    throw new Error('Undeclared receipt import')
  } }, { timeout: 5000 })
  const admission = new admissionExports.E02OutboxAdmission!({ companyId, environment: 'test', mailboxId }, sql)
  admission.rememberMime(eml)
  if (variant === 'http-batched') admission.rememberMime(secondMime)
  admission.observePoll([emailId], [sourceId])
  const engineResult = { fetchedMessages: 1, storedEmails: 1, dedupedEmails: 0, failedJobs: 0, processedJobs: 0,
    inboundEmailMessageIds: [emailId], edielMessageIds: [sourceId], debug: { errorsByMailbox: [], autoProcessErrors: [], configurationError: null,
      customerOperationJobs: { claimed: 0, completed: 0, failed: 0, needsReview: 0, errors: [] } } }
  // Actual intake helper/qualification code, with only service ports substituted.
  const chain: Record<string, unknown> = {}
  const chainPorts: Record<string, unknown> = {
    'node:perf_hooks': { performance: { now: () => 0 } }, './counterparty': { appendToInbox: async () => {}, purgeInbox: async () => 0 },
    './db': { resetMailboxSchedule: () => {} }, './e01-fixture': { sqlIn: sql },
    './inprocess': { runInboundEngineAsAutomationActor: async () => { engineCalls++; return { ok: true, result: engineResult } } },
    './mime': {}, './seed.mjs': { lit: (s: string) => "'" + s.replaceAll("'", "''") + "'" }, 'node:fs': {}, 'node:path': {},
    '@/lib/inbound-mail/edielMailboxPoller': { processQueuedInboundProcessingJobs: async () => ({ processed: 0, failed: 0 }) },
    '@/lib/inbound-mail/edielInboundProcessor': {},
  }
  runInNewContext(ts.transpileModule(readFileSync(fileURLToPath(new URL('../scripts/simulation/track3/lib/e01-chain.ts', import.meta.url)), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: chain, Buffer, process: { env: { EDIEL_AUTOMATION_ACTOR_USER_ID: id(103) } }, require: (name: string) => {
    if (!Object.hasOwn(chainPorts, name)) throw new Error('Undeclared intake import')
    return chainPorts[name]
  } }, { timeout: 5000 })
  const ports: Record<string, unknown> = {
    'node:crypto': crypto, 'node:fs': { readFileSync },
    vitest: { expect, it: (name: string, fn: () => Promise<void>) => callbacks.set(name, fn), describe: (_name: string, fn: () => void) => fn(),
      beforeAll: (fn: () => Promise<void>) => beforeHooks.push(fn), afterAll: (fn: () => Promise<void>) => afterHooks.push(fn), afterEach: (fn: (context: HookContext) => unknown) => eachHooks.push(fn) },
    '../lib/app': { triggerInbound: async () => {
      httpCalls++
      return { status: variant === 'http-intake-failure' ? 500 : 200, ok: variant !== 'http-intake-failure',
        ms: 1, body: { ok: variant !== 'http-intake-failure', result: variant === 'http-batched' && httpCalls >= 2
          ? { ...engineResult, inboundEmailMessageIds: [id(6)], edielMessageIds: [id(5)] } : engineResult } }
    }, triggerOutbox: async (...args: unknown[]) => {
      requests.push(args)
      if (variant === 'throw') throw new Error('connection closed after request; outcome unknown')
      const failedHttp = variant === 'http500' || variant === 'http500-restore-fails'
      return { status: failedHttp ? 500 : 200, ok: !failedHttp, ms: 1, text: '',
        body: failedHttp ? { ok: false, code: 'ediel_outbox_processing_failed' } : { ok: true, result: {
          claimed: 1, processed: 1, sent: variant === 'exact' && !legacy ? 1 : 0, failed: legacy ? 1 : 0, blocked: 0,
          deliveryUncertain: variant === 'unknown' ? 1 : 0,
          results: [{ id: outboxId, status: legacy ? 'failed' : variant === 'unknown' ? 'delivery_uncertain' : variant === 'sending' ? 'sending' : 'sent' }],
        } } }
    } },
    '../lib/counterparty': { setSmtpMode: async (mode: string) => { modes.push(mode); if (mode === 'accept' && variant === 'http500-restore-fails') throw new Error('synthetic restore unknown') }, purgeInbox: async () => 0, receivedMail: async () => [] },
    '../lib/db': { lit: (value: string) => "'" + value.replaceAll("'", "''") + "'", resetMailboxSchedule: () => {} },
    '../lib/e01-chain': { ...chain, Timer },
    '../lib/e02-outbox': admissionExports,
    '../lib/e01-fixture': { sqlIn: sql }, '../lib/e01-tls': {
      startUntrustedTlsListener: async () => { serviceEffects.push('tls-listener'); return { port: 3999, log: { appBytes: 0, secureHandshakes: 0, smtpCommands: [], tlsClientErrors: [] }, close: async () => {} } },
      startPlainSmtpListener: async () => { serviceEffects.push('plain-listener'); return { port: 3998, log: { smtpCommands: [] }, close: async () => {} } },
    }, '../lib/evidence': { Evidence }, '../lib/inprocess': { runInboundEngineAsAutomationActor: async () => { serviceEffects.push('inbound-engine'); return { ok: false, error: 'synthetic failed poll' } } },
    '@/lib/email/sendEdielEmail': { sendEdielEmail: async () => { serviceEffects.push('smtp-send'); throw new Error('synthetic certificate error') } },
    '../lib/seed.mjs': { newRunContext: () => ({ prefix: 'synthetic' }), adminClient: () => ({ storage: { from: () => ({ download: async () => ({ error: null,
      data: { arrayBuffer: async () => Buffer.from('synthetic own original archive') } }) }) } }) },
  }
  const exports: { prime?: (state: unknown) => void; drain?: (ids: string[]) => Promise<unknown> } = {}
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code + '\nexports.prime=s=>{seeded=s.seeded;sources=s.sources;legacySource=s.legacySource;srcIds=s.srcIds;contrl=s.contrl;phaseAdmission=s.admission;};let captured=false;exports.drain=async ids=>{if(!captured){captureContrl(srcIds);captured=true;}return drainUntilDone(ids);};', {
    exports, Buffer, process: { env: { T3_E01_N: variant === 'http-batched' ? '2' : '1', EDIEL_AUTOMATION_ACTOR_USER_ID: id(103) } },
    require: (name: string) => {
      if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name)
      return ports[name]
    },
  }, { filename, timeout: 5000 })
  exports.prime!({ seeded: { companyId, actorUserId: id(103), points: [], mailboxId }, sources: [input], legacySource: input, srcIds: [sourceId], contrl: [ackRow()], admission })
  const legacyCallback = [...callbacks].find(([name]) => name.startsWith('EDIEL01.06 pre: äldre failed'))?.[1]
  if (!legacyCallback) throw new Error('Actual legacy callback missing')
  const callback = (prefix: string) => {
    const found = [...callbacks].find(([name]) => name.startsWith(prefix))?.[1]
    if (!found) throw new Error('Actual callback missing')
    return found
  }
  return { drain: (ids: string[] = [ackId]) => exports.drain!(ids), requests, modes, evidence, serviceEffects, get engineCalls() { return engineCalls }, get httpCalls() { return httpCalls },
    startup: async () => { for (const hook of beforeHooks) await hook() },
    failHook: async () => { for (const hook of eachHooks) await hook({ task: { result: { state: 'fail' } } }) },
    httpIntake: () => callback('EDIEL01.01 HTTP inbound-cron')(), actorIntake: () => callback('EDIEL01.01 intake med aktör')(),
    negativeTls: (kind: 'SMTP' | 'IMAP') => callback('EDIEL01.04 negativt ' + kind)(),
    runLegacy: async () => {
      legacy = true; let failed = false
      try { await legacyCallback() } catch (error) { failed = true; throw error } finally {
        for (const hook of eachHooks) await hook({ task: { result: { state: failed ? 'fail' : 'pass' } } })
        for (const hook of afterHooks) await hook()
      }
    } }
}

describe('T3 actual E01 drain admission and unknown-outcome safety', () => {
  it.each(['http-intake-failure', 'http-intake-incomplete'] as const)('does not heal %s through an actor fallback or drain', async variant => {
    const c = harness(variant)
    await expect(c.httpIntake()).rejects.toThrow()
    await expect(c.actorIntake()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.engineCalls).toBe(0)
    expect(c.requests).toHaveLength(0)
  })
  it('allows a qualified ordinary HTTP reception before the explicit actor diagnostic', async () => {
    const c = harness()
    await c.httpIntake()
    await c.actorIntake()
    expect(c.engineCalls).toBe(2)
  })
  it('completes successful progressing HTTP batches through the ordinary route without actor repair', async () => {
    const c = harness('http-batched')
    await c.httpIntake()
    expect(c.httpCalls).toBe(2)
    expect(c.engineCalls).toBe(0)
    expect(c.requests).toHaveLength(0)
  })
  it('holds later mutations after a failed scenario assertion without an SMTP reset', async () => {
    const c = harness()
    await c.failHook()
    await expect(c.actorIntake()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.engineCalls).toBe(0)
    expect(c.requests).toHaveLength(0)
    expect(c.modes).toEqual([])
  })
  it.each(['SMTP', 'IMAP'] as const)('holds negative %s diagnostics before service effects after assertion failure', async kind => {
    const c = harness()
    await c.failHook()
    await expect(c.negativeTls(kind)).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.serviceEffects).toEqual([])
    expect(c.requests).toHaveLength(0)
    expect(c.modes).toEqual([])
  })
  it('does not invoke the global worker for an empty phase', async () => {
    const c = harness(); await c.drain([]).catch(() => undefined)
    expect(c.requests).toHaveLength(0)
  })
  it.each(['prepared', 'queued', 'sending'] as const)('refuses unassigned same-company %s before invoking worker', async status => {
    const c = harness('exact', status)
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.requests).toHaveLength(0)
  })
  it('does not dispatch a phase already in sending before its own request', async () => {
    const c = harness('pre-sending')
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.requests).toHaveLength(0)
  })
  it.each(['http500', 'throw', 'unknown', 'sending'] as const)('never makes a second request after %s', async variant => {
    const c = harness(variant); await c.drain().catch(() => undefined)
    expect(c.requests).toHaveLength(1)
    expect(c.evidence.has(variant === 'throw' ? 'outbound/drain-unknown-1.json' : 'outbound/drain-http-1.json')).toBe(true)
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.requests).toHaveLength(1)
  })
  it('permits a completed explicit owned phase once', async () => {
    const c = harness(); await c.drain()
    expect(c.requests).toHaveLength(1)
  })
  it('preserves both the primary transport error and a failed SMTP restoration', async () => {
    const c = harness('http500-restore-fails')
    let failure: unknown
    try { await c.runLegacy() } catch (error) { failure = error }
    expect(failure).toMatchObject({ name: 'AggregateError', errors: [
      expect.objectContaining({ message: expect.stringContaining('HTTP outcome unknown') }),
      expect.objectContaining({ message: 'synthetic restore unknown' }),
    ] })
    expect(c.evidence.has('outbound/drain-http-1.json')).toBe(true)
    expect(c.evidence.has('outbound/smtp-restore-unknown.json')).toBe(true)
    await expect(c.drain()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.requests).toHaveLength(1)
  })
  it.each(['prepared', 'queued', 'sending'] as const)('applies legacy admission before SMTP mutation or worker with foreign %s', async status => {
    const c = harness('exact', status); await c.runLegacy().catch(() => undefined)
    expect({ requests: c.requests.length, modes: c.modes }).toEqual({ requests: 0, modes: [] })
  })
  it.each(['prepared', 'queued', 'sending'] as const)('startup refuses foreign %s before its SMTP-mode change', async status => {
    const c = harness('exact', status)
    await expect(c.startup()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.modes).toEqual([])
    expect(c.requests).toHaveLength(0)
  })
  it('does not change shared SMTP mode while another environment has active work', async () => {
    const c = harness('exact', 'sending', 'production')
    await expect(c.runLegacy()).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.modes).toEqual([])
    expect(c.requests).toHaveLength(0)
  })
  it('permits the own legacy negative-control attempt without masking its expected failure', async () => {
    const c = harness(); await c.runLegacy()
    expect(c.requests).toHaveLength(1)
    expect(c.modes).toEqual(['permfail-5xx', 'accept'])
  })
})
