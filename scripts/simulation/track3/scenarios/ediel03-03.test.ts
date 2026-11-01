// EDIEL03.03: förlorat SMTP-svar efter DATA (drop-after-data, samt hang med kort hangMs) för CONTRL ur outbox.
// Playwright används inte. Oraklet: klass 'unknown', outbox 'delivery_uncertain', nästa drain processed:0, motparten har
// exakt EN kopia, ingen blind omsändning (varken via drain, direktanrop av sendOutboxItem eller sendEdielMessageViaSmtp).
// Återhämtningsväg: lib/ediel/recovery/prodatRecovery.ts finns bara för PRODAT; anropet mot CONTRL loggas (utfall, ej antaget).
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { receivedMail, setSmtpMode } from '../lib/counterparty'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'
import { outboxRow, seedInboundSource, type E03Source } from '../lib/e03-fixture'
import { capture, drain, flushQueuedInAcceptMode, maxReceivedN, mimeCopiesFor, operatorVisibility, physicalCaptureSince, rfcIdOf, seedWithRetry, sql, Timing } from '../lib/e03-steps'

const run = newRunContext('ediel03-03')
const evidence = new Evidence()
const timing = new Timing()
const seedLog: Array<Record<string, unknown>> = []
const HANG_MS = 6000

beforeAll(async () => { await setSmtpMode('accept'); evidence.observe('run', { ...run, id: 'EDIEL03.03', hangMs: HANG_MS }); evidence.observe('flush_before', await flushQueuedInAcceptMode(timing)) })
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  evidence.observe('seed_retries', seedLog)
  evidence.observe('timing', { totalsMs: timing.totals, log: timing.log })
  evidence.finalize()
})

async function lostResponseCase(label: 'drop-after-data' | 'hang', seq: number) {
  const src: E03Source = await seedWithRetry(timing, `seed-${label}`, (a) => seedInboundSource({ prefix: run.prefix, seq: seq + a * 100 }), seedLog)
  expect(src.outboxId, 'CONTRL-outbox skapades inte av koden').toBeTruthy()
  const n0 = await maxReceivedN()
  if (label === 'hang') await setSmtpMode('hang', { hangMs: HANG_MS }); else await setSmtpMode('drop-after-data')
  const d1 = await drain(src.outboxId!, timing, `drain-1-${label}`)
  evidence.save(`${label}/drain-1.json`, d1)
  await setSmtpMode('accept') // återställ direkt; fortsatta steg ska bevisa att ingen omsändning sker trots friskt SMTP
  const snap = await capture(evidence, `${label}/after-drain-1`, { outboxId: src.outboxId!, ackMessageId: src.ackMessageId!, fromN: n0 })
  const attempt = snap.attempts[0] as Record<string, unknown>
  if (attempt?.entered_at && attempt?.observed_at) timing.add('smtp_transport', `${label} entered->observed`, Date.parse(String(attempt.observed_at)) - Date.parse(String(attempt.entered_at)))
  evidence.observe(`${label}_drain_1`, { http: d1.status, ms: d1.ms, result: d1.result, foreignClaimableBefore: d1.foreignClaimableBefore })
  evidence.observe(`${label}_attempt`, { classification: attempt?.classification, entered_at: attempt?.entered_at, observed_at: attempt?.observed_at, provider_result: attempt?.provider_result })
  evidence.observe(`${label}_outbox`, { status: snap.outbox.status, last_error: snap.outbox.last_error, locked_by: snap.outbox.locked_by })
  expect(snap.attempts).toHaveLength(1)
  expect(attempt).toMatchObject({ classification: 'unknown' })
  expect(snap.outbox.status).toBe('delivery_uncertain')
  expect(snap.copies, 'motparten sparade exakt en kopia').toHaveLength(1)
  expect(snap.copies[0].sha256Verified).toBe(true)
  expect(snap.copies[0].disposition).toBe(label === 'hang' ? 'received-no-reply-hang' : 'received-no-reply-connection-dropped')
  // This run requires a coordinator-qualified exclusive/quiescent mail phase.
  // Every physical addition is audited; changing the RFC ID cannot hide a copy.
  const originalCapture = await physicalCaptureSince(n0)
  expect(originalCapture).toHaveLength(1)
  const binding = attempt.binding as { rfcMessageId?: string; mimeSha256?: string; originalHash?: string }
  expect(originalCapture[0]).toMatchObject({ rfcMessageId: rfcIdOf(snap.attempts), sha256: binding.mimeSha256 })
  const unchangedCapture = async (phase: string) => {
    const actual = await physicalCaptureSince(n0)
    evidence.save(`${label}/${phase}-physical-capture.json`, actual)
    expect(actual, `${phase}: all owned physical MIME copies, independent of RFC ID`).toEqual(originalCapture)
  }

  // nästa drain: processed 0, ingen ny kopia
  await timing.sleep(`settle-${label}`, 1500)
  const d2 = await drain(src.outboxId!, timing, `drain-2-${label}`)
  evidence.save(`${label}/drain-2.json`, d2)
  expect(d2.result).toMatchObject({ processed: 0 })
  expect(((d2.result?.results as Array<{ id: string }> | undefined) ?? []).filter((r) => r.id === src.outboxId)).toHaveLength(0)
  const afterDrain2 = await mimeCopiesFor(rfcIdOf(snap.attempts), n0)
  expect(afterDrain2, 'fortfarande exakt en kopia efter andra draining').toHaveLength(1)
  await unchangedCapture('after-drain-2')

  // ingen blind retry via direkta vägar (accept-läge är aktivt, så en omsändning skulle synas hos motparten)
  const { sendOutboxItem } = await import('@/lib/ediel/outbox/sendOutboxItem')
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const { sendEdielMessageViaSmtp } = await import('@/lib/ediel/transport')
  const direct = await sendOutboxItem({ actorUserId: process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!, outboxItemId: src.outboxId! })
  const message = await getEdielMessageById(src.ackMessageId!)
  expect(message).toMatchObject({ id: src.ackMessageId, company_id: src.companyId, related_message_id: src.sourceMessageId, message_family: 'CONTRL', direction: 'outbound' })
  expect(binding.originalHash, 'attempt is bound to the exact owned ACK payload').toBe(createHash('sha256').update(message!.raw_payload ?? '', 'utf8').digest('hex'))
  let transportResend: unknown
  try {
    transportResend = { returned: await sendEdielMessageViaSmtp(message!, { actorUserId: process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!, smtpMimeMode: null, dispatchOwner: { kind: 'direct' } } as never) }
  } catch (e) { transportResend = { threw: (e as Error).message, name: (e as Error).name } }
  expect((transportResend as { threw?: string }).threw, 'direct transport reached the semantic resend fence').toContain('ediel_transport_resend_suppressed')
  const afterDirect = await mimeCopiesFor(rfcIdOf(snap.attempts), n0)
  const totalAfter = (await receivedMail()).filter((m) => m.n > n0).length
  evidence.observe(`${label}_no_blind_retry`, { sendOutboxItemDirect: direct, transportDirectResend: transportResend, copiesForThisMessage: afterDirect.length, allMailsSinceBaseline: totalAfter })
  expect(direct.status).toBe('blocked')
  expect(afterDirect, 'direktanrop får inte ge ny kopia').toHaveLength(1)
  await unchangedCapture('after-direct')

  // återhämtningsväg (endast PRODAT i koden): loggar vad CONTRL-anropet ger
  const { prepareAndQueueProdatRecovery } = await import('@/lib/ediel/recovery/prodatRecovery')
  let recovery: unknown
  try { recovery = await prepareAndQueueProdatRecovery({ companyId: src.companyId, actorUserId: process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!, originalMessageId: src.ackMessageId!, operationId: randomUUID(), previousAttemptId: String(attempt.id) }) }
  catch (e) { recovery = { threw: (e as Error).message } }
  const afterRecovery = await mimeCopiesFor(rfcIdOf(snap.attempts), n0)
  evidence.observe(`${label}_recovery_path_contrl`, { outcome: recovery, copiesAfter: afterRecovery.length, exposedFor: 'PRODAT only (lib/ediel/recovery/prodatRecovery.ts)' })
  evidence.observe(`${label}_operator_visibility`, operatorVisibility(src.ackMessageId!, src.sourceMessageId))
  evidence.observe(`${label}_final_outbox`, { status: outboxRow(src.outboxId!).status })
  expect(afterRecovery).toHaveLength(1)
  await unchangedCapture('after-recovery')
  expect(Number(sql(`SELECT count(*) FROM public.ediel_outbox WHERE id='${src.outboxId}' AND status IN ('prepared','queued','sending')`))).toBe(0)
  return { src, attempt, recovery }
}

describe('EDIEL03 deadlines, retry och återhämtning', () => {
  it('EDIEL03.03 drop-after-data -> klass unknown, delivery_uncertain, drain processed:0, exakt 1 kopia, ingen blind retry', async () => {
    const r = await lostResponseCase('drop-after-data', 1)
    const rec = r.recovery as { status?: string; reason?: string; threw?: string }
    evidence.observe('recovery_expectation', { expected: "hold/'verified_transfer_loss_required' eller avvisning", actual: rec })
    expect(JSON.stringify(rec)).not.toMatch(/"status":"queued"/)
  })

  it('EDIEL03.03 hang (hangMs 6 s) -> samma oracle', async () => {
    await lostResponseCase('hang', 2)
  })
})
