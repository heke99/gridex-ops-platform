import { supabaseService } from '@/lib/supabase/service'
import { resolveAutomationActorId } from '@/lib/customer-operations/automationConfig'
import { syncCustomerOperationsForCustomer } from '@/lib/operations/db'
import {
  getSupplierSwitchActivationReadiness,
  stockholmMarketDate,
} from '@/lib/operations/supplierSwitchActivation'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

type JsonRecord = Record<string, unknown>

type ActivationFailure = {
  requestId: string
  companyId: string | null
  code: string
  message: string
}

export type SupplierSwitchActivationSweepResult = {
  marketDate: string
  scanned: number
  ready: number
  activated: number
  alreadyCompleted: number
  waiting: number
  blocked: number
  failed: number
  failures: ActivationFailure[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string | null {
  const cleaned = typeof value === 'string' ? value.trim() : ''
  return cleaned || null
}

function boundedLimit(value: number | undefined): number {
  const parsed = Number(value ?? 50)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(Math.max(Math.floor(parsed), 1), 100)
}

/**
 * Finalizes accepted supplier switches when Gridex actually becomes the active
 * supplier. The database RPC is the final authority and performs the transition
 * atomically under a row lock. This sweep only discovers candidates.
 */
export async function processReadySupplierSwitchActivations(
  input: { limit?: number; actorUserId?: string | null } = {},
): Promise<SupplierSwitchActivationSweepResult> {
  const limit = boundedLimit(input.limit)
  const actorUserId = resolveAutomationActorId(input.actorUserId)
  const marketDate = stockholmMarketDate()

  // Pull a wider accepted window because confirmed_start_date is authoritative
  // when present, while older rows may only have requested_start_date.
  const candidateLimit = Math.min(Math.max(limit * 10, 100), 500)
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('*')
    .eq('status', 'accepted')
    .order('requested_start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(candidateLimit)

  if (error) throw error

  const candidates = (data ?? []) as SupplierSwitchRequestRow[]
  const readyCandidates = candidates
    .filter((request) => getSupplierSwitchActivationReadiness(request).ready)
    .slice(0, limit)

  const result: SupplierSwitchActivationSweepResult = {
    marketDate,
    scanned: candidates.length,
    ready: readyCandidates.length,
    activated: 0,
    alreadyCompleted: 0,
    waiting: 0,
    blocked: 0,
    failed: 0,
    failures: [],
  }

  const rpcClient = supabaseService as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  }

  for (const request of readyCandidates) {
    const companyId = text(request.company_id)
    if (!companyId) {
      result.failed += 1
      result.failures.push({
        requestId: request.id,
        companyId: null,
        code: 'supplier_switch_company_missing',
        message: 'Accepted switchärende saknar company_id och får inte aktiveras.',
      })
      continue
    }

    try {
      const { data: rpcData, error: rpcError } = await rpcClient.rpc(
        'gridex_finalize_supplier_switch_activation',
        {
          p_company_id: companyId,
          p_request_id: request.id,
          p_actor_user_id: actorUserId,
        },
      )

      if (rpcError) throw new Error(rpcError.message ?? rpcError.code ?? 'supplier_switch_activation_rpc_failed')

      const activation = record(rpcData)
      const status = text(activation.status) ?? 'unknown'
      const reasonCode = text(activation.reason_code)

      if (status === 'activated') {
        result.activated += 1
        // Customer-operation tasks are derived state. Refresh them only after
        // the atomic market activation has committed.
        await syncCustomerOperationsForCustomer(supabaseService, request.customer_id)
        continue
      }

      if (status === 'already_completed') {
        result.alreadyCompleted += 1
        continue
      }

      if (status === 'waiting') {
        result.waiting += 1
        continue
      }

      if (status === 'blocked') {
        result.blocked += 1
        result.failures.push({
          requestId: request.id,
          companyId,
          code: reasonCode ?? 'supplier_switch_activation_blocked',
          message: `Automatisk leveransstart blockerades: ${reasonCode ?? 'okänd blockerare'}.`,
        })
        continue
      }

      result.failed += 1
      result.failures.push({
        requestId: request.id,
        companyId,
        code: reasonCode ?? 'supplier_switch_activation_unexpected_result',
        message: `Oväntat resultat från automatisk leveransstart: ${status}.`,
      })
    } catch (activationError) {
      result.failed += 1
      result.failures.push({
        requestId: request.id,
        companyId,
        code: 'supplier_switch_activation_failed',
        message: activationError instanceof Error
          ? activationError.message
          : 'Automatisk leveransstart misslyckades.',
      })
    }
  }

  return result
}
