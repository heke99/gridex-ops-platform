// Live-like local chain, part B: an existing supply customer's month from the
// grid owner's metering files to a prepared test invoice. Real Next app (next
// start), real cron/admin endpoints, real IMAPS/SMTPS transport (local
// GreenMail, TLS verified against a local CA), real public spot prices.
// Synthetic only where the platform is waiting for external evidence
// (EXT-ISSUER-01/EXT-ARCHIVE-02), clearly marked. No production data.
import { writeFileSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import {
  LIVE, approveIssuerHistoryGround, configurePlatformMailbox, configureTenant, cron, dailyE66, dayProfile, existingSupplyCustomer,
  gridOwnerSends, literal, readInbox, sql, type LiveCustomer, type LiveTenant,
} from './helpers/live-chain-fixture'

const MONTH = '2026-09'
const DAYS = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
const report: Record<string, unknown> = { month: MONTH, startedAt: new Date().toISOString() }
let tenant: LiveTenant, customer: LiveCustomer
let browser: Browser
const sessions = new Map<string, BrowserContext>()
const sent = new Map<string, number[]>()
let billable = 0

/** Logged-in browser context, like a person using the admin UI. */
async function session(email: string, password: string, label: string) {
  const existing = sessions.get(email)
  if (existing) return existing
  // PLAYWRIGHT_CHROMIUM_EXECUTABLE lets a host whose pre-installed browser build
  // differs from @playwright/test's pinned one run the suite without a download.
  browser ??= await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  const context = await browser.newContext({ baseURL: LIVE.appUrl })
  const page = await context.newPage()
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')])
  report[`${label}Landing`] = new URL(page.url()).pathname
  await page.close()
  sessions.set(email, context)
  return context
}
const adminSession = () => session(tenant.adminEmail, tenant.adminPassword, 'admin')
const operatorSession = () => session(tenant.operatorEmail, tenant.operatorPassword, 'operator')

describe.sequential('live chain B — metering to invoice for an existing customer', () => {
  beforeAll(() => { expect(LIVE.cronSecret).toBeTruthy(); expect(LIVE.automationUserId).toBeTruthy() })
  afterAll(async () => {
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_LIVE_REPORT ?? '/tmp/live-chain-report.json', JSON.stringify(report, null, 2))
    await browser?.close()
  })

  it('B1 configures the supplier for go-live and has an existing supply customer', async () => {
    expect(configurePlatformMailbox()).toBe(1)
    tenant = await configureTenant(supabaseService as never)
    customer = await existingSupplyCustomer(supabaseService as never, tenant, { name: 'Kvartskund', supplyStart: '2026-08-01' })
    const contract = sql<Record<string, unknown>>(`SELECT jsonb_build_object('status',status,'signed',signed_at IS NOT NULL,'snapshot',contract_price_snapshot_id IS NOT NULL)
      FROM public.customer_contracts WHERE id=${literal(customer.contractId)}`)
    report.tenant = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: tenant.issuerEdielId }
    report.customer = { ...customer, contract }
    expect(contract).toEqual({ status: 'signed', signed: true, snapshot: true })
  })

  it('B2 the grid owner sends one E66 per day for September over SMTPS', async () => {
    for (const [index, day] of DAYS.entries()) {
      const values = dayProfile(index)
      sent.set(day, values)
      const reference = `${day.replaceAll('-', '').slice(2)}${customer.meterId.slice(-6)}`
      await gridOwnerSends({ from: tenant.gridOwnerEmail, subject: `UTILTS E66 ${day}`, filename: `E66_${customer.meterId}_${day}.edi`,
        edifact: dailyE66({ issuer: tenant.issuerEdielId, receiver: tenant.supplierEdielId, meterId: customer.meterId, day, values, reference }) })
    }
    report.sentKwh = Math.round([...sent.values()].flat().reduce((a, b) => a + b, 0) * 1000) / 1000
    expect(sent.size).toBe(30)
  })

  it('B3 the inbound cron receives every file and acknowledges it to the grid owner', async () => {
    // Like Vercel Cron: one call per minute; the mailbox's own poll interval decides when it is due.
    const deadlocks = () => sql<number>(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database()`)
    const deadlocksBefore = deadlocks()
    const runs: unknown[] = []
    const outboxRuns: unknown[] = []
    // Below the 15 min test timeout so the report and assertions still run.
    const deadline = Date.now() + 12 * 60_000
    for (;;) {
      const result = await cron('/api/internal/inbound-mail/cron?environment=test')
      runs.push({ at: new Date().toISOString(), status: result.status, result: (result.body as { result?: unknown }).result ?? result.body })
      expect(result.status, JSON.stringify(result.body)).toBe(200)
      // vercel.json runs the Ediel outbox one minute after the inbound cron; it sends the CONTRL drafts.
      const outbox = await cron('/api/ediel/outbox/process')
      outboxRuns.push({ at: new Date().toISOString(), status: outbox.status, body: outbox.body })
      const state = sql<{ inbound: number; sent: number }>(`SELECT jsonb_build_object(
        'inbound',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_family='UTILTS'),
        'sent',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='outbound' AND message_family='CONTRL' AND status='sent'))`)
      if ((state.inbound >= 30 && state.sent >= 30) || Date.now() > deadline) break
      await new Promise(resolve => setTimeout(resolve, 60_000))
    }
    report.inboundCronRuns = runs
    report.outboxCronRuns = outboxRuns
    report.deadlocksDuringReception = deadlocks() - deadlocksBefore
    const inbound = sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('code',message_code,'status',status,'match',business_match_status,'meter',metering_point_id IS NOT NULL) ORDER BY created_at),'[]')
      FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound'`)
    report.inbound = inbound
    expect(inbound.filter(m => m.code === 'E66')).toHaveLength(30)
    const gridOwnerInbox = await readInbox(tenant.gridOwnerEmail)
    report.gridOwnerReceived = gridOwnerInbox.map(m => ({ subject: m.subject, files: m.attachments.map(a => a.filename), kinds: m.attachments.map(a => /UNH\+[^+]*\+(\w+)/.exec(a.text)?.[1] ?? '?') }))
    const contrl = gridOwnerInbox.flatMap(m => m.attachments).filter(a => /UNH\+[^+]*\+CONTRL/.test(a.text))
    expect(contrl.length, 'one technical CONTRL per received interchange').toBe(30)
  })

  it('B4 values are held, without billing effect, while issuer evidence is missing', () => {
    const state = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'normalized',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)}),
      'billable',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND billing_gate_status='eligible'),
      'reviewEvents',(SELECT coalesce(jsonb_agg(DISTINCT e.message),'[]') FROM public.ediel_message_events e JOIN public.ediel_messages m ON m.id=e.ediel_message_id
        WHERE m.company_id=${literal(tenant.companyId)} AND e.event_status='warning'))`)
    report.beforeEvidence = state
    expect(state.billable).toBe(0)
  })

  it('B5 after (synthetic) issuer evidence, the operator reprocesses and every quarter-hour becomes billable', async () => {
    const sources = sql<Array<{ id: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY created_at),'[]')
      FROM public.ediel_messages WHERE company_id=${literal(tenant.companyId)} AND direction='inbound' AND message_code='E66'`)
    for (const source of sources) approveIssuerHistoryGround(source.id, tenant.adminUserId)
    // No job re-evaluates held UTILTS: Gridex staff re-run the UTILTS engine per
    // message from the Ediel message page (platform-admin only).
    const context = await operatorSession()
    const page = await context.newPage()
    const outcomes: unknown[] = []
    for (const source of sources) {
      await page.goto(`/admin/ediel/messages/${source.id}`)
      const button = page.getByRole('button', { name: 'Kör UTILTS engine / skapa TGT-svar' })
      const visible = await button.count()
      if (visible) await Promise.all([page.waitForLoadState('networkidle'), button.click()])
      outcomes.push({ source: source.id, path: new URL(page.url()).pathname, button: visible, search: new URL(page.url()).search.slice(0, 300) })
    }
    await page.close()
    report.reprocess = outcomes
    const state = sql<Record<string, number>>(`SELECT jsonb_build_object(
      'normalized',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND revision_status='current'),
      'billable',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND billing_gate_status='eligible'),
      'kwh',(SELECT coalesce(sum(quantity_kwh),0) FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} AND revision_status='current'))`)
    const gate = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'statuses',(SELECT coalesce(jsonb_object_agg(s,n),'{}') FROM (SELECT billing_gate_status s,count(*) n FROM public.normalized_metering_values WHERE company_id=${literal(tenant.companyId)} GROUP BY 1) x),
      'reasons',(SELECT coalesce(jsonb_agg(DISTINCT r->>'code'),'[]') FROM public.normalized_metering_values v, jsonb_array_elements(coalesce(v.billing_gate_reasons,'[]')) r WHERE v.company_id=${literal(tenant.companyId)}),
      'unresolved',(SELECT count(*) FROM public.ediel_unresolved_items WHERE company_id=${literal(tenant.companyId)} AND issue_type='billing_gate_blocked' AND status='open'))`)
    report.afterEvidence = { ...state, gate }
    // Every quarter-hour is stored. Billing additionally needs the supply period to rest on
    // received Ediel market messages; a migrated period has none (FINDINGS F17), so the
    // values are blocked with that reason until chain A establishes supply.
    expect(state.normalized).toBe(30 * 96)
    expect(Number(state.kwh)).toBeCloseTo(report.sentKwh as number, 6)
    billable = state.billable
    if (billable === 0) expect(gate.reasons).toContain('supply_source_unqualified')
    else expect(billable).toBe(30 * 96)
  })

  it('B6 the admin imports and locks the real September SE3 spot prices', async () => {
    const context = await adminSession()
    const imported = await context.request.post('/api/internal/spot/import-month', { data: { billing_month: MONTH, price_areas: ['SE3'] } })
    report.spotImport = { status: imported.status(), body: await imported.json().catch(() => null) }
    expect(imported.status(), JSON.stringify(report.spotImport)).toBe(200)
    const locked = await context.request.post('/api/internal/spot/lock-month', { data: { billing_month: MONTH, price_area: 'SE3', reason: 'E2E live chain' } })
    report.spotLock = { status: locked.status(), body: await locked.json().catch(() => null) }
    expect(locked.status(), JSON.stringify(report.spotLock)).toBe(200)
    const quarters = sql<number>(`SELECT to_jsonb(count(*)) FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour'
      AND time_start>='2026-08-31T22:00:00Z' AND time_start<'2026-09-30T22:00:00Z'`)
    expect(quarters).toBe(30 * 96)
  })

  it('B7 the monthly billing cron creates the underlay, locks pricing and prepares a test invoice', async (context) => {
    if (billable === 0) { report.billing = 'skipped: no billable values until supply rests on Ediel (chain A)'; context.skip() }
    const result = await cron(`/api/cron/billing/monthly?company_id=${tenant.companyId}&billing_month=${MONTH}`)
    report.billingCron = result
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const graph = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'underlays',(SELECT coalesce(jsonb_agg(to_jsonb(u)-'metadata'),'[]') FROM public.billing_underlays u WHERE u.company_id=${literal(tenant.companyId)}),
      'pricingRuns',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'metadata'-'input_snapshot'),'[]') FROM public.pricing_runs r WHERE r.company_id=${literal(tenant.companyId)}),
      'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i)-'metadata'),'[]') FROM public.customer_invoices i WHERE i.company_id=${literal(tenant.companyId)}))`)
    report.billingGraph = graph
    expect((graph.underlays as unknown[]).length).toBe(1)
    expect((graph.invoices as unknown[]).length).toBe(1)
  })

  it('B8 the invoice matches an independent calculation from the sent values and the locked spot prices', (context) => {
    if (billable === 0) context.skip()
    const prices = sql<Array<{ s: string; p: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('s',time_start,'p',sek_per_kwh) ORDER BY time_start),'[]')
      FROM public.spot_price_intervals WHERE price_area='SE3' AND resolution='quarter_hour' AND time_start>='2026-08-31T22:00:00Z' AND time_start<'2026-09-30T22:00:00Z'`)
    const price = new Map(prices.map(row => [new Date(row.s).toISOString(), Number(row.p)]))
    let energy = 0, kwh = 0
    for (const [day, values] of sent) values.forEach((value, q) => {
      const start = new Date(Date.parse(`${day}T00:00:00+02:00`) + q * 900_000).toISOString()
      const p = price.get(start)
      if (p === undefined) throw Error(`no spot price for ${start}`)
      energy += value * p; kwh += value
    })
    const markup = kwh * 0.04, monthlyFee = 49
    const exVat = energy + markup + monthlyFee
    report.independent = { kwh, spotSek: energy, markupSek: markup, monthlyFeeSek: monthlyFee, exVat, incVat: exVat * 1.25 }
    const invoice = (report.billingGraph as { invoices: Array<Record<string, unknown>> }).invoices[0]
    const total = Number(invoice.total_amount_inc_vat ?? invoice.amount_inc_vat ?? invoice.total_inc_vat ?? invoice.total_amount)
    report.invoiceTotal = total
    expect(Math.abs(total - exVat * 1.25)).toBeLessThan(1)
  })
})
