'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { loadCustomerTenantContext } from '@/lib/tenant/entityGuards'
import { resendCustomerEmail } from '@/lib/email/resendCustomerEmail'

const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export async function resendCustomerEmailAction(formData: FormData) {
  const customerId = formData.get('customer_id')
  const logId = formData.get('log_id')
  if (typeof customerId !== 'string' || !uuid.test(customerId)) redirect('/admin/customers')

  let status: Awaited<ReturnType<typeof resendCustomerEmail>> = 'failed'
  if (typeof logId === 'string' && uuid.test(logId)) {
    try {
      const guard = await requireAdminActionAccess({ anyOf: ['customers.write'] })
      const tenant = await loadCustomerTenantContext(customerId, guard)
      status = await resendCustomerEmail({ companyId: tenant.companyId, customerId, logId, actorId: guard.userId })
    } catch {
      console.warn('[email] customer resend did not produce a verified receipt')
    }
  }

  if (status === 'queued' || status === 'duplicate') revalidatePath('/admin/customers/' + customerId)
  redirect('/admin/customers/' + customerId + '?tab=communication&resend=' + status)
}
