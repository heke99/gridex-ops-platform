import { applyPermissionMarketSource, type PermissionMarketTransitionResult } from '@/lib/ediel/permissions/permissionMarketTransition'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type ProdatPermissionPersistenceResult = Omit<PermissionMarketTransitionResult, 'status'> & {
  status: 'active' | 'ended' | 'partially_approved' | 'manual_review'
}

export async function applyInboundZ15PermissionState(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ProdatPermissionPersistenceResult> {
  if (String(params.message.message_code ?? '').toUpperCase().slice(0, 3) !== 'Z15') {
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'not_inbound_z15', idempotent: false }
  }
  // The full saved source and each physical scope are checked by the same
  // native owner. A malformed sibling cannot select or erase another outcome.
  const result = await applyPermissionMarketSource(params)
  return { ...result, status: result.applied
    ? result.status === 'ended' ? 'ended' : result.status === 'partially_approved' ? 'partially_approved' : 'active'
    : 'manual_review' }
}
