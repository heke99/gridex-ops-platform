import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(), actor: vi.fn() }))
const [companyId, userId, invoiceId, customerId] = [1, 2, 3, 4].map(n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const month = '2026-10'
const reviewHash = 'a'.repeat(64)

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: port.revalidate }))
vi.mock('next/navigation', () => ({ redirect: port.redirect }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: port.rpc } }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } } }) } }),
}))
vi.mock('@/lib/admin/guards', () => ({ requireCompanyScopedActionAccess: port.actor }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: async () => ({ userId, companyId }) }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async () => companyId }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId }) }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => {} }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: vi.fn() }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({ approveAndSendReadyInvoicesForMonth: vi.fn() }))
vi.mock('@/app/admin/billing/group-invoice-files/actions', () => ({ createConsolidatedInvoiceNeutralFileAction: vi.fn() }))

import { approveConsolidatedInvoiceDraftAction, issueConsolidatedInvoiceAction } from '@/app/admin/billing/actions'
import ConsolidatedInvoiceReview from '@/app/admin/billing/ConsolidatedInvoiceReview'
import { invoiceGroupPreparationMessages } from '@/lib/billing/invoiceGroupPreparationFeedback'

function form(billingMonth: string | null = month) {
  const data = new FormData()
  data.set('invoice_id', invoiceId)
  data.set('review_hash', reviewHash)
  if (billingMonth !== null) data.set('billing_month', billingMonth)
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  port.actor.mockResolvedValue({ userId, companyId, isPlatformAdmin: false })
  port.redirect.mockImplementation((target: string) => { throw new Error(target) })
})

it.each([
  'invoice_group_selection_changed',
  'invoice_group_customer_choice_changed',
  'invoice_group_price_not_locked',
  'invoice_group_terms_conflict',
  'invoice_group_channel_conflict',
] as const)('shows the allowlisted reason for a first-attest conflict: %s', async code => {
  port.rpc.mockResolvedValue({ error: { message: code, code: '23514', details: 'PRIVATE DETAIL', hint: 'PRIVATE HINT' } })
  const url = `/admin/billing?group_error=${code}&month=${month}`
  await expect(approveConsolidatedInvoiceDraftAction(form())).rejects.toThrow(url)
  expect(port.redirect).toHaveBeenCalledExactlyOnceWith(url)
  expect(invoiceGroupPreparationMessages[code]).toBeTruthy()
  expect(port.rpc).toHaveBeenCalledExactlyOnceWith('gridex_approve_consolidated_invoice_draft_v1', {
    p_company_id: companyId, p_invoice_id: invoiceId, p_actor_user_id: userId, p_review_hash: reviewHash,
  })
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('explains that conflicting contract references can block a consolidated invoice', () => {
  expect(invoiceGroupPreparationMessages.invoice_group_channel_conflict).toBe(
    'Samlingsfakturan kan inte skapas. Kontrollera leveranskanal, fakturaadress och fakturareferens på de berörda avtalen.',
  )
})

it.each([null, '2026-13', '/billing?PRIVATE DETAIL'])('omits broken or older month context: %s', async providedMonth => {
  const code = 'invoice_group_customer_choice_changed'
  port.rpc.mockResolvedValue({ error: { message: code, code: '23514' } })
  const url = `/admin/billing?group_error=${code}`
  await expect(approveConsolidatedInvoiceDraftAction(form(providedMonth))).rejects.toThrow(url)
  expect(port.redirect).toHaveBeenCalledExactlyOnceWith(url)
})

it.each([
  { code: '23514', message: 'PRIVATE server text' },
  { code: 'P0001', message: 'invoice_group_customer_choice_changed' },
  { code: '23514', message: 'constructor' },
  { code: '23514', message: 'invoice_group_customer_choice_changed: PRIVATE suffix' },
])('keeps unknown or noncanonical failures generic: $code / $message', async error => {
  port.rpc.mockResolvedValue({ error: { ...error, details: 'PRIVATE DETAIL', hint: 'PRIVATE HINT' } })
  await expect(approveConsolidatedInvoiceDraftAction(form())).rejects.toThrow(
    new Error('Samlingsfakturan kunde inte attesteras. Kontrollera kundens underlag och fakturauppgifter.'),
  )
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('keeps the established changed-review feedback', async () => {
  port.rpc.mockResolvedValue({ error: { code: '40001', message: 'invoice_group_review_changed' } })
  await expect(approveConsolidatedInvoiceDraftAction(form())).rejects.toThrow('Läs om och granska fakturan igen.')
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('keeps success receipt validation and billing revalidation', async () => {
  port.rpc.mockResolvedValue({ data: { invoiceId, reviewHash, approvedAt: '2026-11-01T15:30:00Z' }, error: null })
  await expect(approveConsolidatedInvoiceDraftAction(form())).resolves.toStrictEqual({ success: true })
  expect(port.revalidate).toHaveBeenCalledExactlyOnceWith('/admin/billing')
  expect(port.redirect).not.toHaveBeenCalled()
})

it('keeps malformed success receipts generic', async () => {
  port.rpc.mockResolvedValue({ data: { invoiceId, reviewHash, approvedAt: 'broken' }, error: null })
  await expect(approveConsolidatedInvoiceDraftAction(form())).rejects.toThrow('Samlingsfakturan kunde inte attesteras.')
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('supplies the reviewed billing month for attest and issue', async () => {
  const row = {
    companyId, invoiceId, billingMonth: month, customerId, customerName: null, invoiceNumber: null, reviewHash,
    canIssue: false, status: 'pending_review', currency: 'SEK', totalAmount: 420,
    sources: [5, 6].map(n => ({
      underlayId: `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      siteId: `72000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
      facilityReference: null, priceArea: 'SE3', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      quantityKwh: n, totalAmount: 210,
    })),
  }
  port.rpc.mockResolvedValue({ data: [row], error: null })
  const props = { companyId, billingMonth: month, customerId: null, canApprove: true }
  const html = renderToStaticMarkup(await ConsolidatedInvoiceReview(props)!)
  expect(html).toMatch(/<input[^>]*name="billing_month"[^>]*value="2026-10"/)
  expect(html).toContain('Attestera samlingsfaktura')
  port.rpc.mockResolvedValue({ data: [{ ...row, canIssue: true, status: 'approved' }], error: null })
  const approvedHtml = renderToStaticMarkup(await ConsolidatedInvoiceReview(props)!)
  expect(approvedHtml).toMatch(/<input[^>]*name="billing_month"[^>]*value="2026-10"/)
  expect(approvedHtml).toContain('Utfärda samlingsfaktura')
})


it.each([
  'invoice_group_selection_changed',
  'invoice_group_customer_choice_changed',
  'invoice_group_terms_conflict',
  'invoice_group_company_scope_mismatch',
  'invoice_group_calculation_changed',
] as const)('retains the selected month and exact safe issue conflict %s', async message => {
  port.rpc.mockResolvedValue({ error: { code: '23514', message, details: 'PRIVATE DETAIL', hint: 'PRIVATE HINT' } })
  const url = `/admin/billing?group_error=${message}&month=${month}`
  await expect(issueConsolidatedInvoiceAction(form())).rejects.toThrow(url)
  expect(port.redirect).toHaveBeenCalledExactlyOnceWith(url)
  expect(port.rpc).toHaveBeenCalledExactlyOnceWith('gridex_finish_consolidated_invoice_v1', {
    p_company_id: companyId, p_invoice_id: invoiceId, p_actor_user_id: userId, p_review_hash: reviewHash,
    p_outcome: 'issued',
  })
  expect(port.revalidate).not.toHaveBeenCalled()
})

it.each([null, '2026-13', 'https://example.invalid/y'])('uses the ordinary billing month when issue context is absent or invalid %s', async providedMonth => {
  const code = 'invoice_group_customer_choice_changed'
  port.rpc.mockResolvedValue({ error: { code: '23514', message: code } })
  const url = `/admin/billing?group_error=${code}`
  await expect(issueConsolidatedInvoiceAction(form(providedMonth))).rejects.toThrow(url)
  expect(port.redirect).toHaveBeenCalledExactlyOnceWith(url)
})

it.each([
  { code: 'P0001', message: 'invoice_group_customer_choice_changed' },
  { code: '23514', message: 'invoice_group_customer_choice_changed: PRIVATE DETAIL' },
  { code: '23514', message: 'constructor' },
  { code: '55000', message: 'proof_evidence_digest_mismatch' },
])('keeps an unknown or differently typed issue failure generic %j', async error => {
  port.rpc.mockResolvedValue({ error })
  await expect(issueConsolidatedInvoiceAction(form())).rejects.toThrow('Utfärdandekvittot kunde inte bekräftas. Läs om fakturans status.')
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('preserves the established issue authority feedback', async () => {
  port.rpc.mockResolvedValue({ error: { code: '23514', message: 'invoice_group_issue_issuer_required' } })
  await expect(issueConsolidatedInvoiceAction(form())).rejects.toThrow('En godkänd utfärdare och nummerserie saknas för den här fakturan.')
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it('returns the normal action success after an exact issue receipt and preserves malformed receipts', async () => {
  const data = { invoiceId, reviewHash, outcome: 'issued', invoiceNumber: 'TEST-01' }
  port.rpc.mockResolvedValueOnce({ data, error: null })
  await expect(issueConsolidatedInvoiceAction(form())).resolves.toBeUndefined()
  expect(port.revalidate).toHaveBeenCalledExactlyOnceWith('/admin/billing')
  expect(port.redirect).not.toHaveBeenCalled()
  port.revalidate.mockClear()
  port.rpc.mockResolvedValueOnce({ data: { ...data, invoiceId: customerId }, error: null })
  await expect(issueConsolidatedInvoiceAction(form())).rejects.toThrow('Utfärdandekvittot kunde inte bekräftas.')
  expect(port.redirect).not.toHaveBeenCalled()
  expect(port.revalidate).not.toHaveBeenCalled()
})

it.each([false, true])('reflects qualified TEST price-series issuance with canIssue=%s', async (canIssue) => {
  const row = {
    companyId, invoiceId, billingMonth: month, customerId, customerName: null, invoiceNumber: null, reviewHash,
    canIssue, reviewType: 'test_price_series', status: 'approved', currency: 'SEK', totalAmount: 420,
    sources: [5, 6].map(n => ({
      underlayId: `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      siteId: customerId, facilityReference: null, priceArea: 'SE3', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      quantityKwh: n, totalAmount: 210,
    })),
  }
  port.rpc.mockResolvedValue({ data: [row], error: null })
  const html = renderToStaticMarkup(await ConsolidatedInvoiceReview({
    companyId, billingMonth: month, customerId, canApprove: true,
  }))
  expect(html).toContain('Attesterad, väntar på utfärdande')
  expect(html).toContain('prisperioder på samma anläggning (TEST)')
  expect(html).not.toContain('Attestera prisperioderna (TEST)')
  expect(html).not.toContain('Utfärda samlingsfaktura')
  expect(html).not.toContain('Skapa neutral fakturafil')
  if (canIssue) {
    expect(html).toContain('Utfärda faktura för prisperioderna (TEST)')
    expect(html).toContain(`name="invoice_id" value="${invoiceId}"`)
    expect(html).toContain(`name="billing_month" value="${month}"`)
    expect(html).toContain(`name="review_hash" value="${reviewHash}"`)
  } else {
    expect(html).not.toContain('Utfärda faktura för prisperioderna (TEST)')
    expect(html).not.toContain('name="billing_month"')
  }
})
