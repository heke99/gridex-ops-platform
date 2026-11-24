import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { readConfirmedMarketStarts } from '@/lib/operations/readyBulkCandidates'
import { getVerifiedSupplierSwitchActivationReadiness, type SupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
import { readResult } from '@/lib/read-models/readResult'

export type SwitchActivationByRequest = Readonly<Partial<Record<string, SupplierSwitchActivationReadiness>>>

/** Authority belongs to the calling page. Make only the qualified visible scope
 * available to the read model and pass business status to client components. */
export async function readSwitchActivationPresentation(
  supabase: SupabaseClient,
  requests: readonly SupplierSwitchRequestRow[],
  scope: { companyId: string | null; customerId?: string },
): Promise<{ byRequestId: SwitchActivationByRequest; unavailable: boolean }> {
  const candidates = requests.filter(request => request.status === 'accepted'
    && (scope.companyId === null || request.company_id === scope.companyId)
    && (scope.customerId === undefined || request.customer_id === scope.customerId))
  if (!candidates.length) return { byRequestId: {}, unavailable: false }

  const now = new Date()
  const starts = await readResult(
    () => readConfirmedMarketStarts(supabase, candidates),
    { definitionVersion: 'supplier_switch_confirmed_market_start_v1', errorCode: 'SWITCH_MARKET_START_UNAVAILABLE' },
  )
  return {
    byRequestId: Object.fromEntries(candidates.map(request => [
      request.id,
      getVerifiedSupplierSwitchActivationReadiness(
        request, starts.kind === 'unavailable' ? undefined : starts.data.get(request.id.toLowerCase()) ?? null, now,
      ),
    ])),
    unavailable: starts.kind === 'unavailable',
  }
}
