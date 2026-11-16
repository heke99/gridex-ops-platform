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

    const resendBucket = new Date().toISOString().slice(0, 16)
    await sendCompanyEmail({
      companyId: tenant.companyId,
      customerId,
      eventKey: log.event_key ?? 'manual_resend',
      templateKey: log.template_key,
      to: log.recipient_email,
      variables: {},
      idempotencyKey: `resend:${log.id}:${resendBucket}`,
      metadata: {
        resend_of_communication_log_id: log.id,
        resend_requested_by: guard.userId,
        source: 'resend_customer_email_action',
      },
    })

    revalidatePath(`/admin/customers/${customerId}`)
  } catch (error) {
    console.warn('[email] resendCustomerEmailAction failed', error)
    redirect(`/admin/customers/${customerId || ''}?tab=communication&error=${encodeURIComponent('E-postmeddelandet kunde inte skickas om.')}`)
  }

  redirect(`/admin/customers/${customerId}?tab=communication`)
}
