'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'
import { parseBillingMonth } from '@/lib/time/stockholm'

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

export async function approveAndSendReadyInvoicesAction(formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  const companyId = await requireOperationalCompanyId(user.id)
  const billingMonth = parseBillingMonth(value(formData, 'billing_month')).value

  const company = await supabase
    .from('companies')
    .select('billing_provider_environment,invoice_export_target_system')
    .eq('id', companyId)
    .maybeSingle()
  if (company.error) throw company.error
  if (!company.data) throw new Error('Tenant saknas.')
  if (company.data.invoice_export_target_system !== 'capway_aptic') throw new Error('Canonical fakturapartner är inte konfigurerad som Capway/Aptic.')
  const environment = company.data.billing_provider_environment === 'production' ? 'production' : 'test'

  // Refresh first so meter values that arrived since the page loaded can make
  // only the affected customers reviewable. Already-reserved invoices are
  // idempotently skipped.
  await prepareInvoiceDraftsForReview({
    companyId,
    billingMonth,
    environment,
    actorUserId: user.id,
  })

  const result = await approveAndSendReadyInvoicesForMonth({
    companyId,
    billingMonth,
    actorUserId: user.id,
  })
  revalidatePath('/admin/billing')
  revalidatePath('/admin/customers')
  const query = new URLSearchParams({
    month: billingMonth,
    sent: String(result.sent),
    failed: String(result.failed),
    approved: String(result.approved),
  })
  redirect(`/admin/billing?${query.toString()}`)
}
