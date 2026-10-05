'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { getCustomerCaseById, updateCustomerCaseStatus } from '@/lib/customer-cases/db'

const SOURCE = 'ediel_inbound_state_machine'
const STATUSES = new Set(['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'])
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function updateEdielOperationalCaseStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  if (isPlatformAdminContext(admin) || !admin.permissions.includes('cases.write')) throw new Error('Ärendestatus kräver tenantbehörighet att ändra ärenden.')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const selected = scope.memberships.find((membership) => membership.companyId === companyId)
  if (!companyId || admin.companyId !== companyId || !selected || selected.status !== 'active' || !isCompanyWritableInTenantWorkspace(selected.companyStatus)) {
    throw new Error('Valt bolag saknar aktiv ändringsbehörighet.')
  }

  const caseId = String(formData.get('case_id') ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()
  if (!ID.test(caseId) || !STATUSES.has(status)) throw new Error('Ogiltig Ediel-ärendeåtgärd.')
  const row = await getCustomerCaseById(caseId, companyId)
  if (!row || row.source !== SOURCE) throw new Error('Ediel-ärendet finns inte i valt bolag.')

  await updateCustomerCaseStatus({
    caseId,
    companyId,
    expectedSource: SOURCE,
    status,
    message: `Ediel-ärendestatus uppdaterad till ${status}.`,
    actorUserId: admin.userId,
  })
  revalidatePath('/admin/ediel/operational-cases')
  revalidatePath('/admin/controltower')
}
