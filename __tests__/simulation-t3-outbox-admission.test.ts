// Component qualification of actual E02 receipt/admission code with finite SQL ports.
// No database, mailbox, HTTP worker or scenario PASS is produced.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'

const filename = fileURLToPath(new URL('../scripts/simulation/track3/lib/e02-outbox.ts', import.meta.url))
const raw = "UNB+UNOC:3+70007:ZZ+16700:ZZ+261101:1200+OWNREF++23-DDQ-E66-T++1++1'\r\nUNH+1+UTILTS:D:02B:UN:E5SE5A'\r\nBGM+E66::260+OWNDOC+9+AB'\r\nIDE+24+OWNTX'\r\nUNT+4+1'\r\nUNZ+1+OWNREF'"
const mime = Buffer.from('From: 70007@dso.t3.sim.invalid\r\nTo: ediel@t3.sim.invalid\r\nMessage-ID: <owned@t3.sim.invalid>\r\nContent-Type: application/edifact\r\n\r\n' + raw + '\r\n')
const hash = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex')
const parsed = parseInboundEmailContent({ rawEmail: mime.toString('utf8') })!
const email = { inboundEmailMessageId: 'email-A', companyId: 'own-company', environment: 'test', mailboxId: 'owned-mailbox', mimeSha256: hash(mime) }
const source = { ...email, sourceMessageId: 'source-A', sourcePayloadSha256: hash(parsed.rawPayload), direction: 'inbound', emailCompanyId: 'own-company', emailEnvironment: 'test' }
const outbox = {
  ...source, id: 'outbox-A', ackMessageId: 'ack-A', ackFamily: 'CONTRL', status: 'queued',
  ackCompanyId: 'own-company', ackEnvironment: 'test', ackSourceMessageId: 'source-A', ackDirection: 'outbound',
  outboxFamily: 'CONTRL', ackPayloadSha256: hash("UNH+1+CONTRL:D:3:UN'"), sourceCompanyId: 'own-company', sourceEnvironment: 'test',
}
type Receipt = Readonly<{ id: string; sourceMessageId: string } & Record<string, unknown>>
type Admission = {
  rememberMime: (mime: Buffer) => void
  observePoll: (stored: string[], returned: string[]) => readonly string[]
  assertSources: (ids: readonly string[]) => void
  captureOutboxes: (ids: readonly string[]) => readonly Receipt[]
  admit: (ids: readonly string[]) => { workerNeeded: boolean; assigned: readonly Receipt[] }
  readonly sources: readonly Readonly<Record<string, unknown>>[]
  readonly technicalSources: readonly Readonly<Record<string, unknown>>[]
  readonly outboxes: readonly Receipt[]
  captureEnqueue: (expected: { sourceMessageId: string; ackMessageId: string; ackPayloadSha256: string },
    action: () => Promise<{ status: string; ackMessageId: string | null; lifecycleStatus: string | null }>, repeat?: boolean) => Promise<readonly Receipt[]>
}
function harness() {
  let emails: unknown = [email], sources: unknown = [source], outputs: unknown = [outbox], active: unknown = [outbox]
  let enqueueAck: unknown = [], enqueueOutputs: unknown = []
  const calls: string[] = []
  const sqlJson = (sql: string): unknown => {
    calls.push(sql)
    if (sql.includes('t3-e02:emails')) return emails
    if (sql.includes('t3-e02:sources')) return sources
    if (sql.includes('t3-e02:outputs')) return outputs
    if (sql.includes('t3-e02:inventory')) return active
    if (sql.includes('t3-e02:enqueue-ack')) return enqueueAck
    if (sql.includes('t3-e02:enqueue-outputs')) return enqueueOutputs
    throw new Error('Undeclared SQL port')
  }
  const exports: { E02OutboxAdmission?: new (scope: unknown, port: unknown) => Admission } = {}
  const ports: Record<string, unknown> = {
    'node:crypto': crypto,
    '@/lib/inbound-mail/edielEmailParser': { parseInboundEmailContent },
    './seed.mjs': { sqlJson, lit: (value: string) => "'" + value.replaceAll("'", "''") + "'" },
  }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, { exports, Buffer, require: (name: string) => {
    if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name)
    return ports[name]
  } }, { filename, timeout: 5000 })
  const Class = exports.E02OutboxAdmission!
  const admission = new Class({ companyId: 'own-company', environment: 'test', mailboxId: 'owned-mailbox' }, sqlJson)
  const receive = () => { admission.rememberMime(mime); return admission.observePoll(['email-A'], ['source-A']) }
  const capture = () => { receive(); return admission.captureOutboxes(['source-A']) }
  return { admission, calls, receive, capture,
    setEmails: (x: unknown) => { emails = x }, setSources: (x: unknown) => { sources = x },
    setOutputs: (x: unknown) => { outputs = x }, setActive: (x: unknown) => { active = x },
    setEnqueueAck: (x: unknown) => { enqueueAck = x }, setEnqueueOutputs: (x: unknown) => { enqueueOutputs = x } }
}

describe('T3 E02 physical reception ownership', () => {
  it('roots a source in appended MIME and exact current stored email', () => {
    const c = harness()
    expect(c.receive()).toEqual(['source-A'])
    expect(c.admission.sources[0]).toMatchObject({ sourceMessageId: 'source-A', inboundEmailMessageId: 'email-A', mimeSha256: hash(mime), sourcePayloadSha256: hash(parsed.rawPayload) })
    expect(Object.isFrozen(c.admission.sources)).toBe(true)
    expect(Object.isFrozen(c.admission.sources[0])).toBe(true)
  })
  it('refuses a current stored email that was not explicitly appended', () => {
    const c = harness()
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each(['companyId', 'environment', 'mailboxId', 'mimeSha256'])('refuses mismatched email %s', key => {
    const c = harness(); c.admission.rememberMime(mime); c.setEmails([{ ...email, [key]: 'different' }])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each(['companyId', 'environment', 'mailboxId', 'mimeSha256', 'sourcePayloadSha256', 'inboundEmailMessageId', 'direction'])('refuses mismatched source %s', key => {
    const c = harness(); c.admission.rememberMime(mime); c.setSources([{ ...source, [key]: 'different' }])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each([null, {}, [null], [{ sourceMessageId: 'source-A' }]])('refuses malformed source rows %j', rows => {
    const c = harness(); c.admission.rememberMime(mime); c.setSources(rows)
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('refuses missing current email and missing returned source', () => {
    const c = harness(); c.admission.rememberMime(mime); c.setEmails([])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow()
    const d = harness(); d.admission.rememberMime(mime); d.setSources([])
    expect(() => d.admission.observePoll(['email-A'], ['source-A'])).toThrow()
  })
  it.each([null, {}, [null], [email, email]])('refuses ambiguous email receipt inventory %j', emails => {
    const c = harness(); c.admission.rememberMime(mime); c.setEmails(emails)
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toEqual([])
  })
  it('does not preserve partially verified sources after one receipt is wrong', () => {
    const c = harness(); c.admission.rememberMime(mime)
    c.setSources([source, { ...source, sourceMessageId: 'source-B', sourcePayloadSha256: '0'.repeat(64) }])
    expect(() => c.admission.observePoll(['email-A'], ['source-A', 'source-B'])).toThrow()
    expect(c.admission.sources).toEqual([])
  })
  it('does not adopt an unknown old source returned by a duplicate poll', () => {
    const c = harness(); c.admission.rememberMime(mime)
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('reuses an immutable known source returned by a duplicate poll', () => {
    const c = harness(); c.receive()
    expect(c.admission.observePoll([], ['source-A'])).toEqual(['source-A'])
    expect(c.admission.sources).toHaveLength(1)
  })
  it('checks known sources before further processing and rejects changed hashes', () => {
    const c = harness(); c.receive(); c.setSources([{ ...source, sourcePayloadSha256: '0'.repeat(64) }])
    expect(() => c.admission.assertSources(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('rejects unknown processing IDs and duplicate source assignment IDs', () => {
    const c = harness(); c.receive()
    expect(() => c.admission.assertSources(['unknown'])).toThrow()
    expect(() => c.admission.assertSources(['source-A', 'source-A'])).toThrow()
  })
  it('permits a genuinely received no-source MIME without inventing a source', () => {
    const c = harness(), plain = Buffer.from('From: synthetic@t3.sim.invalid\r\n\r\nNo EDIFACT')
    c.admission.rememberMime(plain); c.setEmails([{ ...email, mimeSha256: hash(plain) }]); c.setSources([]); c.setActive([])
    expect(c.admission.observePoll(['email-A'], [])).toEqual([])
    expect(c.admission.admit([]).workerNeeded).toBe(false)
  })
})

describe('T3 later APERAK capture requires its own completed enqueue action', () => {
  const expected = { sourceMessageId: 'source-A', ackMessageId: 'aperak-A', ackPayloadSha256: hash("UNH+1+APERAK:D:96A:UN'") }
  const ack = { ackMessageId: 'aperak-A', companyId: 'own-company', environment: 'test', sourceMessageId: 'source-A',
    direction: 'outbound', family: 'APERAK', ackOutcome: 'positive', status: 'draft', ackPayloadSha256: expected.ackPayloadSha256 }
  const output = { ...outbox, id: 'aperak-outbox', ackMessageId: 'aperak-A', ackFamily: 'APERAK', outboxFamily: 'APERAK', ackPayloadSha256: expected.ackPayloadSha256 }
  const retained = { status: 'retained', ackMessageId: 'aperak-A', lifecycleStatus: 'existing_response_retained' }
  function ready() {
    const c = harness(); c.capture(); c.setEnqueueAck([ack]); c.setEnqueueOutputs([]); c.setActive([{ ...outbox, status: 'sent' }])
    return c
  }
  it('captures exactly the new expected ACK outbox after one successful own action', async () => {
    const c = ready(); let actions = 0
    const receipts = await c.admission.captureEnqueue(expected, async () => { actions++; c.setEnqueueOutputs([output]); return retained })
    expect(actions).toBe(1)
    expect(receipts).toMatchObject([{ id: 'aperak-outbox', sourceMessageId: 'source-A', ackMessageId: 'aperak-A', ackPayloadSha256: expected.ackPayloadSha256 }])
    expect(Object.isFrozen(receipts)).toBe(true); expect(Object.isFrozen(receipts[0])).toBe(true)
    c.setActive([output]); expect(c.admission.admit(['aperak-outbox']).workerNeeded).toBe(true)
    expect(c.admission.outboxes).toHaveLength(2)
  })
  it('requires the initial source capture and does not treat an observed source as enqueue authority', async () => {
    const c = harness(); c.receive(); c.setEnqueueAck([ack]); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(0)
  })
  it.each(['ackMessageId', 'companyId', 'environment', 'sourceMessageId', 'direction', 'family', 'ackOutcome', 'ackPayloadSha256', 'status'])('refuses wrong pre-action ACK %s before calling the action', async key => {
    const c = ready(); c.setEnqueueAck([{ ...ack, [key]: 'wrong' }]); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(0)
  })
  it('does not adopt a pre-existing unowned output row as a new enqueue effect', async () => {
    const c = ready(); c.setEnqueueOutputs([output]); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(0)
  })
  it.each(['status', 'ackMessageId', 'lifecycleStatus'])('holds on wrong action return %s and permits no implicit recovery', async key => {
    const c = ready(); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; c.setEnqueueOutputs([output]); return { ...retained, [key]: 'wrong' } })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(1)
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.captureOutboxes([])).toThrow('T3_HARNESS_PRECONDITION')
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(1)
  })
  it('preserves a partial thrown action as a sticky hold even if its output later appears', async () => {
    const c = ready(); let actions = 0; const error = new Error('statement timeout; outcome unknown')
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; c.setEnqueueOutputs([output]); throw error })).rejects.toBe(error)
    expect(c.admission.outboxes).toHaveLength(1)
    c.setActive([]); expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained }, true)).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(1)
  })
  it('blocks queue admission during the in-flight own action', async () => {
    const c = ready()
    await c.admission.captureEnqueue(expected, async () => {
      expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
      expect(() => c.admission.captureOutboxes([])).toThrow('T3_HARNESS_PRECONDITION')
      c.setEnqueueOutputs([output]); return retained
    })
  })
  it('snapshots expected ACK identity before the mutating callback can change its caller object', async () => {
    const c = ready(), mutable = { ...expected }
    const receipt = await c.admission.captureEnqueue(mutable, async () => {
      mutable.ackMessageId = 'unassigned'; mutable.sourceMessageId = 'unassigned'; mutable.ackPayloadSha256 = '0'.repeat(64)
      c.setEnqueueOutputs([output]); return retained
    })
    expect(receipt).toMatchObject([{ ackMessageId: 'aperak-A', sourceMessageId: 'source-A', ackPayloadSha256: expected.ackPayloadSha256 }])
  })
  it.each(['sourceMessageId', 'ackMessageId', 'companyId', 'environment', 'ackPayloadSha256', 'sourcePayloadSha256'])('holds after an action produces the wrong output %s', async key => {
    const c = ready(); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; c.setEnqueueOutputs([{ ...output, [key]: 'wrong' }]); return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(1); expect(c.admission.outboxes).toHaveLength(1)
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each([{ outputs: [] }, { outputs: [output, { ...output, id: 'duplicate-outbox' }] }])('requires exactly one post-action output %j', async ({ outputs }) => {
    const c = ready()
    await expect(c.admission.captureEnqueue(expected, async () => { c.setEnqueueOutputs(outputs); return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.outboxes).toHaveLength(1)
  })
  it('allows an explicit idempotency action only for the unchanged already-owned exact receipt', async () => {
    const c = ready(); let actions = 0
    await c.admission.captureEnqueue(expected, async () => { actions++; c.setEnqueueOutputs([output]); return retained })
    const again = await c.admission.captureEnqueue(expected, async () => { actions++; return retained }, true)
    expect(actions).toBe(2); expect(again).toMatchObject([{ id: 'aperak-outbox' }]); expect(c.admission.outboxes).toHaveLength(2)
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(2)
  })
  it('refuses repeat=true when no exact owned output receipt exists', async () => {
    const c = ready(); c.setEnqueueOutputs([output]); let actions = 0
    await expect(c.admission.captureEnqueue(expected, async () => { actions++; return retained }, true)).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(actions).toBe(0)
  })
  it('holds if an explicit repeat mutates its selected existing output', async () => {
    const c = ready(); await c.admission.captureEnqueue(expected, async () => { c.setEnqueueOutputs([output]); return retained })
    await expect(c.admission.captureEnqueue(expected, async () => { c.setEnqueueOutputs([{ ...output, status: 'sending' }]); return retained }, true)).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('keeps a changed original ACK after a completed action on HOLD', async () => {
    const c = ready()
    await expect(c.admission.captureEnqueue(expected, async () => {
      c.setEnqueueOutputs([output]); c.setEnqueueAck([{ ...ack, ackPayloadSha256: '0'.repeat(64) }]); return retained
    })).rejects.toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.outboxes).toHaveLength(1)
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
  })
})

describe('T3 E02 unattributed technical reception remains evidence only', () => {
  const technical = { ...source, companyId: null, emailCompanyId: null }
  function receivedTechnical() {
    const c = harness(); c.admission.rememberMime(mime)
    c.setEmails([{ ...email, companyId: null }]); c.setSources([technical]); c.setActive([])
    return c
  }
  it('permits exact own-mailbox reception with null company and no source', () => {
    const c = receivedTechnical(); c.setSources([])
    expect(c.admission.observePoll(['email-A'], [])).toEqual([])
    expect(c.admission.sources).toEqual([])
    expect(c.admission.technicalSources).toEqual([])
    expect(c.admission.admit([])).toMatchObject({ workerNeeded: false, assigned: [] })
  })
  it('preserves a null-company technical source without returning business IDs or processing authority', () => {
    const c = receivedTechnical()
    expect(c.admission.observePoll(['email-A'], ['source-A'])).toEqual([])
    expect(c.admission.sources).toEqual([])
    expect(c.admission.technicalSources).toMatchObject([{ sourceMessageId: 'source-A', companyId: null, inboundEmailMessageId: 'email-A', mimeSha256: hash(mime), sourcePayloadSha256: hash(parsed.rawPayload) }])
    expect(Object.isFrozen(c.admission.technicalSources)).toBe(true)
    expect(Object.isFrozen(c.admission.technicalSources[0])).toBe(true)
    expect(() => c.admission.assertSources(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.admit(['outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.admit([]).workerNeeded).toBe(false)
  })
  it('never infers an owned business source from an unattributed email', () => {
    const c = receivedTechnical(); c.setSources([{ ...source, emailCompanyId: null }])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toEqual([])
  })
  it('cross-checks claimed own source metadata against the independently observed null-company email', () => {
    const c = receivedTechnical(); c.setSources([source])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toEqual([])
  })
  it.each(['sourcePayloadSha256', 'mimeSha256', 'direction', 'environment', 'emailEnvironment', 'mailboxId', 'inboundEmailMessageId'])('refuses invalid technical receipt %s', key => {
    const c = receivedTechnical(); c.setSources([{ ...technical, [key]: 'different' }])
    expect(() => c.admission.observePoll(['email-A'], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toEqual([])
  })
  it('refuses a foreign non-null received company even when no source exists', () => {
    const c = receivedTechnical(); c.setEmails([{ ...email, companyId: 'foreign-company' }]); c.setSources([])
    expect(() => c.admission.observePoll(['email-A'], [])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('refuses to adopt an unknown old technical source from returned IDs alone', () => {
    const c = receivedTechnical()
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('reuses an unchanged known technical receipt without granting business authority', () => {
    const c = receivedTechnical(); c.admission.observePoll(['email-A'], ['source-A'])
    expect(c.admission.observePoll([], ['source-A'])).toEqual([])
    expect(c.admission.technicalSources).toHaveLength(1)
    expect(c.admission.sources).toEqual([])
  })
  it('rejects changed known technical receipt instead of promoting it', () => {
    const c = receivedTechnical(); c.admission.observePoll(['email-A'], ['source-A']); c.setSources([source])
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toEqual([])
    expect(c.admission.technicalSources[0].companyId).toBe(null)
  })
  it('rejects a changed known technical payload hash while preserving the original evidence', () => {
    const c = receivedTechnical(); c.admission.observePoll(['email-A'], ['source-A'])
    c.setSources([{ ...technical, sourcePayloadSha256: '0'.repeat(64) }])
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.technicalSources[0].sourcePayloadSha256).toBe(hash(parsed.rawPayload))
  })
  it('rejects changed known business receipt instead of downgrading it', () => {
    const c = harness(); c.receive(); c.setSources([technical])
    expect(() => c.admission.observePoll([], ['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.sources).toHaveLength(1)
    expect(c.admission.technicalSources).toEqual([])
  })
  it('keeps technical output unassigned even when its active row claims the own company', () => {
    const c = receivedTechnical(); c.admission.observePoll(['email-A'], ['source-A']); c.setActive([outbox])
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.outboxes).toEqual([])
  })
})

describe('T3 E02 exact output receipt capture', () => {
  it.each(['CONTRL', 'APERAK', 'UTILTS_ERR'])('admits explicitly captured %s', ackFamily => {
    const c = harness(), row = { ...outbox, ackFamily, outboxFamily: ackFamily }
    c.receive(); c.setOutputs([row]); c.setActive([row])
    const receipt = c.admission.captureOutboxes(['source-A'])
    expect(receipt).toHaveLength(1)
    expect(Object.isFrozen(receipt[0])).toBe(true)
    expect(c.admission.admit(['outbox-A'])).toMatchObject({ workerNeeded: true, assigned: [{ id: 'outbox-A', sourceMessageId: 'source-A' }] })
  })
  it('does not automatically capture outputs newly appearing on previously processed source', () => {
    const c = harness(); c.capture(); c.setOutputs([{ ...outbox, id: 'late-output', ackMessageId: 'late-ack' }])
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    c.setActive([{ ...outbox, id: 'late-output', ackMessageId: 'late-ack' }])
    expect(() => c.admission.admit(['outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('retains a no-output denial as an empty explicit result', () => {
    const c = harness(); c.receive(); c.setOutputs([]); c.setActive([])
    expect(c.admission.captureOutboxes(['source-A'])).toEqual([])
    expect(c.admission.admit([])).toMatchObject({ workerNeeded: false, assigned: [] })
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow()
  })
  it.each(['ackCompanyId', 'ackEnvironment', 'ackSourceMessageId', 'ackDirection', 'ackFamily', 'outboxFamily', 'ackPayloadSha256'])('refuses incomplete or wrong output %s', key => {
    const c = harness(); c.receive(); c.setOutputs([{ ...outbox, [key]: 'wrong' }])
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each(['sourceCompanyId', 'sourceEnvironment', 'emailCompanyId', 'emailEnvironment'])('checks joined receipt scope %s', key => {
    const c = harness(); c.receive(); c.setOutputs([{ ...outbox, [key]: 'foreign' }])
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.outboxes).toEqual([])
  })
  it.each([null, {}, [null], [{ id: 'outbox-A' }], [outbox, outbox]])('refuses malformed or duplicate output capture %j', outputs => {
    const c = harness(); c.receive(); c.setOutputs(outputs)
    expect(() => c.admission.captureOutboxes(['source-A'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(c.admission.outboxes).toEqual([])
  })
})

describe('T3 E02 complete active outbox admission', () => {
  it.each(['prepared', 'queued', 'sending'])('refuses same-company unassigned %s rows, including live leases', status => {
    const c = harness(); c.capture()
    c.setActive([outbox, { ...outbox, id: 'foreign-same-company', status, lockedAt: new Date().toISOString() }])
    expect(() => c.admission.admit(['outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it.each([null, {}, [null], [{ id: 'outbox-A' }]])('refuses malformed inventory %j', rows => {
    const c = harness(); c.capture(); c.setActive(rows)
    expect(() => c.admission.admit(['outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('requires explicit complete phase IDs even for remembered outputs', () => {
    const c = harness(); c.capture()
    expect(() => c.admission.admit([])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.admit(['unowned'])).toThrow('T3_HARNESS_PRECONDITION')
    expect(() => c.admission.admit(['outbox-A', 'outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('refuses missing and duplicate assigned rows', () => {
    const c = harness(); c.capture(); c.setActive([])
    expect(() => c.admission.admit(['outbox-A'])).toThrow()
    c.setActive([outbox, outbox])
    expect(() => c.admission.admit(['outbox-A'])).toThrow()
  })
  it.each(['mimeSha256', 'sourcePayloadSha256', 'ackPayloadSha256', 'companyId', 'sourceMessageId', 'inboundEmailMessageId', 'ackMessageId', 'ackSourceMessageId', 'ackEnvironment', 'mailboxId'])('refuses mutation of captured binding %s', key => {
    const c = harness(); c.capture(); c.setActive([{ ...outbox, [key]: 'different' }])
    expect(() => c.admission.admit(['outbox-A'])).toThrow('T3_HARNESS_PRECONDITION')
  })
  it('never requests worker for an empty or terminal-only phase', () => {
    const c = harness(); c.setActive([])
    expect(c.admission.admit([]).workerNeeded).toBe(false)
    c.capture(); c.setActive([{ ...outbox, status: 'sent' }])
    expect(c.admission.admit(['outbox-A'])).toMatchObject({ workerNeeded: false })
  })
})
