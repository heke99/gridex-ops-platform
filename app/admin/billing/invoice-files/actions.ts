'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { parseBillingMonth } from '@/lib/time/stockholm'

export async function createInvoiceFileAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  const companyId = await requireOperationalCompanyId(user.id)
  const billingMonth = parseBillingMonth(String(formData.get('billing_month') ?? '')).value

  let target: string
  try {
    const result = await createInvoiceFile({ companyId, billingMonth, actorUserId: user.id })
    target = `/admin/billing?month=${billingMonth}&file=${result.fileId}`
  } catch (error) {
    unstable_rethrow(error)
    if (!(error instanceof InvoiceProviderConfigError)) throw error
    target = `/admin/billing?month=${billingMonth}&file_error=${encodeURIComponent(error.code)}`
  }
  revalidatePath('/admin/billing')
  redirect(target)
}
