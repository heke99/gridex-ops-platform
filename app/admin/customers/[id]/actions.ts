"use server";

// Stable public facade. Implementations are split into 4 characterized modules.
import * as implementation1 from './actions.part-1'
import * as implementation2 from './actions.part-2'
import * as implementation3 from './actions.part-3'
import * as implementation4 from './actions.part-4'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { ensureAndPrepareUtiltsFromDataRequest } from '@/lib/cis/edielAutomation'

export type { CustomerOperationActionState } from './actions.part-2'

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function listMeterValueRequestIds(input: {
  actorUserId: string
  customerId: string
}): Promise<Set<string>> {
  const scope = await getOperationalCompanyScope(input.actorUserId)
  let query = supabaseService
    .from('grid_owner_data_requests')
    .select('id')
    .eq('customer_id', input.customerId)
    .eq('request_scope', 'meter_values')

  if (!scope.isPlatformAdmin) {
    if (!scope.companyId) throw new Error('Aktivt bolag saknas för mätvärdesbegäran.')
    query = query.eq('company_id', scope.companyId)
  }

  const { data, error } = await query.limit(200)
  if (error) throw error
  return new Set((data ?? []).map((row) => String(row.id)))
}

export async function saveCustomerSiteAction(...args: Parameters<typeof implementation1.saveCustomerSiteAction>) {
  return implementation1.saveCustomerSiteAction(...args)
}

export async function saveMeteringPointAction(...args: Parameters<typeof implementation1.saveMeteringPointAction>) {
  return implementation1.saveMeteringPointAction(...args)
}

export async function createCustomerInternalNoteAction(...args: Parameters<typeof implementation1.createCustomerInternalNoteAction>) {
  return implementation1.createCustomerInternalNoteAction(...args)
}

export async function createPowerOfAttorneyAction(...args: Parameters<typeof implementation1.createPowerOfAttorneyAction>) {
  return implementation1.createPowerOfAttorneyAction(...args)
}

export async function uploadCustomerAuthorizationDocumentAction(...args: Parameters<typeof implementation2.uploadCustomerAuthorizationDocumentAction>) {
  return implementation2.uploadCustomerAuthorizationDocumentAction(...args)
}

export async function runSwitchReadinessAction(...args: Parameters<typeof implementation2.runSwitchReadinessAction>) {
  return implementation2.runSwitchReadinessAction(...args)
}

export async function createSupplierSwitchRequestAction(...args: Parameters<typeof implementation2.createSupplierSwitchRequestAction>) {
  return implementation2.createSupplierSwitchRequestAction(...args)
}

export async function startAutomaticOnboardingAction(...args: Parameters<typeof implementation2.startAutomaticOnboardingAction>) {
  return implementation2.startAutomaticOnboardingAction(...args)
}

export async function requestSupplierSwitchAutomationAction(...args: Parameters<typeof implementation2.requestSupplierSwitchAutomationAction>) {
  return implementation2.requestSupplierSwitchAutomationAction(...args)
}

export async function updateOperationTaskStatusAction(...args: Parameters<typeof implementation2.updateOperationTaskStatusAction>) {
  return implementation2.updateOperationTaskStatusAction(...args)
}

export async function createGridOwnerDataRequestAction(...args: Parameters<typeof implementation3.createGridOwnerDataRequestAction>) {
  const [formData] = args
  const requestScope = formText(formData, 'request_scope')

  if (requestScope !== 'meter_values') {
    return implementation3.createGridOwnerDataRequestAction(...args)
  }

  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const customerId = formText(formData, 'customer_id')
  if (!customerId) {
    return implementation3.createGridOwnerDataRequestAction(...args)
  }

  const beforeIds = await listMeterValueRequestIds({
    actorUserId: guard.userId,
    customerId,
  })

  const result = await implementation3.createGridOwnerDataRequestAction(...args)

  const afterIds = await listMeterValueRequestIds({
    actorUserId: guard.userId,
    customerId,
  })
  const createdIds = [...afterIds].filter((id) => !beforeIds.has(id))

  // The implementation intentionally returns without creating a request when
  // route/readiness/access is blocked. In that case there is nothing to send.
  if (createdIds.length === 0) return result
  if (createdIds.length !== 1) {
    throw new Error('Mätvärdesbegäran blev tvetydig och stoppades innan E73 kunde skapas.')
  }

  await ensureAndPrepareUtiltsFromDataRequest({
    actorUserId: guard.userId,
    dataRequestId: createdIds[0],
    utiltsCode: 'E73',
  })

  return result
}

export async function createAuthorizationRequestPackageAction(...args: Parameters<typeof implementation3.createAuthorizationRequestPackageAction>) {
  return implementation3.createAuthorizationRequestPackageAction(...args)
}

export async function createCustomerDataRequestPackageAction(...args: Parameters<typeof implementation3.createCustomerDataRequestPackageAction>) {
  return implementation3.createCustomerDataRequestPackageAction(...args)
}

export async function registerCurrentSupplierResponseAction(...args: Parameters<typeof implementation3.registerCurrentSupplierResponseAction>) {
  return implementation3.registerCurrentSupplierResponseAction(...args)
}

export async function createPartnerExportAction(...args: Parameters<typeof implementation4.createPartnerExportAction>) {
  return implementation4.createPartnerExportAction(...args)
}

export async function savePowerOfAttorneyScopeAction(...args: Parameters<typeof implementation4.savePowerOfAttorneyScopeAction>) {
  return implementation4.savePowerOfAttorneyScopeAction(...args)
}

export async function registerCustomerLifecycleDecisionAction(...args: Parameters<typeof implementation4.registerCustomerLifecycleDecisionAction>) {
  return implementation4.registerCustomerLifecycleDecisionAction(...args)
}

export async function verifyCustomerSiteGridOwnerManually(...args: Parameters<typeof implementation4.verifyCustomerSiteGridOwnerManually>) {
  return implementation4.verifyCustomerSiteGridOwnerManually(...args)
}
