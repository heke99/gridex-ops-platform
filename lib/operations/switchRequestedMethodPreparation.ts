import { supabaseService } from '@/lib/supabase/service'
import { deriveContractRequestedMethodFromSignedAgreement } from '@/lib/ediel/production/contractRequestedMethodSource'

/**
 * Before a new agreement's Z03 is prepared, the requested metering method is
 * derived from the signed agreement when the contract has no declaration yet
 * (FINDINGS F46). The Ediel environment is chosen later by route resolution, so
 * both lanes are offered; the native owner declines a lane the tenant has no
 * identity for. Never blocks: a source that cannot be derived keeps Z03 held.
 */
export async function deriveRequestedMethodBeforeSwitch(input: { actorUserId: string; switchRequestId: string }) {
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('id,company_id,customer_contract_id,contract_id')
    .eq('id', input.switchRequestId)
    .maybeSingle()
  if (error || !data?.company_id) return
  const contractId = (data.customer_contract_id ?? data.contract_id) as string | null
  if (!contractId) return
  for (const environment of ['production', 'test'] as const) {
    await deriveContractRequestedMethodFromSignedAgreement({ companyId: data.company_id as string, contractId, actorUserId: input.actorUserId, environment })
      .catch(failure => console.warn('[switch] requested method derivation skipped', { switchRequestId: input.switchRequestId, environment, failure }))
  }
}
