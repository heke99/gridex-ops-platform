import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Synthetic component controls only: no genuine Auth, database or original scenario receipt.
const ports = vi.hoisted(() => ({
  createFile: vi.fn(),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`) }),
  requireAction: vi.fn(async () => ({ userId: 'actor-delivery', companyId: 'company-delivery' })),
}))
vi.mock('next/navigation', () => ({ redirect: ports.redirect, unstable_rethrow: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentOperationalAction: vi.fn(async () => true) }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: ports.requireAction,
  requireAdminPageKeyAccess: vi.fn(async () => ({
    userId: 'actor-delivery', companyId: 'company-delivery',
    permissions: ['billing_underlay.read', 'billing_underlay.export'],
  })),
}))
vi.mock('@/lib/auth/requirePermissionServer', () => ({
  requirePermissionServer: vi.fn(async () => ({ userId: 'actor-delivery', permissions: ['billing_underlay.read', 'billing_underlay.export'] })),
}))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: vi.fn(async () => ({ companyId: 'company-delivery' })) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: async (name: string, parameters: { p_company_id: string; p_billing_month: string }) => {
      expect(name).toBe('gridex_list_consolidated_invoice_reviews_v1')
      expect(parameters.p_company_id).toBe('company-delivery')
      expect(parameters.p_billing_month).toBe('2026-02')
      return { data: [], error: null }
    },
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'actor-delivery', email: 'synthetic@example.invalid' } } })) },
})) }))
vi.mock('@/lib/billing/invoiceReviewData', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/billing/invoiceReviewData')>(),
  listInvoiceReviewRows: vi.fn(async () => []),
}))
vi.mock('@/app/admin/billing/actions', () => ({
  approveAndSendReadyInvoicesAction: vi.fn(),
  approveConsolidatedInvoiceDraftAction: vi.fn(),
  issueConsolidatedInvoiceAction: vi.fn(),
}))
vi.mock('@/app/admin/billing/group-invoice-files/actions', () => ({ createConsolidatedInvoiceNeutralFileAction: vi.fn() }))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  createInvoiceFile: ports.createFile,
  isInvoiceFileSelectionItem: vi.fn(() => false),
  isInvoiceFileGroupSelectionItem: vi.fn(() => false),
  previewInvoiceFileSelection: vi.fn(async () => []),
  previewInvoiceFileGroups: vi.fn(async () => []),
  readFrozenInvoiceFileIntent: vi.fn(async () => null),
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
import { signInvoiceFileIntent } from '@/lib/billing/invoiceFileIntentToken'

async function alertFor(code: string) {
  const stream = await renderToReadableStream(await Page({ searchParams: Promise.resolve({ month: '2026-02', file_error: code }) }))
  await stream.allReady
  const html = await new Response(stream).text()
  const alert = html.match(/<p role="alert"[^>]*>([^<]*)<\/p>/)?.[1]
  expect(alert).toBeDefined()
  return alert
}

describe('invoice-file distribution validation feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['invoice_file_delivery_unverified', 'Det valda leveranssättet kan inte verifieras i det godkända fakturaunderlaget.'],
    ['invoice_file_delivery_unsupported', 'Filexporten stöder inte fakturans valda leveranssätt.'],
    ['invoice_distribution_missing', 'Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress.'],
    ['invoice_distribution_paper_address_missing', 'Pappersfaktura har valts men den frysta fakturaadressen är ofullständig.'],
    ['invoice_distribution_email_missing', 'Faktura via e-post har valts men en bekräftad fryst faktura-e-post saknas.'],
  ])('carries %s from the real action to the matching alert on the real billing page', async (code, message) => {
    ports.createFile.mockRejectedValueOnce(new InvoiceProviderConfigError(code, message))
    const form = new FormData()
    form.set('billing_month', '2026-02')
    const intentId = '12710000-0000-4000-8000-000000000001'
    const scope = { provider: 'file_export', environment: 'test', selection: [] } as const
    form.set('export_intent_v2', signInvoiceFileIntent({
      intentId, companyId: 'company-delivery', billingMonth: '2026-02', actorUserId: 'actor-delivery',
      scope: { ...scope, selection: [] },
    }))
    await expect(createInvoiceFileAction(form)).rejects.toThrow('REDIRECT:')
    expect(ports.requireAction).toHaveBeenCalledWith(['billing_underlay.export'])
    expect(ports.createFile).toHaveBeenCalledWith({
      companyId: 'company-delivery', billingMonth: '2026-02', actorUserId: 'actor-delivery',
      exportIntentId: intentId, exportIntentScope: scope,
    })
    const [target] = ports.redirect.mock.calls[0]
    const params = new URL(target, 'https://synthetic.invalid').searchParams
    expect(params.get('file')).toBeNull()
    expect(params.get('file_error')).toBe(code)
    expect(await alertFor(code)).toBe(`${message} Ingen fil skapades.`)
  })

  it('keeps the generic fallback for unknown error codes', async () => {
    expect(await alertFor('unknown_untrusted_code')).toBe('Fakturafilen kunde inte skapas.')
  })

  it('preserves the existing empty-file guidance', async () => {
    expect(await alertFor('invoice_file_empty')).toBe('Det finns inga godkända fakturor att lägga i en fil. Godkänn fakturorna först.')
  })
})
