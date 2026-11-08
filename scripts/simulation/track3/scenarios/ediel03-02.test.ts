// EDIEL03.02: SMTP 554 (permanent avvisning) vid sändning av CONTRL ur outbox (Playwright används inte).
// Oraklet: synligt misslyckande (outboxstatus + attempt-klass + ev. transportärende synligt för operatör), ingen ny
// sändning. Kontrollsteg: samma flöde med 451 i samma körning så att "4xx och 5xx behandlas identiskt" kan loggas.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setSmtpMode } from '../lib/counterparty'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'
import { outboxRow, seedInboundSource, type E03Source } from '../lib/e03-fixture'
import { capture, drain, flushQueuedInAcceptMode, maxReceivedN, operatorVisibility, seedWithRetry, sql, sqlJson, Timing } from '../lib/e03-steps'

const run = newRunContext('ediel03-02')
const evidence = new Evidence()
const timing = new Timing()
const seedLog: Array<Record<string, unknown>> = []
let perm: E03Source, temp: E03Source
let n0 = 0
const outcomes: Record<string, { outbox: Record<string, unknown>; attempt: Record<string, unknown>; copies: number; eventTypes: string[] }> = {}

beforeAll(async () => { await setSmtpMode('accept'); evidence.observe('run', { ...run, id: 'EDIEL03.02' }); evidence.observe('flush_before', await flushQueuedInAcceptMode(timing)) })
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  evidence.observe('seed_retries', seedLog)
  evidence.observe('timing', { totalsMs: timing.totals, log: timing.log })
  evidence.finalize()
})

describe('EDIEL03 deadlines, retry och återhämtning', () => {
  it('EDIEL03.02 fixture: två CONTRL-outboxrader (554-objekt och 451-kontroll) via kodens egen väg', async () => {
    perm = await seedWithRetry(timing, 'seed-554', (a) => seedInboundSource({ prefix: run.prefix, seq: 1 + a * 100 }), seedLog)
    temp = await seedWithRetry(timing, 'seed-451-control', (a) => seedInboundSource({ prefix: run.prefix, seq: 2 + a * 100 }), seedLog)
    evidence.observe('fixture', { perm: { src: perm.sourceMessageId, ack: perm.ackMessageId, outbox: perm.outboxId }, temp: { src: temp.sourceMessageId, ack: temp.ackMessageId, outbox: temp.outboxId } })
    expect(perm.outboxId).toBeTruthy(); expect(temp.outboxId).toBeTruthy()
  })

  it('EDIEL03.02 SMTP 554 -> synligt misslyckande (outboxstatus, attempt-klass, last_error), ingen ny sändning', async () => {
    // Båda raderna ligger köade; kör dem en i taget så att varje drain bara äger en rad: parkera kontrollraden som 'draft' tillfälligt.
    sql(`UPDATE public.ediel_outbox SET status='draft' WHERE id='${temp.outboxId}' AND status='queued'`)
    n0 = await maxReceivedN()
    await setSmtpMode('permfail-5xx', { code: 554 })
    const d1 = await drain(perm.outboxId!, timing, 'drain-1-554')
    evidence.save('drain-1-554.json', d1)
    const snap = await capture(evidence, '554/after-drain-1', { outboxId: perm.outboxId!, ackMessageId: perm.ackMessageId!, fromN: n0 })
    const attempt = snap.attempts[0] as Record<string, unknown>
    evidence.observe('drain_554', { http: d1.status, result: d1.result, foreignClaimableBefore: d1.foreignClaimableBefore })
    evidence.observe('outbox_554', { status: snap.outbox.status, last_error: snap.outbox.last_error, attempts: snap.outbox.attempts })
    evidence.observe('attempt_554', { classification: attempt?.classification, provider_result: attempt?.provider_result })
    evidence.observe('operator_visibility_554', operatorVisibility(perm.ackMessageId!, perm.sourceMessageId))
    expect(snap.attempts, 'exakt ett registrerat försök').toHaveLength(1)
    expect(attempt).toMatchObject({ classification: 'explicit_negative' })
    expect(JSON.stringify(attempt.provider_result)).toMatch(/554/)
    expect(['failed', 'delivery_uncertain']).toContain(String(snap.outbox.status))
    expect(String(snap.outbox.last_error ?? ''), 'felet är synligt i outbox-raden').toMatch(/554/)
    expect(snap.copies, 'motparten fick exakt ett försök').toHaveLength(1)
    expect(snap.copies[0].disposition).toBe('permfail-not-accepted')
    outcomes.permfail = { outbox: snap.outbox, attempt, copies: snap.copies.length, eventTypes: snap.events.map((e) => String(e.event_type)) }
    // ingen ny sändning
    await timing.sleep('settle-before-drain-2', 1500)
    const d2 = await drain(perm.outboxId!, timing, 'drain-2-after-554')
    const snap2 = await capture(evidence, '554/after-drain-2', { outboxId: perm.outboxId!, ackMessageId: perm.ackMessageId!, fromN: n0 })
    evidence.observe('drain_554_second', { result: d2.result })
    expect(((d2.result?.results as Array<{ id: string }> | undefined) ?? []).filter((r) => r.id === perm.outboxId)).toHaveLength(0)
    expect(snap2.attempts).toHaveLength(1)
    expect(snap2.copies).toHaveLength(1)
    expect(snap2.outbox.status).toBe(snap.outbox.status)
  })

  it('EDIEL03.02 kontroll: 451 i samma körning; loggar om 4xx och 5xx behandlas identiskt', async () => {
    sql(`UPDATE public.ediel_outbox SET status='queued' WHERE id='${temp.outboxId}' AND status='draft'`)
    const n1 = await maxReceivedN()
    await setSmtpMode('tempfail-4xx', { code: 451 })
    const d = await drain(temp.outboxId!, timing, 'drain-451-control')
    const snap = await capture(evidence, '451-control/after-drain-1', { outboxId: temp.outboxId!, ackMessageId: temp.ackMessageId!, fromN: n1 })
    const attempt = snap.attempts[0] as Record<string, unknown>
    outcomes.tempfail = { outbox: snap.outbox, attempt, copies: snap.copies.length, eventTypes: snap.events.map((e) => String(e.event_type)) }
    const shape = (o: (typeof outcomes)[string]) => ({ outboxStatus: o.outbox.status, attemptClass: o.attempt.classification, copies: o.copies, eventTypes: o.eventTypes, lastErrorPrefix: String(o.outbox.last_error).split(':')[0] })
    const identical = JSON.stringify(shape(outcomes.permfail)) === JSON.stringify(shape(outcomes.tempfail))
    evidence.observe('four_vs_five_xx', { permfail554: shape(outcomes.permfail), tempfail451: shape(outcomes.tempfail), treatedIdentically: identical, drainResult: d.result,
      note: identical ? 'Koden skiljer inte tillfälligt (4xx) från permanent (5xx): båda ger samma terminala outbox-status utan väntan/omförsök.' : 'Skillnad observerad, se shapes.' })
    expect(attempt).toMatchObject({ classification: 'explicit_negative' })
    expect(snap.copies).toHaveLength(1)
    await setSmtpMode('accept')
    // Kontrollen lämnar inga köade rader efter sig.
    expect(Number(sql(`SELECT count(*) FROM public.ediel_outbox WHERE id IN ('${temp.outboxId}','${perm.outboxId}') AND status IN ('prepared','queued','sending')`))).toBe(0)
    void outboxRow; void sqlJson
  })
})
