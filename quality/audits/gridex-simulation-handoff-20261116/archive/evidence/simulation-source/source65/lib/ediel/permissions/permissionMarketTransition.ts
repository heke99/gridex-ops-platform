import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { SourceObjectScope } from '@/lib/ediel/sources/sourceOwnerWire'

export type PermissionObjectDisposition = {
  object: SourceObjectScope
  status: 'applied' | 'rejected' | 'held'
  permissionId?: string
  reason?: string | null
}

export type PermissionMarketTransitionResult = {
  applied: boolean
  permissionId: string | null
  status: string | null
  reason: string | null
  idempotent: boolean
  /** Present only for an actual prospective native partition receipt. */
  manifest?: PermissionObjectDisposition[]
  /** Every physical scope was processed; a source-qualified N denial also counts. */
  fullyApplied?: boolean
  /** At least one physical scope had no effect because it was rejected or held. */
  reviewRequired?: boolean
  permissionResults?: { applied: boolean; permissionId: string; status?: string; reason?: string }[]
  sourceMessageId?: string
  sourceCode?: 'Z14' | 'Z15'
  canonicalAssessmentId?: string
  sourcePayloadHash?: string
}

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nullableText = (value: unknown) => value === null || typeof value === 'string'

function nativePartition(result: Record<string, unknown>, sourceMessageId: string, sourceCode: string): Partial<PermissionMarketTransitionResult> {
  if (result.manifest === undefined) return {} // Genuine historical fixed whole-source result.
  if (result.version !== 1 || result.sourceMessageId !== sourceMessageId || result.sourceCode !== sourceCode || !['Z14','Z15'].includes(sourceCode) || !uuid(result.canonicalAssessmentId)
    || typeof result.sourcePayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourcePayloadHash)
    || !Array.isArray(result.manifest) || !result.manifest.length || !Array.isArray(result.permissionResults)) throw Error('permission_native_partition_invalid')
  const indices = new Set<number>()
  for (const entry of result.manifest) {
    if (!record(entry) || !['applied', 'rejected', 'held'].includes(String(entry.status)) || !record(entry.object)
      || entry.permissionId !== undefined && !uuid(entry.permissionId)
      || entry.reason !== undefined && !nullableText(entry.reason)) throw Error('permission_native_partition_invalid')
    const scope = entry.object
    if (!Number.isSafeInteger(scope.messageIndex) || Number(scope.messageIndex) < 0 || !nullableText(scope.messageReference)
      || !nullableText(scope.objectId) || !nullableText(scope.identityAgency) || !Array.isArray(scope.registers) || !scope.registers.length) throw Error('permission_native_partition_invalid')
    for (const register of scope.registers) {
      if (!record(register) || !Number.isSafeInteger(register.segmentIndex) || Number(register.segmentIndex) < 0
        || !Number.isSafeInteger(register.lineIndex) || Number(register.lineIndex) < 0
        || !Number.isSafeInteger(register.registerPosition) || Number(register.registerPosition) < 0
        || !nullableText(register.lineNumber) || !nullableText(register.registerIndex)
        || indices.has(Number(register.segmentIndex))) throw Error('permission_native_partition_invalid')
      indices.add(Number(register.segmentIndex))
    }
    if (entry.status === 'applied' && !uuid(entry.permissionId)) throw Error('permission_native_partition_invalid')
  }
  if (result.applied !== result.manifest.some(entry => entry.status === 'applied') || result.permissionResults.some(entry => !record(entry)
    || typeof entry.applied !== 'boolean' || !uuid(entry.permissionId) || entry.status !== undefined && !nullableText(entry.status)
    || entry.reason !== undefined && !nullableText(entry.reason))) throw Error('permission_native_partition_invalid')
  const permissionIds = new Set<string>()
  for (const entry of result.permissionResults) {
    if (permissionIds.has(entry.permissionId) || entry.applied !== result.manifest.some(scope => scope.permissionId === entry.permissionId && scope.status === 'applied')) throw Error('permission_native_partition_invalid')
    permissionIds.add(entry.permissionId)
  }
  if (result.manifest.some(entry => entry.status === 'applied' && !permissionIds.has(entry.permissionId))) throw Error('permission_native_partition_invalid')
  return { manifest: result.manifest as PermissionObjectDisposition[], permissionResults: result.permissionResults,
    fullyApplied: result.manifest.every(entry => entry.status === 'applied'),
    reviewRequired: result.manifest.some(entry => entry.status !== 'applied'),
    sourceMessageId, sourceCode: sourceCode as 'Z14' | 'Z15', canonicalAssessmentId: result.canonicalAssessmentId, sourcePayloadHash: result.sourcePayloadHash }
}

/** All consumers, including operator-selected messages, use the same durable
 * source executor. No caller-provided status, date, actor or object is evidence. */
export async function applyPermissionMarketSource(params: {
  actorUserId: string
  message: Pick<EdielMessageRow, 'id' | 'company_id' | 'direction' | 'message_family' | 'message_code'>
  expectedPermissionId?: string | null
}): Promise<PermissionMarketTransitionResult> {
  if (!params.message.company_id || params.message.direction !== 'inbound'
    || params.message.message_family !== 'PRODAT'
    || !['Z14', 'Z15'].includes(String(params.message.message_code ?? '').toUpperCase().slice(0, 3))) {
    return { applied: false, permissionId: null, status: null, reason: 'not_inbound_permission_source', idempotent: false }
  }
  const { data, error } = await supabaseService.rpc('ediel_apply_permission_source_v1', {
    p_company_id: params.message.company_id,
    p_source_message_id: params.message.id,
    p_actor_user_id: params.actorUserId,
    p_expected_permission_id: params.expectedPermissionId ?? null,
  })
  if (error) throw error
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return { applied: result.applied === true, permissionId: typeof result.permissionId === 'string' ? result.permissionId : null,
    status: typeof result.status === 'string' ? result.status : null, reason: typeof result.reason === 'string' ? result.reason : null,
    idempotent: result.idempotent === true, ...nativePartition(result, params.message.id, String(params.message.message_code ?? '').toUpperCase().slice(0, 3)) }
}

/** Advance only an already source-approved end timestamp. Never fabricates a
 * market response or originates a request. Durable locks serialize with C. */
export async function advancePermissionMarketDeadlines(params: { actorUserId: string; companyId?: string | null; limit?: number }): Promise<{ updated: number }> {
  const { data, error } = await supabaseService.rpc('ediel_advance_permission_deadlines_v1', {
    p_actor_user_id: params.actorUserId, p_company_id: params.companyId ?? null,
    p_limit: Math.min(Math.max(Math.floor(params.limit ?? 100), 1), 200),
  })
  if (error) throw error
  return { updated: typeof data?.updated === 'number' ? data.updated : 0 }
}
