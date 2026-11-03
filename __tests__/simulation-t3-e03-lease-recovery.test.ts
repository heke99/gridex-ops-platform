/* eslint-disable @typescript-eslint/no-explicit-any */
// Component qualification of actual adapter with finite service ports; no native PASS.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
const root = fileURLToPath(new URL('../scripts/simulation/track3/lib/', import.meta.url))
const raw = (n: number) => `UNB+UNOC:3+70007:ZZ+16703:ZZ+261101:1200+REF${n}++23-DDQ-E66-T++1++1'\r\nUNH+1+UTILTS:D:02B:UN:E5SE5A'\r\nBGM+E66::260+DOC${n}+9+AB'\r\nIDE+24+TX${n}'\r\nUNT+4+1'\r\nUNZ+1+REF${n}'`
const lit = (v: string) => "'" + v.replaceAll("'", "''") + "'"
function load(file: string, ports: Record<string, unknown>, extra: object = {}) {
  const exports: Record<string, any> = {}
  runInNewContext(ts.transpileModule(readFileSync(root + file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Buffer, ...extra, require: (name: string) => { if (!(name in ports)) throw new Error('Undeclared port ' + name); return ports[name] } }, { timeout: 5000 })
  return exports
}
function harness(failure: 'append-second' | 'http' | 'ok' | 'duplicate-ack' | 'foreign-mime' = 'append-second') {
  let appends = 0, http = 0, smtp = 0
  const mimes: Buffer[] = []
  let receiveGate: (() => Promise<unknown[]>) | undefined
  let appendGate: (() => Promise<void>) | undefined
  let boundary: string | undefined
  const hash = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex')
  const states = [0, 1].map(i => ({ id: `outbox${i}`, status: 'queued', locked_by: null as string | null, locked_at: null as string | null, current_send_attempt_id: null as string | null, last_error: null as string | null }))
  const sources = () => mimes.map((mime, i) => ({ companyId: 'company', emailCompanyId: 'company', environment: 'test', emailEnvironment: 'test', mailboxId: 'mailbox', sourceMessageId: `source${i}`, inboundEmailMessageId: `email${i}`, direction: 'inbound', mimeSha256: failure === 'foreign-mime' ? '0'.repeat(64) : hash(mime), sourcePayloadSha256: hash(parseInboundEmailContent({ rawEmail: mime.toString('utf8') })!.rawPayload) }))
  const outputs = () => sources().map((source, i) => ({ ...source, id: `outbox${i}`, sourceCompanyId: 'company', sourceEnvironment: 'test', ackMessageId: failure === 'duplicate-ack' ? 'ack0' : `ack${i}`, ackCompanyId: 'company', ackEnvironment: 'test', ackSourceMessageId: `source${i}`, ackDirection: 'outbound', ackFamily: 'CONTRL', outboxFamily: 'CONTRL', ackPayloadSha256: hash('CONTRL'+i), status: states[i].status }))
  const query = (sql: string): unknown => {
    if (sql.includes('t3-e02:inventory')) return boundary === 'foreign-active' ? [{ id: 'foreign' }] : http ? outputs() : []
    if (sql.includes('shared-smtp')) return http ? states.filter(x => ['prepared', 'queued', 'sending'].includes(x.status)).map(x => x.id) : []
    if (sql.includes('t3-e02:emails') || sql.includes('t3-e02:sources')) return sources().reverse()
    if (sql.includes('t3-e02:outputs')) return outputs().reverse()
    if (sql.includes('physical-received')) return { receivedAt: '2026-11-01T12:00:00Z' }
    if (sql.includes('ediel_sla_timers')) return []
    if (sql.includes('t3-e03-lease:expire-lease')) {
      const index = sql.includes("'outbox0'") ? 0 : 1
      states[index].locked_at = new Date(Date.now() - 11 * 60_000).toISOString()
      return { ...states[index] }
    }
    if (sql.includes('t3-e03-lease:state')) return { ...states[sql.includes("'outbox0'") ? 0 : 1] }
    if (sql.includes('t3-e03-lease:attempts')) return boundary === 'attempt' ? 1 : 0
    if (sql.includes('global-ingress')) return { inbound: boundary === 'ingress' ? 1 : 0, customer: 0, outbound: 0 }
    if (sql.includes('assigned-schedule')) return { id: 'mailbox', environment: 'test' }
    throw new Error('Undeclared query: ' + sql.slice(0, 90))
  }
  const admission = load('e02-outbox.ts', { 'node:crypto': crypto, '@/lib/inbound-mail/edielEmailParser': { parseInboundEmailContent }, './seed.mjs': { lit, sqlJson: query } })
  const chain = load('e01-chain.ts', { 'node:perf_hooks': {}, './counterparty': {}, './db': {}, './e01-fixture': {}, './inprocess': {}, './mime': {}, './seed.mjs': {}, 'node:fs': {}, 'node:path': {} })
  const unit = load('e03-lease-recovery.ts', {
    'node:crypto': crypto, './e03-reception': { assignedE03Mailbox: () => 'mailbox' },
    './e02-outbox': admission, './e01-chain': chain,
    './mime': load('mime.ts', { 'node:crypto': crypto }),
    '@/lib/inbound-mail/edielEmailParser': { parseInboundEmailContent },
    './evidence': { Evidence: class { save() {} } }, './seed.mjs': { lit, sqlJson: query },
    './counterparty': { appendToInbox: async (mime: Buffer) => { appends++; mimes.push(mime); if (appendGate) await appendGate(); if (failure === 'append-second' && appends === 2) throw new Error('ambiguous APPEND'); return { uid: appends, path: 'INBOX' } }, setSmtpMode: async () => { smtp++ }, receivedMail: async () => receiveGate ? receiveGate() : boundary === 'smtp' ? [{ n: 1 }] : [] },
    './app': { triggerInbound: async () => { http++; if (failure === 'http') throw new Error('ambiguous HTTP');
      return { ok: true, status: 200, body: { ok: true, result: {
        overdueTasks: { ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }, failedJobs: 0,
        inboundEmailMessageIds: ['email1','email0'], edielMessageIds: ['source1','source0'],
        debug: { errorsByMailbox: [], autoProcessErrors: [], configurationError: null,
          customerOperationJobs: { claimed: 0, completed: 0, failed: 0, needsReview: 0, errors: [] } },
      } } } } },
  }, { process: { env: { SIM_HOME: '/private', T3_EVIDENCE_DIR: '/private/evidence' } } })
  const inputs = [1, 2].map(seq => ({ prefix: 'synthetic', seq, raw: raw(seq), companyId: 'company', environment: 'test' }))
  return { unit, inputs, states, setBoundary: (value: string) => { boundary = value }, setAppendGate: (gate: () => Promise<void>) => { appendGate = gate }, setReceiveGate: (gate: () => Promise<unknown[]>) => { receiveGate = gate }, counts: () => ({ appends, http, smtp }) }
}
describe('E03.04 physical pair ambiguity boundary', () => {
  it.each(['company', 'environment', 'prefix', 'seq', 'raw'])('rejects an invalid %s pair before any physical effect', async field => {
    const c = harness(); const inputs = c.inputs.map(x => ({ ...x }))
    if (field === 'seq') inputs[1].seq = inputs[0].seq
    else if (field === 'raw') inputs[1].raw = inputs[0].raw
    else if (field === 'company') inputs[1].companyId = 'foreign'
    else (inputs[1] as any)[field] = 'other'
    await expect(c.unit.receiveE03LeaseRecoveryPair(inputs)).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 0, http: 0, smtp: 0 })
  })
  it('never polls after ambiguous second APPEND and cannot rearm with a new prefix', async () => {
    const c = harness(); await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow('ambiguous APPEND')
    expect(c.counts()).toEqual({ appends: 2, http: 0, smtp: 1 })
    await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs.map(x => ({ ...x, prefix: 'new' })))).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 2, http: 0, smtp: 1 })
  })
  it('polls exactly once for both APPENDs and preserves unknown HTTP without retry', async () => {
    const c = harness('http'); await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow('ambiguous HTTP')
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
    await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
  })
})

describe('E03.04 pair receipt and effect admission', () => {
  it('maps both sources by actual MIME instead of result ordering', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    expect(pair.sources.map((x: any) => x.sourceMessageId)).toEqual(['source0', 'source1'])
    expect(pair.sources.map((x: any) => x.outboxId)).toEqual(['outbox0', 'outbox1'])
    expect(Object.isFrozen(pair.sources)).toBe(true)
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
  })
  it.each(['duplicate-ack', 'foreign-mime'] as const)('holds %s without re-intake or SMTP reset', async failure => {
    const c = harness(failure)
    await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow()
    await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
  })
  it('does not enter a claim callback after explicit HOLD or restore accepting mode', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs); let entered = 0
    pair.hold()
    await expect(pair.claim(0, 'workerA', async () => { entered++ })).rejects.toThrow()
    await expect(pair.restoreSmtp()).rejects.toThrow()
    expect(entered).toBe(0)
    expect(c.counts().smtp).toBe(1)
  })
  it('compares actual claim result with the independent owned row and latches unknown effects', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs); let entered = 0
    const action = async () => { entered++; return { id: 'outbox0', status: 'sending', locked_by: 'workerA', current_send_attempt_id: 'attemptA' } }
    await expect(pair.claim(0, 'workerA', action)).rejects.toThrow()
    await expect(pair.claim(0, 'workerA', action)).rejects.toThrow()
    await expect(pair.restoreSmtp()).rejects.toThrow()
    expect(entered).toBe(1)
  })
})

describe('E03.04 live claim custody', () => {
  const claim = (c: ReturnType<typeof harness>, index: number, worker: string) => async () => {
    Object.assign(c.states[index], { status: 'sending', locked_by: worker, locked_at: new Date().toISOString(), current_send_attempt_id: `attempt${index}` })
    return { ...c.states[index] }
  }
  it.each(['locked_by', 'locked_at', 'status', 'current_send_attempt_id'])('holds cross-row %s drift before entering the next claim', async field => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    await pair.claim(0, 'workerA', claim(c, 0, 'workerA'))
    ;(c.states[0] as any)[field] = field === 'status' ? 'queued' : 'foreign'
    let entered = 0
    await expect(pair.claim(1, 'workerB', async () => { entered++; return claim(c, 1, 'workerB')() })).rejects.toThrow()
    expect(entered).toBe(0)
    await expect(pair.restoreSmtp()).rejects.toThrow()
  })
  it('requires two distinct worker and attempt receipts before a zero-work live drain', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    await pair.claim(0, 'workerA', claim(c, 0, 'workerA'))
    await pair.claim(1, 'workerB', claim(c, 1, 'workerB'))
    let entered = 0
    const action = async () => { entered++; return { ok: true, status: 200, body: { ok: true, result: { claimed: 0, processed: 0, results: [] } } } }
    await pair.drain('live', action)
    await expect(pair.drain('live', action)).rejects.toThrow()
    expect(entered).toBe(1)
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
  })
  it('holds an unknown claim without invoking another worker or SMTP reset', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    await expect(pair.claim(0, 'workerA', async () => { throw new Error('unknown claim') })).rejects.toThrow('unknown claim')
    let entered = 0
    await expect(pair.claim(1, 'workerB', async () => { entered++ })).rejects.toThrow()
    await expect(pair.restoreSmtp()).rejects.toThrow()
    expect(entered).toBe(0)
  })
})

describe('E03.04 declared complete lease recovery sequence', () => {
  it('follows both claims, live no-op, B expiry refusal, stale reconciliation, A fences and final no-resend', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    const zero = () => ({ ok: true, status: 200, body: { ok: true, result: { claimed: 0, processed: 0, results: [] } } })
    for (const index of [0, 1]) await pair.claim(index, `worker${index}`, async () => {
      Object.assign(c.states[index], { status: 'sending', locked_by: `worker${index}`, locked_at: new Date().toISOString(), current_send_attempt_id: `attempt${index}` })
      return { ...c.states[index] }
    })
    await pair.drain('live', async () => zero())
    await pair.expireLease(1)
    await pair.probe(1, 'expired-worker', async () => ({ status: 'blocked', error: 'ediel_outbox_worker_lease_expired' }))
    await pair.expireLease(0)
    await pair.drain('stale', async () => {
      c.states.forEach(x => Object.assign(x, { status: 'delivery_uncertain', locked_by: null, locked_at: null, last_error: 'stale_sending_lock_requires_transport_reconciliation' }))
      return zero()
    })
    await pair.probe(0, 'resumed-worker', async () => ({ status: 'blocked', error: 'outbox_item_not_claimed_by_worker' }))
    await pair.probe(0, 'transport-fence', async () => { throw { code: 'P0001', message: 'ediel_transport_worker_fence_lost' } })
    await pair.drain('final', async () => zero())
    await pair.restoreSmtp()
    expect(c.states.map(x => x.status)).toEqual(['delivery_uncertain', 'delivery_uncertain'])
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 2 })
  })
  it('keeps an explicit HOLD during an in-flight claim sticky after that claim resolves', async () => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    let resolve!: (value: unknown) => void
    const pending = pair.claim(0, 'workerA', () => new Promise(r => { resolve = r }))
    // The finite callback is entered after the adapter completes its asynchronous observations.
    for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve()
    expect(resolve).toBeTypeOf('function')
    pair.hold()
    Object.assign(c.states[0], { status: 'sending', locked_by: 'workerA', locked_at: new Date().toISOString(), current_send_attempt_id: 'attemptA' })
    resolve({ ...c.states[0] })
    await expect(pending).rejects.toThrow()
    await expect(pair.restoreSmtp()).rejects.toThrow()
    expect(c.counts().smtp).toBe(1)
  })
})

describe('E03.04 await-to-effect guard regression', () => {
  it.each(['hold', 'other-row-drift'] as const)('blocks callback when %s occurs during SMTP observation', async variant => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    let release!: (rows: unknown[]) => void; let entered = 0
    c.setReceiveGate(() => new Promise(r => { release = r }))
    const pending = pair.claim(0, 'workerA', async () => { entered++; throw new Error('must not enter') })
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    expect(release).toBeTypeOf('function')
    if (variant === 'hold') pair.hold()
    else c.states[1].status = 'sending'
    release([])
    await expect(pending).rejects.toThrow()
    expect(entered).toBe(0)
    expect(c.counts().smtp).toBe(1)
  })
})

describe('E03.04 concurrent intake remains held', () => {
  it('does not APPEND the second original or poll after another pair call poisons the first pending APPEND', async () => {
    const c = harness('ok'); let release!: () => void
    c.setAppendGate(() => new Promise<void>(r => { release = r }))
    const pending = c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    expect(release).toBeTypeOf('function')
    await expect(c.unit.receiveE03LeaseRecoveryPair(c.inputs)).rejects.toThrow()
    release()
    await expect(pending).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 1, http: 0, smtp: 1 })
  })
})

describe('E03.04 global and transport effect boundaries', () => {
  it.each(['attempt', 'smtp', 'foreign-active', 'ingress'])('holds %s before worker callback and never restores SMTP', async variant => {
    const c = harness('ok'); const pair = await c.unit.receiveE03LeaseRecoveryPair(c.inputs)
    c.setBoundary(variant); let entered = 0
    await expect(pair.claim(0, 'workerA', async () => { entered++; throw new Error('must not enter') })).rejects.toThrow()
    expect(entered).toBe(0)
    await expect(pair.restoreSmtp()).rejects.toThrow()
    expect(c.counts()).toEqual({ appends: 2, http: 1, smtp: 1 })
  })
})
