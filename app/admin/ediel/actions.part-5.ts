// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { approveEdielInboundCase, getEdielInboundCaseById, rejectEdielInboundCase, type EdielInboundObjectDecision } from '@/lib/ediel/inboundCases'
import { formString, revalidateEdiel } from './actions.part-1'
import { parseInboundCaseMode } from '@/lib/ediel/inboundCaseForm'

const permissions = { allOf: ['communication.write', 'masterdata.write'] }
async function caseAccess(formData: FormData) {
  await requireAdminActionAccess(permissions)
  const caseId = formString(formData.get('caseId'))
  if (!caseId) throw new Error('caseId saknas')
  const row = await getEdielInboundCaseById(caseId)
  if (!row?.company_id) throw new Error('Inbound-caset saknar behörigt bolag.')
  // Never trust a hidden company ID or global permission for another tenant.
  const context = await requireCompanyScopedActionAccess(row.company_id, permissions)
  return { caseId, companyId: row.company_id, actorUserId: context.userId }
}

function objectChoices(form: FormData): EdielInboundObjectDecision[] | undefined {
  const names = ['objectMeteringPointId', 'objectIdentityAgency', 'objectMode', 'objectCustomerId', 'objectSiteId', 'objectMeteringPointDbId'] as const
  const columns = names.map(name => form.getAll(name))
  if (columns.every(column => column.length === 0)) return undefined
  const count = columns[0].length
  if (!count || count > 999999 || columns.some(column => column.length !== count || column.some(value => typeof value !== 'string'))) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
  return columns[0].map((value, index) => {
    const meteringPointId = formString(value)
    const identityAgency = formString(columns[1][index])
    const mode = columns[2][index]
    if (!meteringPointId || !identityAgency || !['create_new_customer', 'update_existing_customer', 'link_existing_only'].includes(String(mode))) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    return { meteringPointId, identityAgency, mode: mode as EdielInboundObjectDecision['mode'],
      selectedCustomerId: formString(columns[3][index]), selectedSiteId: formString(columns[4][index]), selectedMeteringPointId: formString(columns[5][index]) }
  })
}

export async function approveEdielInboundCaseAction(formData: FormData) {
  const access = await caseAccess(formData)
  const objectDecisions = objectChoices(formData)
  await approveEdielInboundCase({
    ...access,
    objectDecisions,
    // Per-object choices and legacy root defaults are mutually exclusive.
    ...(objectDecisions ? {} : {
      mode: parseInboundCaseMode(formData.get('mode')),
      selectedCustomerId: formString(formData.get('selectedCustomerId')),
      selectedSiteId: formString(formData.get('selectedSiteId')),
      selectedMeteringPointId: formString(formData.get('selectedMeteringPointId')),
    }),
    note: formString(formData.get('note')),
  })
  revalidateEdiel()
  revalidatePath('/admin/customers')
}

export async function rejectEdielInboundCaseAction(formData: FormData) {
  const access = await caseAccess(formData)
  await rejectEdielInboundCase({ ...access, note: formString(formData.get('note')) })
  revalidateEdiel()
}
