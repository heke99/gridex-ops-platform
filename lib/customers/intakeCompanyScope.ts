import 'server-only'
import type { GuardResult } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'

/** Bind a submitted intake to both its rendered scope and the actual write scope.
 * An operational membership fallback must never silently redirect this write. */
export async function requireBoundCustomerIntakeCompany(
  formData: FormData,
  guard: Pick<GuardResult, 'companyId'>,
  actorUserId: string,
): Promise<string> {
  const expected = String(formData.get('expected_company_id') ?? '').trim()
  if (!expected || !guard.companyId || guard.companyId !== expected) {
    throw new Error('Bolaget för kundintaget kunde inte bekräftas. Ladda om sidan innan du sparar.')
  }
  const companyId = await requireOperationalCompanyId(actorUserId)
  if (companyId !== expected) {
    throw new Error('Aktivt operativt bolag skiljer sig från kundintagets bolag. Välj rätt bolag och ladda om sidan innan du sparar.')
  }
  return companyId
}
