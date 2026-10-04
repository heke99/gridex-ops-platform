import { supabaseService } from '@/lib/supabase/service'
import { StaffApiError } from '@/lib/staff-api/errors'
import { decryptStaffPayload, encryptStaffPayload, staffHash, type StaffStage } from '@/lib/staff-api/crypto'

export type NativeFactor = { id: string; method: string; friendly_name: string | null }
export type StaffSessionPayload = {
  accessToken: string; refreshToken: string; stage: StaffStage; recovery: boolean
  factors: NativeFactor[]; challenge?: { reference: string; factorId: string; nativeId: string; expiresAt: string }
}
export type StaffSessionRow = {
  id: string; user_id: string; company_id: string; api_client_id: string; native_session_id: string
  encrypted_payload: string; refresh_hash: string; previous_refresh_hash: string | null
  revision: number; stage: StaffStage; native_aal: 'aal1' | 'aal2'; status: 'active' | 'revoked' | 'blocked'
  expires_at: string; lease_id: string | null; lease_expires_at: string | null
}
export function sessionPayload(row: StaffSessionRow) { return decryptStaffPayload<StaffSessionPayload>(row.encrypted_payload, row.id) }
export async function staffRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseService.rpc(name, args)
  if (error) throw new StaffApiError(error.code === '42501' ? 403 : 503, error.code === '42501' ? 'staff_permission_denied' : 'staff_session_unavailable', error.code === '42501' ? 'Staff authorization was revoked.' : 'Staff session service is unavailable.', error.code !== '42501')
  return data as T
}
export async function loadStaffSession(id: string) {
  const { data, error } = await supabaseService.from('staff_api_sessions').select('*').eq('id', id).maybeSingle()
  if (error) throw new StaffApiError(503, 'staff_session_unavailable', 'Staff session service is unavailable.', true)
  return data as StaffSessionRow | null
}
export async function loadStaffSessionByRefresh(token: string) {
  const hash = staffHash(`refresh:${token}`)
  const { data, error } = await supabaseService.from('staff_api_sessions').select('*').or(`refresh_hash.eq.${hash},previous_refresh_hash.eq.${hash}`).maybeSingle()
  if (error) throw new StaffApiError(503, 'staff_session_unavailable', 'Staff session service is unavailable.', true)
  return data as StaffSessionRow | null
}
export async function insertStaffSession(row: Omit<StaffSessionRow, 'lease_id' | 'lease_expires_at' | 'previous_refresh_hash'>) {
  const { error } = await supabaseService.from('staff_api_sessions').insert(row)
  if (error?.code === '42501') throw new StaffApiError(403, 'staff_permission_denied', 'Staff authorization was revoked.')
  if (error) throw new StaffApiError(503, 'staff_session_unavailable', 'Staff session could not be stored.', true)
}
export type AcquiredOperation = { state: 'acquired'; session: StaffSessionRow; lease_id: string } | { state: 'replay'; session: StaffSessionRow; receipt: string } | { state: 'invalid' | 'conflict' | 'busy' | 'uncertain' }
export async function acquireSessionOperation(row: StaffSessionRow, input: { key: string; command: string; digest: string; revision?: number; refreshHash?: string }): Promise<AcquiredOperation> {
  return staffRpc('staff_api_acquire_session_operation', { p_session_id: row.id, p_client_id: row.api_client_id, p_company_id: row.company_id, p_operation_key: input.key, p_command: input.command, p_request_hash: input.digest, p_revision: input.revision ?? null, p_refresh_hash: input.refreshHash ?? null })
}
export function operationError(result: Exclude<AcquiredOperation, { state: 'acquired' | 'replay' }>): never {
  if (result.state === 'busy') throw new StaffApiError(409, 'staff_session_busy', 'Another staff authentication operation is in progress.', true, [], 1)
  if (result.state === 'conflict') throw new StaffApiError(409, 'idempotency_conflict', 'The operation reference no longer matches this request.')
  throw new StaffApiError(401, result.state === 'uncertain' ? 'staff_reauthentication_required' : 'staff_session_invalid', 'Staff authentication is required.')
}
export async function completeSessionOperation(row: StaffSessionRow, leaseId: string, payload: StaffSessionPayload, nativeSessionId: string, nativeAal: 'aal1' | 'aal2', receipt: unknown, options: { advance: boolean; refreshToken?: string }) {
  const revision = await staffRpc<number>('staff_api_complete_session_operation', { p_session_id: row.id, p_lease_id: leaseId, p_encrypted_payload: encryptStaffPayload(payload, row.id), p_native_session_id: nativeSessionId, p_stage: payload.stage, p_native_aal: nativeAal, p_refresh_hash: options.refreshToken ? staffHash(`refresh:${options.refreshToken}`) : null, p_encrypted_receipt: receipt === null ? null : encryptStaffPayload(receipt, `receipt:${row.id}`), p_advance_revision: options.advance })
  // Zero commits the database's durable block after a consuming native Auth
  // call; throwing inside that transaction would undo the block.
  if (revision === 0) throw new StaffApiError(403, 'staff_permission_denied', 'Staff authorization was revoked.')
  return revision
}
export async function revokeStaffSession(row: StaffSessionRow, status: 'revoked' | 'blocked' = 'revoked') { await staffRpc('staff_api_revoke_session', { p_session_id: row.id, p_client_id: row.api_client_id, p_company_id: row.company_id, p_status: status }) }
