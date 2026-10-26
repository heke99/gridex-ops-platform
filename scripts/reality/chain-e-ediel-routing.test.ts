/**
 * Reality scenario E — inbound Ediel lands on the right tenant and the right customer.
 *
 * Two electricity suppliers (tenants A and B) in the same grid area share one grid owner (same Ediel id and
 * mailbox). Each has an existing supply customer with its own metering point; tenant A also has a customer whose
 * supply starts later. The grid owner sends real UTILTS E66 files over SMTPS to the platform's shared Ediel
 * mailbox: regular quarter-hour values to A and to B, hourly values, a corrected re-send, a file addressed to A
 * that carries B's metering point, and a file addressed to an Ediel id no tenant holds. The platform's own crons
 * receive, attribute, acknowledge and store everything. The scenario proves where every file, acknowledgement
 * and value ended up. Synthetic parties only (example.invalid, 7359990… metering points).
 */
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { approveIssuerHistoryGround, configurePlatformMailbox, configureTenant, existingSupplyCustomer, gridOwnerSends, literal, readInbox, sql,
  type LiveCustomer, type LiveTenant } from '../helpers/live-chain-fixture'
import { dailyE66, dayProfile, hourlyFromQuarters } from '../helpers/live-chain-wire'
import { closeOperatorConsole, operatorSession, submitServerAction } from '../helpers/reality/operatorConsole'
import { pollInboundMailLanes, runSlotAfterInbound } from '../helpers/reality/world'
import { clockSettings, cronTick } from '../helpers/reality/clock'

const report: Record<string, unknown> = { scenario: 'E inbound Ediel routing', startedAt: new Date().toISOString(), clock: clockSettings() }
let tenantA: LiveTenant, tenantB: LiveTenant
let customerA: LiveCustomer, customerB: LiveCustomer, customerLaterA: LiveCustomer
// An Ediel id no tenant holds (outside the fixture's 70000–79999 supplier range).
const UNKNOWN_RECEIVER = '69999'

type Sent = { key: string; receiver: string; meterId: string; day: string; reference: string; values: number[]; resolution: 15 | 60 }
const sent: Sent[] = []
const ref = (key: string) => `E${Date.now().toString().slice(-7)}${key}`.slice(0, 14)

describe.sequential('reality E — inbound Ediel routing to the right tenant and customer', () => {
  afterAll(async () => {
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-e-report.json', JSON.stringify(report, null, 2))
  })

  it('E1 two suppliers in one grid area share a grid owner, each with its own supply customers', async () => {
    expect(configurePlatformMailbox()).toBe(1)
    tenantA = await configureTenant(supabaseService as never)
    tenantB = await configureTenant(supabaseService as never, { sharedGridOwner: tenantA })
    customerA = await existingSupplyCustomer(supabaseService as never, tenantA, { name: 'Kund A', supplyStart: '2026-08-01' })
    customerB = await existingSupplyCustomer(supabaseService as never, tenantB, { name: 'Kund B', supplyStart: '2026-08-01' })
    customerLaterA = await existingSupplyCustomer(supabaseService as never, tenantA, { name: 'Kund A senare', supplyStart: '2026-10-01' })
    report.tenants = {
      A: { companyId: tenantA.companyId, supplier: tenantA.supplierEdielId, meter: customerA.meterId, laterMeter: customerLaterA.meterId },
      B: { companyId: tenantB.companyId, supplier: tenantB.supplierEdielId, meter: customerB.meterId },
      gridOwner: tenantA.issuerEdielId,
    }
    expect(tenantB.issuerEdielId).toBe(tenantA.issuerEdielId)
    expect(tenantB.supplierEdielId).not.toBe(tenantA.supplierEdielId)
  })

  it('E2 the grid owner sends regular, hourly, corrected, misaddressed and unknown-receiver files over SMTPS', async () => {
    const files: Array<Omit<Sent, 'reference'>> = [
      { key: 'A15', receiver: tenantA.supplierEdielId, meterId: customerA.meterId, day: '2026-09-15', values: dayProfile(0), resolution: 15 },
      { key: 'B15', receiver: tenantB.supplierEdielId, meterId: customerB.meterId, day: '2026-09-15', values: dayProfile(1), resolution: 15 },
      { key: 'A16H', receiver: tenantA.supplierEdielId, meterId: customerA.meterId, day: '2026-09-16', values: hourlyFromQuarters(dayProfile(2)), resolution: 60 },
      // B's metering point in a file whose legal receiver is A: never stored on B, never on A's customers.
      { key: 'XAB', receiver: tenantA.supplierEdielId, meterId: customerB.meterId, day: '2026-09-17', values: dayProfile(3), resolution: 15 },
      // Addressed to an Ediel id no tenant holds: held unattributed.
      { key: 'XUNK', receiver: UNKNOWN_RECEIVER, meterId: customerA.meterId, day: '2026-09-17', values: dayProfile(4), resolution: 15 },
      // A's customer whose supply starts on 1 October: values for September.
      { key: 'ALATE', receiver: tenantA.supplierEdielId, meterId: customerLaterA.meterId, day: '2026-09-15', values: dayProfile(5), resolution: 15 },
    ]
    for (const file of files) {
      const reference = ref(file.key)
      sent.push({ ...file, reference })
      await gridOwnerSends({ from: tenantA.gridOwnerEmail, subject: `UTILTS E66 ${file.key}`, filename: `E66_${file.key}.edi`,
        edifact: dailyE66({ issuer: tenantA.issuerEdielId, receiver: file.receiver, meterId: file.meterId, day: file.day, values: file.values,
          reference, resolutionMinutes: file.resolution }) })
    }
    report.sent = sent.map(({ values, ...file }) => ({ ...file, kwh: Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000 }))
    expect(sent).toHaveLength(6)
  })

  const receiveUntil = async (done: () => boolean, minutes: number) => {
    const runs: unknown[] = []
    const deadline = Date.now() + minutes * 60_000
    for (;;) {
      // Both lanes as the world runs them (production as Vercel polls it, then test). E's tenants are configured
      // for the test lane (configureTenant) and its files carry the test indicator, so they arrive in the test lane.
      const inbound = await pollInboundMailLanes()
      const outbox = await runSlotAfterInbound()
      runs.push({ at: new Date().toISOString(), inbound: inbound.production.status, inboundTest: inbound.test.status, outbox: outbox.status })
      expect(inbound.status, JSON.stringify(inbound.body)).toBe(200)
      if (done() || Date.now() > deadline) break
      await cronTick()
    }
    return runs
  }
  const inboundFor = (companyId: string | null) => sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'reference',m.external_reference,'code',m.message_code,'status',m.status,'meter',m.metering_point_id,'routing',m.processing_status) ORDER BY m.created_at),'[]')
    FROM public.ediel_messages m WHERE m.direction='inbound' AND m.message_family='UTILTS' AND m.created_at>${literal(report.startedAt)}
     AND ${companyId ? `m.company_id=${literal(companyId)}` : 'm.company_id IS NULL'}`)

  it('E3 the inbound cron receives and attributes every file by its legal receiver', async () => {
    const attributed = () => inboundFor(tenantA.companyId).length + inboundFor(tenantB.companyId).length + inboundFor(null).length
    report.receptionRuns = await receiveUntil(() => attributed() >= sent.length, 10)
    const a = inboundFor(tenantA.companyId), b = inboundFor(tenantB.companyId), none = inboundFor(null)
    report.inbound = { A: a, B: b, unattributed: none }
    const refs = (rows: Array<Record<string, unknown>>) => rows.map(row => String(row.reference))
    const sentRef = (key: string) => sent.find(file => file.key === key)!.reference
    // A: its own regular, hourly, misaddressed (legal receiver A) and later-supply files. B: only its own.
    for (const key of ['A15', 'A16H', 'XAB', 'ALATE']) expect(refs(a).some(r => r.includes(sentRef(key))), key).toBe(true)
    expect(refs(b).filter(r => r.includes(sentRef('B15')))).toHaveLength(1)
    expect(refs(b).some(r => r.includes(sentRef('XAB')) || r.includes(sentRef('XUNK'))), 'nothing misaddressed reaches B').toBe(false)
    // Unknown receiver: never on A or B. The retained mail is held without a tenant for platform review
    // (/admin/inbound-mail). FINDINGS F69: the base64 attachment never becomes an unattributed Ediel source.
    expect(refs(a).some(r => r.includes(sentRef('XUNK')))).toBe(false)
    const heldMail = sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',processing_status,'match',match_status,'company',company_id)),'[]')
      FROM public.inbound_email_messages WHERE subject='UTILTS E66 XUNK' AND created_at>${literal(report.startedAt)}`)
    const unresolved = sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_unresolved_items WHERE created_at>${literal(report.startedAt)} AND raw_interchange_reference=${literal(sentRef('XUNK'))}`)
    report.unknownReceiver = { messages: none, heldMail, unresolvedItems: unresolved }
    expect(heldMail).toEqual([{ status: 'manual_review', match: 'unassigned', company: null }])
  }, 15 * 60_000)

  it('E3b a corrected re-send for A\'s 15 September replaces the original values', async () => {
    const original = sent.find(file => file.key === 'A15')!
    const corrected = original.values.map((value, q) => Math.round((value + (q % 4 === 0 ? 0.012 : 0)) * 1000) / 1000)
    const reference = ref('A15C')
    sent.push({ key: 'A15C', receiver: original.receiver, meterId: original.meterId, day: original.day, values: corrected, resolution: 15, reference })
    await gridOwnerSends({ from: tenantA.gridOwnerEmail, subject: 'UTILTS E66 A15C', filename: 'E66_A15C.edi',
      edifact: dailyE66({ issuer: tenantA.issuerEdielId, receiver: original.receiver, meterId: original.meterId, day: original.day, values: corrected,
        reference, registeredAfterHours: 30 }) })
    report.correctionRuns = await receiveUntil(() => inboundFor(tenantA.companyId).some(row => String(row.reference).includes(reference)), 6)
    expect(inboundFor(tenantA.companyId).some(row => String(row.reference).includes(reference))).toBe(true)
  }, 10 * 60_000)

  it('E4 each tenant acknowledges only its own files, from its own Ediel identity', async () => {
    const inbox = await readInbox(tenantA.gridOwnerEmail)
    const contrl = inbox.flatMap(mail => mail.attachments).filter(a => /UNH\+[^+]*\+CONTRL/.test(a.text))
      .map(a => ({ sender: /UNB\+[^+]+\+([^:+]+)/.exec(a.text)?.[1], references: [...a.text.matchAll(/UCI\+([^+]+)/g)].map(m => m[1]) }))
    report.contrl = contrl
    const senderFor = (key: string) => contrl.find(c => c.references.includes(sent.find(file => file.key === key)!.reference))?.sender
    expect(senderFor('A15')).toBe(tenantA.supplierEdielId)
    expect(senderFor('B15')).toBe(tenantB.supplierEdielId)
    expect(senderFor('A16H')).toBe(tenantA.supplierEdielId)
    // Nobody acknowledges a file in the name of a tenant it was not addressed to.
    expect(contrl.filter(c => c.sender === tenantB.supplierEdielId).every(c => c.references.every(r => r === sent.find(file => file.key === 'B15')!.reference))).toBe(true)
  })

  it('E5 after issuer evidence and reprocessing, values are stored only on the right tenant, customer and metering point', async () => {
    const reprocess = async (tenant: LiveTenant) => {
      const sources = sql<Array<{ id: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY created_at),'[]')
        FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66' AND created_at>${literal(report.startedAt)}`)
      for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
      const context = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
      const page = await context.newPage()
      const outcomes: unknown[] = []
      for (const source of sources) {
        const response = await page.goto(`/admin/ediel/messages/${source.id}`)
        // The detail page streams behind loading.tsx and takes 15-30 s to render; count() does not wait, so the
        // run read the placeholder and skipped the reprocess (harness defect S2). Wait for the rendered detail.
        await page.getByText('Detaljvy för canonical kernel').first().waitFor({ timeout: 180_000 })
        const button = page.getByRole('button', { name: /Kör UTILTS engine \/ skapa TGT-svar|Återuppta hållna transaktioner/ })
        const visible = await button.count()
        const pageState = { status: response?.status() ?? null, url: page.url() }
        // The server action finishes before the next page is opened.
        const actionStatus = visible ? await submitServerAction(page, () => button.click(), 600_000) : null
        const started = Date.now()
        let stored = 0
        while (visible && Date.now() - started < 120_000) {
          await new Promise(resolve => setTimeout(resolve, 5_000))
          const next = sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(source.id)}`)
          if (next === stored && next > 0) break
          stored = next
        }
        const diagnosis = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
          'status',m.status,
          'issues',(SELECT coalesce(jsonb_agg(i->>'code'),'[]') FROM jsonb_array_elements(coalesce(m.validation_report#>'{utiltsRuntime,validation,issues}','[]')) i),
          'ackPlan',m.validation_report#>>'{utiltsRuntime,ackPlan,reason}',
          'transactions',(SELECT coalesce(jsonb_agg(jsonb_build_object('disposition',t.disposition,'persistence',t.persistence_status,'issues',t.issue_codes)),'[]') FROM public.ediel_ack_transaction_results t WHERE t.source_message_id=m.id),
          'lastEvents',(SELECT coalesce(jsonb_agg(e.message ORDER BY e.created_at DESC),'[]') FROM (SELECT message,created_at FROM public.ediel_message_events WHERE ediel_message_id=m.id ORDER BY created_at DESC LIMIT 4) e))
          FROM public.ediel_messages m WHERE m.id=${literal(source.id)}`)
        outcomes.push({ source: source.id, button: Boolean(visible), pageState, actionStatus, stored, diagnosis })
      }
      await page.close()
      return outcomes
    }
    report.reprocess = { A: await reprocess(tenantA), B: await reprocess(tenantB) }

    const valuesFor = (meteringPointId: string) => sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'companies',(SELECT coalesce(jsonb_agg(DISTINCT company_id),'[]') FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)}),
      'customers',(SELECT coalesce(jsonb_agg(DISTINCT customer_id),'[]') FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)}),
      'current',(SELECT count(*) FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND revision_status='current'),
      'kwh',(SELECT coalesce(sum(quantity_kwh),0) FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND revision_status='current'),
      -- Per Ediel day (00:00-24:00 +0100, Etc/GMT-1): one grid-owner file each (ENV-08, T15; a JS comment here broke the SQL, T36).
      -- A civil day would also show the next day for the last hour of every summer file.
      'days',(SELECT coalesce(jsonb_agg(d ORDER BY d),'[]') FROM (SELECT DISTINCT (period_start AT TIME ZONE 'Etc/GMT-1')::date d FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)}) x),
      'resolutions',(SELECT coalesce(jsonb_agg(DISTINCT resolution),'[]') FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND revision_status='current'),
      'superseded',(SELECT count(*) FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND revision_status<>'current'),
      'billable',(SELECT count(*) FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} AND billing_gate_status='eligible'),
      'gate',(SELECT coalesce(jsonb_object_agg(s,n),'{}') FROM (SELECT billing_gate_status s,count(*) n FROM public.normalized_metering_values WHERE metering_point_id=${literal(meteringPointId)} GROUP BY 1) x))`)
    const a = valuesFor(customerA.meteringPointId), b = valuesFor(customerB.meteringPointId), later = valuesFor(customerLaterA.meteringPointId)
    report.values = { A: a, B: b, laterA: later }
    const kwh = (key: string) => Math.round(sent.find(file => file.key === key)!.values.reduce((x, y) => x + y, 0) * 1000) / 1000

    // B's point: only B's own file, on B's customer. The misaddressed file (legal receiver A) added nothing.
    expect(b.companies).toEqual([tenantB.companyId])
    expect(b.customers).toEqual([customerB.customerId])
    expect(b.days).toEqual(['2026-09-15'])
    expect(Number(b.kwh)).toBeCloseTo(kwh('B15'), 6)
    // A's point: its quarter-hours and hours, on A's customer; never the unknown-receiver file (17 September).
    expect(a.companies).toEqual([tenantA.companyId])
    expect(a.customers).toEqual([customerA.customerId])
    expect(a.days).toEqual(['2026-09-15', '2026-09-16'])
    // The correction is current for 15 September; the original is superseded, not added.
    expect(Number(a.kwh)).toBeCloseTo(kwh('A15C') + kwh('A16H'), 6)
    // Outside the supply period (supply from 1 October): never billable.
    expect(later.billable).toBe(0)
  }, 30 * 60_000)
})
