'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { BillingProfileCommandError, changeCustomerBillingProfile, changeContractBillingOverride } from '@/lib/billing/billingProfileCommand'
import type { BillingProfileFields } from '@/lib/billing/effectiveBillingProfile'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'

function refreshBillingPaths(paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path)
    return ''
  } catch (error) {
    unstable_rethrow(error)
    return ' Ladda om sidan för aktuella uppgifter.'
  }
}

export async function saveCustomerBillingProfileAction(input: {
  companyId: string; customerId: string; expectedRevision: number; idempotencyKey: string; changes: BillingProfileFields
}) {
  const actor = await requireAdminActionAccess(['masterdata.write'])
  // The form's tenant is a resource selection, never an authorization claim.
  if (actor.companyId !== input.companyId && !actor.isPlatformAdmin) {
    return { status: 'error' as const, code: 'tenant_context_changed', message: 'Tenantkontexten har ändrats. Ladda om kundkortet före sparning.' }
  }
  await assertUserCanOperateCompany(actor.userId, input.companyId)
  const session = await currentSupportSession('ops', actor.userId)
  try {
    const result = await changeCustomerBillingProfile({ ...input, actor: { ...session, kind: 'ops', reason: 'ops_customer_billing_default' } })
    const refreshMessage = refreshBillingPaths([`/admin/customers/${input.customerId}`, '/admin/customers', '/admin/billing'])
    return { status: 'success' as const, ...result, ...(refreshMessage ? { notice: refreshMessage.trim() } : {}),
      message: `Faktureringsstandarden är sparad. ${result.affectedContractIds.length} avtal ärver de ändrade uppgifterna.${refreshMessage}` }
  } catch (error) {
    if (error instanceof BillingProfileCommandError) {
      return { status: 'error' as const, code: error.code, message: error.status === 409
        ? 'Faktureringsprofilen har ändrats sedan formuläret öppnades. Bevara ditt utkast och läs in aktuell revision.'
        : error.status === 403 ? 'Du saknar aktuell rättighet att ändra kundens faktureringsstandard.'
          : error.status === 422 ? 'Kontrollera faktureringsuppgifterna.' : 'Faktureringsprofilen kunde inte sparas just nu.' }
    }
    throw error
  }
}

export async function saveCustomerContractBillingOverrideAction(input: {
  companyId: string; customerId: string; contractId: string; expectedRevision: number; expectedOverrideRevision: number
  idempotencyKey: string; changes: BillingProfileFields; inheritFields?: Array<keyof BillingProfileFields>
}) {
  const actor = await requireAdminActionAccess(['masterdata.write'])
  if (actor.companyId !== input.companyId && !actor.isPlatformAdmin) {
    return { status: 'error' as const, code: 'tenant_context_changed', message: 'Tenantkontexten har ändrats. Ladda om kundkortet före sparning.' }
  }
  await assertUserCanOperateCompany(actor.userId, input.companyId)
  const session = await currentSupportSession('ops', actor.userId)
  try {
    const result = await changeContractBillingOverride({ ...input, actor: { ...session, kind: 'ops', reason: 'ops_contract_billing_override' } })
    const refreshMessage = refreshBillingPaths([`/admin/customers/${input.customerId}`, '/admin/billing'])
    return { status: 'success' as const, ...result, ...(refreshMessage ? { notice: refreshMessage.trim() } : {}),
      message: 'Avtalets faktureringsundantag är sparat. Låsta underlag och historiska fakturor behåller sin tidigare profil.' + refreshMessage }
  } catch (error) {
    if (error instanceof BillingProfileCommandError) return { status: 'error' as const, code: error.code,
      message: error.status === 409 ? 'Kundstandarden eller avtalsundantaget har ändrats. Bevara utkastet och läs in aktuell revision.'
        : error.status === 403 ? 'Du saknar aktuell rättighet att ändra avtalsundantaget.' : 'Faktureringsundantaget kunde inte sparas.' }
    throw error
  }
}
