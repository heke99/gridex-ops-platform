// EDIEL03.01: SMTP 451 (tillfälligt fel) vid sändning av CONTRL ur outbox (Playwright används inte; ingen webbläsare).
// Oraklet: försöket registreras med SMTP-status och klass explicit_negative, outbox blir inte 'sent', ingen automatisk
// ny sändning vid nästa drain (exakt ett mottaget MIME-försök hos motparten). Designens "föreskrivna väntan" saknar
// kodmotsvarighet; vad som finns (next_attempt/väntekolumner) LOGGAS som observation och asserteras inte bort.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { counterpartyState, setSmtpMode } from '../lib/counterparty'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'
import { attemptsFor, eventsFor, outboxRow, seedInboundSource, type E03Source } from '../lib/e03-fixture'
import { capture, drain, flushQueuedInAcceptMode, maxReceivedN, operatorVisibility, rfcIdOf, seedWithRetry, sqlJson, Timing } from '../lib/e03-steps'

const run = newRunContext('ediel03-01')
const evidence = new Evidence()
const timing = new Timing()
const seedLog: Array<Record<string, unknown>> = []
let src: E03Source
let n0 = 0

beforeAll(async () => {
  await setSmtpMode('accept')
  evidence.observe('run', { ...run, id: 'EDIEL03.01' })
  // Flusha köade rester från andra körningar i accept-läge innan eget läge sätts (rapporteras, inte maskerat).
  evidence.observe('flush_before', await flushQueuedInAcceptMode(timing))
})
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  evidence.observe('seed_retries', seedLog)
  evidence.observe('timing', { totalsMs: timing.totals, log: timing.log })
  evidence.finalize()
})

describe('EDIEL03 deadlines, retry och återhämtning', () => {
  it('EDIEL03.01 fixture: CONTRL i outbox via kodens egen mottagnings- och ACK-väg', async () => {
    src = await seedWithRetry(timing, 'seed-source+contrl', (a) => seedInboundSource({ prefix: run.prefix, seq: 1 + a * 100 }), seedLog)
    evidence.observe('fixture', { sourceMessageId: src.sourceMessageId, ackMessageId: src.ackMessageId, outboxId: src.outboxId, replacementSteps: ['inbound_email_messages-rad via SQL (e03-fixture.ts)', 'UNB-testindikator och ediel_ack-profilens application_reference (harnessfynd)'] })
    expect(src.outboxId, 'CONTRL-outbox skapades inte av koden').toBeTruthy()
    expect(outboxRow(src.outboxId!).status).toBe('queued')
    n0 = await maxReceivedN()
  })

  it('EDIEL03.01 SMTP 451 -> försök med SMTP-status, klass explicit_negative, outbox ej sent', async () => {
    await setSmtpMode('tempfail-4xx', { code: 451 })
    const d1 = await drain(src.outboxId!, timing, 'drain-1-451')
    evidence.save('drain-1.json', d1)
    const snap = await capture(evidence, 'after-drain-1', { outboxId: src.outboxId!, ackMessageId: src.ackMessageId!, fromN: n0 })
    const attempt = snap.attempts[0] as Record<string, unknown> | undefined
    const entered = attempt?.entered_at ? Date.parse(String(attempt.entered_at)) : NaN
    const observed = attempt?.observed_at ? Date.parse(String(attempt.observed_at)) : NaN
    if (Number.isFinite(entered) && Number.isFinite(observed)) timing.add('smtp_transport', 'attempt entered->observed', observed - entered)
    evidence.observe('drain_1', { http: d1.status, result: d1.result, foreignClaimableBefore: d1.foreignClaimableBefore })
    evidence.observe('outbox_after_1', { status: snap.outbox.status, last_error: snap.outbox.last_error, attempts: snap.outbox.attempts, send_attempt_count: snap.outbox.send_attempt_count })
    evidence.observe('attempt_after_1', attempt)
    // Förväntat (designen): försök registrerat med SMTP-status 451 och klass explicit_negative; faktiskt loggas ovan.
    expect(snap.attempts.length, 'exakt ett registrerat försök').toBe(1)
    expect(attempt).toMatchObject({ classification: 'explicit_negative' })
    expect(JSON.stringify(attempt!.provider_result), 'SMTP-statuskod 451 i registrerat försök').toMatch(/451/)
    expect(snap.outbox.status).not.toBe('sent')
    expect(['failed', 'delivery_uncertain', 'queued']).toContain(String(snap.outbox.status))
    expect(snap.copies.length, 'motparten fick exakt ett MIME-försök').toBe(1)
    expect(snap.copies[0].disposition).toBe('tempfail-not-accepted')
    expect(snap.copies[0].sha256Verified).toBe(true)
  })

  it('EDIEL03.01 ingen automatisk ny sändning vid nästa drain (exakt 1 MIME hos motparten)', async () => {
    const before = outboxRow(src.outboxId!)
    await timing.sleep('settle-before-drain-2', 1500)
    const d2 = await drain(src.outboxId!, timing, 'drain-2-after-451')
    evidence.save('drain-2.json', d2)
    const snap = await capture(evidence, 'after-drain-2', { outboxId: src.outboxId!, ackMessageId: src.ackMessageId!, fromN: n0 })
    evidence.observe('drain_2', { http: d2.status, result: d2.result, foreignClaimableBefore: d2.foreignClaimableBefore })
    const ownResults = ((d2.result?.results as Array<{ id: string }> | undefined) ?? []).filter((r) => r.id === src.outboxId)
    expect(ownResults, 'drain 2 rörde inte raden').toHaveLength(0)
    expect(snap.attempts, 'inga fler transportförsök').toHaveLength(1)
    expect(snap.copies, 'exakt 1 MIME-försök hos motparten').toHaveLength(1)
    expect(snap.outbox.status).toBe(before.status)
    expect(snap.outbox.send_attempt_count).toBe(before.send_attempt_count)
  })

  it('EDIEL03.01 observation: föreskriven väntan/next_attempt finns i koden? (loggas, asserteras inte bort)', async () => {
    const outbox = outboxRow(src.outboxId!)
    const cols = (sqlJson(`SELECT coalesce(jsonb_agg(column_name ORDER BY ordinal_position),'[]') FROM information_schema.columns WHERE table_schema='public' AND table_name='ediel_outbox'`) as string[])
    const waitCols = cols.filter((c) => /next|retry|backoff|wait|resume|not_before|available/i.test(c))
    const events = await eventsFor(src.ackMessageId!)
    evidence.observe('retry_wait_columns_in_ediel_outbox', { waitCols, values: Object.fromEntries(waitCols.map((c) => [c, outbox[c]])) })
    evidence.observe('retry_wait_events', events.filter((e) => /retry|wait|next/i.test(JSON.stringify(e))).map((e) => [e.event_type, e.message]))
    evidence.observe('design_vs_code', {
      expected: '4xx: försök registrerat som explicit_negative; automatisk omsändning först efter föreskriven väntan',
      actual: { outboxStatus: outbox.status, last_error: outbox.last_error, nextAttemptColumn: waitCols.length ? waitCols : 'saknas', statusesClaimedByClaimRpc: ['prepared', 'queued'] },
    })
    evidence.observe('operator_visibility', operatorVisibility(src.ackMessageId!, src.sourceMessageId))
    evidence.observe('ack_message_row', sqlJson(`SELECT to_jsonb(x) FROM (SELECT id,status,failure_reason,ack_status,message_sent_at FROM public.ediel_messages WHERE id='${src.ackMessageId}') x`))
    evidence.observe('counterparty', await counterpartyState())
    const attempts = attemptsFor(src.ackMessageId!)
    evidence.observe('rfc_message_id', rfcIdOf(attempts))
    expect(true).toBe(true)
  })
})
