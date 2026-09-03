import { supabaseService } from '@/lib/supabase/service'
import { resolveAutomationActorId } from '@/lib/customer-operations/automationConfig'
import { syncCustomerOperationsForCustomer } from '@/lib/operations/db'
import { stockholmMarketDate } from '@/lib/operations/supplierSwitchActivation'

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

function integer(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function boundedLimit(value: number | undefined): number {
  const parsed = Number(value ?? 50)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(Math.max(Math.floor(parsed), 1), 100)
}

function activationFailures(value: unknown): ActivationFailure[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const row = record(entry)
    const code = text(row.code) ?? 'supplier_switch_activation_failed'
    return {
      requestId: text(row.requestId) ?? 'unknown',
      companyId: text(row.companyId),
      code,
      message: text(row.message) ?? `Automatisk leveransstart blockerades: ${code}.`,
    }
  })
}

/**
 * Runs the DB-native supplier activation sweep. Candidate discovery and the
 * state transition both live in PostgreSQL so the service-role application
 * never performs an unscoped tenant table scan. Each activation is row-locked,
 * tenant-bound, Z04-gated and date-gated.
 */
export async function processReadySupplierSwitchActivations(
  input: { limit?: number; actorUserId?: string | null } = {},
): Promise<SupplierSwitchActivationSweepResult> {
  const actorUserId = resolveAutomationActorId(input.actorUserId)
  const limit = boundedLimit(input.limit)

  const rpcClient = supabaseService as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  }

  const { data, error } = await rpcClient.rpc(
    'gridex_process_ready_supplier_switch_activations',
    {
      p_actor_user_id: actorUserId,
      p_limit: limit,
    },
  )

  if (error) {
    throw new Error(error.message ?? error.code ?? 'supplier_switch_activation_sweep_failed')
  }

  const payload = record(data)
  const failures = activationFailures(payload.failures)
  const activatedCustomerIds = Array.isArray(payload.activatedCustomerIds)
    ? [...new Set(payload.activatedCustomerIds.map(text).filter((value): value is string => Boolean(value)))]
    : []

  // Operational tasks are derived state. The market activation itself has
  // already committed atomically; a refresh failure must therefore be surfaced
  // without rolling back or misreporting the completed supplier switch.
  for (const customerId of activatedCustomerIds) {
    try {
      await syncCustomerOperationsForCustomer(supabaseService, customerId)
    } catch (syncError) {
      failures.push({
        requestId: 'derived-state-refresh',
        companyId: null,
        code: 'post_activation_customer_sync_failed',
        message: syncError instanceof Error
          ? syncError.message
          : 'Kundens derived operations-state kunde inte uppdateras efter leveransstart.',
      })
    }
  }

  return {
    marketDate: text(payload.marketDate) ?? stockholmMarketDate(),
    scanned: integer(payload.scanned),
    ready: integer(payload.ready),
    activated: integer(payload.activated),
    alreadyCompleted: integer(payload.alreadyCompleted),
    waiting: integer(payload.waiting),
    blocked: integer(payload.blocked),
    failed: integer(payload.failed),
    failures,
  }
}
