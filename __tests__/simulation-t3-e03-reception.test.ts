/* eslint-disable @typescript-eslint/no-explicit-any */
// Actual candidate callbacks/classes; finite service ports, no native evidence.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
const root = fileURLToPath(new URL('../scripts/simulation/track3/lib/', import.meta.url))
const real = process.env.E03_REVIEW_SOURCE_ROOT ? process.env.E03_REVIEW_SOURCE_ROOT + '/scripts/simulation/track3/lib/' : root
const raw = "UNB+UNOC:3+70007:ZZ+16703:ZZ+261101:1200+OWNREF++23-DDQ-E66-T++1++1'\r\nUNH+1+UTILTS:D:02B:UN:E5SE5A'\r\nBGM+E66::260+OWNDOC+9+AB'\r\nIDE+24+OWNTX'\r\nUNT+4+1'\r\nUNZ+1+OWNREF'"
const hash = (v: Buffer | string) => crypto.createHash('sha256').update(v).digest('hex')
const lit = (v: string) => "'" + v.replaceAll("'", "''") + "'"
function load(file: string, ports: Record<string, unknown>, extra: object = {}, tail = '') {
  const exports: Record<string, any> = {}
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + tail,
    { exports, Buffer, ...extra, require: (name: string) => { if (!(name in ports)) throw new Error('Undeclared port ' + name); return ports[name] } }, { timeout: 5000 })
  return exports
}
type Variant = 'ok' | 'http500' | 'http-throws' | 'missing-source' | 'foreign-mime' | 'failed-jobs' | 'customer-held' | 'configuration' | 'missing-ack' | 'technical-only' | 'foreign-active' | 'foreign-inbound' | 'foreign-customer' | 'foreign-outbound' | 'mailbox-locked' | 'global-completed' | 'overdue-work' | 'pre-sending' | 'prior-attempt' | 'late-inbound'
function harness(variant: Variant = 'ok') {
  let mime: Buffer = Buffer.alloc(0)
  let appends = 0, http = 0, smtp = 0, state = 'queued', ingressReads = 0
  let controlRead: unknown = undefined
  const source = () => ({ companyId: variant === 'technical-only' ? null : 'company', emailCompanyId: variant === 'technical-only' ? null : 'company', environment: 'test',
    emailEnvironment: 'test', mailboxId: 'mailbox', sourceMessageId: 'source', inboundEmailMessageId: 'email', direction: 'inbound',
    mimeSha256: variant === 'foreign-mime' ? '0'.repeat(64) : hash(mime), sourcePayloadSha256: hash(parseInboundEmailContent({ rawEmail: mime.toString('utf8') })!.rawPayload) })
  const output = () => ({ ...source(), id: 'outbox', sourceCompanyId: 'company', sourceEnvironment: 'test', ackMessageId: 'ack',
    ackCompanyId: 'company', ackEnvironment: 'test', ackSourceMessageId: 'source', ackDirection: 'outbound', ackFamily: 'CONTRL',
    outboxFamily: 'CONTRL', ackPayloadSha256: hash('CONTRL'), status: state })
  const query = (sql: string): unknown => {
    if (sql.includes('t3-e03:global-ingress')) { ingressReads++; return { inbound: variant === 'foreign-inbound' || variant === 'late-inbound' && ingressReads > 1 ? 1 : 0, customer: variant === 'foreign-customer' ? 1 : 0, outbound: variant === 'foreign-outbound' ? 1 : 0 } }
    if (sql.includes('t3-e03:assigned-schedule')) return variant === 'mailbox-locked' ? null : { id: 'mailbox', environment: 'test' }
    if (sql.includes('t3-e02:inventory')) return variant === 'foreign-active' ? [{ id: 'foreign' }] : mime.length ? [output()] : []
    if (sql.includes('t3-e02:emails') || sql.includes('t3-e02:sources')) return [source()]
    if (sql.includes('t3-e02:outputs')) return variant === 'missing-ack' ? [] : [output()]
    if (sql.includes('t3-e03:dispatch-state')) { if (controlRead instanceof Error) throw controlRead; return controlRead === undefined ? state : controlRead }
    if (sql.includes('t3-e03:fresh-transport')) return { status: variant === 'pre-sending' ? 'sending' : 'queued', attempts: variant === 'prior-attempt' ? 1 : 0 }
    if (sql.includes('t3-e03:physical-received')) return { receivedAt: '2026-11-01T12:00:00Z' }
    if (sql.includes('ediel_sla_timers')) return []
    if (sql.includes('t3-e03:shared-smtp')) return []
    throw new Error('Undeclared query')
  }
  const admission = load(real + 'e02-outbox.ts', { 'node:crypto': crypto, '@/lib/inbound-mail/edielEmailParser': { parseInboundEmailContent }, './seed.mjs': { lit, sqlJson: query } })
  const chain = load(real + 'e01-chain.ts', { 'node:perf_hooks': {}, './counterparty': {}, './db': {}, './e01-fixture': {}, './inprocess': {}, './mime': {}, './seed.mjs': {}, 'node:fs': {}, 'node:path': {} })
  const mimeBuilder = load(real + 'mime.ts', { 'node:crypto': crypto })
  const unit = load(root + 'e03-reception.ts', {
    'node:crypto': crypto, 'node:path': { join: (...s: string[]) => s.join('/') },
    'node:fs': { realpathSync: (p: string) => p, lstatSync: () => ({ isFile: () => true, uid: 123, mode: 0o600 }), readFileSync: () => JSON.stringify({ mailboxes: { test: 'mailbox' } }) },
    '@/lib/inbound-mail/edielEmailParser': { parseInboundEmailContent }, './e01-chain': chain, './e02-outbox': admission, './mime': mimeBuilder,
    './evidence': { Evidence: class { save() {} } },
    './seed.mjs': { lit, sqlJson: query }, './counterparty': { appendToInbox: async (b: Buffer) => { appends++; mime = b }, setSmtpMode: async () => { smtp++ } },
    './app': { triggerInbound: async (...args: unknown[]) => {
      http++; expect(args).toEqual(['test', 'mailbox'])
      if (variant === 'http-throws') throw new Error('unknown HTTP outcome')
      return { status: variant === 'http500' ? 500 : 200, ok: variant !== 'http500', body: { ok: true, result: {
        overdueTasks: { ackOverdue: variant === 'overdue-work' ? 1 : 0, z04Overdue: 0, z14Overdue: 0 }, failedJobs: variant === 'failed-jobs' ? 1 : 0, inboundEmailMessageIds: ['email'], edielMessageIds: variant === 'missing-source' ? [] : ['source'],
        debug: { errorsByMailbox: [], autoProcessErrors: [], configurationError: variant === 'configuration' ? 'missing' : null,
          customerOperationJobs: { claimed: variant === 'global-completed' ? 1 : 0, completed: variant === 'global-completed' ? 1 : 0, failed: 0, needsReview: variant === 'customer-held' ? 1 : 0, errors: [] } },
      } } }
    } },
  }, { process: { env: { SIM_HOME: '/private', T3_EVIDENCE_DIR: '/private/evidence' }, getuid: () => 123 } })
  return { unit, setControlRead: (value: unknown) => { controlRead = value }, setState: (value: string) => { state = value }, input: { prefix: 'synthetic', seq: 1, raw, companyId: 'company', environment: 'test' }, counts: () => ({ appends, http, smtp }) }
}
describe('E03 physical reception candidate, no native claim', () => {
  it('the actual explicit physical fixture delegates to physical reception rather than inserting a mail row', async () => {
    const c = harness(); let inserted = 0
    const edifact = load(real + 'edifact.ts', { './seed.mjs': { COUNTERPARTY_EDIEL_ID: '70007', OWN_EDIEL_ID: '16703' } })
    const fixtureFile = process.env.E03_FIXTURE_BASELINE ? real + 'e03-fixture.ts' : root + 'e03-fixture.ts'
    const fixture = load(fixtureFile, {
      './e03-reception': c.unit, 'node:crypto': crypto, './edifact': edifact,
      './seed.mjs': { lit, sql: (sql: string) => { if (sql.startsWith('INSERT INTO public.inbound_email_messages')) { inserted++; return '' } return 'company' }, sqlJson: (sql: string) => sql.includes('ediel_sla_timers') ? [] : { id: 'ack', outbox_id: 'outbox' } },
      '@/lib/inbound-mail/edielEmailParser': { parseEdifactPayload: () => ({}) },
      '@/lib/inbound-mail/inboundStatusUpdater': { createParseResult: async () => 'parse', createInboundEdielMessage: async () => 'source' },
      '@/lib/ediel/flows/inboundProcessing': { processInboundEdielMessage: async () => undefined },
    }, { process: { env: { T3_MODE: 'test', EDIEL_AUTOMATION_ACTOR_USER_ID: 'actor' } } }, '\nexports.ready = () => { tenantReady = true };')
    fixture.ready()
    await fixture.seedInboundSource({ prefix: 'synthetic', seq: 1, physical: true })
    expect({ inserted, ...c.counts() }).toEqual({ inserted: 0, appends: 1, http: 1, smtp: 0 })
  })
  it('binds actual APPEND, ordinary HTTP returned IDs, source and initial CONTRL before branding authority', async () => {
    const c = harness(); const source = await c.unit.receiveE03Physical(c.input)
    expect(source).toMatchObject({ sourceMessageId: 'source', inboundEmailMessageId: 'email', ackMessageId: 'ack', outboxId: 'outbox' })
    c.unit.requireE03Physical(source)
    expect(() => c.unit.requireE03Physical({ ...source })).toThrow('physical reception receipt required')
    expect(c.counts()).toEqual({ appends: 1, http: 1, smtp: 0 })
  })
  it.each(['http500', 'http-throws', 'missing-source', 'foreign-mime', 'failed-jobs', 'customer-held', 'configuration', 'missing-ack', 'technical-only', 'global-completed', 'overdue-work', 'pre-sending', 'prior-attempt'] as const)('holds %s without fallback, re-APPEND, HTTP retry or SMTP reset', async variant => {
    const c = harness(variant)
    await expect(c.unit.receiveE03Physical(c.input)).rejects.toThrow()
    const before = c.counts()
    await expect(c.unit.receiveE03Physical({ ...c.input, prefix: 'other' })).rejects.toThrow()
    await expect(c.unit.setE03PhysicalSmtp(null, 'accept')).rejects.toThrow()
    expect(c.counts()).toEqual(before)
    expect(before).toEqual({ appends: 1, http: 1, smtp: 0 })
  })
  it.each(['throw', 'http500', 'missing-result', 'sending', 'foreign-result', 'extra-result'] as const)('keeps %s worker outcome held without HTTP retry or SMTP reset', async variant => {
    const c = harness(); await c.unit.receiveE03Physical(c.input); let calls = 0
    const action = async () => { calls++; if (variant === 'throw') throw new Error('unknown worker'); c.setState(variant === 'sending' ? 'sending' : 'delivery_uncertain');
      return { ok: variant !== 'http500', status: variant === 'http500' ? 500 : 200, body: variant === 'missing-result' ? { ok: true } : { ok: true, result: { processed: variant === 'extra-result' ? 2 : 1, results: [{ id: variant === 'foreign-result' ? 'foreign' : 'outbox', status: 'delivery_uncertain' }] } } } }
    await expect(c.unit.dispatchE03Physical('outbox', action)).rejects.toThrow()
    await expect(c.unit.dispatchE03Physical('outbox', action, true)).rejects.toThrow()
    await expect(c.unit.setE03PhysicalSmtp(null, 'accept')).rejects.toThrow()
    expect(calls).toBe(1)
  })
  it('permits a fresh transport once then exactly one explicit known-uncertain no-resend probe', async () => {
    const c = harness(); await c.unit.receiveE03Physical(c.input)
    await c.unit.dispatchE03Physical('outbox', async () => { c.setState('delivery_uncertain'); return { ok: true, status: 200, body: { ok: true, result: { processed: 1, results: [{ id: 'outbox', status: 'delivery_uncertain' }] } } } })
    await c.unit.dispatchE03Physical('outbox', async () => ({ ok: true, status: 200, body: { ok: true, result: { processed: 0, results: [] } } }), true)
    await expect(c.unit.dispatchE03Physical('outbox', async () => { throw new Error('must not enter') }, true)).rejects.toThrow()
  })
  it.each([{ name: 'missing', value: null }, { name: 'malformed', value: {} }, { name: 'unknown', value: 'invented' }, { name: 'sending', value: 'sending' }, { name: 'read-failed', value: new Error('receipt read failed') }])('holds $name SMTP receipt state and all follow-up operations', async ({ value }) => {
    const c = harness(); const source = await c.unit.receiveE03Physical(c.input); c.setControlRead(value)
    await expect(c.unit.setE03PhysicalSmtp(source, 'drop-after-data')).rejects.toThrow()
    c.setControlRead('queued')
    await expect(c.unit.setE03PhysicalSmtp(source, 'accept')).rejects.toThrow()
    await expect(c.unit.receiveE03Physical({ ...c.input, prefix: 'other' })).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 1, http: 1, smtp: 0 })
  })
  it('never changes SMTP mode while the actual owned row is sending', async () => {
    const c = harness(); const source = await c.unit.receiveE03Physical(c.input); c.setState('sending'); await expect(c.unit.setE03PhysicalSmtp(source, 'drop-after-data')).rejects.toThrow('sending'); expect(c.counts().smtp).toBe(0)
  })
  it('allows initial accepting mode only with empty shared work, and fresh queued negative control', async () => {
    const c = harness(); await c.unit.setE03PhysicalSmtp(null, 'accept'); const source = await c.unit.receiveE03Physical(c.input); await c.unit.setE03PhysicalSmtp(source, 'drop-after-data'); expect(c.counts().smtp).toBe(2)
  })
  it('restores accepting mode from a qualified terminal result, but never re-arms negative control', async () => {
    const c = harness(); const source = await c.unit.receiveE03Physical(c.input)
    await c.unit.dispatchE03Physical('outbox', async () => { c.setState('delivery_uncertain'); return { ok: true, status: 200, body: { ok: true, result: { processed: 1, results: [{ id: 'outbox', status: 'delivery_uncertain' }] } } } })
    await c.unit.setE03PhysicalSmtp(source, 'accept'); expect(c.counts().smtp).toBe(1)
    await expect(c.unit.setE03PhysicalSmtp(source, 'drop-after-data')).rejects.toThrow()
    await expect(c.unit.setE03PhysicalSmtp(source, 'accept')).rejects.toThrow(); expect(c.counts().smtp).toBe(1)
  })
  it('refuses negative SMTP controls without a real source', async () => {
    const c = harness(); await expect(c.unit.setE03PhysicalSmtp(null, 'drop-after-data')).rejects.toThrow(); expect(c.counts().smtp).toBe(0)
  })
  it.each(['foreign-inbound', 'foreign-customer', 'foreign-outbound'] as const)('rejects %s before APPEND or HTTP', async variant => {
    const c = harness(variant); await expect(c.unit.receiveE03Physical(c.input)).rejects.toThrow('global intake workers'); expect(c.counts()).toEqual({ appends: 0, http: 0, smtp: 0 })
  })
  it('rechecks global jobs after APPEND before entering HTTP, preserving ambiguous intake', async () => {
    const c = harness('late-inbound'); await expect(c.unit.receiveE03Physical(c.input)).rejects.toThrow('global intake workers'); expect(c.counts()).toEqual({ appends: 1, http: 0, smtp: 0 }); await expect(c.unit.receiveE03Physical({ ...c.input, prefix: 'other' })).rejects.toThrow()
  })
  it('does not clear or steal the assigned mailbox lock', async () => {
    const c = harness('mailbox-locked'); await expect(c.unit.receiveE03Physical(c.input)).rejects.toThrow('mailbox changed or locked'); expect(c.counts()).toEqual({ appends: 0, http: 0, smtp: 0 })
  })
  it('requires all active work to be absent before physical mutation', async () => {
    const c = harness('foreign-active')
    await expect(c.unit.receiveE03Physical(c.input)).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 0, http: 0, smtp: 0 })
  })
})
