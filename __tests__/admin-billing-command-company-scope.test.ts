import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  access: vi.fn(), pageAccess: vi.fn(), membershipScope: vi.fn(), lifecycle: vi.fn(),
  companyRead: vi.fn(), prepare: vi.fn(), approve: vi.fn(), path: vi.fn(), unexpectedRead: vi.fn(),
  readIntent: vi.fn(), readFrozen: vi.fn(), createFile: vi.fn(), recover: vi.fn(), revalidate: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: fixture.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: (target: string) => { throw new Error(target) },
  unstable_rethrow: () => {},
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: fixture.access,
  requireAdminPageKeyAccess: fixture.pageAccess,
  isPlatformAdminContext: (access: { isPlatformAdmin?: boolean }) => access.isPlatformAdmin === true,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: fixture.membershipScope,
  requireOperationalCompanyId: async () => (await fixture.membershipScope()).companyId,
  TenantCompanyRequiredError: Error,
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: fixture.lifecycle }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    from: () => ({ select: () => ({ eq: fixture.companyRead }) }),
  }),
}))
vi.mock('@/lib/billing/providers/registry', async original => ({
  ...await original<typeof import('@/lib/billing/providers/registry')>(),
  loadTenantInvoiceProviderSelection: fixture.path,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: fixture.unexpectedRead },
}))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: fixture.pageAccess }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentOperationalAction: async () => true }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('@/app/admin/billing/ConsolidatedInvoiceReview', () => ({ default: () => null }))
vi.mock('@/lib/billing/readInvoiceEdielReview', () => ({ readInvoiceEdielReviewSources: async () => null }))
vi.mock('@/lib/billing/invoiceReviewData', () => ({
  invoiceReviewActivePath: () => null,
  listInvoiceReviewRows: async () => [{
    underlayId: 'underlay-a', customerId: 'customer-a', customerName: 'Syntetisk kund',
    status: 'ready_for_review', amountIncVat: 33, totalKwh: 10, statusLabel: 'Klar för granskning',
  }],
}))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: fixture.prepare }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({ approveAndSendReadyInvoicesForMonth: fixture.approve }))
vi.mock('@/lib/billing/consolidatedInvoiceAdmin', () => ({}))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  createInvoiceFile: fixture.createFile,
  readFrozenInvoiceFileIntent: fixture.readFrozen,
  listInvoiceFiles: async () => [],
}))
vi.mock('@/lib/billing/invoiceFileIntentToken', () => ({
  readSignedInvoiceFileIntent: fixture.readIntent,
  signInvoiceFileMonthLockNotice: vi.fn(),
}))
vi.mock('@/lib/billing/invoiceFileReplayRecovery', () => ({
  isInvoiceFileRecoveryId: () => false,
  recoverInvoiceFileReceipt: fixture.recover,
}))

import { approveAndSendReadyInvoicesAction } from '@/app/admin/billing/actions'
import BillingPage from '@/app/admin/billing/page'
import { submitInvoiceFile } from '@/app/admin/billing/invoice-files/submit'

const exportPermission = 'billing_underlay.export'
const month = '2026-10'
const context = (companyId: string | null, isPlatformAdmin = false, permissions = [exportPermission]) => ({
  companyId, userId: 'actor', roles: [], isPlatformAdmin, permissions,
})
const request = () => {
  const data = new FormData()
  data.set('billing_month', month)
  data.set('export_intent_v2', 'fixture-signed-v2')
  return data
}
const approvalRequest = (companyId = 'company-a', actorUserId = 'actor') => {
  const data = request()
  data.set('expected_company_id', companyId)
  data.set('expected_actor_user_id', actorUserId)
  data.set('expected_provider', 'file_export')
  data.set('expected_environment', 'test')
  return data
}
const providerPath = (provider = 'file_export', environment = 'test') => ({
  invoice_export_target_system: provider, billing_provider_environment: environment, invoice_export_enabled: false,
})
const setContext = (selected: ReturnType<typeof context>) => {
  fixture.pageAccess.mockResolvedValue(selected)
  fixture.access.mockImplementation(async (requirement: string[]) => {
    expect(requirement).toEqual([exportPermission])
    if (!selected.isPlatformAdmin && !selected.permissions.includes(exportPermission)) throw new Error('Forbidden')
    return selected
  })
}
const fileIntent = (companyId: string) => ({
  companyId, actorUserId: 'actor', billingMonth: month, intentId: 'intent-a', scope: { selectedRows: ['frozen-a'] },
})

beforeEach(() => {
  vi.resetAllMocks()
  setContext(context('company-a'))
  fixture.membershipScope.mockResolvedValue({ companyId: 'company-b' })
  fixture.companyRead.mockReturnValue({ maybeSingle: async () => ({ data: providerPath(), error: null }) })
  fixture.path.mockResolvedValue(providerPath())
  fixture.unexpectedRead.mockImplementation(() => { throw new Error('Unexpected effect read in test') })
  fixture.approve.mockResolvedValue({ approved: 1, sent: 0, failed: 0, approveOnly: true })
  fixture.readIntent.mockReturnValue(fileIntent('company-a'))
  fixture.readFrozen.mockResolvedValue(null)
  fixture.createFile.mockResolvedValue({ fileId: 'file-a' })
})

it.each([
  ['an entitled tenant in A', 'company-a', false],
  ['an entitled tenant in B', 'company-b', false],
  ['the platform-selected company A', 'company-a', true],
])('prepares and approves only in %s', async (_, companyId, platform) => {
  setContext(context(companyId, platform, platform ? [] : [exportPermission]))
  await expect(approveAndSendReadyInvoicesAction(approvalRequest(companyId))).rejects.toThrow('mode=file')
  expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId, actorUserId: 'actor', billingMonth: month }))
  expect(fixture.approve).toHaveBeenCalledExactlyOnceWith({ companyId, actorUserId: 'actor', billingMonth: month, expectedPath: { provider: 'file_export', environment: 'test' } })
  expect(fixture.lifecycle).toHaveBeenCalledWith(companyId)
  expect(fixture.companyRead).toHaveBeenCalledWith('id', companyId)
  expect(fixture.membershipScope).not.toHaveBeenCalled()
})

it('reports file approval lock retries separately without forwarding diagnostics', async () => {
  fixture.approve.mockResolvedValueOnce({
    approved: 1, sent: 0, failed: 1, approvalBusy: 2, approveOnly: true,
    errors: [{ invoiceExportItemId: 'private-export-item', error: 'private-sql-detail' }],
  })
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow(
    new Error('/admin/billing?month=2026-10&sent=0&failed=1&approved=1&mode=file&approval_busy=2'),
  )
})

it.each([false, true])('separates price review, transient retry, and provider review in the redirect with file mode=%s', async approveOnly => {
  fixture.approve.mockResolvedValueOnce({
    approved: 1, sent: 0, failed: 1, approvalBusy: 2, approvalPriceReview: 3, approvalProviderReview: 1, approveOnly,
    errors: [{ invoiceExportItemId: 'private-export-item', error: 'private-sql-detail' }],
  })
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow(
    new Error('/admin/billing?month=2026-10&sent=0&failed=1&approved=1' +
      (approveOnly ? '&mode=file' : '') + '&approval_busy=2&approval_price_review=3&approval_provider_review=1'),
  )
})

it('does not prepare or approve for a reader, an unselected platform, or a paused selected company', async () => {
  setContext(context('company-a', false, ['billing_underlay.read']))
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow('Forbidden')
  setContext(context(null, true, []))
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow('Välj ett bolag')
  setContext(context('company-a', true, []))
  fixture.lifecycle.mockRejectedValue(new Error('Pausat bolag'))
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow('Pausat bolag')
  expect(fixture.companyRead).not.toHaveBeenCalled()
  expect(fixture.prepare).not.toHaveBeenCalled()
  expect(fixture.approve).not.toHaveBeenCalled()
})

const staleRedirect = '/admin/billing?month=2026-10&approval_scope_changed=1'

it('carries the rendered company, authenticated actor and configured path in the ordinary forward-only form', async () => {
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({ month, approval_scope_changed: '1' }) }))
  expect(html).toContain('Godkänn 1 klara fakturor')
  expect(html).toContain('Bolagsvalet, inloggningen eller fakturavägen har ändrats.')
  expect(html).toContain('name="expected_company_id" value="company-a"')
  expect(html).toContain('name="expected_actor_user_id" value="actor"')
  expect(html).toContain('name="expected_provider" value="file_export"')
  expect(html).toContain('name="expected_environment" value="test"')
})

it.each(['other company', 'other actor', 'missing field', 'duplicate field'])('blocks %s before any operation on the newly selected scope', async reason => {
  const data = approvalRequest()
  if (reason === 'other company') setContext(context('company-b', true))
  if (reason === 'other actor') setContext({ ...context('company-a'), userId: 'new-actor' })
  if (reason === 'missing field') data.delete('expected_company_id')
  if (reason === 'duplicate field') data.append('expected_actor_user_id', 'actor')

  await expect(approveAndSendReadyInvoicesAction(data)).rejects.toThrow(new Error(staleRedirect))
  expect(fixture.lifecycle).not.toHaveBeenCalled()
  expect(fixture.companyRead).not.toHaveBeenCalled()
  expect(fixture.prepare).not.toHaveBeenCalled()
  expect(fixture.approve).not.toHaveBeenCalled()
})

it.each([
  ['capway_aptic', 'test'],
  ['file_export', 'production'],
])('blocks displayed file mode before preparing on newly configured %s and %s', async (provider, environment) => {
  fixture.companyRead.mockReturnValue({ maybeSingle: async () => ({ data: providerPath(provider, environment), error: null }) })
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow(new Error(staleRedirect))
  expect(fixture.prepare).not.toHaveBeenCalled()
  expect(fixture.approve).not.toHaveBeenCalled()
})

it('checks the chosen path again inside the actual batch delegate after draft preparation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/invoiceApprovedDispatch')>('@/lib/billing/invoiceApprovedDispatch')
  fixture.prepare.mockImplementation(async () => { fixture.path.mockResolvedValue(providerPath('capway_aptic')) })
  fixture.approve.mockImplementation(actual.approveAndSendReadyInvoicesForMonth)
  await expect(approveAndSendReadyInvoicesAction(approvalRequest())).rejects.toThrow(new Error(staleRedirect))
  expect(fixture.prepare).toHaveBeenCalledOnce()
  expect(fixture.path).toHaveBeenCalledExactlyOnceWith('company-a')
  expect(fixture.unexpectedRead).not.toHaveBeenCalled()
})

it.each([
  ['company-a', false], ['company-b', false], ['company-a', true],
])('creates the exact signed selection for %s with platform=%s', async (companyId, platform) => {
  setContext(context(companyId, platform))
  fixture.readIntent.mockReturnValue(fileIntent(companyId))
  await expect(submitInvoiceFile(request())).resolves.toBe('/admin/billing?month=2026-10&file=file-a')
  const input = { companyId, actorUserId: 'actor', billingMonth: month, exportIntentId: 'intent-a', exportIntentScope: fileIntent(companyId).scope }
  expect(fixture.readFrozen).toHaveBeenCalledExactlyOnceWith(input)
  expect(fixture.createFile).toHaveBeenCalledExactlyOnceWith(input)
  expect(fixture.membershipScope).not.toHaveBeenCalled()
})

it('denies a reader, a missing selection, a foreign token, and a changed action scope before creating a file', async () => {
  setContext(context('company-a', false, ['billing_underlay.read']))
  await expect(submitInvoiceFile(request())).rejects.toThrow('Forbidden')
  setContext(context('company-a', true, []))
  await expect(submitInvoiceFile(request())).rejects.toThrow('Forbidden')
  setContext(context(null, true))
  await expect(submitInvoiceFile(request())).resolves.toContain('invoice_file_intent_scope_mismatch')
  setContext(context('company-b', true))
  await expect(submitInvoiceFile(request())).resolves.toContain('invoice_file_intent_scope_mismatch')
  setContext(context('company-a', true))
  fixture.access.mockResolvedValueOnce(context('company-b', true))
  await expect(submitInvoiceFile(request())).resolves.toContain('invoice_file_intent_scope_mismatch')
  expect(fixture.createFile).not.toHaveBeenCalled()
})

it('replays the already stored file without entering the writer or lifecycle gate', async () => {
  setContext(context('company-a', true))
  fixture.readFrozen.mockResolvedValue({ fileId: 'prior-file-a' })
  await expect(submitInvoiceFile(request())).resolves.toBe('/admin/billing?month=2026-10&file=prior-file-a')
  expect(fixture.access).not.toHaveBeenCalled()
  expect(fixture.createFile).not.toHaveBeenCalled()
  expect(fixture.lifecycle).not.toHaveBeenCalled()
  expect(fixture.revalidate).not.toHaveBeenCalled()
})
