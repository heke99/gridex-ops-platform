import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatDateSyntaxIssues } from '@/lib/ediel/prodat/prodatDateFields'
import { applyPermissionMarketSource } from '@/lib/ediel/permissions/permissionMarketTransition'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type ProdatPermissionPersistenceResult = {
  applied: boolean
  permissionId: string | null
  status: 'active' | 'ended' | 'manual_review'
  reason: string | null
}

export async function applyInboundZ15PermissionState(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ProdatPermissionPersistenceResult> {
  if (String(params.message.message_code ?? '').toUpperCase().slice(0, 3) !== 'Z15') {
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'not_inbound_z15' }
  }
  const parsed = parseProdatMessage(params.message)
  const wire = tokenizeEdifact(params.message.raw_payload)
  if (!parsed.lineItems.length || parsed.lineItems.some(line => !line.meteringPointId || !line.permissionEndTimestamp || !/^[0-9]{12}$/.test(line.permissionEndTimestamp))
    || prodatDateSyntaxIssues(wire.segments, wire.una).length) {
    return { applied: false, permissionId: null, status: 'manual_review', reason: 'invalid_z15_permission_end_evidence' }
  }
  const result = await applyPermissionMarketSource(params)
  return { applied: result.applied, permissionId: result.permissionId,
    status: result.applied ? result.status === 'ended' ? 'ended' : 'active' : 'manual_review', reason: result.reason }
}
