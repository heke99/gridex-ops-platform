// Execute the actual E01 callbacks with finite SQL/mail ports. N=1 is a
// diagnostic component cohort; this produces no mailbox or scenario PASS.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { encodeEdifactUnoc } from '@/lib/ediel/core/edifactEncoding'

const filename = fileURLToPath(new URL('../scripts/simulation/track3/scenarios/ediel01.test.ts', import.meta.url))
const sha = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex')
type Variant = 'exact' | 'contrl-same-rfc' | 'contrl-new-rfc' | 'aperak-same-rfc' | 'aperak-new-rfc'
  | 'extra-unrelated' | 'duplicate-capture-n' | 'bad-sidecar-hash' | 'duplicate-rfc-header' | 'header-substring' | 'rejected-disposition'
  | 'unoc-8bit' | 'unoc-base64' | 'extra-body-framing'
type Mail = {
  n: number; receivedAt: string; envelopeFrom: string; envelopeTo: string[]; bytes: number; sha256: string
  authUser: string; tlsVersion: string; mode: 'accept'; disposition: string; smtpReply: string
}
type Fixture = { raw: Buffer; payload: string; rfc: string; rec: Mail }
function message(family: string, n: number, rfc: string, headers?: string[], encoding?: 'unoc-8bit' | 'unoc-base64', extraFrame = false): Fixture {
  const payload = `UNB+UNOC:3+16700:ZZ+70007:ZZ+261101:1200+REF${family}'UNH+1+${family}:D:3:UN'${encoding ? "FTX+AAO+++ÅÄÖ åäö'" : ''}UNZ+1+REF${family}'`
  const head = Buffer.from([
    'From: ediel@t3.sim.invalid', 'To: dso@t3.sim.invalid', `Subject: ${family} synthetic`,
    ...(headers ?? [`Message-ID: ${rfc}`]), 'MIME-Version: 1.0', 'Content-Type: application/edifact',
    ...(encoding ? [`Content-Transfer-Encoding: ${encoding === 'unoc-base64' ? 'base64' : '8bit'}`] : []), '', '',
  ].join('\r\n'), 'ascii')
  const bytes = encodeEdifactUnoc(payload)
  const raw = Buffer.concat([head, encoding === 'unoc-base64' ? Buffer.from(bytes.toString('base64'), 'ascii') : bytes,
    ...(encoding ? [Buffer.from(extraFrame ? '\r\n\r\n' : '\r\n', 'ascii')] : [])])
  return { raw, payload, rfc, rec: {
    n, receivedAt: '2026-11-01T12:00:00.000Z', envelopeFrom: 'ediel@t3.sim.invalid', envelopeTo: ['dso@t3.sim.invalid'],
    bytes: raw.length, sha256: sha(raw), authUser: 'synthetic', tlsVersion: 'TLSv1.3', mode: 'accept', disposition: 'accepted', smtpReply: '250 accepted',
  } }
}
function harness(variant: Variant) {
  const callbacks = new Map<string, () => Promise<void>>()
  const received: Mail[] = []
  let drains = 0
  const cRfc = '<contrl@t3.sim.invalid>', aRfc = '<aperak@t3.sim.invalid>'
  const cHeaders = variant === 'duplicate-rfc-header' ? [`Message-ID: ${cRfc}`, 'Message-ID: <other@t3.sim.invalid>']
    : variant === 'header-substring' ? [`X-Message-ID: ${cRfc}`] : undefined
  const encoding = variant === 'unoc-8bit' || variant === 'unoc-base64' ? variant : variant === 'extra-body-framing' ? 'unoc-8bit' : undefined
  const contrl = message('CONTRL', 1, cRfc, cHeaders, encoding, variant === 'extra-body-framing'), aperak = message('APERAK', 2, aRfc, undefined, encoding)
  if (variant === 'rejected-disposition') contrl.rec.disposition = 'rejected'
  const duplicateFamily = variant.startsWith('aperak-') ? 'APERAK' : 'CONTRL'
  const duplicate = message(variant === 'extra-unrelated' ? 'NOTICE' : duplicateFamily,
    variant === 'duplicate-capture-n' ? 1 : 3,
    variant.endsWith('same-rfc') || variant === 'duplicate-capture-n' ? (duplicateFamily === 'CONTRL' ? cRfc : aRfc) : '<extra-copy@t3.sim.invalid>')
  const captures = new Map([[contrl.rec.n, contrl.raw], [aperak.rec.n, aperak.raw]])
  if (variant !== 'duplicate-capture-n') captures.set(duplicate.rec.n, duplicate.raw)
  const row = (family: 'CONTRL' | 'APERAK', id: string) => ({
    id, message_family: family, status: 'sent', ack_outcome: 'positive', related_message_id: 'source-A',
    interchange_reference: `REF${family}`, external_reference: null, raw_payload: family === 'CONTRL' ? contrl.payload : aperak.payload,
    outbox_id: `outbox-${id}`, outbox_status: 'sent', send_attempt_count: 1,
  })
  const rows = { CONTRL: [row('CONTRL', 'ack-C')], APERAK: [row('APERAK', 'ack-A')] }
  const attempt = (fixture: Fixture, messageId: string) => ({
    message_id: messageId, classification: 'accepted', rfc: fixture.rfc, mimeSha: sha(fixture.raw), payloadHash: sha(encodeEdifactUnoc(fixture.payload)),
    providerMessageId: null, smtpCode: 250, rawBase64: fixture.raw.toString('base64'),
  })
  const sql = (query: string) => {
    if (query.includes('t3-e01:dispatch-status')) return Object.values(rows).flat().filter(row => query.includes(`'${row.outbox_id}'`)).map(row => ({ id: row.outbox_id, status: drains >= (row.message_family === 'CONTRL' ? 1 : 2) ? 'sent' : 'queued' }))
    if (query.includes('SELECT count(*)')) return 0
    if (query.includes('FROM gridex_ediel_transport.attempts')) {
      const wanted = []
      if (query.includes("'ack-C'")) wanted.push(attempt(contrl, 'ack-C'))
      if (query.includes("'ack-A'")) wanted.push(attempt(aperak, 'ack-A'))
      return wanted
    }
    if (query.includes("m.message_family='CONTRL'")) return rows.CONTRL
    if (query.includes("m.message_family='APERAK'")) return rows.APERAK
    throw new Error('Undeclared SQL operation')
  }
  class Evidence { save() {} observe() {} finalize() {} }
  class Timer { async p<T>(_label: string, fn: () => Promise<T>): Promise<T> { return fn() } summary() { return {} } }
  const ports: Record<string, unknown> = {
    'node:crypto': crypto, 'node:fs': { readFileSync },
    vitest: { expect, it: (name: string, fn: () => Promise<void>) => callbacks.set(name, fn), describe: (_name: string, fn: () => void) => fn(), beforeAll() {}, afterAll() {}, afterEach() {} },
    '../lib/app': { triggerOutbox: async () => {
      drains++
      const family = drains === 1 ? 'CONTRL' : 'APERAK'
      received.push(family === 'CONTRL' ? contrl.rec : aperak.rec)
      const extraContrl = ['contrl-same-rfc', 'contrl-new-rfc', 'duplicate-capture-n', 'extra-unrelated'].includes(variant)
      if ((family === 'CONTRL' && extraContrl) || (family === 'APERAK' && variant.startsWith('aperak-'))) received.push(duplicate.rec)
      return { status: 200, ok: true, ms: 1, body: { ok: true, result: {} }, text: '' }
    } },
    '../lib/counterparty': {
      receivedMail: async () => received,
      readReceivedEml: (n: number) => {
        const raw = captures.get(n)
        if (!raw) throw new Error('Undeclared physical capture')
        return { raw, sha256: sha(raw), sha256Matches: !(variant === 'bad-sidecar-hash' && n === 1) }
      },
    },
    '../lib/db': { lit: (value: string) => "'" + value.replaceAll("'", "''") + "'" },
    '../lib/e01-chain': { Timer }, '../lib/e01-fixture': { sqlIn: sql }, '../lib/e01-tls': {},
    '../lib/e02-outbox': {},
    '../lib/evidence': { Evidence }, '../lib/inprocess': {}, '../lib/seed.mjs': { newRunContext: () => ({ prefix: 'synthetic' }) },
  }
  const exports: { prime?: (state: unknown) => void } = {}
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  // Receipt admission is an explicit finite port here; its actual implementation
  // is tested separately. These callbacks qualify physical MIME matching only.
  runInNewContext(code + '\nexports.prime=s=>{contrl=s.contrl;aperak=s.aperak;srcIds=["source-A"];dsoBase=0;phaseAdmission=s.admission;};', {
    exports, Buffer, process: { env: { T3_E01_N: '1' } },
    require: (name: string) => {
      if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name)
      return ports[name]
    },
  }, { filename, timeout: 5000 })
  exports.prime!( { contrl: rows.CONTRL, aperak: rows.APERAK,
    admission: { outboxes: Object.values(rows).flat().map(row => ({ id: row.outbox_id, ackMessageId: row.id })), admit: () => ({ workerNeeded: true }) } })
  const prefixes = ['EDIEL01.01 outbox-drain via', 'EDIEL01.03 outbox-drain via', 'EDIEL01.03 N CONTRL-MIME:']
  const run = async () => {
    for (const prefix of prefixes) {
      const callback = [...callbacks].find(([name]) => name.startsWith(prefix))?.[1]
      if (!callback) throw new Error('Actual E01 physical callback missing: ' + prefix)
      await callback()
    }
  }
  return { run, physical: () => received.length, workers: () => drains }
}

describe('T3 actual E01 physical-copy bijection', () => {
  it('accepts exactly one CONTRL and one APERAK with matching original bytes and hashes', async () => {
    const c = harness('exact')
    await c.run()
    expect(c.physical()).toBe(2)
    expect(c.workers()).toBe(2)
  })
  it.each(['unoc-8bit', 'unoc-base64'] as const)('preserves valid non-ASCII %s wire bytes and the actual transport payload hash', async variant => {
    const c = harness(variant)
    await c.run()
    expect(c.physical()).toBe(2)
    expect(c.workers()).toBe(2)
  })
  it.each(['contrl-same-rfc', 'contrl-new-rfc', 'aperak-same-rfc', 'aperak-new-rfc'] as const)('rejects an extra physical %s copy even though every expected attempt can find a MIME', async variant => {
    const c = harness(variant)
    await expect(c.run()).rejects.toThrow()
  })
  it.each(['extra-unrelated', 'duplicate-capture-n', 'bad-sidecar-hash', 'duplicate-rfc-header', 'header-substring', 'rejected-disposition', 'extra-body-framing'] as const)('refuses %s as exact physical delivery evidence', async variant => {
    const c = harness(variant)
    await expect(c.run()).rejects.toThrow()
  })
})
