import 'server-only'

import { supabaseService } from '@/lib/supabase/service'

const MAX_DUE_ITEMS = 10
const QUEUE_TIMEOUT_MS = 20_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const periodStatuses = ['pending', 'locked', 'incomplete', 'superseded', 'already_locked'] as const
const legacyStatuses = ['pending', 'applied', 'held'] as const

type DueFile = { company_id: string; file_id: string }
type QueueStats = {
  scanned: number
  listFailed: boolean
  deferred: number
  failed: number
}
type QueueResult = QueueStats & { counts: Map<string, number> }

function isDueFile(value: unknown): value is DueFile {
  if (!value || typeof value !== 'object') return false
  const { company_id, file_id } = value as Record<string, unknown>
  return typeof company_id === 'string' && UUID.test(company_id) && typeof file_id === 'string' && UUID.test(file_id)
}

async function runQueue(listRpc: string, reconcileRpc: string, statuses: readonly string[]): Promise<QueueResult> {
  const result: QueueResult = { scanned: 0, listFailed: false, deferred: 0, failed: 0, counts: new Map() }
  const signal = AbortSignal.timeout(QUEUE_TIMEOUT_MS)
  let files: DueFile[]

  try {
    const { data, error } = await supabaseService.rpc(listRpc, { p_limit: MAX_DUE_ITEMS }).abortSignal(signal)
    if (error || !Array.isArray(data) || data.length > MAX_DUE_ITEMS || !data.every(isDueFile)) {
      throw new Error('invoice_file_reconciliation_invalid_batch')
    }
    const keys = new Set(data.map(file => `${file.company_id.toLowerCase()}/${file.file_id.toLowerCase()}`))
    if (keys.size !== data.length) throw new Error('invoice_file_reconciliation_duplicate_batch_item')
    files = data
  } catch {
    result.listFailed = true
    return result
  }

  result.scanned = files.length
  for (const [index, file] of files.entries()) {
    if (signal.aborted) {
      result.deferred = files.length - index
      break
    }
    try {
      const { data, error } = await supabaseService.rpc(reconcileRpc, {
        p_company_id: file.company_id,
        p_file_id: file.file_id,
      }).abortSignal(signal)
      const { fileId, status } = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      if (error || fileId !== file.file_id || typeof status !== 'string' || !statuses.includes(status)) {
        throw new Error('invoice_file_reconciliation_invalid_result')
      }
      result.counts.set(status, (result.counts.get(status) ?? 0) + 1)
    } catch {
      // The native job stays retryable or can return the same durable receipt.
      result.failed += 1
    }
  }
  return result
}

export async function runInvoiceFileReconciliation() {
  // These independent lanes have separate budgets. Exhausting one may not starve the other.
  const { counts: periodCounts, ...periodStats } = await runQueue(
    'gridex_list_due_invoice_export_period_reconciliations_v1',
    'gridex_reconcile_invoice_export_period_v1',
    periodStatuses,
  )
  const { counts: legacyCounts, ...legacyStats } = await runQueue(
    'gridex_list_due_invoice_export_legacy_projections_v1',
    'gridex_reconcile_invoice_export_legacy_projection_v1',
    legacyStatuses,
  )
  const period = {
    ...periodStats,
    locked: periodCounts.get('locked') ?? 0,
    alreadyLocked: periodCounts.get('already_locked') ?? 0,
    incomplete: periodCounts.get('incomplete') ?? 0,
    superseded: periodCounts.get('superseded') ?? 0,
    retryPending: periodCounts.get('pending') ?? 0,
  }
  const legacy = {
    ...legacyStats,
    applied: legacyCounts.get('applied') ?? 0,
    held: legacyCounts.get('held') ?? 0,
    retryPending: legacyCounts.get('pending') ?? 0,
  }
  const completed = period.locked + period.alreadyLocked + period.incomplete + period.superseded + legacy.applied + legacy.held
  const hasRetry = [period, legacy].some(queue => queue.listFailed || queue.failed || queue.deferred || queue.retryPending)
  return { status: hasRetry ? completed > 0 ? 'partial' as const : 'failed' as const : 'completed' as const, period, legacy }
}

export async function loadInvoiceFileEffects(companyId: string, fileId: string, rowCount: number) {
  const { data, error } = await supabaseService.rpc('gridex_read_invoice_export_effects_v1', {
    p_company_id: companyId,
    p_file_id: fileId,
  })
  if (error) throw error
  const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const status = receipt.status as (typeof legacyStatuses)[number]
  const { expectedEventCount, eventCount, missingFanoutCount } = receipt
  if (receipt.fileId !== fileId || !legacyStatuses.includes(status) || expectedEventCount !== rowCount ||
      typeof eventCount !== 'number' || !Number.isSafeInteger(eventCount) || eventCount < 0 || eventCount > rowCount ||
      typeof missingFanoutCount !== 'number' || !Number.isSafeInteger(missingFanoutCount) || missingFanoutCount < 0 || missingFanoutCount > rowCount) {
    throw new Error('invoice_file_invalid_effects_receipt')
  }
  return {
    status, expectedEventCount, eventCount, missingFanoutCount,
    retryingAfterFailure: status === 'pending' && receipt.reason === 'legacy_projection_failed',
  }
}
