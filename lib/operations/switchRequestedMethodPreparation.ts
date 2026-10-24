import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { deriveContractRequestedMethodFromSignedAgreement } from '@/lib/ediel/production/contractRequestedMethodSource'
import { deriveCustomerMasterdataBeforeSwitch } from '@/lib/operations/switchCustomerMasterdataPreparation'
import { selectInvoiceeBeforeSwitch } from '@/lib/operations/switchInvoiceePreparation'

/**
 * Before a new agreement's Z03 is prepared, the requested metering method is
 * derived from the signed agreement when the contract has no declaration yet
 * (FINDINGS F46). The Ediel environment is chosen later by route resolution, so
 * both lanes are offered; the native owner declines a lane the tenant has no
 * identity for. Never blocks: a source that cannot be derived keeps Z03 held.
 * The end user's masterdata declaration is derived from the same signed
 * agreement (FINDINGS F51); both switch paths (automation and startSupplierSwitch)
 * call this one preparation. The Z03's invoicee is selected from the same contract (FINDINGS F87).
 */
export async function deriveRequestedMethodBeforeSwitch(input: { companyId: string; actorUserId: string; switchRequestId: string }) {
  const { data, error } = await tenantSelect(input.companyId, "supplier_switch_requests", 'id,company_id,customer_contract_id,contract_id')
    .eq('id', input.switchRequestId)
    .returns<Array<{ id: string; company_id: string; customer_contract_id: string | null; contract_id: string | null }>>().maybeSingle()
  if (error || data?.company_id !== input.companyId) return
  const contractId = (data.customer_contract_id ?? data.contract_id) as string | null
  if (!contractId) return
  for (const environment of ['production', 'test'] as const) {
    await deriveContractRequestedMethodFromSignedAgreement({ companyId: data.company_id as string, contractId, actorUserId: input.actorUserId, environment })
      .catch(failure => console.warn('[switch] requested method derivation skipped', { switchRequestId: input.switchRequestId, environment, failure }))
  }
  await deriveCustomerMasterdataBeforeSwitch(input)
  // The invoicee is selected against that masterdata, so it runs last (FINDINGS F87).
  await selectInvoiceeBeforeSwitch(input)
}
