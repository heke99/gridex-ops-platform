'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { changeContactAfterSupportVerification } from '@/lib/customer-operations/supportSensitiveContact'
import { SupportCommandError } from '@/lib/customer-operations/supportCommand'
import { supportFormError, type SupportFormState } from '@/lib/customer-cases/formState'

/** Internal server action following the existing support guard/selected-company
 * path. Issuer delivery/UI enrollment remains separate; no verified checkbox. */
export async function changeSupportContactWithVerificationAction(form: FormData): Promise<SupportFormState> {
  try {
    const allowed = new Set(['customer_id','case_id','expected_case_revision','expected_contact_revision','idempotency_key','reason','email','phone','proof_token'])
    for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1 || typeof form.get(key) !== 'string') {
      throw new SupportCommandError('invalid_support_sensitive_command', 422)
    }
    const value = (key: string) => String(form.get(key) ?? '').trim()
    const revision = (key: string) => {
      if (!/^(0|[1-9][0-9]*)$/.test(value(key)) || !Number.isSafeInteger(Number(value(key)))) throw new SupportCommandError('invalid_support_sensitive_command', 422)
      return Number(value(key))
    }
    const admin = await requireAdminActionAccess({ allOf: ['cases.write','masterdata.write'] })
    const scope = await getOperationalCompanyScope(admin.userId)
    if (!scope.companyId || scope.companyId !== admin.companyId) throw new SupportCommandError('support_actor_forbidden', 403)
    const result = await changeContactAfterSupportVerification({ companyId: scope.companyId, customerId: value('customer_id'), caseId: value('case_id'),
      expectedCaseRevision: revision('expected_case_revision'), expectedContactRevision: revision('expected_contact_revision'),
      idempotencyKey: value('idempotency_key'), reason: value('reason'), proofToken: value('proof_token'),
      changes: { ...(form.has('email') ? { email: value('email') || null } : {}), ...(form.has('phone') ? { phone: value('phone') || null } : {}) } }, admin.userId)
    let refreshed = true
    for (const path of ['/admin/customer-cases', `/admin/customers/${result.customerId}`, '/portal/profil']) {
      try { revalidatePath(path) } catch { refreshed = false }
    }
    return { ok: true, revision: result.caseRevision, message: 'Kontaktändringen är sparad efter handlingsbunden verifiering.' +
      (refreshed ? '' : ' Läs om sidan för aktuella uppgifter.') }
  } catch (error) { return supportFormError(error) }
}
