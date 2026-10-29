// BILLNEG01.02: typed contention result crosses the actual action redirect and
// server-page presentation boundary. Auth/data/navigation are synthetic ports;
// this SSR test is not a browser or native PostgreSQL concurrency proof.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ServiceError = { invoiceExportItemId: string; error: string; errorCode?: string }
const io = vi.hoisted(() => ({
  result: { approved: 0, sent: 0, failed: 1, approveOnly: true, dispatchEnabled: false, errors: [] as ServiceError[] },
  user: { id: 'synthetic-actor', email: 'synthetic@example.test' } as { id: string; email: string } | null,
  companyId: 'synthetic-company' as string | null,
  order: [] as string[], companyFilters: [] as Array<[string, unknown]>,
  guard: vi.fn(), prepare: vi.fn(), approve: vi.fn(), scope: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: (target: string): never => { io.order.push('redirect'); io.redirect(target); throw new Error('synthetic-redirect') } }))
vi.mock('next/cache', () => ({ revalidatePath: (target: string) => { io.order.push(`revalidate:${target}`); io.revalidate(target) } }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => React.createElement('header', null, 'Synthetic admin header') }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async (permissions: string[]) => { io.order.push('guard'); return io.guard(permissions) } }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: async () => ({ userId: 'synthetic-actor' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: io.companyId }) }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async (actor: string) => { io.order.push('scope'); io.scope(actor); return io.companyId } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => { io.order.push('auth'); return { data: { user: io.user }, error: null } } },
  from: (table: string) => {
    if (table !== 'companies') throw new Error(`Unexpected table ${table}`)
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { io.companyFilters.push([key, value]); return query },
      maybeSingle: async () => { io.order.push('company'); return { data: { billing_provider_environment: 'test', invoice_export_target_system: 'nordfin' }, error: null } },
    }
    return query
  },
}) }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: async (input: unknown) => { io.order.push('prepare'); return io.prepare(input) } }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({ approveAndSendReadyInvoicesForMonth: async (input: unknown) => { io.order.push('approve'); io.approve(input); return io.result } }))
vi.mock('@/lib/billing/providers/registry', () => ({
  requireTenantInvoiceProvider: () => ({ environment: 'test', provider: 'nordfin' }),
  loadTenantInvoiceProviderSelection: async () => null,
  isFileProvider: () => false,
}))
vi.mock('@/lib/billing/invoiceReviewData', () => ({ listInvoiceReviewRows: async () => [] }))
vi.mock('@/lib/billing/invoiceFileExport', () => ({ listInvoiceFileCandidates: async () => [], listInvoiceFiles: async () => [] }))
vi.mock('@/app/admin/billing/invoice-files/actions', () => ({ createInvoiceFileAction: vi.fn() }))

import { approveAndSendReadyInvoicesAction } from '@/app/admin/billing/actions'
import AdminBillingPage from '@/app/admin/billing/page'

function form() { const data = new FormData(); data.set('billing_month', '2026-09'); return data }
async function actionUrl() {
  await expect(approveAndSendReadyInvoicesAction(form())).rejects.toThrow('synthetic-redirect')
  return new URL(io.redirect.mock.calls.at(-1)![0] as string, 'https://local.test')
}
const message = 'En annan körning godkänner redan fakturan. Försök igen om en stund.'
beforeEach(() => {
  vi.clearAllMocks()
  io.guard.mockReset(); io.guard.mockResolvedValue(undefined)
  io.result = { approved: 0, sent: 0, failed: 1, approveOnly: true, dispatchEnabled: false, errors: [] }
  io.user = { id: 'synthetic-actor', email: 'synthetic@example.test' }
  io.companyId = 'synthetic-company'; io.order = []; io.companyFilters = []
})

describe('approval contention feedback', () => {
  it('redirects with only the controlled busy code and preserves authenticated tenant/month flow', async () => {
    io.result.errors = [{ invoiceExportItemId: 'synthetic-item', error: 'raw private backend details must never be reflected', errorCode: 'invoice_approval_busy' }]
    const url = await actionUrl()
    expect(url.pathname).toBe('/admin/billing')
    expect(Object.fromEntries(url.searchParams)).toEqual({ month: '2026-09', sent: '0', failed: '1', approved: '0', mode: 'approve_only', approval_error: 'busy' })
    expect(url.href).not.toContain('raw'); expect(url.href).not.toContain('private')
    expect(io.guard).toHaveBeenCalledWith(['billing_underlay.export'])
    expect(io.scope).toHaveBeenCalledWith('synthetic-actor')
    expect(io.companyFilters).toEqual([['id', 'synthetic-company']])
    expect(io.prepare).toHaveBeenCalledWith({ companyId: 'synthetic-company', billingMonth: '2026-09', environment: 'test', provider: 'nordfin', actorUserId: 'synthetic-actor' })
    expect(io.approve).toHaveBeenCalledWith({ companyId: 'synthetic-company', billingMonth: '2026-09', actorUserId: 'synthetic-actor' })
    expect(io.order).toEqual(['guard', 'auth', 'scope', 'company', 'prepare', 'approve', 'revalidate:/admin/billing', 'revalidate:/admin/customers', 'redirect'])
  })
  it('does not reflect untyped backend text or unknown codes and retains file dispatch mode', async () => {
    io.result.dispatchEnabled = true
    io.result.errors = [{ invoiceExportItemId: 'synthetic-item', error: '<script>private</script>', errorCode: 'invoice_review_approval_already_running' }]
    const url = await actionUrl()
    expect(url.searchParams.get('approval_error')).toBeNull()
    expect(url.searchParams.get('mode')).toBe('file')
    expect(url.href).not.toContain('script'); expect(url.href).not.toContain('private')
  })
  it('does not infer a busy condition from a raw message alone', async () => {
    io.result.errors = [{ invoiceExportItemId: 'synthetic-item', error: 'invoice_approval_busy' }]
    expect((await actionUrl()).searchParams.get('approval_error')).toBeNull()
  })
  it('keeps authorization before all business calls', async () => {
    io.guard.mockRejectedValue(new Error('synthetic denied'))
    await expect(approveAndSendReadyInvoicesAction(form())).rejects.toThrow('synthetic denied')
    expect(io.order).toEqual(['guard']); expect(io.prepare).not.toHaveBeenCalled(); expect(io.approve).not.toHaveBeenCalled(); expect(io.redirect).not.toHaveBeenCalled()
  })
  it('keeps authentication before tenant and business calls', async () => {
    io.user = null
    await expect(approveAndSendReadyInvoicesAction(form())).rejects.toThrow('Du måste vara inloggad.')
    expect(io.scope).not.toHaveBeenCalled(); expect(io.prepare).not.toHaveBeenCalled(); expect(io.approve).not.toHaveBeenCalled()
  })
  it('renders the fixed retry guidance from the actual server page for the known code', async () => {
    const html = renderToStaticMarkup(await AdminBillingPage({ searchParams: Promise.resolve({ month: '2026-09', failed: '1', approval_error: 'busy' }) }))
    expect(html).toContain(message)
    expect(html).toContain('role="alert"')
  })
  it('does not render an unknown query value as backend error content', async () => {
    const html = renderToStaticMarkup(await AdminBillingPage({ searchParams: Promise.resolve({ month: '2026-09', failed: '1', approval_error: '<script>private-backend-token</script>' }) }))
    expect(html).not.toContain(message)
    expect(html).not.toContain('private-backend-token')
    expect(html).not.toContain('&lt;script&gt;')
  })
  it('does not show a tenant-operation error when no tenant has been selected', async () => {
    io.companyId = null
    const html = renderToStaticMarkup(await AdminBillingPage({ searchParams: Promise.resolve({ month: '2026-09', approval_error: 'busy' }) }))
    expect(html).not.toContain(message)
    expect(html).toContain('Välj en tenant')
  })
})
