import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Synthetic component controls only: no genuine Auth, database or original scenario receipt.
const ports = vi.hoisted(() => ({
  createFile: vi.fn(),
  canExport: vi.fn(async () => true),
  fileReceipt: vi.fn(),
  fileHistory: vi.fn<() => Promise<unknown[]>>(async () => []),
  rows: vi.fn(),
  fileSelection: vi.fn(),
  providerSelection: vi.fn(async () => ({
    invoice_export_target_system: 'file_export',
    billing_provider_environment: 'test',
    invoice_export_enabled: true,
  })),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`) }),
  requireAction: vi.fn(async () => ({ userId: 'actor-delivery', companyId: 'company-delivery' })),
}))
vi.mock('next/navigation', () => ({ redirect: ports.redirect, unstable_rethrow: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentOperationalAction: ports.canExport }))
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
  listInvoiceReviewRows: ports.rows,
}))
vi.mock('@/app/admin/billing/actions', () => ({
  approveAndSendReadyInvoicesAction: vi.fn(),
  approveConsolidatedInvoiceDraftAction: vi.fn(),
  issueConsolidatedInvoiceAction: vi.fn(),
}))
vi.mock('@/app/admin/billing/group-invoice-files/actions', () => ({ createConsolidatedInvoiceNeutralFileAction: vi.fn() }))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  createInvoiceFile: ports.createFile,
  isInvoiceFileSelectionItem: vi.fn((item: unknown) =>
    typeof item === 'object' && item !== null && 'itemId' in item),
  isInvoiceFileGroupSelectionItem: vi.fn(() => false),
  previewInvoiceFileSelection: ports.fileSelection,
  previewInvoiceFileGroups: vi.fn(async () => []),
  readFrozenInvoiceFileIntent: vi.fn(async () => null),
  listInvoiceFiles: ports.fileHistory,
  loadInvoiceFilePeriodReconciliation: vi.fn(async () => null),
  loadInvoiceFileReceipt: ports.fileReceipt,
}))
vi.mock('@/lib/billing/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/billing/providers/registry')>(),
  loadTenantInvoiceProviderSelection: ports.providerSelection,
}))

import Page from '@/app/admin/billing/page'
import { POST as submitInvoiceFileForm } from '@/app/admin/billing/invoice-files/create/route'
import type { InvoiceReviewRow } from '@/lib/billing/invoiceReviewData'
import { createInvoiceFileAction } from '@/app/admin/billing/invoice-files/actions'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'
import { signInvoiceFileIntent } from '@/lib/billing/invoiceFileIntentToken'

async function renderBillingFeedback(searchParams: Record<string, string>) {
  const stream = await renderToReadableStream(await Page({ searchParams: Promise.resolve({ month: '2026-02', ...searchParams }) }))
  await stream.allReady
  return (await new Response(stream).text()).replace(/<!--.*?-->/g, '')
}

async function alertFor(code: string) {
  const html = await renderBillingFeedback({ file_error: code })
  const alert = html.match(/<p role="alert"[^>]*>([^<]*)<\/p>/)?.[1]
  expect(alert).toBeDefined()
  return alert
}

function reviewRow(status: InvoiceReviewRow['status'], underlayId: string): InvoiceReviewRow {
  return {
    underlayId, customerId: 'local-synthetic-customer', customerName: 'Syntetiskt bolag',
    customerNumber: null, customerInvoiceId: null, invoiceExportItemId: null, billingMonth: '2026-02',
    status, statusLabel: status === 'approved' ? 'Godkänd' : 'Klar för granskning',
    hasApprovedCalculation: status === 'approved', blocker: null, periodStart: null, periodEnd: null,
    totalKwh: 12, amountIncVat: 125, priceArea: 'SE3', contractType: 'fixed', contractName: null,
  }
}

describe('invoice-file distribution validation feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ports.rows.mockResolvedValue([])
    ports.fileSelection.mockResolvedValue([])
  })

  it.each([
    ['invoice_file_delivery_unverified', 'Det valda leveranssättet kan inte verifieras i det godkända fakturaunderlaget.'],
    ['invoice_file_delivery_unsupported', 'Filexporten stöder inte fakturans valda leveranssätt.'],
    ['invoice_distribution_missing', 'Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress.'],
    ['invoice_distribution_paper_address_missing', 'Pappersfaktura har valts men den frysta fakturaadressen är ofullständig.'],
    ['invoice_distribution_email_missing', 'Faktura via e-post har valts men en bekräftad fryst faktura-e-post saknas.'],
    ['nordfin_invoice_number_required', 'En godkänd Nordfinfaktura saknar ett giltigt sparat fakturanummer.'],
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

  it('gives the operator a retry for a locked file approval without suggesting a send', async () => {
    const html = await renderBillingFeedback({ mode: 'file', approved: '0', failed: '1', approval_busy: '2' })
    expect(html).toContain('Godkända i körningen: 0.')
    expect(html).toContain('Övriga fel: 1.')
    expect(html).toContain('Väntar på omtag: 2.')
    expect(html).toContain('Försök godkänna igen om en stund.')
    expect(html).not.toContain('Fakturafilen omfattar bara godkända fakturor.')
    expect(html).not.toContain('skicka dem till fakturaleverantören')
  })

  it.each(['file', 'direct'])('shows a distinct price review and retry in %s mode', async mode => {
    const html = await renderBillingFeedback({
      mode, sent: '0', approved: '0', failed: '0', approval_busy: '1', approval_price_review: '2',
    })
    expect(html).toContain('Prisgranskning krävs för 2 fakturautkast.')
    expect(html).toContain('Kontrollera nya prisversioner och beräkna om underlaget före godkännande.')
    expect(html).toContain('Väntar på omtag: 1.')
    expect(html).not.toContain('price_timeline_invoice_review_required')
  })

  it.each(['file', 'direct'])('guides the operator to review provider changes in %s mode', async mode => {
    const html = await renderBillingFeedback({
      mode, sent: '0', approved: '0', failed: '0', approval_provider_review: '1',
    })
    expect(html).toContain('Leverantör eller miljö behöver stämmas av för 1 fakturautkast.')
    expect(html).toContain('Stäm av tidigare reservationer i fakturalistan.')
    expect(html).toMatch(/<a[^>]*href="\/admin\/billing\/integrations"[^>]*>Integrationsinställningarna<\/a>/i)
    expect(html).not.toMatch(/Väntar på omtag|Prisgranskning krävs|invoice_approval_provider_scope_changed/)
  })

  it('binds the approval button to new file approvals and keeps the valid file action separate', async () => {
    const fileId = '12710000-0000-4000-8000-000000000002'
    const previouslyApproved = reviewRow('approved', 'existing')
    const selection = [{
      itemId: '12710000-0000-4000-8000-000000000003', reviewHash: 'b'.repeat(64),
      approvedAt: '2026-03-01T10:00:00.000Z', approvedBy: 'earlier-operator',
    }]
    ports.rows.mockResolvedValueOnce([
      previouslyApproved, reviewRow('ready_for_review', 'price-review'), reviewRow('ready_for_review', 'busy'),
    ])
    ports.fileSelection.mockResolvedValue(selection)
    const html = await renderBillingFeedback({
      mode: 'file', sent: '0', approved: '0', failed: '0', approval_busy: '1', approval_price_review: '1',
    })
    expect(html).toContain('Godkänn 2 klara fakturor')
    expect(html).toContain('Prisgranskning krävs för 1 fakturautkast.')
    expect(html).toContain('Väntar på omtag: 1.')
    expect(html).toContain('Skapa fakturafil (1 valda)')

    ports.rows.mockResolvedValueOnce([previouslyApproved])
    expect(await renderBillingFeedback({})).not.toMatch(/Godkänn \d+ klara fakturor/)

    const form = new URLSearchParams({ billing_month: '2026-02' })
    for (const field of ['export_intent_v2', 'export_receipt_v2']) {
      const value = html.match(new RegExp('name="' + field + '" value="([^"]+)"'))?.[1]
      expect(value).toBeTruthy()
      form.set(field, value!)
    }
    ports.createFile.mockResolvedValueOnce({ fileId })
    const response = await submitInvoiceFileForm(new Request('https://synthetic.invalid/admin/billing/invoice-files/create', {
      method: 'POST', headers: { origin: 'https://synthetic.invalid' }, body: form,
    }))
    expect(response.status).toBe(303)
    expect(ports.createFile).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'actor-delivery', companyId: 'company-delivery',
      exportIntentScope: { provider: 'file_export', environment: 'test', selection },
    }))
    const target = new URL(response.headers.get('location')!, 'https://synthetic.invalid')
    ports.fileReceipt.mockResolvedValueOnce({
      id: fileId, billing_month: '2026-02', row_count: 1, environment: 'test',
      handoff_phase: 'created', artifact_archive_version: null, rows_sha256: 'a'.repeat(64),
    })
    const receipt = await renderBillingFeedback(Object.fromEntries(target.searchParams))
    expect(receipt).toContain('Fil skapad. Leveranskvitto saknas.')
    expect(receipt).not.toContain('Väntar på omtag')
    expect(receipt).not.toContain('Prisgranskning krävs')
  })

  it.each([
    { name: 'legacy', version: null, preparationKind: null },
    { name: 'frozen', version: 2, preparationKind: null },
    { name: 'mixed frozen', version: 2, preparationKind: 'mixed_neutral_v1' },
  ])('labels original-byte provenance in the $name receipt and history', async ({ version, preparationKind }) => {
    const id = '12710000-0000-4000-8000-000000000004'
    const file = {
      id, billing_month: '2026-02', row_count: 1, environment: 'test',
      provider: 'file_export', total_inc_vat: 125, created_at: '2026-03-01T10:00:00.000Z',
      preparation_kind: preparationKind, artifact_archive_version: version,
      handoff_phase: 'created', rows_sha256: 'a'.repeat(64),
    }
    ports.fileReceipt.mockResolvedValueOnce(file)
    ports.fileHistory.mockResolvedValueOnce([file])

    const html = await renderBillingFeedback({ file: id })
    expect(ports.fileHistory).toHaveBeenCalledWith('company-delivery')
    expect(ports.fileReceipt).toHaveBeenCalledWith('company-delivery', id)
    expect(html).toContain('Tidigare fakturafiler (1)')
    expect(html).toContain(`href="/admin/billing/invoice-files/${id}"`)

    if (version === null) {
      expect(html).toContain('Äldre fakturafil')
      expect(html).toContain('När filen kan hämtas återskapas den från sparade fakturarader.')
      expect(html).toContain('Äldre format')
      expect(html).not.toContain('Arkiverad fakturafil')
    } else {
      expect(html).toContain('Arkiverad fakturafil')
      expect(html).not.toContain('Äldre format')
      expect(html).not.toContain('Äldre fakturafil')
    }
  })

  it('keeps already approved direct invoices eligible and hides actions for read-only presentation', async () => {
    ports.rows.mockResolvedValue([reviewRow('approved', 'direct')])
    ports.providerSelection.mockResolvedValueOnce({
      invoice_export_target_system: 'capway_aptic', billing_provider_environment: 'test', invoice_export_enabled: true,
    })
    expect(await renderBillingFeedback({})).toContain('Godkänn och skicka 1 klara fakturor')
    ports.canExport.mockResolvedValueOnce(false)
    const readOnly = await renderBillingFeedback({})
    expect(readOnly).not.toMatch(/Godkänn (och skicka )?\d+ klara fakturor/)
    expect(readOnly).not.toContain('name="export_intent_v2"')
    expect(readOnly).toContain('Godkänd')
  })

  it('keeps the generic fallback for unknown error codes', async () => {
    expect(await alertFor('unknown_untrusted_code')).toBe('Fakturafilen kunde inte skapas.')
  })

  it('preserves the existing empty-file guidance', async () => {
    expect(await alertFor('invoice_file_empty')).toBe('Det finns inga godkända fakturor att lägga i en fil. Godkänn fakturorna först.')
  })
})
