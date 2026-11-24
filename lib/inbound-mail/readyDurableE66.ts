import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import type { MeterValueBillingGateCommand } from '@/lib/billing/meterValueBillingMatcher'
import type { DurableE66Scope } from '@/lib/inbound-mail/qualifyDurableE66'
import { supabaseService } from '@/lib/supabase/service'

type Scope = { p_company: string; p_environment: DurableE66Scope['environment']; p_mailbox: string; p_actor: string }
type Lease = Scope & { p_source: string; p_lease: string }
type Commit = Lease & { p_next: number; p_metering_id: string; p_normalized_id: string; p_gate: MeterValueBillingGateCommand['p_gate'] }
type Response = PromiseLike<{ data: unknown; error: { message: string } | null }>
type ReadyResult =
  | { state: 'idle' }
  | { state: 'retry_required'; sourceId: string; nextOrdinal: number; observationCount: number; reason: 'database_lock_contended' }
  | { state: 'progress' | 'sealed'; sourceId: string; nextOrdinal: number; observationCount: number }

// The ordinary REST path allows 8 seconds. Reserve a separate network margin.
const SEAL_HEADROOM_MS = 8_500
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('e66_readiness_receipt_invalid')
  }
  return value as Record<string, unknown>
}

export async function readyNextDurableE66(
  scope: DurableE66Scope,
  limits: { maxValues: number; budgetMs: number },
): Promise<ReadyResult> {
  if (!Number.isInteger(limits.maxValues) || limits.maxValues < 1 || limits.maxValues > 16 ||
      !Number.isInteger(limits.budgetMs) || limits.budgetMs < 1 || limits.budgetMs > 30_000) {
    throw new Error('e66_readiness_limits_invalid')
  }
  const started = performance.now()
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as {
    (name: 'gridex_claim_e66_readiness_v1', args: Scope): Response
    (name: 'gridex_read_e66_readiness_batch_v1', args: Lease & { p_limit: number }): Response
    (name: 'gridex_commit_e66_readiness_v1', args: Commit): Response
    (name: 'gridex_yield_e66_readiness_v1', args: Lease & { p_next: number }): Response
    (name: 'gridex_seal_e66_with_request_handoff_v1', args: Lease): Response
  }
  const nativeScope: Scope = {
    p_company: scope.companyId, p_environment: scope.environment, p_mailbox: scope.mailboxId, p_actor: scope.actorUserId,
  }
  const claimed = await rpc('gridex_claim_e66_readiness_v1', nativeScope)
  if (claimed.error) throw new Error(`e66_readiness_claim_failed:${claimed.error.message}`)
  const claim = asRecord(claimed.data)
  if (claim.kind === 'idle') return { state: 'idle' }
  if (claim.kind !== 'claimed' || claim.phase !== 'readiness' ||
      typeof claim.sourceId !== 'string' || !uuid.test(claim.sourceId) ||
      typeof claim.leaseToken !== 'string' || !uuid.test(claim.leaseToken)) {
    throw new Error('e66_readiness_claim_invalid')
  }
  const leaseUntil = typeof claim.leaseUntil === 'string' ? Date.parse(claim.leaseUntil) : NaN
  if (!Number.isFinite(leaseUntil)) throw new Error('e66_readiness_lease_deadline_invalid')
  // Convert the server wall-clock cutoff once to a local monotonic deadline.
  // Native still rechecks the actual deadline and token under the row lock.
  const leaseDeadline = performance.now() + leaseUntil - Date.now()
  const phaseDeadline = started + limits.budgetMs
  const sourceId = claim.sourceId
  const lease = { ...nativeScope, p_source: sourceId, p_lease: claim.leaseToken }
  const loaded = await rpc('gridex_read_e66_readiness_batch_v1', { ...lease, p_limit: limits.maxValues })
  if (loaded.error) throw new Error(`e66_readiness_batch_failed:${loaded.error.message}`)
  const batch = asRecord(loaded.data)
  const { observationCount, nextOrdinal, values } = batch
  if (batch.sourceId !== sourceId || typeof observationCount !== 'number' || !Number.isSafeInteger(observationCount) ||
      typeof nextOrdinal !== 'number' || !Number.isSafeInteger(nextOrdinal) || nextOrdinal < 0 ||
      observationCount < 1 || nextOrdinal > observationCount || claim.nextOrdinal !== nextOrdinal ||
      !Array.isArray(values) || values.length !== Math.min(limits.maxValues, observationCount - nextOrdinal)) {
    throw new Error('e66_readiness_batch_invalid')
  }

  const meters = values.map((value, index) => {
    const entry = asRecord(value)
    const meter = asRecord(entry.meter)
    const id = meter.id
    const point = meter.metering_point_id
    const periodStart = meter.period_start
    const periodEnd = meter.period_end
    const normalizedId = entry.normalizedId
    if (entry.ordinal !== nextOrdinal + index || typeof normalizedId !== 'string' || !uuid.test(normalizedId) ||
        typeof id !== 'string' || !uuid.test(id) || meter.company_id !== scope.companyId ||
        typeof point !== 'string' || !uuid.test(point) || typeof periodStart !== 'string' ||
        typeof periodEnd !== 'string' || meter.source_ediel_message_id !== sourceId) {
      throw new Error('e66_readiness_meter_scope_invalid')
    }
    return { id, point, periodStart, periodEnd, normalizedId }
  })
  const qualifiedValues = await loadQualifiedBillingValues(scope.companyId, meters.map((row) => row.normalizedId))
  let next = nextOrdinal
  for (const { id, point, periodStart, periodEnd, normalizedId } of meters) {
    if (next > nextOrdinal && performance.now() - started >= limits.budgetMs) break
    const status = await updateMeterValueBillingReadiness({
      meterValue: {
        id, company_id: scope.companyId, metering_point_id: point,
        period_start: periodStart, period_end: periodEnd, source_ediel_message_id: sourceId,
      },
      sourceMessageId: sourceId,
      qualifiedValues,
      async commitBillingGate(command) {
        if (command.p_company_id !== scope.companyId || command.p_gate.source_message_id !== sourceId ||
            command.p_metering_value_id !== id || command.p_normalized_value_id !== normalizedId) {
          throw new Error('e66_readiness_command_scope_invalid')
        }
        const result = await rpc('gridex_commit_e66_readiness_v1', {
          ...lease, p_next: next, p_metering_id: id, p_normalized_id: normalizedId, p_gate: command.p_gate,
        })
        if (result.error) throw new Error(result.error.message)
        if (asRecord(result.data).nextOrdinal !== next + 1) throw new Error('e66_readiness_checkpoint_invalid')
      },
    })
    if (status !== 'billable') throw new Error('e66_readiness_unavailable')
    next += 1
  }
  if (next === observationCount &&
      Math.min(phaseDeadline, leaseDeadline) - performance.now() >= SEAL_HEADROOM_MS) {
    const sealed = await rpc('gridex_seal_e66_with_request_handoff_v1', lease)
    if (sealed.error) throw new Error(`e66_readiness_seal_failed:${sealed.error.message}`)
    const receipt = asRecord(sealed.data)
    if (receipt.state === 'retry_required') {
      if (receipt.sourceId !== sourceId || receipt.phase !== 'readiness' || receipt.checkpoint !== next ||
          receipt.reason !== 'database_lock_contended') throw new Error('e66_readiness_retry_receipt_invalid')
      return { state: 'retry_required', sourceId, observationCount, nextOrdinal: next, reason: receipt.reason }
    }
    if (receipt.state !== 'complete' || receipt.observationCount !== observationCount) throw new Error('e66_readiness_seal_invalid')
    return { state: 'sealed', sourceId, observationCount, nextOrdinal: next }
  }
  const yielded = await rpc('gridex_yield_e66_readiness_v1', { ...lease, p_next: next })
  if (yielded.error) throw new Error(`e66_readiness_yield_failed:${yielded.error.message}`)
  if (yielded.data !== true) throw new Error('e66_readiness_yield_invalid')
  return { state: 'progress', sourceId, observationCount, nextOrdinal: next }
}
