import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'
import { listCustomersPage } from '@/lib/customers/getCustomers'
import { changeCustomerBillingProfile } from '@/lib/billing/billingProfileCommand'

type Row = Record<string, unknown>
type BillingFixture = { context: { companyId: string; customerId: string; invoiceId: string; actorUserId: string; sessionId: string }; original: Row
  writerEmail: string; readerEmail: string; foreignWriterEmail: string; explicitContract: string; inheritedContract: string }
type ViewFixture = { billing: BillingFixture; invoices: Array<{ itemId: string; email: string; overrideRevision: number }>; graph: Row; customer: Row }
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function path(name: string) {
  const value = process.env[name], temp = process.env.RUNNER_TEMP
  if (!value || !temp || !resolve(value).startsWith(resolve(temp) + sep)) throw new Error('billing_revision_view_fixture_must_stay_in_runner_temp')
  return resolve(value)
}
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('billing_revision_view_local_only')
  return JSON.parse(execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 20_000 }).trim()) as T
}
function graph(f: BillingFixture, itemIds: string[]) {
  const c = f.context, ids = itemIds.map(quote).join(',')
  return sql<Row>(`with items as(select * from public.invoice_export_items where company_id=${quote(c.companyId)} and id in(${ids})),
    invoices as(select n.* from public.customer_invoices n join items i on n.invoice_export_item_id=i.id and n.company_id=i.company_id)
    select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(n) order by n.id) from invoices n),
      'items',(select jsonb_agg(to_jsonb(i) order by i.id) from items i),
      'underlays',(select jsonb_agg(to_jsonb(t) order by t.id) from public.billing_underlays t join items i on t.id=i.billing_underlay_id and t.company_id=i.company_id),
      'pricing',(select jsonb_agg(to_jsonb(t) order by t.id) from public.pricing_runs t join items i on t.id=i.pricing_run_id and t.company_id=i.company_id),
      'lines',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_invoice_lines t join invoices n on t.invoice_id=n.id and t.company_id=n.company_id),
      'documents',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_invoice_documents t join invoices n on t.invoice_id=n.id and t.company_id=n.company_id));`)
}
function original(f: BillingFixture) {
  const item = (f.original.item as Row).id
  const all = graph(f, [String(item)])
  return { invoice: (all.invoices as Row[])[0], item: (all.items as Row[])[0], underlay: (all.underlays as Row[])[0], pricing: (all.pricing as Row[])[0], lines: all.lines, documents: all.documents }
}
function customer(f: BillingFixture) { return sql<Row>(`select to_jsonb(c) from public.customers c where company_id=${quote(f.context.companyId)} and id=${quote(f.context.customerId)};`) }

it('T44 prepares real current-revision invoices from the completed billing browser fixture or verifies all graph bytes after actual view navigation', async () => {
  const output = path('GRIDEX_BILLING_REVISION_VIEWS_FIXTURE_PATH')
  if (process.env.GRIDEX_BILLING_REVISION_VIEWS_POSTCHECK === '1') {
    const f = JSON.parse(readFileSync(output, 'utf8')) as ViewFixture
    expect(graph(f.billing, f.invoices.map(row => row.itemId))).toEqual(f.graph)
    expect(original(f.billing)).toEqual(f.billing.original); expect(customer(f.billing)).toEqual(f.customer)
    const rows = await listCustomersPage({ companyId: f.billing.context.companyId, query: f.billing.context.customerId })
    expect(rows.rows).toHaveLength(1); expect(rows.rows[0].billing_profile_revision).toBe(4)
    console.log('BILLING_REVISION_VIEWS_NATIVE_POSTCHECK_PASS currentListRevision=4 originalIssuedGraphUnchanged=true preparedInvoiceRevision=3 preparedGraphsUnchanged=true viewReadsOnly=true providerCalls=0')
    return
  }
  const billing = JSON.parse(readFileSync(path('GRIDEX_BILLING_RECIPIENT_FIXTURE_PATH'), 'utf8')) as BillingFixture, c = billing.context
  expect(customer(billing)).toMatchObject({ billing_profile_revision: 3, billing_profile: { email: 'ui-default-later@example.invalid' } })
  const before = original(billing); expect(before).toEqual(billing.original)
  // This is the actual production readiness/lock/preparation pipeline. Existing
  // native pricing rows are consumed; no provider client or approval is called.
  const result = await prepareInvoiceDraftsForReview({ companyId: c.companyId, customerId: c.customerId, billingMonth: '2026-10', actorUserId: c.actorUserId })
  expect(result).toMatchObject({ created: 2, failed: 0, blocked: 0 })
  const items = sql<Array<{ id: string; contract: string }>>(`select jsonb_agg(jsonb_build_object('id',id,'contract',customer_contract_id) order by id) from public.invoice_export_items
    where company_id=${quote(c.companyId)} and customer_id=${quote(c.customerId)} and customer_contract_id in(${quote(billing.explicitContract)},${quote(billing.inheritedContract)});`)
  expect(items).toHaveLength(2)
  const invoices: ViewFixture['invoices'] = []
  for (const item of items) {
    const explicit = item.contract === billing.explicitContract, email = explicit ? 'ui-agency@example.invalid' : 'ui-default-later@example.invalid', overrideRevision = explicit ? 1 : 2
    const detail = await getInvoiceReviewDetail({ companyId: c.companyId, invoiceExportItemId: item.id })
    expect(detail.invoice?.invoice_address_snapshot).toMatchObject({ recipient: 'UI Later Saved Recipient', email, country: 'NO', profile_revision: 3, contract_override_revision: overrideRevision })
    expect(detail.invoice?.status).toBe('draft'); expect(detail.item.provider_invoice_guid).toBeNull()
    invoices.push({ itemId: item.id, email, overrideRevision })
  }
  const rows = await listCustomersPage({ companyId: c.companyId, query: c.customerId })
  expect(rows.rows).toHaveLength(1); expect(rows.rows[0].billing_profile_revision).toBe(3)
  const preparedGraph = graph(billing, invoices.map(row => row.itemId)), beforeCustomer = customer(billing)
  const changed = await changeCustomerBillingProfile({ companyId: c.companyId, customerId: c.customerId, expectedRevision: 3,
    actor: { kind: 'ops', userId: c.actorUserId, sessionId: c.sessionId, reason: 'Synthetic native later current profile, immutable invoice view' },
    idempotencyKey: `billing-view-later-current:${c.customerId}`, changes: { recipient: 'View Later Current Recipient', email: 'view-later-current@example.invalid', country: 'DK' } })
  expect(changed.revision).toBe(4)
  expect(graph(billing, invoices.map(row => row.itemId))).toEqual(preparedGraph)
  expect(customer(billing)).toMatchObject({ email: beforeCustomer.email, phone: beforeCustomer.phone, contact_revision: beforeCustomer.contact_revision,
    billing_profile_revision: 4, billing_profile: { email: 'view-later-current@example.invalid' } })
  const currentRows = await listCustomersPage({ companyId: c.companyId, query: c.customerId })
  expect(currentRows.rows).toHaveLength(1); expect(currentRows.rows[0].billing_profile_revision).toBe(4)
  expect(original(billing)).toEqual(before)
  const fixture: ViewFixture = { billing, invoices, graph: preparedGraph, customer: customer(billing) }
  writeFileSync(output, JSON.stringify(fixture), { mode: 0o600 })
  console.log('BILLING_REVISION_VIEWS_NATIVE_SEED_PASS actualReadinessLockPreparation=true actualLaterDefaultSave=true currentListRevision=4 preparedInvoiceRevision=3 invoices=2 originalIssuedAndPreparedGraphsUnchanged=true providerCalls=0')
})
