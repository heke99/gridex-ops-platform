import 'server-only'

import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { parseBillingMonth } from '@/lib/time/stockholm'
import { readInvoiceGroupPreparationCode } from '@/lib/billing/invoiceGroupPreparationFeedback'

export const consolidatedInvoiceStatuses = {
  pending_review: 'Väntar på attest',
  approved: 'Attesterad, väntar på utfärdande',
  issued: 'Utfärdad',
  cancelled: 'Avbruten',
  sent: 'Skickad',
  paid: 'Betald',
  overdue: 'Förfallen',
  credited: 'Krediterad',
  failed: 'Behöver granskas',
} as const

type ReviewSource = {
  underlayId: string
  siteId: string
  facilityReference: string | null
  priceArea: string
  periodStart: string
  periodEnd: string
  quantityKwh: number
  totalAmount: number
}

type Review = {
  companyId: string
  customerId: string
  customerName: string | null
  invoiceId: string
  invoiceNumber: string | null
  reviewType?: 'test_price_series'
  canIssue: boolean
  billingMonth: string
  reviewHash: string
  status: keyof typeof consolidatedInvoiceStatuses
  currency: string
  totalAmount: number
  sources: ReviewSource[]
}

type PriceSeriesState =
  | { status: 'pending_review'; canIssue: false; invoiceNumber: null }
  | { status: 'approved'; canIssue: boolean; invoiceNumber: null }
  | { status: 'issued'; canIssue: false; invoiceNumber: string }

function isPriceSeriesState(row: Partial<Review>): row is Partial<Review> & PriceSeriesState {
  if (row.status === 'issued') {
    return row.canIssue === false && typeof row.invoiceNumber === 'string' && Boolean(row.invoiceNumber.trim())
  }
  return row.invoiceNumber === null && (
    (row.status === 'pending_review' && row.canIssue === false) ||
    (row.status === 'approved' && typeof row.canIssue === 'boolean')
  )
}

type ReviewSelection = { companyId: string; billingMonth: string; customerId: string | null; afterInvoiceId?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const civilDate = /^\d{4}-\d{2}-\d{2}$/

function isReviewSource(value: Partial<ReviewSource> | null): value is ReviewSource {
  return Boolean(value && typeof value.underlayId === 'string' && uuid.test(value.underlayId) &&
    typeof value.siteId === 'string' && uuid.test(value.siteId) &&
    (value.facilityReference === null || typeof value.facilityReference === 'string') &&
    typeof value.priceArea === 'string' && /^SE[1-4]$/.test(value.priceArea) &&
    typeof value.periodStart === 'string' && civilDate.test(value.periodStart) &&
    typeof value.periodEnd === 'string' && civilDate.test(value.periodEnd) &&
    Number.isFinite(value.quantityKwh) && Number.isFinite(value.totalAmount))
}

function isReview(row: Partial<Review> | null, selection: ReviewSelection): row is Review {
  return Boolean(row && row.companyId === selection.companyId && row.billingMonth === selection.billingMonth &&
    typeof row.customerId === 'string' && uuid.test(row.customerId) && (!selection.customerId || row.customerId === selection.customerId) &&
    typeof row.invoiceId === 'string' && uuid.test(row.invoiceId) &&
    typeof row.reviewHash === 'string' && /^[a-f0-9]{64}$/.test(row.reviewHash) &&
    typeof row.status === 'string' && Object.hasOwn(consolidatedInvoiceStatuses, row.status) &&
    typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) && Number.isFinite(row.totalAmount) &&
    (row.customerName === null || typeof row.customerName === 'string') &&
    (row.reviewType === undefined || (row.reviewType === 'test_price_series' && isPriceSeriesState(row))) &&
    typeof row.canIssue === 'boolean' && (row.invoiceNumber === null || typeof row.invoiceNumber === 'string') &&
    (row.status !== 'issued' || Boolean(row.invoiceNumber)) && Array.isArray(row.sources) &&
    row.sources.length >= 2 && row.sources.every(isReviewSource))
}

export async function readConsolidatedInvoiceReviewsForAdmin(selection: ReviewSelection): Promise<Review[] | null> {
  const actor = await requirePermissionServer('billing_underlay.read')
  const scope = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  const { companyId, billingMonth, customerId, afterInvoiceId } = selection
  if (!scope.companyId || scope.companyId !== companyId || !uuid.test(scope.companyId)) return null
  if (customerId && !uuid.test(customerId)) return []
  try {
    parseBillingMonth(billingMonth)
  } catch {
    return null
  }
  const { data, error } = await supabaseService.rpc('gridex_list_consolidated_invoice_reviews_v1', {
    p_company_id: scope.companyId,
    p_billing_month: billingMonth,
    p_customer_id: customerId || null,
    p_after_invoice_id: afterInvoiceId && uuid.test(afterInvoiceId) ? afterInvoiceId : null,
  })
  const rows = data as Array<Partial<Review> | null> | null
  if (error || !Array.isArray(rows) || rows.length > 21 || !rows.every(row => isReview(row, selection))) return null
  return rows.map(({ companyId, customerId, customerName, invoiceId, invoiceNumber, canIssue, billingMonth, reviewHash, status, currency, totalAmount, sources, reviewType }) => ({
    companyId, customerId, customerName, invoiceId, invoiceNumber, canIssue, billingMonth, reviewHash, status, currency, totalAmount,
    ...(reviewType ? { reviewType } : {}),
    sources: sources.map(({ underlayId, siteId, facilityReference, priceArea, periodStart, periodEnd, quantityKwh, totalAmount }) => ({
      underlayId, siteId, facilityReference, priceArea, periodStart, periodEnd, quantityKwh, totalAmount,
    })),
  }))
}

async function consolidatedInvoiceActionInput(input: { invoiceId: string; reviewHash: string }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  const companyId = await requireOperationalCompanyId(user.id)
  const actor = await requireCompanyScopedActionAccess(companyId, ['billing_underlay.export'])
  if (actor.userId !== user.id || !uuid.test(actor.userId) || !uuid.test(companyId) ||
      (!actor.isPlatformAdmin && actor.companyId !== companyId)) {
    throw new Error('Du saknar aktiv ändringsbehörighet för valt bolag.')
  }
  await requireCompanyOperationalForWrites(companyId)
  const invoiceId = input.invoiceId.toLowerCase()
  const reviewHash = input.reviewHash
  if (!uuid.test(invoiceId) ||
      !/^[0-9a-f]{64}$/.test(reviewHash)) {
    throw new Error('Fakturans granskningsuppgifter saknas. Läs om samlingsfakturan.')
  }
  return { user, companyId, invoiceId, reviewHash }
}

export async function approveConsolidatedInvoiceDraftForAdmin(input: { invoiceId: string; reviewHash: string }) {
  const { user, companyId, invoiceId, reviewHash } = await consolidatedInvoiceActionInput(input)
  const result = await supabaseService.rpc('gridex_approve_consolidated_invoice_draft_v1', {
    p_company_id: companyId,
    p_invoice_id: invoiceId,
    p_actor_user_id: user.id,
    p_review_hash: reviewHash,
  })
  const receipt = result.data as { invoiceId?: string; reviewHash?: string; approvedAt?: string } | null
  if (result.error || receipt?.invoiceId !== invoiceId || receipt.reviewHash !== reviewHash ||
      typeof receipt.approvedAt !== 'string' || !Number.isFinite(Date.parse(receipt.approvedAt))) {
    const message = result.error?.message
    if (message === 'invoice_group_review_missing') throw new Error('Samlingsfakturan finns inte i valt bolag.')
    if (message === 'invoice_group_review_changed') throw new Error('Samlingsfakturans underlag har ändrats. Läs om och granska fakturan igen.')
    const groupError = result.error?.code === '23514' ? readInvoiceGroupPreparationCode(result.error.message) : null
    if (groupError) return { success: false, groupError } as const
    throw new Error('Samlingsfakturan kunde inte attesteras. Kontrollera kundens underlag och fakturauppgifter.')
  }
  return { success: true } as const
}

export async function issueConsolidatedInvoiceForAdmin(input: { invoiceId: string; reviewHash: string }) {
  const { user, companyId, invoiceId, reviewHash } = await consolidatedInvoiceActionInput(input)
  const { data, error } = await supabaseService.rpc('gridex_finish_consolidated_invoice_v1', {
    p_company_id: companyId, p_invoice_id: invoiceId, p_actor_user_id: user.id,
    p_review_hash: reviewHash, p_outcome: 'issued',
  })
  const receipt = data as { invoiceId?: string; reviewHash?: string; outcome?: string; invoiceNumber?: string } | null
  if (error || receipt?.invoiceId !== invoiceId || receipt.reviewHash !== reviewHash ||
      receipt.outcome !== 'issued' || typeof receipt.invoiceNumber !== 'string' || !receipt.invoiceNumber.trim()) {
    if (error?.message === 'invoice_group_issue_issuer_required') {
      throw new Error('En godkänd utfärdare och nummerserie saknas för den här fakturan.')
    }
    if (error?.message === 'invoice_group_issue_period_locked' || error?.message === 'invoice_group_period_busy') {
      throw new Error('Fakturaperioden är låst eller ändras just nu. Läs om fakturans status.')
    }
    if (error?.message === 'invoice_group_review_changed' || error?.message === 'invoice_group_issue_approval_required') {
      throw new Error('Korrekt attest saknas. Läs om och granska samlingsfakturan igen.')
    }
    if (error?.code === '23514' && error.message === 'price_timeline_invoice_review_required') {
      throw new Error('Prisunderlaget har ändrats. Läs om och granska prisperioderna igen.')
    }
    const groupError = error?.code === '23514' ? readInvoiceGroupPreparationCode(error.message) : null
    if (groupError) return { success: false, groupError } as const
    throw new Error('Utfärdandekvittot kunde inte bekräftas. Läs om fakturans status.')
  }
  return { success: true } as const
}
