"use server";

// Stable public facade. Implementations are split into 4 characterized modules.
import * as implementation1 from './actions.part-1'
import * as implementation2 from './actions.part-2'
import * as implementation3 from './actions.part-3'
import * as implementation4 from './actions.part-4'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import { ensureAndPrepareUtiltsFromDataRequest } from '@/lib/cis/edielAutomation'

export type { CustomerOperationActionState } from './actions.part-2'

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function listMeterValueRequestIds(customerId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const pageSize = 500

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseService
      .from('grid_owner_data_requests')
      .select('id')
      .eq('customer_id', customerId)
      .eq('request_scope', 'meter_values')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw error
    for (const row of data ?? []) ids.add(String(row.id))
    if ((data ?? []).length < pageSize) break
  }

  return ids
}

async function runCustomerActionWithMeterValuePreparation<T>(input: {
  formData: FormData
  operation: () => Promise<T>
}): Promise<T> {
  const customerId = formText(input.formData, 'customer_id')
  if (!customerId) return input.operation()

  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const beforeIds = await listMeterValueRequestIds(customerId)
  const result = await input.operation()
  const afterIds = await listMeterValueRequestIds(customerId)
  const createdIds = [...afterIds].filter((id) => !beforeIds.has(id))

  // Every new meter-value request created from the customer card must enter the
  // canonical supplier path immediately. Other request scopes are ignored.
  for (const dataRequestId of createdIds) {
    await ensureAndPrepareUtiltsFromDataRequest({
      actorUserId: guard.userId,
      dataRequestId,
      utiltsCode: 'E73',
    })
  }

  return result
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
  return runCustomerActionWithMeterValuePreparation({
    formData,
    operation: () => implementation3.createGridOwnerDataRequestAction(...args),
  })
}

export async function createAuthorizationRequestPackageAction(...args: Parameters<typeof implementation3.createAuthorizationRequestPackageAction>) {
  const [formData] = args
  return runCustomerActionWithMeterValuePreparation({
    formData,
    operation: () => implementation3.createAuthorizationRequestPackageAction(...args),
  })
}

export async function createCustomerDataRequestPackageAction(...args: Parameters<typeof implementation3.createCustomerDataRequestPackageAction>) {
  const [formData] = args
  return runCustomerActionWithMeterValuePreparation({
    formData,
    operation: () => implementation3.createCustomerDataRequestPackageAction(...args),
  })
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
