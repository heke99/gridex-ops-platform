/* eslint-disable @typescript-eslint/no-explicit-any */
// EDIEL02.03 / EDIEL02.04: rättelser och felordning (UTILTS E66, SC046-semantik). Ingen webbläsare.
// Replaced/superseded avgörs av meter_reading_series.latest_update_date (DTM+597 i huvudet); normal väg = poller -> processInboundEdielMessage.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeInbox, receivedMail } from '../lib/counterparty'
import { consumeMeteringDirect } from '../lib/e02-rpc'
import { buildE02Utilts } from '../lib/e02-edifact'
import { deliverE02, lit, sql } from '../lib/e02-flow'
import { e02MeteringPoint, reprocessInbound, seedE02Routable } from '../lib/e02-seed'
import { e02Counts, e02Quantities } from '../lib/e02-state'
import { setupE02 } from '../lib/e02-setup'

let S: Awaited<ReturnType<typeof setupE02>>
beforeAll(async () => { S = await setupE02('corr') }, 120_000)
afterAll(async () => { await S?.teardown() })

const versionState = (sourceId: string) => sql(`SELECT parsed_payload#>'{normalizedMeteringPayload,utiltsTransactionPersistenceResults}' FROM public.ediel_messages WHERE id=${lit(sourceId)}`)
const ackOf = (sourceId: string) => sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome,'status',status)),'[]') FROM public.ediel_messages WHERE direction='outbound' AND related_message_id=${lit(sourceId)}`)

describe('EDIEL02 rättelser och ordning', () => {
  it('EDIEL02.03 giltig rättelse ersätter (replaced) och ogiltig rättelse avvisas med utilts_consumption_correction_*; fysisk mängd inte dubblerad', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 3), `${run.prefix}-03`)
    const mk = (seq: number, quantity: string, latestUpdate: string) => buildE02Utilts({ prefix: run.prefix, seq, meteringPoint: fx.meteringPoint, quantity, latestUpdate })
    const subj = (t: string) => `E66 ${run.prefix} 03${t}`

    const A = mk(31, '500', '202607010020')
    const a = await deliverE02(flow, '03/A-original', A.raw, subj('A'))
    expect(a.ids).toHaveLength(1)
    const QA = e02Quantities(fx); const CA = e02Counts(fx, run.prefix)
    expect(QA.metering).toMatchObject([{ kwh: 500, current: true }])

    // Giltig rättelse: nyare latest_update_date, föregångaren (A) är accepterad och konsumerad.
    const B = mk(32, '600', '202607010040')
    const b = await deliverE02(flow, '03/B-valid-correction', B.raw, subj('B'))
    const QB = e02Quantities(fx); const CB = e02Counts(fx, run.prefix)
    ev.save('03/state-after-B.json', { QA, QB, CA, CB, versionB: versionState(b.ids[0]), acks: JSON.parse(ackOf(b.ids[0])), poll: b.poll.summary, reproc: b.reproc })
    expect(b.ids).toHaveLength(1)
    expect(QB.metering).toHaveLength(2)
    expect(QB.metering.filter((m) => m.current)).toMatchObject([{ kwh: 600, rev: 'current', n: 2 }])
    expect(QB.metering.find((m) => m.kwh === 500)).toMatchObject({ current: false, rev: 'replaced' })
    expect(QB.normalized.filter((m) => m.rev === 'current')).toMatchObject([{ kwh: 600 }])
    expect(QB.normalized.find((m) => m.kwh === 500)).toMatchObject({ rev: 'replaced' })
    expect(QB.series.filter((s) => s.current).map((s) => s.qty)).toEqual(['600']) // exakt en gällande serie: fysisk mängd inte dubblerad
    expect(QB.series.find((s) => s.qty === '500')).toMatchObject({ current: false })
    expect(CB.invoices).toBe(0)

    // Ogiltig rättelse: samma latest_update_date som gällande huvud, annan mängd (SC046 EQUAL) -> correction_not_newer.
    const C = mk(33, '700', '202607010040')
    const c = await deliverE02(flow, '03/C-invalid-equal-time', C.raw, subj('C'))
    const QC = e02Quantities(fx); const CC = e02Counts(fx, run.prefix)
    // Ombearbetning efter poll visar kodens faktiska felmeddelande (pollerns autoProcessErrors tappar texten: "Okänt fel").
    const again = await reprocessInbound(c.ids[0])
    const direct = await consumeMeteringDirect(fx.companyId, fx.actorUserId, c.ids[0], C.transactionRef)
    ev.save('03/state-after-C.json', { QC, CC, poll: c.poll.summary, reproc: c.reproc, again, direct: direct.error ?? direct.data, versionC: versionState(c.ids[0]), acks: JSON.parse(ackOf(c.ids[0])) })
    ev.observe('EDIEL02.03', { replaced: QB.metering, invalidPoll: c.poll.summary.autoProcessErrors, invalidReprocess: (c.reproc as any)[c.ids[0]]?.reprocess, invalidAgain: again, invalidDirect: direct.error?.message, invoices: CC.invoices })
    const reprocessError = JSON.stringify([(c.reproc as any)[c.ids[0]]?.reprocess, again, direct.error?.message])
    expect(reprocessError).toMatch(/utilts_consumption_correction_not_newer/)
    expect(direct.error?.message ?? '').toMatch(/utilts_consumption_correction_(not_newer|ancestry_invalid|binding_invalid)/)
    // Affärsrader (mätvärden, normaliserat, fakturaunderlag) oförändrade av den avvisade rättelsen. Seriehuvudet flyttas av persistensen
    // (kanonisk lagring accepterar källan och exponerar den som current, jfr SC046 EQUAL) men konsumeras inte: loggas som observation.
    ev.observe('EDIEL02.03.seriesHeadVsMetering', { seriesCurrent: QC.series.filter((x) => x.current).map((x) => x.qty), meteringCurrent: QC.metering.filter((x) => x.current).map((x) => x.kwh) })
    expect(QC.metering).toEqual(QB.metering); expect(QC.normalized).toEqual(QB.normalized); expect(QC.billing).toEqual(QB.billing)
    expect(CC.meteringValues).toBe(CB.meteringValues); expect(CC.normalized).toBe(CB.normalized); expect(CC.billingUnderlays).toBe(CB.billingUnderlays); expect(CC.invoices).toBe(0)
    await flow.drain('03')
  }, 400_000)

  it('EDIEL02.04 äldre meddelande levererat efter nyare ger late_history/stale_version, nyare data kvar och ingen ändrad fakturagrund', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 4), `${run.prefix}-04`)
    const mk = (seq: number, quantity: string, latestUpdate: string) => buildE02Utilts({ prefix: run.prefix, seq, meteringPoint: fx.meteringPoint, quantity, latestUpdate })
    const subj = (t: string) => `E66 ${run.prefix} 04${t}`
    const NEWER = mk(41, '500', '202607010040')
    const n = await deliverE02(flow, '04/NEWER-first', NEWER.raw, subj('N'))
    const Q1 = e02Quantities(fx), C1 = e02Counts(fx, run.prefix)
    expect(Q1.metering).toMatchObject([{ kwh: 500, current: true }])
    const dso1 = (await receivedMail()).length

    const OLDER = mk(42, '7', '202607010020') // äldre uppdateringsdatum, mottagen senare
    const o = await deliverE02(flow, '04/OLDER-late', OLDER.raw, subj('O'))
    const drain = await flow.drain('04-older')
    const Q2 = e02Quantities(fx), C2 = e02Counts(fx, run.prefix)
    const direct = await consumeMeteringDirect(fx.companyId, fx.actorUserId, o.ids[0], OLDER.transactionRef)
    const Q3 = e02Quantities(fx), C3 = e02Counts(fx, run.prefix)
    const vs = versionState(o.ids[0])
    ev.save('04/state.json', { Q1, Q2, Q3, C1, C2, C3, versionOlder: vs, acksOlder: JSON.parse(ackOf(o.ids[0])), direct: direct.error ?? direct.data, poll: o.poll.summary, reproc: o.reproc, dsoNew: drain.mails.map((m) => m.subject) })
    ev.observe('EDIEL02.04', { versionState: vs, directError: direct.error?.message, olderSeries: Q2.series, acks: ackOf(o.ids[0]), invoices: C3.invoices, billingBefore: Q1.billing, billingAfter: Q3.billing, dsoNew: (await receivedMail()).length - dso1 })

    expect(o.ids).toHaveLength(1)
    // Normal väg: äldre källa lagras som sen historik utan affärseffekt; nyare data kvar.
    expect(JSON.stringify(JSON.parse(vs))).toContain('late_older_history')
    expect(Q2.metering).toEqual(Q1.metering); expect(Q2.normalized).toEqual(Q1.normalized); expect(Q2.billing).toEqual(Q1.billing)
    expect(Q2.series.filter((s) => s.current).map((s) => s.qty)).toEqual(['500'])
    expect(Q2.series.find((s) => s.qty === '7')).toMatchObject({ current: false })
    // Direktanrop av metering-RPC för den äldre källan avvisas.
    expect(direct.error?.message ?? '').toMatch(/utilts_consumption_(late_history|stale_version)/)
    expect(Q3).toEqual(Q2)
    // Ingen faktura finns i flödet (bara fakturaunderlag); underlaget är oförändrat och inga fakturor skapades.
    expect(C3.invoices).toBe(0); expect(C3.billingUnderlays).toBe(C1.billingUnderlays)
  }, 400_000)
})
