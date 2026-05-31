'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { loadCustomerTenantContext } from '@/lib/tenant/entityGuards'
import { sendCompanyEmail } from '@/lib/email/sendCompanyEmail'
import { supabaseService } from '@/lib/supabase/service'

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function isRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  )
}

export async function resendCustomerEmailAction(formData: FormData) {
  const customerId = text(formData.get('customer_id'))
  const logId = text(formData.get('log_id'))

  try {
    if (!customerId || !logId) throw new Error('Utskicket saknas.')
    const guard = await requireAdminActionAccess({ anyOf: ['customers.write', 'customers.read'] })
    const tenant = await loadCustomerTenantContext(customerId, guard)

    const { data: log, error } = await supabaseService
      .from('communication_logs')
      .select('*')
      .eq('id', logId)
      .eq('company_id', tenant.companyId)
      .eq('customer_id', customerId)
      .maybeSingle()

    if (error) throw error
    if (!log?.template_key || !log.recipient_email) throw new Error('Loggen saknar mall eller mottagare.')

    await sendCompanyEmail({
      companyId: tenant.companyId,
      customerId,
      eventKey: log.event_key ?? 'manual_resend',
      templateKey: log.template_key,
      to: log.recipient_email,
      variables: {},
    })

    revalidatePath(`/admin/customers/${customerId}`)
    redirect(`/admin/customers/${customerId}?tab=communication`)
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.warn('[email] resendCustomerEmailAction failed', error)
    redirect(`/admin/customers/${customerId || ''}?tab=communication`)
  }
}
