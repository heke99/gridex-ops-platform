'use server'

import { requireTenantInvoiceProvider } from '@/lib/billing/providers/registry'
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

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

export async function approveAndSendReadyInvoicesAction(formData: FormData) {
  const actor = await requireAdminActionAccess(['billing_underlay.export'])
  const { companyId } = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (!companyId) throw new Error('Välj ett bolag innan du godkänner fakturor.')
  const billingMonth = parseBillingMonth(value(formData, 'billing_month')).value
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

  // Refresh first so meter values that arrived since the page loaded can make
  // only the affected customers reviewable. Already-reserved invoices are
  // idempotently skipped.
  await prepareInvoiceDraftsForReview({
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
  redirect(`/admin/billing?${query.toString()}`)
}

export async function approveConsolidatedInvoiceDraftAction(formData: FormData) {
  const receipt = await approveConsolidatedInvoiceDraftForAdmin({
    invoiceId: value(formData, 'invoice_id'), reviewHash: value(formData, 'review_hash'),
  })
  revalidatePath('/admin/billing')
  return receipt
}

export async function issueConsolidatedInvoiceAction(formData: FormData): Promise<void> {
  await issueConsolidatedInvoiceForAdmin({
    invoiceId: value(formData, 'invoice_id'), reviewHash: value(formData, 'review_hash'),
  })
  revalidatePath('/admin/billing')
}
