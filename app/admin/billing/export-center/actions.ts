'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { sendApprovedInvoiceExportRun } from '@/lib/billing/invoiceApprovedDispatch'
import { parseBillingMonth } from '@/lib/time/stockholm'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

async function context() {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  const companyId = await requireOperationalCompanyId(user.id)
  return { supabase, user, companyId }
}

export async function createBillingExportRunAction(formData: FormData) {
  const { supabase, user, companyId } = await context()
  const periodMonth = parseBillingMonth(text(formData, 'period_month') || new Date().toISOString().slice(0, 7)).value
  const company = await supabase.from('companies').select('billing_provider_environment,invoice_export_target_system').eq('id', companyId).maybeSingle()
  if (company.error) throw company.error
  if (!company.data || company.data.invoice_export_target_system !== 'capway_aptic') throw new Error('Canonical fakturapartner är inte korrekt konfigurerad.')
  await prepareInvoiceDraftsForReview({
    companyId,
    billingMonth: periodMonth,
    environment: company.data.billing_provider_environment === 'production' ? 'production' : 'test',
    actorUserId: user.id,
  })
  revalidatePath('/admin/billing/export-center')
  revalidatePath('/admin/billing')
}

export async function queueReadyBillingExportRunItemsAction(_formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  throw new Error('Manuell köning är avstängd. Fakturor förbereds automatiskt och skickas först efter godkännande i Fakturor.')
}

export async function sendBillingExportRunToPartnerApiAction(formData: FormData) {
  const { user, companyId } = await context()
  const exportRunId = text(formData, 'export_run_id')
  if (!exportRunId) throw new Error('export_run_id saknas.')
  await sendApprovedInvoiceExportRun({ companyId, actorUserId: user.id, exportRunId })
  revalidatePath('/admin/billing/export-center')
  revalidatePath('/admin/billing')
}

export async function retryFailedBillingExportRunItemsAction(_formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  throw new Error('Manuellt legacy-retry är avstängt. Endast redan godkända fakturor återförsöks av canonical retry-kedjan.')
}
