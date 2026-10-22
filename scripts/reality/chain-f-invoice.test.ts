// Reality scenario F: invoices for a customer with several facilities, with contract terms (binding,
// notice, automatic renewal) in every invoice and agreement file.
//
// Same world as scenario A: the supplier goes live in ALS, customers apply on the website, the switch
// runs against the simulated grid owner over SMTPS/IMAPS, the grid owner sends metering values, and the
// monthly billing cron invoices. Owner decision 2026-10-22: the one deviation from real time is the start
// date. The customers are treated as having applied in August for supply from 1 September, so a whole
// month can be invoiced today; the requested start date is set to 2026-09-01 before the switch request is
// sent. Everything else is the real code. Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it, type TestContext } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { renderInvoiceFile, type InvoiceFileRow } from '@/lib/billing/invoiceFileExport'
import { LIVE, approveIssuerHistoryGround, cron, literal, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { closeOperatorConsole, operatorSession } from '../helpers/reality/operatorConsole'
import { runOperationalCronSlot, type GridOwnerSim } from '../helpers/reality/world'
import { GRID_AREA, GRID_OWNER_EDIEL_ID, goLiveAlsSupplier } from '../helpers/reality/goLiveAls'
import { detectStuckStates } from '../helpers/reality/stuckDetector'
import { registerUtiltsIssuer } from '../helpers/utiltsConsumptionParties'
import { dayProfile, gs1 } from '../helpers/live-chain-wire'
import { applyAsWebsiteCustomer, type SimulatedPerson, type SimulatedSite } from './simulators/websiteCustomer'

const report: Record<string, unknown> = { scenario: 'F invoices', startedAt: new Date().toISOString() }
const REPORT = process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-f-report.json'
const saveReport = (extra: Record<string, unknown> = {}) => writeFileSync(REPORT, JSON.stringify({ ...report, ...extra }, null, 2))
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let tenant: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

/** The offer's contract terms: 12 months binding, 1 month notice, 12-month automatic renewal. */
const TERMS = { bindingMonths: 12, noticeMonths: 1, renewalMonths: 12 }
const SUPPLY_START = '2026-09-01'
const MONTH = '2026-09'
report.supplyStart = SUPPLY_START
const RUN = Date.now().toString(36)
function personnummer(birth: string, serial: string) {
  const nine = birth.slice(2) + serial
  const sum = [...nine].reduce((total, digit, i) => { const v = Number(digit) * (i % 2 === 0 ? 2 : 1); return total + (v > 9 ? v - 9 : v) }, 0)
  return `${birth}${serial}${(10 - (sum % 10)) % 10}`
}
const facility = () => gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
const person = (first: string, birth: string, serial: string, street: string): SimulatedPerson => ({ firstName: first, lastName: 'E2E-Faktura', personalNumber: personnummer(birth, serial),
  email: `e2e-${first.toLowerCase()}-${serial}-${RUN}@example.invalid`, phone: '0701234567', address: { street, postalCode: '441 30', city: 'Alingsås' } })
const site = (annualConsumptionKwh: number, street?: string): SimulatedSite => ({ facilityId: facility(), priceArea: 'SE3', annualConsumptionKwh,
  ...(street ? { address: { street, postalCode: '441 30', city: 'Alingsås' } } : {}) })
const CUSTOMERS = [
  // One private customer with a house, a holiday home and a garage: three facilities, one person.
  { person: person('Tre', '19700101', '321', 'Kungsgatan 1'), sites: [site(18_000), site(4_500, 'Drottninggatan 2'), site(1_200, 'Nygatan 3')] },
  // Control: one facility.
  { person: person('En', '19850615', '654', 'Kungsgatan 1'), sites: [site(9_000)] },
]
const EXACT_POINTS: Record<string, { latitude: number; longitude: number }> = {
  'Kungsgatan 1': { latitude: 57.9303, longitude: 12.534 }, 'Drottninggatan 2': { latitude: 57.931, longitude: 12.5355 }, 'Nygatan 3': { latitude: 57.9298, longitude: 12.533 },
}

/** Every facility gets its own profile: the household profile scaled to its annual consumption and shifted. */
const FACILITIES = CUSTOMERS.flatMap((customer, c) => customer.sites.map((one, s) => ({ who: customer.person.firstName, gsrn: one.facilityId,
  scale: Math.round((one.annualConsumptionKwh / 3500) * 100) / 100, offset: c * 3 + s })))
type Facility = (typeof FACILITIES)[number]
const [HOUSE, HOLIDAY_HOME, GARAGE, CONTROL] = FACILITIES
const SEPTEMBER = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
/** The grid owner never sends this day for the holiday home: a gap, never zero consumption. */
const MISSING = { facility: HOLIDAY_HOME, day: '2026-09-14' }
/** The house's 10 September is re-sent later with corrected values. */
const CORRECTED = { facility: HOUSE, day: '2026-09-10' }
/** The garage's last August days, before our supply started: never billable. */
const AUGUST = { facility: GARAGE, days: ['2026-08-29', '2026-08-30', '2026-08-31'] }
const profileFor = (f: Facility, dayIndex: number) => dayProfile(dayIndex + f.offset).map(v => Math.round(v * f.scale * 1000) / 1000)
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000

/** Exactly what the grid owner sent, kept for the independent calculation. */
type SentFile = { facility: string; day: string; kind: 'regular' | 'august' | 'correction'; reference: string; values: number[] }
const sentFiles: SentFile[] = []
/** The values in force per day for one facility: a later correction replaces the original. */
function effective(gsrn: string) {
  const days = new Map<string, number[]>()
  for (const file of sentFiles) if (file.facility === gsrn) days.set(file.day, file.values)
  return days
}
/** The sent file an inbound message carries (the correction's reference extends the original's). */
const fileOf = (reference: string) => sentFiles.filter(file => reference.includes(file.reference)).sort((a, b) => b.reference.length - a.reference.length)[0]
let correctedQuarters = 0

type Ids = { mp: string; customer: string; contract: string | null }
const ids = new Map<string, Ids>()
function loadIds() {
  const rows = sql<Array<Ids & { gsrn: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('gsrn',mp.metering_point_id,'mp',mp.id,'customer',mp.customer_id,
      'contract',(SELECT c.id FROM public.customer_contracts c WHERE c.company_id=mp.company_id AND c.metering_point_id=mp.id ORDER BY c.created_at DESC LIMIT 1))),'[]')
    FROM public.metering_points mp WHERE mp.company_id=${literal(tenant.companyId)}`)
  for (const row of rows) ids.set(row.gsrn, row)
}
function idOf(f: Facility) {
  const found = ids.get(f.gsrn)
  if (!found) throw Error(`facility_not_on_tenant:${f.gsrn}`)
  return found
}

/** Every row of the tenant that carries the supply start, per facility. */
function startDates() {
  return sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,
      'application',(SELECT jsonb_build_object('status',a.status,'start',a.requested_start_date) FROM public.website_customer_applications a WHERE a.company_id=mp.company_id AND a.metering_point_id=mp.id ORDER BY a.created_at DESC LIMIT 1),
      'contract',(SELECT jsonb_build_object('status',c.status,'starts_at',c.starts_at,'requested',c.requested_start_date,'binding',c.binding_months,'notice',c.notice_months,'renew',c.auto_renew_enabled) FROM public.customer_contracts c WHERE c.company_id=mp.company_id AND c.metering_point_id=mp.id ORDER BY c.created_at DESC LIMIT 1),
      'switch',(SELECT jsonb_build_object('status',s.status,'start',s.requested_start_date,'z03',s.outbound_z03_message_id) FROM public.supplier_switch_requests s WHERE s.company_id=mp.company_id AND s.metering_point_id=mp.id ORDER BY s.created_at DESC LIMIT 1))
    ORDER BY mp.created_at),'[]') FROM public.metering_points mp WHERE mp.company_id=${literal(tenant.companyId)}`)
}

type SwitchRow = { facility: string; id: string | null; status: string | null; start: string | null; z03: string | null; z03Status: string | null; z03Start: string | null
  calculation: unknown; blockers: unknown; events: unknown }
/** Per facility: the switch request, its start-date calculation, latest events and the Z03 it built (start = DTM+92). */
function switches() {
  return sql<SwitchRow[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,'id',s.id,'status',s.status,'start',s.requested_start_date,
      'z03',z.id,'z03Status',z.status,'z03Start',substring(z.raw_payload from 'DTM\\+92:(\\d{8})'),
      'calculation',s.validation_snapshot->'startDateCalculation','blockers',s.metadata->'supplier_switch_blockers',
      'events',(SELECT coalesce(jsonb_agg(e.message ORDER BY e.created_at DESC),'[]') FROM (SELECT message,created_at FROM public.supplier_switch_events WHERE switch_request_id=s.id ORDER BY created_at DESC LIMIT 4) e))
    ORDER BY mp.created_at),'[]')
    FROM public.metering_points mp
    LEFT JOIN LATERAL (SELECT * FROM public.supplier_switch_requests x WHERE x.company_id=mp.company_id AND x.metering_point_id=mp.id ORDER BY x.created_at DESC LIMIT 1) s ON true
    LEFT JOIN LATERAL (SELECT m.id,m.status,m.raw_payload FROM public.ediel_messages m WHERE m.company_id=mp.company_id
      AND (m.id=s.outbound_z03_message_id OR (m.switch_request_id=s.id AND m.message_code LIKE 'Z03%')) ORDER BY m.created_at DESC LIMIT 1) z ON true
    WHERE mp.company_id=${literal(tenant.companyId)}`)
}

/** The one deviation from real time (owner decision). A refusal is recorded, never worked around. */
function backdate(target: string, statement: string): { target: string; ok: boolean; rows?: number; refusal?: string } {
  try { return { target, ok: true, rows: sql<number>(statement) } }
  catch (error) { return { target, ok: false, refusal: String((error as { stderr?: string }).stderr || (error as Error).message).trim().split('\n')[0] } }
}
let backdated = false
/** Steps after F3 need the established historical supply period; without it there is nothing to invoice for September. */
function requireBackdate(step: string, context: TestContext) {
  if (backdated) return
  report[step] = 'skipped: the supply start 2026-09-01 was not established (F3), so September cannot be supplied or invoiced'
  return context.skip()
}

type Row = Record<string, unknown>
type BillingGraph = { underlays: Row[]; underlayItems: Record<string, string[]>; pricingRuns: Array<Row & { lines: Row[] }>; invoices: Row[]; exportItems: Row[]
  exportFiles: Array<{ id: string; provider: string; billing_month: string; rows: InvoiceFileRow[]; rows_sha256: string; created_at: string }> }
let graph: BillingGraph
let agreements: Array<{ contract: string; lines: string[] | null; error?: string }> = []
let renderedFiles: Array<{ id: string; provider: string; nordfin_xml: string; json: string; csv: string }> = []

/** Everything the monthly billing cron produced for the tenant and September. */
function billingGraph() {
  const company = literal(tenant.companyId)
  return sql<BillingGraph>(`SELECT jsonb_build_object(
    'underlays',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'facility',mp.metering_point_id,'customer',u.customer_id,'contract',coalesce(u.customer_contract_id,u.contract_id),
        'status',u.status,'readiness',u.readiness_status,'kwh',u.total_kwh,'missing',u.missing_values_count,'values',u.source_meter_value_count,'block',u.billing_block_reason,
        'start',u.billing_period_start,'end',u.billing_period_end,'supplyPeriod',u.supply_period_id) ORDER BY mp.metering_point_id),'[]')
      FROM public.billing_underlays u LEFT JOIN public.metering_points mp ON mp.id=u.metering_point_id WHERE u.company_id=${company} AND u.underlay_year=2026 AND u.underlay_month=9),
    'underlayItems',(SELECT coalesce(jsonb_object_agg(x.underlay,x.points),'{}') FROM (SELECT billing_underlay_id underlay,jsonb_agg(DISTINCT metering_point_id) points
      FROM public.billing_underlay_items WHERE company_id=${company} GROUP BY 1) x),
    'pricingRuns',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'underlay',r.billing_underlay_id,'status',r.status,'exVat',r.total_ex_vat,'vat',r.vat_amount,'incVat',r.total_inc_vat,'locked',r.locked_at IS NOT NULL,
        'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',l.line_type,'description',l.description,'quantity',l.quantity,'unit',l.unit,'unitPrice',l.unit_price_ex_vat,
          'exVat',l.amount_ex_vat,'vat',l.vat_amount,'incVat',l.amount_inc_vat,'component',l.metadata->>'component_code') ORDER BY l.sort_order),'[]') FROM public.pricing_preview_lines l WHERE l.pricing_run_id=r.id))
      ORDER BY r.created_at),'[]') FROM public.pricing_runs r WHERE r.company_id=${company}),
    'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'customer',i.customer_id,'contract',coalesce(i.customer_contract_id,i.contract_id),'item',i.invoice_export_item_id,
        'underlay',coalesce(i.billing_underlay_id,(SELECT e.billing_underlay_id FROM public.invoice_export_items e WHERE e.id=i.invoice_export_item_id)),
        'number',i.invoice_number,'reference',i.invoice_reference,'status',i.status,'kwh',i.total_kwh,'exVat',i.amount_ex_vat,'vat',i.vat_amount,'incVat',i.amount_inc_vat,
        'start',i.period_start,'end',i.period_end,'calculation',i.calculation_snapshot-'interval_evidence',
        'lines',(SELECT count(*) FROM public.customer_invoice_lines l WHERE l.invoice_id=i.id),'documents',(SELECT count(*) FROM public.customer_invoice_documents d WHERE d.invoice_id=i.id))
      ORDER BY i.created_at),'[]') FROM public.customer_invoices i WHERE i.company_id=${company}),
    'exportItems',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'underlay',e.billing_underlay_id,'status',e.status,'provider',e.provider,'ocr',e.provider_ocr,
        'paymentReference',e.provider_payment_reference,'rounding',e.rounding_amount,'incVat',e.amount_inc_vat,'approval',e.metadata->'approval'->>'status','file',e.export_file_id) ORDER BY e.created_at),'[]')
      FROM public.invoice_export_items e WHERE e.company_id=${company}),
    'exportFiles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'provider',f.provider,'billing_month',f.billing_month,'rows',f.rows,'rows_sha256',f.rows_sha256,'created_at',f.created_at)),'[]')
      FROM public.invoice_export_files f WHERE f.company_id=${company}))`)
}
const counts = (g: BillingGraph) => ({ underlays: g.underlays.length, pricingRuns: g.pricingRuns.length, invoices: g.invoices.length, exportItems: g.exportItems.length, exportFiles: g.exportFiles.length })

/** The text lines of a PDF written by lib/customer-contracts/agreementPdf.ts (uncompressed `(…) Tj` strings, WinAnsi). */
function pdfText(pdf: Buffer) {
  return [...pdf.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map(match => match[1].replace(/\\([0-7]{3}|.)/g, (_, escaped: string) => escaped.length === 3 ? String.fromCharCode(parseInt(escaped, 8)) : escaped))
}
/** The archived signed agreement PDFs, read from storage as the customer received them. */
async function agreementTexts() {
  const documents = sql<Array<{ contract: string; bucket: string | null; path: string | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('contract',customer_contract_id,
    'bucket',storage_bucket,'path',storage_path)),'[]') FROM public.customer_contract_documents WHERE company_id=${literal(tenant.companyId)} AND document_type='signed_contract_pdf'`)
  const texts: typeof agreements = []
  for (const document of documents) {
    if (!document.bucket || !document.path) { texts.push({ contract: document.contract, lines: null, error: 'no storage location' }); continue }
    const { data, error } = await supabaseService.storage.from(document.bucket).download(document.path)
    texts.push(error || !data ? { contract: document.contract, lines: null, error: error?.message ?? 'empty' } : { contract: document.contract, lines: pdfText(Buffer.from(await data.arrayBuffer())) })
  }
  return texts
}
/** Which contract terms one output (an invoice row, a file, an agreement text) carries. */
function termsIn(output: unknown) {
  const t = (typeof output === 'string' ? output : JSON.stringify(output ?? null)).toLowerCase()
  return { binding: /binding_?months|bindingmonths|bindningstid/.test(t), notice: /notice_?months|noticemonths|uppsägningstid/.test(t),
    autoRenewal: /auto_?renew|autorenew|automatisk förläng/.test(t), endDate: /binding_?end_?date|bindingenddate|slutdatum|gäller till|löper ut/.test(t),
    remaining: /months_?remaining|monthsremaining|återstående/.test(t) }
}
const ALL_TERMS = { binding: true, notice: true, autoRenewal: true, endDate: true, remaining: true }
const isMonthlyFee = (line: Row) => /månadsavgift|monthly_fee/i.test(`${line.description} ${line.component} ${line.type}`)
const isInvoiceFee = (line: Row) => /fakturaavgift|invoice_fee/i.test(`${line.description} ${line.component} ${line.type}`)

/** One grid-owner metering run: the simulator sends each day as its own UTILTS E66 mail over SMTPS. */
async function gridOwnerSendsE66(files: Array<Omit<SentFile, 'reference'> & { registeredAfterHours?: number }>) {
  const response = await fetch(`${gridOwner.url}/__sim/send-e66-batch`, { method: 'POST', body: JSON.stringify({ receiver: tenant.supplierEdielId,
    files: files.map(file => ({ meterId: file.facility, day: file.day, values: file.values, registeredAfterHours: file.registeredAfterHours })) }) })
  const body = await response.json().catch(() => null) as { sent?: Array<{ reference: string }> } | null
  if (!response.ok || body?.sent?.length !== files.length) throw Error(`grid_owner_send_failed:${response.status}:${JSON.stringify(body).slice(0, 300)}`)
  files.forEach((file, i) => sentFiles.push({ facility: file.facility, day: file.day, kind: file.kind, values: file.values, reference: body.sent![i].reference }))
}
const inboundE66 = () => sql<Array<{ id: string; reference: string; status: string; meter: string | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,
    'reference',coalesce(external_reference,interchange_reference,''),'status',status,'meter',metering_point_id) ORDER BY created_at),'[]')
  FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66'`)
/** Like Vercel: the inbound mail cron, then the Ediel outbox (which sends our CONTRL), once a minute. */
async function receiveUntil(done: () => boolean, minutes: number) {
  const runs: unknown[] = []
  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
    const outbox = await cron('/api/ediel/outbox/process')
    runs.push({ at: new Date().toISOString(), inbound: inbound.status, outbox: outbox.status })
    expect(inbound.status, JSON.stringify(inbound.body)).toBe(200)
    if (done() || Date.now() > deadline) break
    await pause(60_000)
  }
  return runs
}

describe.sequential('reality F — invoices for several facilities with contract terms', () => {
  afterAll(async () => {
    gridOwner?.stop()
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    saveReport()
  })

  it('F1 the supplier goes live with a 12-month binding offer', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    const live = await goLiveAlsSupplier(report, { terms: TERMS })
    ;({ tenant, gridOwner, apiKey } = live)
    expect(live.provisioned.readinessBlockers, JSON.stringify(live.provisioned.readinessBlockers)).toEqual([])
    expect(apiKey).toBeTruthy()
    expect(sql(`SELECT jsonb_build_object('binding',binding_months,'notice',notice_months,'renew',auto_renew_enabled,'term',renewal_term_months)
      FROM public.contract_price_options WHERE company_id=${literal(tenant.companyId)} AND is_default`)).toEqual({ binding: 12, notice: 1, renew: true, term: 12 })
  })

  it('F2 a customer applies for three facilities and a control customer for one', async () => {
    for (const centroid of [{ postal_code: '441 30', latitude: 57.9303, longitude: 12.534 }]) await fetch('http://127.0.0.1:3901/__sim/geocode', { method: 'POST', body: JSON.stringify(centroid) })
    for (const customer of CUSTOMERS) for (const one of customer.sites) {
      const address = one.address ?? customer.person.address
      const point = EXACT_POINTS[address.street]
      const projected = sql<{ x: number; y: number; area: string | null }>(`SELECT jsonb_build_object('x',round(ST_X(p)::numeric,2),'y',round(ST_Y(p)::numeric,2),
        'area',(SELECT g.grid_area_code FROM public.platform_grid_area_geometries g WHERE g.is_active AND ST_Contains(g.geometry,p) LIMIT 1))
        FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${point.longitude},${point.latitude}),4326),3006) p) q`)
      expect(projected.area).toBe(GRID_AREA)
      const [street, number] = [address.street.replace(/\s+\d+\w*$/, ''), /(\d+\w*)$/.exec(address.street)?.[1] ?? '']
      await fetch('http://127.0.0.1:3901/__sim/address', { method: 'POST', body: JSON.stringify({ street, number, postalCode: address.postalCode, city: address.city, x: projected.x, y: projected.y }) })
    }
    const results: Array<{ who: string; status: number; step: string; body?: unknown }> = []
    for (const customer of CUSTOMERS) {
      const account = await supabaseService.auth.admin.createUser({ email: customer.person.email, password: `Reality-${customer.person.personalNumber}`, email_confirm: true })
      if (account.error || !account.data.user) throw Error(`portal_account_failed:${account.error?.message}`)
      for (const one of customer.sites) {
        const result = await applyAsWebsiteCustomer({ baseUrl: LIVE.appUrl, apiKey, origin: WEBSITE_ORIGIN, person: customer.person, site: one, portalUserId: account.data.user.id })
        results.push({ who: `${customer.person.firstName} ${one.facilityId}`, status: result.status, step: result.step, body: result.status >= 300 || result.status === 0 ? result.body : undefined })
      }
    }
    report.applications = results
    for (const result of results) expect(result.status, `${result.who}: ${result.step} ${JSON.stringify(result.body).slice(0, 600)}`).toBeLessThan(300)
    report.startDatesAfterApplication = startDates()
    // One customer per person: the three facilities belong to one customer.
    const customers = sql<Array<{ facilities: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facilities',n) ORDER BY n),'[]') FROM (SELECT count(*) n FROM public.metering_points WHERE company_id=${literal(tenant.companyId)} GROUP BY customer_id) x`)
    expect(customers).toEqual([{ facilities: 1 }, { facilities: 3 }])
  })

  it('F3 the supply start is set to 1 September before any Z03 is built (owner decision)', async () => {
    loadIds()
    // The website application only queues its continuation job; the customer-operations cron runs it, creates
    // the switch request and builds the Z03 in the same call (customerProcessNextStepEngine → edielAutomation).
    const before = switches()
    report.switchesBeforeBackdate = before
    expect(before.filter(row => row.id || row.z03), 'a cron built switch requests before the backdate (shared world?)').toEqual([])
    const company = literal(tenant.companyId), start = literal(SUPPLY_START)
    const updated = (table: string, set: string, where = '') => `WITH u AS (UPDATE public.${table} SET ${set} WHERE company_id=${company}${where} RETURNING 1) SELECT to_jsonb(count(*)) FROM u`
    const outcomes = [
      backdate('website_customer_applications.requested_start_date', updated('website_customer_applications', `requested_start_date=${start},requested_start_mode='specific_date',updated_at=now()`)),
      backdate('customer_application_workflows.snapshot.requested_start_date', updated('customer_application_workflows', `snapshot=snapshot||jsonb_build_object('requested_start_date',${start}::text),updated_at=now()`)),
      backdate('customer_contracts.requested_start_date', updated('customer_contracts', `requested_start_date=${start}`)),
      // The start of the signed contract (part of the signed, hash-bound record).
      backdate('customer_contracts.starts_at+expected_start_at', updated('customer_contracts', `starts_at=${start},expected_start_at=${start}`)),
    ]
    const runs: unknown[] = []
    const sinceBackdate = new Map<string, number>()
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_F3_MINUTES ?? 10) * 60_000
    let state = before
    for (;;) {
      const ran = await cron('/api/internal/customer-operations/cron')
      runs.push({ at: new Date().toISOString(), status: ran.status, result: (ran.body as { result?: unknown }).result ?? ran.body })
      state = switches()
      for (const row of state) {
        if (!row.id) continue
        const seen = sinceBackdate.get(row.id)
        if (seen !== undefined) { sinceBackdate.set(row.id, seen + 1); continue }
        // A switch request that exists before its Z03 gets the start too, exactly once.
        if (!row.z03 && row.start !== SUPPLY_START) {
          outcomes.push(backdate(`supplier_switch_requests.requested_start_date ${row.facility}`,
            updated('supplier_switch_requests', `requested_start_date=${start},updated_at=now()`, ` AND id=${literal(row.id)} AND outbound_z03_message_id IS NULL`)))
          sinceBackdate.set(row.id, 0)
        }
      }
      saveReport({ backdateProgress: { outcomes, runs, state } })
      const done = state.length === 4 && state.every(row => row.z03 || (row.id && (sinceBackdate.get(row.id) ?? 0) >= 2))
      if (done || Date.now() > deadline) break
      await pause(30_000)
    }
    const z03Starts = state.map(row => ({ facility: row.facility, switchStatus: row.status, switchStart: row.start, z03: row.z03Status, z03Start: row.z03Start,
      switchBackdated: Boolean(row.id && sinceBackdate.has(row.id)), calculation: row.calculation, blockers: row.blockers, events: row.events }))
    backdated = state.length === 4 && state.every(row => row.z03Start === SUPPLY_START.replaceAll('-', ''))
    const refusals = outcomes.filter(outcome => !outcome.ok)
    report.backdate = { backdated, outcomes, refusals, z03Starts, customerOperationRuns: runs, startDates: startDates() }
    // Owner decision: where the platform refuses the past start, the run says so and stops here.
    expect.soft(refusals, `the platform refused the backdated start on: ${JSON.stringify(refusals)}`).toEqual([])
    expect(z03Starts.map(row => row.z03Start), `every Z03 must carry the supply start 20260901; the real code built: ${JSON.stringify(z03Starts, null, 1).slice(0, 4000)}`)
      .toEqual(FACILITIES.map(() => '20260901'))
  }, 15 * 60_000)

  it('F4 the world runs on cron cadence until every switch is confirmed and supply rests on the Z04 from 1 September', async (context) => {
    requireBackdate('F4', context)
    await gridOwner.profile({ contrlDelayMs: 20_000, aperakDelayMs: 40_000, z04DelayMs: 90_000 })
    const supply = () => sql<Array<{ facility: string; switchId: string | null; switch: string | null; start: string | null; z04: string | null; period: Row | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
        'facility',mp.metering_point_id,'switchId',s.id,'switch',s.status,'start',coalesce(s.confirmed_start_date,s.requested_start_date),'z04',s.inbound_z04_message_id,
        'period',(SELECT jsonb_build_object('status',p.status,'start',p.start_date,'customer',p.customer_id,'contract',coalesce(p.customer_contract_id,p.contract_id),'source',p.source,
          'message',p.source_message_id,'switch',p.source_switch_request_id,'marketStart',p.market_start_at,'atSupplyStart',p.market_start_at=(TIMESTAMP '2026-09-01 00:00' AT TIME ZONE 'Europe/Stockholm'))
          FROM public.customer_supply_periods p WHERE p.company_id=mp.company_id AND p.metering_point_id=mp.id ORDER BY p.created_at DESC LIMIT 1)) ORDER BY mp.created_at),'[]')
      FROM public.metering_points mp
      LEFT JOIN LATERAL (SELECT * FROM public.supplier_switch_requests x WHERE x.company_id=mp.company_id AND x.metering_point_id=mp.id ORDER BY x.created_at DESC LIMIT 1) s ON true
      WHERE mp.company_id=${literal(tenant.companyId)}`)
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_F4_MINUTES ?? 30) * 60_000
    const slots: unknown[] = []
    let state = supply()
    for (;;) {
      const ran = await runOperationalCronSlot()
      slots.push({ at: new Date().toISOString(), crons: ran.map(r => ({ path: r.path, status: r.status, ms: r.ms, ...(r.path.includes('customer-operations') ? { body: r.body } : {}) })) })
      state = supply()
      saveReport({ worldSlots: slots, supply: state })
      const settled = state.length === 4 && state.every(row => row.period?.status === 'active') || state.some(row => row.switch === 'failed')
      if (settled || Date.now() > deadline) break
      await pause(60_000)
    }
    report.worldSlots = slots
    report.supply = state
    report.gridOwner = await gridOwner.state()
    for (const f of FACILITIES) {
      const row = state.find(r => r.facility === f.gsrn), id = idOf(f)
      expect(row?.switch, `${f.gsrn} ${JSON.stringify(row)}`).toMatch(/^(accepted|active|completed)$/)
      expect(row?.z04, `${f.gsrn} rests on the grid owner's Z04`).toBeTruthy()
      expect(row?.period, `${f.gsrn} ${JSON.stringify(row)}`).toMatchObject({ status: 'active', start: SUPPLY_START, atSupplyStart: true, customer: id.customer,
        contract: id.contract, message: row?.z04, switch: row?.switchId })
    }
  }, 40 * 60_000)

  it('F5 the grid owner sends September for every facility, with one day missing and three August days', async (context) => {
    requireBackdate('F5', context)
    // SYNTHETIC stand-in for EXT-ISSUER-01: the issuer registry entry of the real ALS grid owner, exactly as the
    // live-chain fixture registers its fixture issuer (configureTenant). No value, period or gate is set here.
    registerUtiltsIssuer(sql as never, literal, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
    await gridOwnerSendsE66([
      ...FACILITIES.flatMap(f => SEPTEMBER.flatMap((day, i) => f === MISSING.facility && day === MISSING.day ? [] : [{ facility: f.gsrn, day, kind: 'regular' as const, values: profileFor(f, i) }])),
      ...AUGUST.days.map((day, i) => ({ facility: AUGUST.facility.gsrn, day, kind: 'august' as const, values: profileFor(AUGUST.facility, 30 + i) })),
    ])
    report.sentFiles = sentFiles
    report.sentKwh = Object.fromEntries(FACILITIES.map(f => [f.gsrn, sum(SEPTEMBER.flatMap(day => effective(f.gsrn).get(day) ?? []))]))
    expect(sentFiles).toHaveLength(FACILITIES.length * SEPTEMBER.length - 1 + AUGUST.days.length)
  }, 15 * 60_000)

  it('F6 the inbound cron receives every file on the tenant and acknowledges it', async (context) => {
    requireBackdate('F6', context)
    report.receptionRuns = await receiveUntil(() => inboundE66().length >= sentFiles.length, Number(process.env.GRIDEX_REALITY_F6_MINUTES ?? 30))
    const inbound = inboundE66()
    report.inbound = inbound
    const arrived = new Set(inbound.map(message => fileOf(message.reference)?.reference))
    expect(sentFiles.filter(file => !arrived.has(file.reference)).map(file => `${file.facility} ${file.day}`), 'files never received on the tenant').toEqual([])
  }, 40 * 60_000)

  it('F6b the grid owner re-sends one day with corrected values', async (context) => {
    requireBackdate('F6b', context)
    const original = effective(CORRECTED.facility.gsrn).get(CORRECTED.day)!
    const corrected = original.map((value, q) => Math.round((value + (q % 4 === 0 ? 0.012 : 0)) * 1000) / 1000)
    correctedQuarters = corrected.filter((value, q) => value !== original[q]).length
    await gridOwnerSendsE66([{ facility: CORRECTED.facility.gsrn, day: CORRECTED.day, kind: 'correction', values: corrected, registeredAfterHours: 30 }])
    const reference = sentFiles[sentFiles.length - 1].reference
    report.correction = { facility: CORRECTED.facility.gsrn, day: CORRECTED.day, reference, changedQuarters: correctedQuarters, originalKwh: sum(original), correctedKwh: sum(corrected) }
    report.correctionRuns = await receiveUntil(() => inboundE66().some(message => fileOf(message.reference)?.reference === reference), 10)
    expect(inboundE66().some(message => fileOf(message.reference)?.reference === reference)).toBe(true)
  }, 15 * 60_000)

  it('F6c after issuer evidence and operator reprocessing, values are stored on the right customer and only September is billable', async (context) => {
    requireBackdate('F6c', context)
    const sources = inboundE66()
    for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
    // No job re-evaluates held UTILTS: Gridex staff run the UTILTS engine per message (chain E, E5).
    const staff = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    const page = await staff.newPage()
    const storedFor = (id: string) => sql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE source_message_id=${literal(id)}`)
    const outcomes: Array<{ source: string; file: string | null; button: boolean; stored: number; expected: number; diagnosis?: unknown; pageText?: string }> = []
    for (const source of sources) {
      const file = fileOf(source.reference)
      // A correction stores only the quarter-hours it changed (FINDINGS F78).
      const expected = file?.kind === 'correction' ? correctedQuarters : 96
      await page.goto(`/admin/ediel/messages/${source.id}`)
      const button = page.getByRole('button', { name: 'Kör UTILTS engine / skapa TGT-svar' })
      const visible = await button.count()
      if (visible) await Promise.all([page.waitForLoadState('networkidle'), button.click()])
      const started = Date.now()
      let stored = storedFor(source.id)
      while (visible && stored < expected && Date.now() - started < 90_000) { await pause(3_000); stored = storedFor(source.id) }
      const outcome: (typeof outcomes)[number] = { source: source.id, file: file ? `${file.kind} ${file.facility} ${file.day}` : null, button: Boolean(visible), stored, expected }
      if (stored < expected) {
        outcome.diagnosis = sql(`SELECT jsonb_build_object('status',m.status,
          'issues',(SELECT coalesce(jsonb_agg(i->>'code'),'[]') FROM jsonb_array_elements(coalesce(m.validation_report#>'{utiltsRuntime,validation,issues}','[]')) i),
          'transactions',(SELECT coalesce(jsonb_agg(jsonb_build_object('disposition',t.disposition,'persistence',t.persistence_status,'issues',t.issue_codes)),'[]') FROM public.ediel_ack_transaction_results t WHERE t.source_message_id=m.id),
          'lastEvents',(SELECT coalesce(jsonb_agg(e.message ORDER BY e.created_at DESC),'[]') FROM (SELECT message,created_at FROM public.ediel_message_events WHERE ediel_message_id=m.id ORDER BY created_at DESC LIMIT 4) e))
          FROM public.ediel_messages m WHERE m.id=${literal(source.id)}`)
        if (!visible) outcome.pageText = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 300)
      }
      outcomes.push(outcome)
      if (outcomes.length % 10 === 0) saveReport({ reprocessProgress: outcomes })
    }
    await page.close()
    const notStored = outcomes.filter(outcome => outcome.stored < outcome.expected)
    report.reprocess = { outcomes, buttonMissing: outcomes.filter(outcome => !outcome.button).length, notStored: notStored.length }

    const valuesFor = (mp: string) => sql<Row>(`WITH v AS (SELECT *,(period_start AT TIME ZONE 'Europe/Stockholm')::date d FROM public.normalized_metering_values WHERE metering_point_id=${literal(mp)}),
      s AS (SELECT * FROM v WHERE revision_status='current' AND d BETWEEN DATE '2026-09-01' AND DATE '2026-09-30')
      SELECT jsonb_build_object(
        'companies',(SELECT coalesce(jsonb_agg(DISTINCT company_id),'[]') FROM v),'customers',(SELECT coalesce(jsonb_agg(DISTINCT customer_id),'[]') FROM v),
        'septemberCurrent',(SELECT count(*) FROM s),'septemberKwh',(SELECT coalesce(sum(quantity_kwh),0) FROM s),
        'septemberBillable',(SELECT count(*) FROM s WHERE billing_gate_status='eligible'),
        'beforeSupply',(SELECT count(*) FROM v WHERE d<DATE '2026-09-01'),'beforeSupplyBillable',(SELECT count(*) FROM v WHERE d<DATE '2026-09-01' AND billing_gate_status='eligible'),
        'days',(SELECT coalesce(jsonb_agg(DISTINCT d ORDER BY d),'[]') FROM v WHERE revision_status='current'),
        'zeroValues',(SELECT count(*) FROM v WHERE revision_status='current' AND quantity_kwh=0),
        'correctedDayKwh',(SELECT coalesce(sum(quantity_kwh),0) FROM s WHERE d=${literal(CORRECTED.day)}::date),
        'superseded',(SELECT count(*) FROM v WHERE revision_status<>'current'),
        'gate',(SELECT coalesce(jsonb_object_agg(g,n),'{}') FROM (SELECT billing_gate_status g,count(*) n FROM v GROUP BY 1) x),
        'reasons',(SELECT coalesce(jsonb_agg(DISTINCT r->>'code'),'[]') FROM v, jsonb_array_elements(coalesce(v.billing_gate_reasons,'[]')) r))`)
    const values = Object.fromEntries(FACILITIES.map(f => [f.gsrn, valuesFor(idOf(f).mp)]))
    report.values = values
    // FINDINGS F80: the reprocess button can be hidden; then nothing is stored and the run says where.
    expect(notStored.map(outcome => `${outcome.file}: ${outcome.stored}/${outcome.expected}${outcome.button ? '' : ' (no reprocess button, F80)'}`),
      `values not stored for ${notStored.length} of ${outcomes.length} sources`).toEqual([])
    for (const f of FACILITIES) {
      const v = values[f.gsrn], id = idOf(f), days = effective(f.gsrn)
      const september = SEPTEMBER.filter(day => days.has(day))
      const detail = `${f.gsrn} ${JSON.stringify({ gate: v.gate, reasons: v.reasons })}`
      expect(v.companies, detail).toEqual([tenant.companyId])
      expect(v.customers, detail).toEqual([id.customer])
      expect(v.septemberCurrent, detail).toBe(september.length * 96)
      expect(Number(v.septemberKwh), detail).toBeCloseTo(sum(september.flatMap(day => days.get(day)!)), 6)
      expect(v.septemberBillable, detail).toBe(september.length * 96)
      expect(v.beforeSupplyBillable, `${detail}: before the supply start nothing is billable`).toBe(0)
      expect(v.zeroValues, detail).toBe(0)
    }
    // The gap stays a gap; the correction is in force for its day, the original is superseded, not added.
    expect(values[MISSING.facility.gsrn].days).not.toContain(MISSING.day)
    expect(Number(values[CORRECTED.facility.gsrn].correctedDayKwh)).toBeCloseTo(sum(effective(CORRECTED.facility.gsrn).get(CORRECTED.day)!), 6)
    expect(Number(values[CORRECTED.facility.gsrn].superseded)).toBeGreaterThanOrEqual(correctedQuarters)
  }, 150 * 60_000)

  it('F7 the admin imports and locks the September SE3 spot prices', async (context) => {
    requireBackdate('F7', context)
    const admin = await operatorSession(tenant.adminEmail, tenant.adminPassword)
    const imported = await admin.request.post('/api/internal/spot/import-month', { data: { billing_month: MONTH, price_areas: ['SE3'] } })
    report.spotImport = { status: imported.status(), body: await imported.json().catch(() => null) }
    expect(imported.status(), JSON.stringify(report.spotImport)).toBe(200)
    const locked = await admin.request.post('/api/internal/spot/lock-month', { data: { billing_month: MONTH, price_area: 'SE3', reason: 'E2E reality F' } })
    report.spotLock = { status: locked.status(), body: await locked.json().catch(() => null) }
    expect(locked.status(), JSON.stringify(report.spotLock)).toBe(200)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour'
      AND time_start>='2026-08-31T22:00:00Z' AND time_start<'2026-09-30T22:00:00Z'`)).toBe(30 * 96)
  })

  it('F8 the monthly billing cron prepares September: underlays, locked pricing, invoices, files and agreements', async (context) => {
    requireBackdate('F8', context)
    const result = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    report.billingCron = result
    expect(result.status, JSON.stringify(result.body).slice(0, 2000)).toBe(200)
    graph = billingGraph()
    agreements = await agreementTexts()
    // Files are rendered from their stored rows, exactly as the admin download route does.
    renderedFiles = graph.exportFiles.map(file => ({ id: file.id, provider: file.provider,
      ...Object.fromEntries((['nordfin_xml', 'json', 'csv'] as const).map(format => [format, String(renderInvoiceFile(file, format).body)])) as { nordfin_xml: string; json: string; csv: string } }))
    report.billing = { ...graph, agreements, renderedFiles,
      ...(graph.exportFiles.length ? {} : { exportFilesNote: 'none: invoice files hold approved invoices only and are made by staff (lib/billing/invoiceFileExport.ts listInvoiceFileCandidates/createInvoiceFile); the cron prepares drafts for review' }) }
    // One underlay per facility, each for the whole supplied month.
    expect(graph.underlays.map(u => u.facility).sort(), JSON.stringify(graph.underlays)).toEqual(FACILITIES.map(f => f.gsrn).sort())
    for (const underlay of graph.underlays) expect(underlay.start, JSON.stringify(underlay)).toBe(SUPPLY_START)
  }, 15 * 60_000)

  it('F9 each invoice matches an independent calculation; terms, fees, payment reference and rounding (F70–F77)', async (context) => {
    requireBackdate('F9', context)
    // A second cron run must not prepare anything twice.
    const again = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    const repeated = billingGraph()
    report.billingRepeat = { status: again.status, body: again.body, before: counts(graph), after: counts(repeated) }
    expect(again.status).toBe(200)
    expect(counts(repeated)).toEqual(counts(graph))
    expect(repeated.invoices.map(i => i.id).sort()).toEqual(graph.invoices.map(i => i.id).sort())

    const prices = sql<Array<{ s: string; p: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('s',time_start,'p',sek_per_kwh) ORDER BY time_start),'[]')
      FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>='2026-08-31T22:00:00Z' AND time_start<'2026-09-30T22:00:00Z'`)
    const price = new Map(prices.map(row => [new Date(row.s).toISOString(), Number(row.p)]))
    const runOf = (invoice: Row) => graph.pricingRuns.find(run => run.id === (invoice.calculation as Row | null)?.pricing_run_id) ?? graph.pricingRuns.find(run => run.underlay === invoice.underlay && run.locked)
    const independent: Record<string, unknown> = {}
    for (const f of FACILITIES) {
      const underlay = graph.underlays.find(u => u.facility === f.gsrn)
      const invoice = underlay ? graph.invoices.find(i => i.underlay === underlay.id) : undefined
      if (f === MISSING.facility) {
        // A month with a gap is never invoiced as if the gap were zero consumption.
        report.missingDay = { facility: f.gsrn, day: MISSING.day, underlay, invoice: invoice ?? null }
        expect(Number(underlay?.missing), JSON.stringify(underlay)).toBeGreaterThanOrEqual(96)
        expect(invoice, `no invoice from a month with a missing day: ${JSON.stringify(invoice)}`).toBeUndefined()
        continue
      }
      const days = effective(f.gsrn)
      let energy = 0, kwh = 0
      for (const day of SEPTEMBER) days.get(day)!.forEach((value, q) => {
        const start = new Date(Date.parse(`${day}T00:00:00+02:00`) + q * 900_000).toISOString()
        const p = price.get(start)
        if (p === undefined) throw Error(`no spot price for ${start}`)
        energy += value * p; kwh += value
      })
      const markup = kwh * 0.04, monthlyFee = 49, exVat = energy + markup + monthlyFee
      const run = invoice ? runOf(invoice) : undefined
      independent[f.gsrn] = { kwh, spotSek: energy, markupSek: markup, monthlyFeeSek: monthlyFee, exVat, vat: exVat * 0.25, incVat: exVat * 1.25,
        invoice: invoice ? { number: invoice.number, kwh: invoice.kwh, exVat: invoice.exVat, vat: invoice.vat, incVat: invoice.incVat } : null,
        differenceIncVat: invoice ? Number(invoice.incVat) - exVat * 1.25 : null, lines: run?.lines ?? null }
      expect(invoice, `${f.gsrn}: ${JSON.stringify(underlay)}`).toBeTruthy()
      expect(invoice!.customer).toBe(idOf(f).customer)
      expect(invoice!.contract).toBe(idOf(f).contract)
      expect(Number(invoice!.kwh), f.gsrn).toBeCloseTo(kwh, 3)
      expect(Math.abs(Number(invoice!.exVat) - exVat), `${f.gsrn} ex VAT ${JSON.stringify(independent[f.gsrn])}`).toBeLessThan(1)
      expect(Math.abs(Number(invoice!.vat) - Number(invoice!.exVat) * 0.25), `${f.gsrn} VAT 25 %`).toBeLessThan(0.01)
      expect(Math.abs(Number(invoice!.incVat) - exVat * 1.25), `${f.gsrn} inc VAT`).toBeLessThan(1)
      expect.soft(sum((run?.lines ?? []).filter(isMonthlyFee).map(line => Number(line.exVat))), `${f.gsrn} monthly fee 49 kr`).toBeCloseTo(49, 2)
    }
    report.independent = independent

    // Contract terms as signed: 12 months binding and 1 month notice on every contract.
    const contracts = sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'customer',customer_id,'consolidated',consolidated_invoice,'billingLevel',billing_level,
        'startsAt',starts_at,'actualStart',actual_start_date,'confirmedStart',confirmed_start_date,'endsAt',ends_at,'binding',binding_months,'notice',notice_months,
        'renew',auto_renew_enabled,'renewTerm',auto_renew_term_months)),'[]') FROM public.customer_contracts WHERE company_id=${literal(tenant.companyId)}`)
    report.contracts = contracts
    for (const contract of contracts) expect(contract, 'signed binding and notice').toMatchObject({ binding: TERMS.bindingMonths, notice: TERMS.noticeMonths })

    // Candidate findings F70–F77: documented as soft checks so one does not hide the next.
    const findings: Record<string, { status: string; evidence: unknown }> = {}
    const tre = idOf(HOUSE).customer
    const treInvoices = graph.invoices.filter(i => i.customer === tre)
    const consolidated = contracts.filter(c => c.customer === tre).some(c => c.consolidated === true)
    findings.F70 = { status: treInvoices.length > 1 ? (consolidated ? 'confirmed: consolidation chosen, one invoice per facility' : 'one invoice per facility; no consolidation choice is recorded on the contracts')
      : 'refuted: one invoice for the customer', evidence: { invoices: treInvoices.map(i => i.number ?? i.id), consolidated, billingLevels: contracts.filter(c => c.customer === tre).map(c => c.billingLevel) } }
    if (consolidated) expect.soft(treInvoices.length, 'F70 a customer who chose consolidation gets one invoice').toBe(1)
    const fees = graph.invoices.map(i => ({ invoice: i.number ?? i.id, customer: i.customer, monthlyFees: (runOf(i)?.lines ?? []).filter(isMonthlyFee).length,
      invoiceFees: (runOf(i)?.lines ?? []).filter(isInvoiceFee).length }))
    findings.F71 = { status: fees.filter(fee => fee.customer === tre).reduce((n, fee) => n + fee.invoiceFees, 0) > 1
      ? 'confirmed: the customer with several facilities is charged an invoice fee on each facility invoice' : 'not observed', evidence: fees }
    for (const fee of fees) expect.soft(fee.monthlyFees, `F71 monthly fee once per facility invoice (${fee.invoice})`).toBe(1)

    const outputs: Array<{ output: string; terms: ReturnType<typeof termsIn> }> = [
      ...graph.invoices.map(i => ({ output: `draft invoice ${i.number ?? i.id} (customer_invoices.calculation_snapshot)`, terms: termsIn(i.calculation) })),
      ...renderedFiles.flatMap(file => (['nordfin_xml', 'json', 'csv'] as const).map(format => ({ output: `invoice file ${file.id} ${format}`, terms: termsIn(file[format]) }))),
    ]
    findings.F72 = { status: outputs.every(o => Object.values(o.terms).every(Boolean)) ? 'refuted' : 'confirmed: contract terms missing in invoice outputs',
      evidence: { outputs, filesAvailable: renderedFiles.length } }
    for (const o of outputs) expect.soft(o.terms, `F72 contract terms in ${o.output}`).toEqual(ALL_TERMS)
    const pdfs = agreements.map(a => ({ contract: a.contract, error: a.error, terms: a.lines ? termsIn(a.lines.join('\n')) : null,
      startLine: a.lines?.find(line => /startdatum/i.test(line)) ?? null }))
    findings.F73 = { status: pdfs.length && pdfs.every(p => p.terms && Object.values(p.terms).every(Boolean)) ? 'refuted' : 'confirmed: agreement PDF lacks terms', evidence: pdfs }
    expect.soft(pdfs.length, 'F73 every contract has an archived agreement PDF').toBe(FACILITIES.length)
    for (const p of pdfs) expect.soft(p.terms, `F73 contract terms in the agreement PDF of ${p.contract}`).toEqual(ALL_TERMS)
    findings.F74 = { status: contracts.every(c => c.renew === true && c.renewTerm === TERMS.renewalMonths) ? 'refuted' : 'confirmed: the contract does not carry the offered automatic renewal',
      evidence: contracts.map(c => ({ id: c.id, renew: c.renew, renewTerm: c.renewTerm })) }
    for (const c of contracts) expect.soft({ renew: c.renew, renewTerm: c.renewTerm }, `F74 automatic renewal on contract ${c.id}`).toEqual({ renew: true, renewTerm: TERMS.renewalMonths })
    const payment = graph.invoices.map(i => { const item = graph.exportItems.find(e => e.id === i.item)
      return { invoice: i.number ?? i.id, invoiceReference: i.reference, ocr: item?.ocr ?? null, paymentReference: item?.paymentReference ?? null } })
    const xmlReferences = renderedFiles.map(file => [...file.nordfin_xml.matchAll(/<PaymentReference>([^<]*)<\/PaymentReference>|<PaymentReference\s*\/>/g)].map(m => m[1] ?? ''))
    findings.F75 = { status: payment.every(p => !p.invoiceReference && !p.ocr && !p.paymentReference) ? 'confirmed: no payment reference (OCR) on any invoice' : 'refuted', evidence: { payment, xmlReferences } }
    for (const p of payment) expect.soft(p.ocr ?? p.paymentReference ?? p.invoiceReference, `F75 payment reference (OCR) on ${p.invoice}`).toBeTruthy()
    // Mina sidor lists customer_invoices of the customer in published statuses (lib/customer-portal/apiData.ts listPortalInvoicesPage).
    const portal = sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('customer',c.id,'visible',(SELECT count(*) FROM public.customer_invoices i WHERE i.company_id=c.company_id AND i.customer_id=c.id
        AND i.status IN ('issued','sent','paid','overdue','cancelled','credited')),'statuses',(SELECT coalesce(jsonb_agg(DISTINCT i.status),'[]') FROM public.customer_invoices i WHERE i.company_id=c.company_id AND i.customer_id=c.id),
        'lines',(SELECT count(*) FROM public.customer_invoice_lines l WHERE l.company_id=c.company_id AND l.customer_id=c.id),
        'documents',(SELECT count(*) FROM public.customer_invoice_documents d WHERE d.company_id=c.company_id AND d.customer_id=c.id))),'[]')
      FROM public.customers c WHERE c.company_id=${literal(tenant.companyId)}`)
    findings.F76 = { status: portal.every(p => Number(p.lines) === 0 && Number(p.documents) === 0)
      ? 'confirmed for the prepared invoices: no invoice lines or documents for Mina sidor; drafts await approval and are not published by design' : 'refuted', evidence: portal }
    for (const p of portal) expect.soft(Number(p.lines), `F76 invoice lines for Mina sidor (customer ${p.customer})`).toBeGreaterThan(0)
    const toOre = (value: unknown) => Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 1e-6
    const rounding = graph.invoices.map(i => { const lines = runOf(i)?.lines ?? []
      return { invoice: i.number ?? i.id, exVat: i.exVat, vat: i.vat, incVat: i.incVat, roundedToOre: toOre(i.exVat) && toOre(i.vat) && toOre(i.incVat),
        linesExVat: sum(lines.map(line => Number(line.exVat))), roundingLines: lines.filter(line => /rounding|avrundning|öresutjämning/i.test(`${line.type} ${line.description}`)) } })
    findings.F77 = { status: rounding.every(r => r.roundedToOre) ? 'refuted for these invoices: amounts are whole öre' : 'confirmed: an invoice total is not rounded to whole öre', evidence: rounding }
    for (const r of rounding) expect.soft(r.roundedToOre, `F77 amounts in whole öre on ${r.invoice}: ${JSON.stringify(r)}`).toBe(true)
    report.findings = findings
  }, 15 * 60_000)

  it('F10 isolation: the control invoice holds only its own facility, nothing crosses tenants, no queue is stuck', (context) => {
    requireBackdate('F10', context)
    const control = idOf(CONTROL)
    const controlUnderlays = graph.underlays.filter(u => u.customer === control.customer)
    expect(controlUnderlays.map(u => u.facility)).toEqual([CONTROL.gsrn])
    expect(graph.invoices.filter(i => i.customer === control.customer).map(i => i.underlay)).toEqual([controlUnderlays[0].id])
    // Every underlay is built only from its own facility's values.
    for (const underlay of graph.underlays) expect(graph.underlayItems[String(underlay.id)] ?? [], String(underlay.facility)).toEqual([ids.get(String(underlay.facility))?.mp])
    const mine = [...ids.values()]
    const uuids = (values: string[]) => `${literal(`{${values.join(',')}}`)}::uuid[]`
    const company = literal(tenant.companyId)
    const leaks = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'valuesElsewhere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id<>${company} AND (metering_point_id=ANY(${uuids(mine.map(m => m.mp))}) OR facility_id=ANY(${literal(`{${FACILITIES.map(f => f.gsrn).join(',')}}`)}::text[]))),
      'underlaysElsewhere',(SELECT count(*) FROM public.billing_underlays WHERE company_id<>${company} AND metering_point_id=ANY(${uuids(mine.map(m => m.mp))})),
      'invoicesElsewhere',(SELECT count(*) FROM public.customer_invoices WHERE company_id<>${company} AND customer_id=ANY(${uuids(mine.map(m => m.customer))})),
      'foreignValuesHere',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${company} AND NOT (metering_point_id=ANY(${uuids(mine.map(m => m.mp))}))),
      'foreignInvoicesHere',(SELECT count(*) FROM public.customer_invoices WHERE company_id=${company} AND NOT (customer_id=ANY(${uuids(mine.map(m => m.customer))}))))`)
    report.isolation = leaks
    expect(leaks).toEqual({ valuesElsewhere: 0, underlaysElsewhere: 0, invoicesElsewhere: 0, foreignValuesHere: 0, foreignInvoicesHere: 0 })
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
  })
})
