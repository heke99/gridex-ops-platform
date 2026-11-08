/* eslint-disable @typescript-eslint/no-explicit-any */
// EDIEL02.01 / EDIEL02.02: dubbletter. Ingen webbläsare (Playwright används inte).
// Kedja: IMAP-TLS -> poller (motorn med automationsaktören, företagsbrevlåda) -> intake/parsing -> authority -> metering
// (gridex_consume_utilts_metering_v1 via processInboundEdielMessage) -> outbox-drain -> DSO-motpart.
// Harnessens ersättningssteg (loggas som observation): (1) företagsägd brevlåda i stället för den delade (kandidatfynd i README/svar),
// (2) syntetisk granskad historikgrund mellan admission och ombearbetning, (3) in-process-motor med aktör i stället för HTTP-cron.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { receivedMail } from '../lib/counterparty'
import { buildE02Utilts } from '../lib/e02-edifact'
import { e02MeteringPoint, seedE02Routable, type E02Fixture } from '../lib/e02-seed'
import { e02Counts, e02Quantities, e02Receptions } from '../lib/e02-state'
import { setupE02 } from '../lib/e02-setup'
import { sha, sql, lit } from '../lib/e02-flow'
import { purgeInbox } from '../lib/counterparty'

let S: Awaited<ReturnType<typeof setupE02>>
beforeAll(async () => { S = await setupE02('dup') }, 120_000)
afterAll(async () => { await S?.teardown() })

/** Första leverans: inject -> poll -> grund -> ombearbetning -> drain. Returnerar allt som scenariot behöver. */
async function firstDelivery(fx: E02Fixture, tag: string, o: { quantity?: string; latestUpdate?: string } = {}) {
  const { flow, run } = S
  const e = buildE02Utilts({ prefix: run.prefix, seq: Number(tag.replace(/\D/g, '')) || 1, meteringPoint: fx.meteringPoint, quantity: o.quantity, latestUpdate: o.latestUpdate })
  const subject = `E66 ${run.prefix} ${tag}`
  const inj = await flow.inject(`${tag}/original`, e.raw, { subject })
  const poll = await flow.poll(`${tag}-first`)
  const ids = poll.summary.edielMessageIds as string[]
  const reproc = await flow.groundAndReprocess(ids)
  const drain = await flow.drain(`${tag}-first`)
  for (const id of ids) expect((reproc[id] as any).reprocess, `ombearbetning av ${id}`).toEqual({ ok: true }) // förutsättning för jämförelsen
  return { e, subject, inj, poll, ids, reproc, drain }
}

describe('EDIEL02 dubbletter', () => {
  it('EDIEL02.01 byteidentisk andra leverans av samma MIME ger ingen ny mottagning, ACK, outbox eller mätvärdesrad', async () => {
    const { flow, run, ev } = S
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 1), `${run.prefix}-01`)
    const first = await firstDelivery(fx, '01')
    expect(first.poll.summary.errorsByMailbox.map((x: any) => x.errors).flat()).toEqual(expect.not.arrayContaining(['ediel_real_reception_actor_and_parse_required']))
    expect(first.ids).toHaveLength(1)
    const C1 = e02Counts(fx, run.prefix), Q1 = e02Quantities(fx), R1 = e02Receptions(fx)
    const dso1 = (await receivedMail()).length
    ev.save('01/state-after-first.json', { C1, Q1, R1, dso1, reproc: first.reproc })
    // Förutsättning (annars är jämförelsen meningslös): första leveransen gav faktisk affärseffekt.
    expect(C1).toMatchObject({ inboundEmails: 1, edielInbound: 1, contrl: 1, aperak: 1, series: 1, meteringValues: 1, normalizedCurrent: 1, billingUnderlays: 1 })
    expect(Q1.metering).toMatchObject([{ kwh: 500, current: true }])
    expect(R1.receptions.map((r) => r.classification)).toEqual(['first_reception'])

    // Andra leverans: exakt samma bytes (samma Message-ID).
    await flow.putRaw(first.inj.mime)
    const poll2 = await flow.poll('01-second')
    await flow.groundAndReprocess([]) // inget: ingen ny källa får finnas
    const drain2 = await flow.drain('01-second')
    const C2 = e02Counts(fx, run.prefix), Q2 = e02Quantities(fx), R2 = e02Receptions(fx)
    const dso2 = (await receivedMail()).length
    const stored = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'sha',raw_message_sha256,'dup_of',duplicate_of_id,'scope',dedupe_scope,'reason',dedupe_reason,'status',processing_status) ORDER BY created_at),'[]') FROM public.inbound_email_messages WHERE subject=${lit(first.subject)}`)
    ev.save('01/state-after-second.json', { C2, Q2, R2, dso2, poll2: poll2.summary, drain2: drain2.mails.map((m) => ({ n: m.n, subject: m.subject })), stored: JSON.parse(stored), mimeSha256: first.inj.sha256 })
    ev.observe('EDIEL02.01', { dedupeOutcome: { fetched: poll2.summary.fetched, stored: poll2.summary.stored, deduped: poll2.summary.deduped, dedupedIds: poll2.summary.dedupedIds }, storedRows: JSON.parse(stored), mimeSha256: first.inj.sha256, autoProcessErrors: poll2.summary.autoProcessErrors })

    expect(poll2.summary.fetched).toBeGreaterThanOrEqual(2) // båda kopiorna hämtades via IMAP
    expect(poll2.summary.stored).toBe(0)
    expect(poll2.summary.deduped).toBeGreaterThanOrEqual(1) // dedupe-utfallet är loggat i motorns resultat
    expect(C2).toEqual(C1) // ingen ny mottagning/ACK/outbox/mätvärdesrad/uppgift
    expect(Q2).toEqual(Q1)
    expect(R2.receptions).toEqual(R1.receptions)
    expect(dso2).toBe(dso1) // inget nytt kvitto till DSO
    expect(drain2.mails).toHaveLength(0)
    expect(poll2.summary.autoProcessErrors).toEqual([])
  }, 420_000)

  it('EDIEL02.01b (komplement) samma EDIFACT i nytt MIME (nytt Message-ID) skapar inget nytt mätvärde', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 11), `${run.prefix}-01b`)
    const first = await firstDelivery(fx, '11')
    const C1 = e02Counts(fx, run.prefix), Q1 = e02Quantities(fx)
    const dso1 = (await receivedMail()).length
    const again = await flow.inject('11/resent-new-message-id', first.e.raw, { subject: first.subject + ' resend' })
    const poll2 = await flow.poll('11-second')
    const drain2 = await flow.drain('11-second')
    const C2 = e02Counts(fx, run.prefix), Q2 = e02Quantities(fx), R2 = e02Receptions(fx)
    ev.observe('EDIEL02.01b', { C1, C2, R2, poll: poll2.summary, newMessageIdSha: again.sha256, dsoNew: (await receivedMail()).length - dso1, drain2: drain2.mails.map((m) => m.subject) })
    ev.save('11/state.json', { C1, C2, Q1, Q2, R2 })
    expect(Q2).toEqual(Q1) // fysisk mängd inte dubblerad
    expect(C2.series).toBe(C1.series); expect(C2.meteringValues).toBe(C1.meteringValues); expect(C2.normalized).toBe(C1.normalized); expect(C2.billingUnderlays).toBe(C1.billingUnderlays)
  }, 420_000)

  it('EDIEL02.02 samma referens med ändrat innehåll (nytt Message-ID) ger synligt skydd och ingen tyst överskrivning', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 2), `${run.prefix}-02`)
    const first = await firstDelivery(fx, '02', { quantity: '500' })
    const C1 = e02Counts(fx, run.prefix), Q1 = e02Quantities(fx), R1 = e02Receptions(fx)
    const origRow = sql(`SELECT jsonb_build_object('id',id,'sha',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'status',status,'updated',updated_at) FROM public.ediel_messages WHERE id=${lit(first.ids[0])}`)
    // Samma UNB-/BGM-/IDE-referenser, ändrad kvantitet.
    const changed = buildE02Utilts({ prefix: run.prefix, seq: 2, meteringPoint: fx.meteringPoint, quantity: '999' })
    expect(changed.interchangeRef).toBe(first.e.interchangeRef); expect(changed.documentRef).toBe(first.e.documentRef); expect(changed.transactionRef).toBe(first.e.transactionRef)
    expect(sha(changed.raw)).not.toBe(sha(first.e.raw))
    const inj = await flow.inject('02/changed-same-refs', changed.raw, { subject: first.subject + ' changed' })
    const dso1 = (await receivedMail()).length
    const poll2 = await flow.poll('02-second')
    await flow.groundAndReprocess(poll2.summary.edielMessageIds)
    const drain2 = await flow.drain('02-second')
    const C2 = e02Counts(fx, run.prefix), Q2 = e02Quantities(fx), R2 = e02Receptions(fx)
    const rows = JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'subject',subject,'status',processing_status,'match',match_status,'dup_of',duplicate_of_id,'err',error_message,'reason',dedupe_reason,'sha',raw_message_sha256) ORDER BY created_at),'[]') FROM public.inbound_email_messages WHERE subject LIKE ${lit(first.subject + '%')}`))
    const origAfter = sql(`SELECT jsonb_build_object('id',id,'sha',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'status',status,'updated',updated_at) FROM public.ediel_messages WHERE id=${lit(first.ids[0])}`)
    const tasks = JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',task_type,'status',status,'title',title,'desc',description) ORDER BY created_at),'[]') FROM public.customer_operation_tasks WHERE company_id=${lit(fx.companyId)} AND customer_id=${lit(fx.customerId)}`))
    const dso = await flow.dsoSince(dso1)
    ev.save('02/state.json', { C1, C2, Q1, Q2, R1, R2, rows, origRow: JSON.parse(origRow), origAfter: JSON.parse(origAfter), tasks, poll2: poll2.summary, dso: dso.map((d) => ({ n: d.n, subject: d.subject, uci: d.uci })), changedSha: inj.sha256 })
    ev.observe('EDIEL02.02', { receptions: R2.receptions, responseRequests: R2.responseRequests, tasks, emailRows: rows, dso: dso.map((d) => d.subject), autoProcessErrors: poll2.summary.autoProcessErrors, errorsByMailbox: poll2.summary.errorsByMailbox })

    // Ingen tyst överskrivning: mätvärden, serier, fakturaunderlag och originalet orörda.
    expect(Q2).toEqual(Q1)
    expect(Q2.metering).toMatchObject([{ kwh: 500, current: true }])
    expect(C2.series).toBe(C1.series); expect(C2.meteringValues).toBe(C1.meteringValues); expect(C2.normalized).toBe(C1.normalized); expect(C2.billingUnderlays).toBe(C1.billingUnderlays)
    expect(JSON.parse(origAfter).sha).toBe(JSON.parse(origRow).sha)
    // Synligt skydd: identity_conflict-mottagning med svarsbegäran 'same_identity_different_original_requires_review' och hållen mail/uppgift.
    expect(R2.receptions.map((r) => r.classification)).toContain('identity_conflict')
    expect(R2.responseRequests.map((r) => r.reason)).toContain('same_identity_different_original_requires_review')
    expect(rows.some((r: any) => r.status === 'manual_review')).toBe(true)
    expect(tasks.map((t: any) => t.type)).toContain('ediel_duplicate_response_held')
  }, 420_000)
})
