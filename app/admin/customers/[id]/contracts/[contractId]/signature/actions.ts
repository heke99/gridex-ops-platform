'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { sendOnlineContractSignatureRequest } from '@/lib/customer-contracts/onlineSigning'
import { supabaseService } from '@/lib/supabase/service'
import {
  assertContractTenant,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

export async function sendContractSignatureLinkAction(formData: FormData) {
  const customerId = text(formData.get('customer_id'))
  const contractId = text(formData.get('contract_id'))
  const recipientEmail = text(formData.get('recipient_email')).toLowerCase()

  if (!customerId || !contractId) {
    throw new Error('customer_id och contract_id krävs')
  }

  try {
    const guard = await requireAdminActionAccess(['contracts.write'])
    const { companyId } = await loadCustomerTenantContext(customerId, guard)
    await assertContractTenant({ companyId, customerId, contractId })

    const { data: contract, error: contractError } = await supabaseService
      .from('customer_contracts')
      .select('id,status,signed_at')
      .eq('id', contractId)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (contractError) throw contractError
    if (!contract) throw new Error('Kundavtalet hittades inte.')
    if (!['draft', 'pending_signature', 'signature_failed'].includes(contract.status)) {
      throw new Error('Avtalet kan inte skickas för signering i nuvarande status.')
    }
    if (contract.signed_at) throw new Error('Avtalet är redan signerat.')

    const { data: customer, error: customerError } = await supabaseService
      .from('customers')
      .select('email')
      .eq('id', customerId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (customerError) throw customerError

    const email = recipientEmail || String(customer?.email ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      throw new Error('Kunden måste ha en giltig e-postadress för online-signering.')
    }

    await sendOnlineContractSignatureRequest({
      companyId,
      customerId,
      contractId,
      recipientEmail: email,
      actorUserId: guard.userId,
      channel: 'internal',
    })

    revalidatePath(`/admin/customers/${customerId}`)
    revalidatePath(`/admin/customers/${customerId}/contracts/${contractId}/signature`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signeringslänken kunde inte skickas.'
    redirect(
      `/admin/customers/${customerId}/contracts/${contractId}/signature?error=${encodeURIComponent(message)}`,
    )
  }

  redirect(`/admin/customers/${customerId}/contracts/${contractId}/signature?sent=1`)
}
