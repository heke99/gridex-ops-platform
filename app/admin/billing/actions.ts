'use server'

import { InvoiceProviderConfigError, requireTenantInvoiceProvider } from '@/lib/billing/providers/registry'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'
import { parseBillingMonth } from '@/lib/time/stockholm'
import { approveConsolidatedInvoiceDraftForAdmin, issueConsolidatedInvoiceForAdmin } from '@/lib/billing/consolidatedInvoiceAdmin'
import type { InvoiceGroupPreparationCode } from '@/lib/billing/invoiceGroupPreparationFeedback'

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function exactApprovalField(formData: FormData, name: string, expected: string) {
  const values = formData.getAll(name)
  return values.length === 1 && values[0] === expected
}

function redirectToReviewChangedInvoiceScope(billingMonth: string): never {
  const query = new URLSearchParams({ month: billingMonth, approval_scope_changed: '1' })
  redirect(`/admin/billing?${query.toString()}`)
}

export async function approveAndSendReadyInvoicesAction(formData: FormData) {
  const actor = await requireAdminActionAccess(['billing_underlay.export'])
  const { companyId } = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (!companyId) throw new Error('Välj ett bolag innan du godkänner fakturor.')
  const billingMonth = parseBillingMonth(value(formData, 'billing_month')).value
  if (!exactApprovalField(formData, 'expected_company_id', companyId)
      || !exactApprovalField(formData, 'expected_actor_user_id', actor.userId)) {
    redirectToReviewChangedInvoiceScope(billingMonth)
  }
  await requireCompanyOperationalForWrites(companyId)
  const supabase = await createSupabaseServerClient()

  const company = await supabase
    .from('companies')
    .select('billing_provider_environment,invoice_export_target_system')
    .eq('id', companyId)
    .maybeSingle()
  if (company.error) throw company.error
  if (!company.data) throw new Error('Tenant saknas.')
  const { environment, provider } = requireTenantInvoiceProvider(company.data)
  if (!exactApprovalField(formData, 'expected_provider', provider)
      || !exactApprovalField(formData, 'expected_environment', environment)) {
    redirectToReviewChangedInvoiceScope(billingMonth)
  }

  // Refresh first so meter values that arrived since the page loaded can make
  // only the affected customers reviewable. Already-reserved invoices are
  // idempotently skipped.
  const preparation = await prepareInvoiceDraftsForReview({
    companyId,
    billingMonth,
    environment,
    provider,
    actorUserId: actor.userId,
  })

  const result = await approveAndSendReadyInvoicesForMonth({
    companyId,
    billingMonth,
    actorUserId: actor.userId,
    expectedPath: { provider, environment },
  }).catch((error: unknown) => {
    if (error instanceof InvoiceProviderConfigError && error.code === 'invoice_batch_provider_scope_changed') {
      redirectToReviewChangedInvoiceScope(billingMonth)
    }
    throw error
  })
  revalidatePath('/admin/billing')
  revalidatePath('/admin/customers')
  const query = new URLSearchParams({
    month: billingMonth,
    sent: String(result.sent),
    failed: String(result.failed),
    approved: String(result.approved),
  })
  if (result.approveOnly) query.set('mode', 'file')
  for (const reason of preparation?.groupErrorCodes ?? []) query.append('group_error', reason)
  if (result.approvalBusy > 0) query.set('approval_busy', String(result.approvalBusy))
  if (result.approvalPriceReview > 0) query.set('approval_price_review', String(result.approvalPriceReview))
  if (result.approvalCorrectionReview > 0) query.set('approval_correction_review', String(result.approvalCorrectionReview))
  if (result.approvalProviderReview > 0) query.set('approval_provider_review', String(result.approvalProviderReview))
  if (result.dispatchFrozen) query.set('dispatch_frozen', String(result.dispatchFrozen))
  redirect(`/admin/billing?${query.toString()}`)
}

function showConsolidatedInvoiceConflict(formData: FormData, groupError: InvoiceGroupPreparationCode): never {
  const query = new URLSearchParams({ group_error: groupError })
  try {
    query.set('month', parseBillingMonth(value(formData, 'billing_month')).value)
  } catch {
    // Older or invalid form context uses the billing page's current month.
  }
  redirect(`/admin/billing?${query.toString()}`)
}

export async function approveConsolidatedInvoiceDraftAction(formData: FormData) {
  const receipt = await approveConsolidatedInvoiceDraftForAdmin({
    invoiceId: value(formData, 'invoice_id'), reviewHash: value(formData, 'review_hash'),
  })
  if (receipt.success === false) showConsolidatedInvoiceConflict(formData, receipt.groupError)
  revalidatePath('/admin/billing')
  return receipt
}

export async function issueConsolidatedInvoiceAction(formData: FormData): Promise<void> {
  const receipt = await issueConsolidatedInvoiceForAdmin({
    invoiceId: value(formData, 'invoice_id'), reviewHash: value(formData, 'review_hash'),
  })
  if (receipt.success === false) showConsolidatedInvoiceConflict(formData, receipt.groupError)
  revalidatePath('/admin/billing')
}
