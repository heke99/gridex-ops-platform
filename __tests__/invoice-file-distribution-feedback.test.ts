import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Synthetic component controls only: no genuine Auth, database or original scenario receipt.
const ports = vi.hoisted(() => ({
  createFile: vi.fn(),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`) }),
  requireAction: vi.fn(async () => undefined),
}))
vi.mock('next/navigation', () => ({ redirect: ports.redirect, unstable_rethrow: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentOperationalAction: vi.fn(async () => true) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: ports.requireAction }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: vi.fn(async () => ({ userId: 'actor-delivery' })) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: vi.fn(async () => ({ companyId: 'company-delivery' })) }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: vi.fn(async () => 'company-delivery') }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'actor-delivery', email: 'synthetic@example.invalid' } } })) },
})) }))
vi.mock('@/lib/billing/invoiceReviewData', () => ({ listInvoiceReviewRows: vi.fn(async () => []) }))
vi.mock('@/app/admin/billing/actions', () => ({ approveAndSendReadyInvoicesAction: vi.fn() }))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  createInvoiceFile: ports.createFile,
  listInvoiceFileCandidates: vi.fn(async () => []),
  listInvoiceFiles: vi.fn(async () => []),
}))
vi.mock('@/lib/billing/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/billing/providers/registry')>(),
  loadTenantInvoiceProviderSelection: vi.fn(async () => ({
    invoice_export_target_system: 'file_export',
    billing_provider_environment: 'test',
    invoice_export_enabled: true,
  })),
}))

import Page from '@/app/admin/billing/page'
import { createInvoiceFileAction } from '@/app/admin/billing/invoice-files/actions'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'

async function alertFor(code: string) {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ month: '2026-02', file_error: code }) }))
  const alert = html.match(/<p role="alert"[^>]*>([^<]*)<\/p>/)?.[1]
  expect(alert).toBeDefined()
  return alert
}

describe('invoice-file distribution validation feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('carries the real action error code to a clear missing-channel alert on the real billing page', async () => {
    ports.createFile.mockRejectedValueOnce(new InvoiceProviderConfigError(
      'invoice_distribution_missing',
      'Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress.',
    ))
    const form = new FormData()
    form.set('billing_month', '2026-02')
    await expect(createInvoiceFileAction(form)).rejects.toThrow('REDIRECT:')
    expect(ports.requireAction).toHaveBeenCalledWith(['billing_underlay.export'])
    expect(ports.createFile).toHaveBeenCalledWith({ companyId: 'company-delivery', billingMonth: '2026-02', actorUserId: 'actor-delivery' })
    const [target] = ports.redirect.mock.calls[0]
    const params = new URL(target, 'https://synthetic.invalid').searchParams
    expect(params.get('file')).toBeNull()
    expect(params.get('file_error')).toBe('invoice_distribution_missing')
    expect(await alertFor(params.get('file_error')!)).toBe('Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress. Ingen fil skapades.')
  })

  it('keeps the generic fallback for unknown error codes', async () => {
    expect(await alertFor('unknown_untrusted_code')).toBe('Fakturafilen kunde inte skapas.')
  })

  it('preserves the existing empty-file guidance', async () => {
    expect(await alertFor('invoice_file_empty')).toBe('Det finns inga godkända fakturor att lägga i en fil. Godkänn fakturorna först.')
  })
})
