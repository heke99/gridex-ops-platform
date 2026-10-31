// EDIEL03.04: processstopp under claim (worker dör efter claim men före SMTP). Playwright används inte.
// Genomförande: den riktiga claim-RPC:n (claimEdielOutboxItem) körs i testprocessen och workern slutför aldrig
// (samma tillstånd som efter ett processdöd, eftersom allt tillstånd ligger i databasen; appens egen process dödas inte
// eftersom den delas med andra spår). Lease-utgång deklareras som klockfixtur: locked_at flyttas 11 min bakåt med SQL
// (ursprung: scripts/ediel-tr-05-recovery-native.test.ts expireDeclaredWorkerLease(), 1c0c088c rad ~462; där 1 timme).
// Oraklet: ny drain -> delivery_uncertain 'stale_sending_lock_requires_transport_reconciliation', ingen återsändning,
// gammal worker fencad (outbox_item_not_claimed_by_worker / ediel_transport_worker_fence_lost) om den återupptas.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { receivedMail, setSmtpMode } from '../lib/counterparty'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'
import { actor, attemptsFor, eventsFor, outboxRow, seedInboundSource, type E03Source } from '../lib/e03-fixture'
import { drain, flushQueuedInAcceptMode, maxReceivedN, operatorVisibility, seedWithRetry, sql, Timing } from '../lib/e03-steps'

const run = newRunContext('ediel03-04')
const evidence = new Evidence()
const timing = new Timing()
const seedLog: Array<Record<string, unknown>> = []
const A = () => actor()

beforeAll(async () => { await setSmtpMode('accept'); evidence.observe('run', { ...run, id: 'EDIEL03.04' }); evidence.observe('flush_before', await flushQueuedInAcceptMode(timing)) })
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  evidence.observe('seed_retries', seedLog)
  evidence.observe('timing', { totalsMs: timing.totals, log: timing.log })
  evidence.finalize()
})

const expireLease = (id: string) => sql(`UPDATE public.ediel_outbox SET locked_at=now()-interval '11 minutes' WHERE id='${id}' AND status='sending'`)

describe('EDIEL03 deadlines, retry och återhämtning', () => {
  let a: E03Source, b: E03Source
  let n0 = 0
  const workerA = `t3sim-e03-04-a-${randomUUID()}`
  const workerB = `t3sim-e03-04-b-${randomUUID()}`
  let claimA: Record<string, unknown> | null, claimB: Record<string, unknown> | null

  it('EDIEL03.04 fixture + claim som aldrig slutförs (status sending, ingen SMTP, inga attempts)', async () => {
    await setSmtpMode('accept')
    a = await seedWithRetry(timing, 'seed-a', (x) => seedInboundSource({ prefix: run.prefix, seq: 1 + x * 100 }), seedLog)
    b = await seedWithRetry(timing, 'seed-b', (x) => seedInboundSource({ prefix: run.prefix, seq: 2 + x * 100 }), seedLog)
    // Båda ligger köade; claima A och B med varsin worker via den riktiga claim-RPC:n.
    const { claimEdielOutboxItem } = await import('@/lib/ediel/outbox/claimOutboxItems')
    n0 = await maxReceivedN()
    claimA = (await claimEdielOutboxItem({ outboxItemId: a.outboxId!, workerId: workerA, actorUserId: A() })) as never
    claimB = (await claimEdielOutboxItem({ outboxItemId: b.outboxId!, workerId: workerB, actorUserId: A() })) as never
    evidence.save('claim-a.json', claimA); evidence.save('claim-b.json', claimB)
    expect(claimA).toMatchObject({ id: a.outboxId, status: 'sending', locked_by: workerA, current_send_attempt_id: expect.any(String) })
    expect(claimB).toMatchObject({ id: b.outboxId, status: 'sending', locked_by: workerB, current_send_attempt_id: expect.any(String) })
    expect(attemptsFor(a.ackMessageId!)).toHaveLength(0)
    expect((await receivedMail()).filter((m) => m.n > n0)).toHaveLength(0)
    evidence.save('outbox-a-claimed.json', outboxRow(a.outboxId!)); evidence.save('outbox-b-claimed.json', outboxRow(b.outboxId!))
  })

  it('EDIEL03.04 drain medan leasen är giltig rör inte raderna (processed:0, status kvar sending)', async () => {
    const d = await drain(a.outboxId!, timing, 'drain-lease-active')
    evidence.save('drain-lease-active.json', d)
    evidence.observe('drain_lease_active', d.result)
    expect(d.result).toMatchObject({ claimed: 0, processed: 0 })
    expect(outboxRow(a.outboxId!)).toMatchObject({ status: 'sending', locked_by: workerA })
  })

  it('EDIEL03.04 B: utgången lease innan svepet -> gammal worker kan inte nå SMTP (ediel_outbox_worker_lease_expired)', async () => {
    expireLease(b.outboxId!)
    const { sendOutboxItem } = await import('@/lib/ediel/outbox/sendOutboxItem')
    const r = await sendOutboxItem({ actorUserId: A(), outboxItemId: b.outboxId!, workerId: workerB, sendAttemptId: String(claimB!.current_send_attempt_id), alreadyClaimed: true })
    evidence.observe('b_old_worker_resumes_unswept', r)
    expect(r).toMatchObject({ status: 'blocked', error: 'ediel_outbox_worker_lease_expired' })
    expect(attemptsFor(b.ackMessageId!)).toHaveLength(0)
    expect((await receivedMail()).filter((m) => m.n > n0)).toHaveLength(0)
  })

  it('EDIEL03.04 A: lease > 10 min + ny drain -> delivery_uncertain stale_sending_lock_requires_transport_reconciliation, ingen återsändning', async () => {
    expireLease(a.outboxId!)
    evidence.save('outbox-a-expired.json', outboxRow(a.outboxId!))
    const before = (await receivedMail()).length
    const d = await drain(a.outboxId!, timing, 'drain-after-lease-expiry')
    evidence.save('drain-after-expiry.json', d)
    evidence.observe('drain_after_expiry', { http: d.status, result: d.result, foreignClaimableBefore: d.foreignClaimableBefore })
    const rowA = outboxRow(a.outboxId!), rowB = outboxRow(b.outboxId!)
    evidence.save('outbox-a-after-sweep.json', rowA); evidence.save('outbox-b-after-sweep.json', rowB)
    evidence.observe('a_after_sweep', { status: rowA.status, last_error: rowA.last_error, locked_by: rowA.locked_by, current_send_attempt_id: rowA.current_send_attempt_id })
    evidence.observe('b_after_sweep', { status: rowB.status, last_error: rowB.last_error, locked_by: rowB.locked_by })
    expect(d.status).toBe(200)
    expect(d.result).toMatchObject({ processed: 0 })
    expect(rowA).toMatchObject({ status: 'delivery_uncertain', locked_by: null, locked_at: null, last_error: 'stale_sending_lock_requires_transport_reconciliation', current_send_attempt_id: claimA!.current_send_attempt_id })
    expect(rowB).toMatchObject({ status: 'delivery_uncertain', locked_by: null, last_error: 'stale_sending_lock_requires_transport_reconciliation' })
    expect(attemptsFor(a.ackMessageId!)).toHaveLength(0)
    expect((await receivedMail()).length, 'ingen ny sändning hos motparten').toBe(before)
    evidence.observe('operator_visibility_a', operatorVisibility(a.ackMessageId!, a.sourceMessageId))
    evidence.observe('a_message_events', (await eventsFor(a.ackMessageId!)).map((e) => [e.event_type, e.message]))
  })

  it('EDIEL03.04 gammal worker återupptas -> fencad (outbox_item_not_claimed_by_worker, ediel_transport_worker_fence_lost), 0 attempts, 0 SMTP', async () => {
    const before = (await receivedMail()).length
    const { sendOutboxItem } = await import('@/lib/ediel/outbox/sendOutboxItem')
    const { getEdielMessageById } = await import('@/lib/ediel/db')
    const { sendEdielMessageViaSmtp } = await import('@/lib/ediel/transport')
    const resumed = await sendOutboxItem({ actorUserId: A(), outboxItemId: a.outboxId!, workerId: workerA, sendAttemptId: String(claimA!.current_send_attempt_id), alreadyClaimed: true })
    evidence.observe('a_old_worker_resumes_sendOutboxItem', resumed)
    expect(resumed).toMatchObject({ status: 'blocked', error: 'outbox_item_not_claimed_by_worker' })
    // SQL-fencen i sig (utan att förlita sig på workerns tidiga radkontroll): samma mönster som tr-05 rad ~452.
    const msg = (await getEdielMessageById(a.ackMessageId!))!
    let fence: unknown
    try { fence = { returned: await sendEdielMessageViaSmtp(msg, { actorUserId: A(), smtpMimeMode: null, dispatchOwner: { kind: 'worker', outboxId: a.outboxId!, sendAttemptId: String(claimA!.current_send_attempt_id), workerId: workerA } } as never) } }
    catch (e) { fence = { threw: (e as Error).message } }
    evidence.observe('a_old_worker_resumes_transport_fence', fence)
    expect(JSON.stringify(fence)).toContain('ediel_transport_worker_fence_lost')
    expect(attemptsFor(a.ackMessageId!)).toHaveLength(0)
    expect((await receivedMail()).length).toBe(before)
    // B: ny drain återsänder inte heller.
    const d = await drain(b.outboxId!, timing, 'drain-final')
    expect(d.result).toMatchObject({ processed: 0 })
    expect(outboxRow(b.outboxId!).status).toBe('delivery_uncertain')
    expect((await receivedMail()).length).toBe(before)
  })
})
