'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { sendOnlineContractSignatureRequest } from '@/lib/customer-contracts/onlineSigning'
import { contractHasValidSigningSite, SIGNING_LINK_SITE_REQUIRED_MESSAGE } from '@/lib/customer-contracts/autoSendSigningLink'
import { supabaseService } from '@/lib/supabase/service'
import { getCustomerContractById } from '@/lib/customer-contracts/db'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import { updateContractAction } from '@/components/admin/customers/contracts/actions'
import {
  assertContractTenant,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

export type ContractEditSaveResult = {status: 'saved'} | {status: 'invalid'; message: string; field?: string}

/** Price versions used by signing and invoicing cannot be rewritten by an
 * edit of the customer-card scalars. Keep the existing command and its gates. */
export async function saveContractWithFeedbackAction(formData: FormData): Promise<ContractEditSaveResult> {
  const customerId = text(formData.get('customer_id'))
  const contractId = text(formData.get('customer_contract_id'))
  const guard = await requireAdminActionAccess(['contracts.write'])
  const {companyId} = await loadCustomerTenantContext(customerId, guard)
  await assertContractTenant({companyId, customerId, contractId})
  if (!companyId) throw new Error('Bolag krävs för kundavtalet.')
  const before = await getCustomerContractById(contractId, {companyId}) as (CustomerContractRow & {contract_price_snapshot_id?: string | null}) | null
  if (!before || before.customer_id !== customerId || before.company_id !== companyId) throw new Error('Kundavtalet kunde inte hittas')
  const bound = Boolean(['signed', 'active', 'terminated', 'cancelled', 'expired'].includes(before.status) || before.locked_at || before.signed_at || before.price_plan_version_id || before.contract_price_snapshot_id || before.contract_offer_id || before.public_contract_offer_id || before.contract_publication_version_id)
  // The original authoring helper preserves historic VAT for non-drafts and
  // offer-bound rows, but cannot preserve a legacy snapshot-only draft.
  // Hold that case rather than claiming a successful, lossless ordinary save.
  if (before.energy_direction !== 'production' && before.status === 'draft' && !before.locked_at && !before.signed_at && !before.contract_offer_id &&
    !before.public_contract_offer_id && !before.contract_publication_version_id &&
    (before.contract_price_snapshot_id || before.price_plan_version_id) && before.vat_rate !== 0.25) {
    return {status: 'invalid', field: 'vat_rate', message: 'Avtalet har äldre låsta momsuppgifter som inte kan bevaras av detta redigeringsflöde. Hantera priset genom en ny avtalsversion. Inga ändringar har sparats.'}
  }
  const numeric = ['fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh','monthly_fee_sek','invoice_fee_sek','green_fee_value','discount_value','start_fee_sek','admin_fee_sek','break_fee_sek','vat_rate'] as const
  // The delegated command is a full update, so an omitted fee must never
  // become a new null/default and bypass the commercial change check.
  const commandData = new FormData()
  for (const [key, value] of formData) commandData.append(key, value)
  for (const field of numeric) {
    if (!commandData.has(field)) {
      const current = before[field]
      commandData.set(field, current === null || current === undefined ? '' : String(field === 'vat_rate' ? current * 100 : current))
    }
    const raw = text(commandData.get(field)).replace(',', '.')
    const parsed = raw === '' ? null : Number(raw)
    if (parsed !== null && !Number.isFinite(parsed)) return {status: 'invalid', field, message: 'Ange ett giltigt belopp. Använd exempelvis 12,50 eller 0.'}
    if (field === 'invoice_fee_sek' && parsed !== null && parsed < 0) return {status: 'invalid', field, message: 'Fakturaavgiften får inte vara negativ. Ange 0 om fakturaavgift saknas.'}
    const next = field === 'vat_rate' && parsed !== null ? parsed / 100 : parsed
    const current = before[field] ?? null
    if (bound && (next === null || current === null ? next !== current : Math.abs(next - current) > 1e-9)) {
      return {status: 'invalid', field, message: 'Priset hör till en låst avtalsversion som används vid signering och fakturering. Skapa en ny avtalsversion för att ändra priser eller avgifter; den här ändringen har inte sparats.'}
    }
  }
  for (const field of ['green_fee_mode', 'discount_unit'] as const) {
    const current = before[field] || (field === 'green_fee_mode' ? 'none' : '')
    if (!commandData.has(field)) commandData.set(field, current)
    if (bound && text(commandData.get(field)) !== current) {
      return {status: 'invalid', field, message: 'Tillägg och rabatter hör till avtalets prisversion. Skapa en ny avtalsversion för att ändra dem; den här ändringen har inte sparats.'}
    }
  }
  try {
    await updateContractWithSigningFeedbackAction(commandData)
    return {status: 'saved'}
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof Error && ['Ange orsak när katalogpriser ändras.', 'Ange orsak när katalogpriser ändras. Slutdatum kan inte vara före startdatum.'].includes(error.message)) {
      return {status: 'invalid', field: 'override_reason', message: error.message}
    }
    if (error instanceof Error && ['Moms måste ligga mellan 0 och 100 procent.', 'Moms för nya konsumtionspriser måste vara 25 procent.'].includes(error.message)) {
      return {status: 'invalid', field: 'vat_rate', message: error.message}
    }
    if (error instanceof Error && error.message === 'Slutdatum kan inte vara före startdatum.') {
      return {status: 'invalid', field: 'ends_at', message: error.message}
    }
    const problem = error && typeof error === 'object' ? error as {code?: unknown; message?: unknown} : null
    if (problem?.code === '55000' && typeof problem.message === 'string' && /^signed_customer_contract_immutable:[a-z_]+$/.test(problem.message)) {
      return {status: 'invalid', message: 'Avtalet är signerat och dess priser och signeringsunderlag är låsta. Skapa en ny avtalsversion för att ändra villkoren.'}
    }
    throw error
  }
}

/** Keep the existing authorized business command. Expected validation
 * gets a useful return path instead of crashing the entire admin view. */
export async function updateContractWithSigningFeedbackAction(formData: FormData) {
  try {
    await updateContractAction(formData)
  } catch (error) {
    unstable_rethrow(error)
    const problem = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null
    if (problem?.code === '23514' && problem.message === 'customer_contract_signature_evidence_incomplete') {
      const customerId = encodeURIComponent(text(formData.get('customer_id')))
      const contractId = encodeURIComponent(text(formData.get('customer_contract_id')))
      const message = 'Signeringen behöver registreras via kundens signeringslänk eller import av ett redan signerat PDF-avtal. Behåll Väntar signering när anläggningskopplingen sparas.'
      redirect(`/admin/customers/${customerId}/contracts/${contractId}/signature?error=${encodeURIComponent(message)}`)
    }
    throw error
  }
}

export async function sendContractSignatureLinkAction(formData: FormData) {
  const customerId = text(formData.get('customer_id'))
  const contractId = text(formData.get('contract_id'))
  const recipientEmail = text(formData.get('recipient_email')).toLowerCase()
  let deliveryStatus = 'queued'

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
    if (!await contractHasValidSigningSite({ companyId, customerId, contractId })) {
      throw new Error(SIGNING_LINK_SITE_REQUIRED_MESSAGE)
    }

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

    const result = await sendOnlineContractSignatureRequest({
      companyId,
      customerId,
      contractId,
      recipientEmail: email,
      actorUserId: guard.userId,
      channel: 'internal',
    })
    deliveryStatus = result.deliveryStatus

    revalidatePath(`/admin/customers/${customerId}`)
    revalidatePath(`/admin/customers/${customerId}/contracts/${contractId}/signature`)
  } catch (error) {
    unstable_rethrow(error)
    const message = error instanceof Error ? error.message : 'Signeringslänken kunde inte skickas.'
    redirect(
      `/admin/customers/${customerId}/contracts/${contractId}/signature?error=${encodeURIComponent(message)}`,
    )
  }

  redirect(`/admin/customers/${customerId}/contracts/${contractId}/signature?sent=1&delivery=${encodeURIComponent(deliveryStatus)}`)
}
