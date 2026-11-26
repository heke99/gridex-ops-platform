import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const scope = vi.hoisted(() => ({ canExport: true, company: 'company-a', table: {} as Record<string, Record<string, unknown>[]> }))
const access = () => ({ companyId: scope.company, permissions: ['billing_underlay.read', 'customers.read'], roles: [], isPlatformAdmin: false })
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => access(), isPlatformAdminContext: () => false }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: async () => access() }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: scope.company }), resolveAdminTenantReadScope: async () => ({ companyId: scope.company, isPlatformAdmin: false }) }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentOperationalAction: async () => scope.canExport }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string, children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/billing/ConsolidatedInvoiceReview', () => ({ default: () => null }))
vi.mock('@/app/admin/billing/actions', () => ({ approveAndSendReadyInvoicesAction: vi.fn() }))
vi.mock('@/lib/billing/invoiceFileExport', () => ({ listInvoiceFiles: vi.fn(), loadInvoiceFileReceipt: vi.fn(), loadInvoiceFilePeriodReconciliation: vi.fn(), previewInvoiceFileGroups: vi.fn(), previewInvoiceFileSelection: vi.fn() }))
vi.mock('@/lib/billing/invoiceFileReconciliation', () => ({ loadInvoiceFileEffects: vi.fn() }))
vi.mock('@/lib/billing/providers/registry', () => ({ isDispatchImplemented: () => false, isFileProvider: () => false, loadTenantInvoiceProviderSelection: async () => null, InvoiceProviderConfigError: Error }))
vi.mock('@/lib/pricing/adminData', () => ({ readBillingRows: async () => [] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: tableQuery } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc: async (name: string, input: { p_company_id: string, p_segment: string }) => {
  expect(name).toBe('gridex_customer_segments_page_v1')
  expect(input).toMatchObject({ p_company_id: scope.company, p_segment: 'switch' })
  return { data: { rows: scope.table.customers.filter(customer => customer.id === 'customer-b'), page: 1, counts: { all: 2, signed: 0, pending_activation: 0, move: 0, switch: 1 } }, error: null }
}, auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) } }) }))
vi.mock('@/lib/customers/getCustomers', () => ({ getCustomers: async ({ companyId }: { companyId: string }) => scope.table.customers.filter(customer => customer.company_id === companyId) }))

function tableQuery(table: string) {
  let rows = scope.table[table] ?? []
  const result = () => ({ data: rows, error: null })
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { rows = rows.filter(row => row[field] === value); return query },
    in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[field])); return query },
    order: () => query,
    limit: (limit: number) => { rows = rows.slice(0, limit); return query },
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query },
    single: async () => ({ data: rows[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return query
}

import BillingPage from '@/app/admin/billing/page'
import InvoicePage from '@/app/admin/billing/invoices/[id]/page'
import SegmentsPage from '@/app/admin/customers/segments/page'

it('shows approved calculation and failed export on the same invoice without resending it, beside the server-projected segment count', async () => {
  const target = { id: 'invoice-item-a', company_id: 'company-a', customer_id: 'customer-a', customer_contract_id: 'contract-a', billing_underlay_id: 'underlay-a', pricing_run_id: 'pricing-a', status: 'failed', error_payload: { reason: 'provider-diagnostic' }, metadata: { approval: { status: 'approved', approved_by: 'approver-a', approved_at: '2026-10-31T09:00:00Z', review_hash: 'original-review-hash' } } }
  scope.table = {
    billing_underlays: [{ id: 'underlay-a', company_id: 'company-a', customer_id: 'customer-a', customer_contract_id: 'contract-a', status: 'validated', readiness_status: 'ready', underlay_year: 2026, underlay_month: 10, billing_period_start: '2026-10-01', total_kwh: 1200 }],
    invoice_export_items: [target, { ...target, company_id: 'company-b', id: 'foreign-item' }],
    customer_invoices: [{ id: 'invoice-a', company_id: 'company-a', invoice_export_item_id: target.id, status: 'draft', amount_inc_vat: 1500, invoice_reference: 'FA-ARK05-A' }],
    customers: [{ id: 'customer-a', company_id: 'company-a', name: 'Kund Alfa', full_name: 'Kund Alfa', first_name: 'Kund', last_name: 'Alfa' }, { id: 'customer-b', company_id: 'company-a', full_name: 'Kund Beta', created_at: '2026-10-01T00:00:00Z' }],
    customer_contracts: [{ id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a', contract_name: 'Syntetiskt elavtal' }],
    customer_sites: [{ id: 'site-a', company_id: 'company-a', customer_id: 'customer-a', status: 'active' }],
    supplier_switch_requests: [{ id: 'terminal-a', company_id: 'company-a', customer_id: 'customer-a', status: 'cancelled_before_start', request_type: 'switch' }, { id: 'active-b', company_id: 'company-a', customer_id: 'customer-b', status: 'submitted', request_type: 'switch' }],
    pricing_runs: [{ id: 'pricing-a', company_id: 'company-a', status: 'locked' }],
  }
  const segment = renderToStaticMarkup(await SegmentsPage({ searchParams: Promise.resolve({ segment: 'switch' }) }))
  expect(segment).toContain('Byte (1)')
  expect(segment).toContain('Kund Beta')
  expect(segment).not.toContain('Kund Alfa')
  const detail = renderToStaticMarkup(await InvoicePage({ params: Promise.resolve({ id: target.id }) }))
  expect(detail).toContain('FA-ARK05-A')
  expect(detail).toContain('Godkänd')
  expect(detail).toContain('Överföringen kräver åtgärd')
  expect(detail).not.toContain('provider-diagnostic')
  const billing = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({ month: '2026-10' }) }))
  expect(billing).toContain(`/admin/billing/invoices/${target.id}`)
  expect(billing).toMatch(/>Godkända beräkningar<\/p><p[^>]*>1<\/p>/)
  expect(billing).toMatch(/>Flaggade<\/p><p[^>]*>1<\/p>/)
  expect(billing).toContain('Granskning: Godkänd')
  expect(billing).toContain('Överföringen kräver åtgärd')
  expect(billing).not.toContain('Godkänn och skicka 1 klara fakturor')
  expect(billing).not.toContain('foreign-item')
  expect(scope.table.invoice_export_items[0].metadata).toEqual(target.metadata)
})
