/* eslint-disable @typescript-eslint/no-explicit-any */
// EDIEL02.05: meddelande från okänd/främmande part eller utan mandat -> nekat/fail-closed, ingen affärseffekt. Ingen webbläsare.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { purgeInbox, receivedMail } from '../lib/counterparty'
import { buildE02Utilts } from '../lib/e02-edifact'
import { deliverE02, lit, sql } from '../lib/e02-flow'
import { e02MeteringPoint, masterDataFingerprint, reprocessInbound, seedE02Routable, seedForeignTenantPoint } from '../lib/e02-seed'
import { e02Counts, e02Quantities } from '../lib/e02-state'
import { setupE02 } from '../lib/e02-setup'

let S: Awaited<ReturnType<typeof setupE02>>
beforeAll(async () => { S = await setupE02('auth') }, 120_000)
afterAll(async () => { await S?.teardown() })

const j = (q: string) => JSON.parse(sql(q))
/** Allt som skapats för en inkommande post (e-post -> ediel_message -> ACK/ERR) och dess tillstånd, per ämnesprefix. */
function fate(subjectLike: string, company: string) {
  return {
    emails: j(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'status',processing_status,'match',match_status,'err',error_message,'sender',sender_ediel_id,'receiver',receiver_ediel_id,'rawSha256',raw_message_sha256) ORDER BY created_at),'[]') FROM public.inbound_email_messages WHERE subject LIKE ${lit(subjectLike)}`),
    messages: j(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'family',m.message_family,'dir',m.direction,'status',m.status,'ack',m.ack_outcome,'tenant',m.tenant_resolution_status,'company',m.company_id,'rel',m.related_message_id) ORDER BY m.created_at),'[]')
      FROM public.ediel_messages m WHERE m.inbound_email_message_id IN (SELECT id FROM public.inbound_email_messages WHERE subject LIKE ${lit(subjectLike)})
         OR m.related_message_id IN (SELECT id FROM public.ediel_messages WHERE inbound_email_message_id IN (SELECT id FROM public.inbound_email_messages WHERE subject LIKE ${lit(subjectLike)}))`),
    tasks: j(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',task_type,'title',title) ORDER BY created_at),'[]') FROM public.customer_operation_tasks WHERE company_id=${lit(company)} AND metadata::text LIKE ${lit('%' + subjectLike.replaceAll('%', '') + '%')}`),
  }
}

describe('EDIEL02.05 okänd part / utan mandat', () => {
  it('EDIEL02.05a okänd mottagarpart (99999, ingen tenant) hålls: inget affärsutfall, ingen negativ CONTRL (routing unresolved)', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 51), `${run.prefix}-05a`)
    const md0 = masterDataFingerprint([fx.companyId])
    const e = buildE02Utilts({ prefix: run.prefix, seq: 51, meteringPoint: fx.meteringPoint, receiver: '99999' })
    const subject = `E66 ${run.prefix} 05a`
    const dso0 = (await receivedMail()).length
    const d = await deliverE02(flow, '05a/unknown-receiver', e.raw, subject)
    const drain = await flow.drain('05a')
    const F = fate(subject + '%', fx.companyId), C = e02Counts(fx, run.prefix), Q = e02Quantities(fx)
    ev.save('05a/state.json', { F, C, Q, poll: d.poll.summary, reproc: d.reproc, dso: drain.mails.map((m) => m.subject) })
    ev.observe('EDIEL02.05a', { fate: F, poll: { stored: d.poll.summary.stored, ids: d.ids, errors: d.poll.summary.errorsByMailbox, auto: d.poll.summary.autoProcessErrors }, dsoNew: (await receivedMail()).length - dso0 })
    expect(F.emails.length).toBe(1)
    expect(F.emails[0].status).toBe('manual_review')
    expect(C).toMatchObject({ series: 0, meteringValues: 0, normalized: 0, billingUnderlays: 0, invoices: 0, contrl: 0, aperak: 0, utiltsErr: 0 })
    expect(Q.metering).toEqual([]); expect(Q.billing).toEqual([])
    expect(masterDataFingerprint([fx.companyId])).toBe(md0)
    expect((await receivedMail()).length).toBe(dso0) // inget kvitto till DSO för obehörig/oroutad post
    // Ingen tenant-attribuering via företagsbrevlådan: meddelandet får inte tillskrivas T3SIM-bolaget som affärsmeddelande.
    expect(F.messages.filter((m: any) => m.dir === 'inbound' && m.family === 'UTILTS' && m.tenant === 'tenant_resolved')).toEqual([])
  }, 300_000)

  it('EDIEL02.05b avsändare utan godkänd utfärdare/mandat (70099) ger ingen affärseffekt', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const fx = seedE02Routable(e02MeteringPoint(run.prefix, 52), `${run.prefix}-05b`)
    const md0 = masterDataFingerprint([fx.companyId])
    const e = buildE02Utilts({ prefix: run.prefix, seq: 52, meteringPoint: fx.meteringPoint, sender: '70099' })
    const subject = `E66 ${run.prefix} 05b`
    const d = await deliverE02(flow, '05b/unregistered-sender', e.raw, subject)
    const again = d.ids[0] ? await reprocessInbound(d.ids[0]) : null
    const received = fate(subject + '%', fx.companyId)
    // No-effects is meaningful only after successful physical reception and a
    // protected, exact-source issuer/mandate hold. Generic infrastructure errors
    // (including failed reads of that authority) prove no business refusal.
    expect(d.poll.out.ok, 'T3_HARNESS_PRECONDITION: actual IMAP reception').toBe(true)
    expect(d.poll.summary.error).toBeUndefined()
    const pollErrors = d.poll.summary.errorsByMailbox
    expect(Array.isArray(pollErrors), 'T3_HARNESS_PRECONDITION: poll diagnostics').toBe(true)
    for (const diagnostic of pollErrors as Array<{ errors: unknown[] }>) expect(diagnostic.errors).toEqual([])
    expect(d.poll.summary.stored).toBe(1)
    expect(d.poll.summary.storedIds).toHaveLength(1)
    expect(received.emails, 'T3_HARNESS_PRECONDITION: exact received MIME').toHaveLength(1)
    expect(received.emails[0]).toMatchObject({ id: d.poll.summary.storedIds[0], company: fx.companyId, sender: '70099', rawSha256: d.inj.sha256 })
    expect(['manual_review', 'processed']).toContain(received.emails[0].status)
    expect(d.ids, 'T3_HARNESS_PRECONDITION: exact parsed source').toHaveLength(1)
    const sourceId = d.ids[0]
    expect((d.reproc[sourceId] as { reprocess?: { ok: boolean } } | undefined)?.reprocess, 'T3_HARNESS_PRECONDITION: processing completed').toEqual({ ok: true })
    expect(again, 'T3_HARNESS_PRECONDITION: reprocessing completed').toEqual({ ok: true })
    expect(received.messages.filter((m: any) => m.id === sourceId && m.dir === 'inbound' && m.family === 'UTILTS' && m.company === fx.companyId)).toHaveLength(1)
    const denial = j(`SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',a.source_message_id,'companyId',a.company_id,'environment',a.environment,'sourceHash',a.source_payload_hash,
      'namespaceId',a.namespace_id,'issuerVersionId',a.issuer_version_id,'mandateVersionId',a.mandate_version_id,'holdReason',a.hold_reason,
      'emailId',m.inbound_email_message_id)),'[]') FROM gridex_utilts_issuer.source_admissions a JOIN public.ediel_messages m ON m.id=a.source_message_id
      WHERE a.source_message_id=${lit(sourceId)} AND m.inbound_email_message_id=${lit(d.poll.summary.storedIds[0])}`)
    expect(denial, 'T3_HARNESS_PRECONDITION: persisted issuer denial').toEqual([{
      sourceId, companyId: fx.companyId, environment: S.mode, sourceHash: createHash('sha256').update(e.raw, 'utf8').digest('hex'),
      namespaceId: null, issuerVersionId: null, mandateVersionId: null, holdReason: 'ediel_utilts_foreign_issuer_basis_unavailable', emailId: d.poll.summary.storedIds[0],
    }])
    const drain = await flow.drain('05b')
    const F = fate(subject + '%', fx.companyId), C = e02Counts(fx, run.prefix), Q = e02Quantities(fx)
    ev.save('05b/state.json', { F, C, Q, poll: d.poll.summary, reproc: d.reproc, again, dso: drain.mails.map((m) => ({ s: m.subject, uci: m.uci })) })
    ev.observe('EDIEL02.05b', { fate: F, reprocess: d.reproc, again, dso: drain.mails.map((m) => m.subject), counts: C })
    expect(C).toMatchObject({ series: 0, meteringValues: 0, normalized: 0, billingUnderlays: 0, invoices: 0 })
    expect(Q.metering).toEqual([])
    expect(masterDataFingerprint([fx.companyId])).toBe(md0)
    // Positivt affärskvitto (APERAK positiv) får inte skickas för en okänd utfärdare.
    expect(F.messages.filter((m: any) => m.family === 'APERAK' && m.ack === 'positive')).toEqual([])
  }, 300_000)

  it('EDIEL02.05c främmande tenants mätpunkt (SC-047) nekas med UTILTS ERR E10 på TN och skapar ingen stamdata/affärseffekt', async () => {
    const { flow, run, ev } = S
    await purgeInbox()
    const own = seedE02Routable(e02MeteringPoint(run.prefix, 53), `${run.prefix}-05c-own`)
    const foreignMp = e02MeteringPoint(run.prefix, 54)
    const foreign = seedForeignTenantPoint(foreignMp, run.prefix)
    const md0 = masterDataFingerprint([own.companyId, foreign.companyId])
    const e = buildE02Utilts({ prefix: run.prefix, seq: 53, meteringPoint: foreignMp })
    const subject = `E66 ${run.prefix} 05c`
    const d = await deliverE02(flow, '05c/foreign-only-point', e.raw, subject)
    const drain = await flow.drain('05c')
    const F = fate(subject + '%', own.companyId)
    const errs = j(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'wire',raw_payload)),'[]') FROM public.ediel_messages WHERE message_family='UTILTS_ERR' AND direction='outbound' AND related_message_id=${lit(d.ids[0] ?? '00000000-0000-0000-0000-000000000000')}`)
    const foreignRows = sql(`SELECT (SELECT count(*) FROM public.meter_reading_series WHERE company_id IN(${lit(own.companyId)},${lit(foreign.companyId)}) AND external_metering_point_id=${lit(foreignMp)})||'|'||(SELECT count(*) FROM public.metering_values WHERE metering_point_id=${lit(foreign.pointId)})`)
    const dsoErr = drain.mails.filter((m) => (m.edifact ?? '').includes('UTILTS') || m.segments.some((s) => s.startsWith('STS+E01')))
    ev.save('05c/state.json', { F, errs, foreignRows, poll: d.poll.summary, reproc: d.reproc, dso: drain.mails.map((m) => ({ s: m.subject, segs: m.segments.filter((s) => /^(UNH|STS|RFF|ERC|UCI)/.test(s)) })) })
    ev.observe('EDIEL02.05c', { fate: F, errs: errs.map((x: any) => ({ id: x.id, status: x.status })), foreignRows, dso: drain.mails.map((m) => m.subject), reprocess: d.reproc })
    expect(masterDataFingerprint([own.companyId, foreign.companyId])).toBe(md0) // ingen ny kund/anläggning/mätpunkt
    expect(foreignRows).toBe('0|0')
    expect(errs).toHaveLength(1)
    const wire = String(errs[0].wire)
    expect(wire).toContain('STS+E01::260+41+E10::260') // E10 (SC-047) på TN
    expect(wire).toContain(`RFF+TN:${e.transactionRef}'`)
    // Det faktiskt skickade felsvaret når DSO-motparten.
    expect(dsoErr.length).toBeGreaterThanOrEqual(1)
    expect(dsoErr.some((m) => m.segments.some((s) => s.startsWith('STS+E01') && s.includes('E10')))).toBe(true)
  }, 300_000)
})
