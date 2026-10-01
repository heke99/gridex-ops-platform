import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { supabaseService } from '@/lib/supabase/service'

export type ManualEmailClaim = Record<string, unknown> & {
  id: string
  company_id: string
  status: 'sending'
  locked_by: string
  claim_token: string
  attempts: number
}

type RpcName = 'gridex_claim_manual_email_outbox_fair_v1' | 'gridex_recover_stale_manual_email_outbox_v1' |
  'gridex_recheck_manual_email_claim_v1' | 'gridex_finish_manual_email_claim_v1'
// The new forward is not yet part of the last genuine generated type capture.
// Keep this bounded interface explicit until that capture exists.
const client = supabaseService as unknown as {
  rpc(name: RpcName, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const payloadFields = ['company_id', 'request_id', 'to_email', 'actual_recipient_email', 'from_email', 'reply_to',
  'subject', 'body_html', 'body_text', 'attachments', 'idempotency_key', 'provider_idempotency_key', 'provider',
  'recipient_resolution', 'external_delivery', 'attempts'] as const
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)

export function manualEmailClaimLimit(value: unknown): number {
  const parsed = Number(value ?? 25)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed) || 25)) : 25
}

export async function claimManualEmailRows(companyId: string | null, limit: number, workerId: string): Promise<ManualEmailClaim[]> {
  const token = randomUUID()
  const { data, error } = await client.rpc('gridex_claim_manual_email_outbox_fair_v1', {
    p_company_id: companyId, p_limit: limit, p_worker_id: workerId, p_claim_token: token,
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length > limit || new Set(data.map(row => isRecord(row) ? row.id : null)).size !== data.length ||
    data.some(row => !isRecord(row) || !isUuid(row.id) || !isUuid(row.company_id) || row.status !== 'sending' ||
      row.external_delivery !== true || row.locked_by !== workerId || row.claim_token !== token ||
      !Number.isSafeInteger(row.attempts) || Number(row.attempts) < 0 || (companyId && row.company_id !== companyId))) {
    throw new Error('manual_email_claim_receipt_invalid')
  }
  return data as ManualEmailClaim[]
}

export async function recoverStaleManualEmailRows(companyId: string | null, limit: number): Promise<Array<{ id: string; company_id: string; request_id: string | null }>> {
  const { data, error } = await client.rpc('gridex_recover_stale_manual_email_outbox_v1', { p_company_id: companyId, p_limit: limit })
  if (error) throw error
  if (!Array.isArray(data) || data.length > limit || new Set(data.map(row => isRecord(row) ? row.id : null)).size !== data.length ||
    data.some(row => !isRecord(row) || !isUuid(row.id) || !isUuid(row.company_id) ||
      (row.request_id !== null && !isUuid(row.request_id)) || (companyId && row.company_id !== companyId))) {
    throw new Error('manual_email_recovery_receipt_invalid')
  }
  return data as Array<{ id: string; company_id: string; request_id: string | null }>
}

export async function recheckManualEmailClaim(row: ManualEmailClaim): Promise<boolean> {
  const { data, error } = await client.rpc('gridex_recheck_manual_email_claim_v1', {
    p_company_id: row.company_id, p_item_id: row.id, p_worker_id: row.locked_by, p_claim_token: row.claim_token,
  })
  if (error) throw error
  if (Array.isArray(data) && data.length === 0) return false
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0]) || data[0].id !== row.id ||
    data[0].company_id !== row.company_id || data[0].status !== 'sending' || data[0].locked_by !== row.locked_by ||
    payloadFields.some(key => !isDeepStrictEqual(data[0][key], row[key]))) throw new Error('manual_email_recheck_receipt_invalid')
  return true
}

export async function finishManualEmailClaim(row: ManualEmailClaim, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await client.rpc('gridex_finish_manual_email_claim_v1', {
    p_company_id: row.company_id, p_item_id: row.id, p_worker_id: row.locked_by, p_claim_token: row.claim_token, p_patch: patch,
  })
  if (error) throw error
  if (data !== true) throw new Error('manual_email_live_completion_not_saved')
}
