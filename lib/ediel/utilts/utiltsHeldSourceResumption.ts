// lib/ediel/utilts/utiltsHeldSourceResumption.ts
//
// The one engine path that resumes an inbound UTILTS source from its preserved
// original (FINDINGS F80/F107, reality O2). It is shared by
//   * the operator action "Kör UTILTS engine / Återuppta hållna transaktioner"
//     (app/admin/ediel/actions.part-3.ts, after its session/scope checks), and
//   * the scheduled held-UTILTS resume (lib/ediel/utilts/heldUtiltsResume.ts).
// Both re-check the single resumability rule server-side, run the canonical
// processor (processEdielOperationalMessage -> processInboundUtiltsMessage with
// replyOrigin 'operational', so replies go through the outbox and every send
// gate, F112), and record the attempt and its outcome on the source.
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { processEdielOperationalMessage } from '@/lib/ediel/operationalBridge'
import { describeUtiltsSourceResumability, readUtiltsSourceResumability, type UtiltsSourceResumability } from '@/lib/ediel/utilts/utiltsResumability'
import { readUtiltsReplyFailedAfterStore } from '@/lib/ediel/utilts/utiltsReplyAfterStore'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type UtiltsSourceResumptionResult =
  | { status: 'processed'; resumedTransactionIds: string[]; stillHeldTransactionIds: string[] }
  | { status: 'refused'; reason: UtiltsSourceResumability['reason'] }
  | { status: 'already_processing_or_done'; reason: string }
  | { status: 'final_reply_conflict'; reason: string }
  | { status: 'reply_failed_after_store'; reason: string; storedMeterValueCount: number; pendingReplyTransactionIds: string[] }

// Errors raised by the existing DB/draft guards when a second, concurrent or
// repeated attempt meets work that another attempt already committed.
const UTILTS_CONCURRENT_ATTEMPT_MARKERS = [
  'utilts_transaction_ack_finalization_conflict',
  'utilts_transaction_ack_finalization_ambiguous',
]
// Errors raised when a re-check disagrees with an immutable earlier final reply.
const UTILTS_FINAL_REPLY_CONFLICT_MARKERS = [
  'blocked_final_ack_exists',
  'utilts_committed_transaction_retry_conflict',
]

function errorChainText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) parts.push(current.message)
    else if (typeof current === 'object' && 'message' in current) parts.push(String((current as { message?: unknown }).message))
    else parts.push(String(current))
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return parts.join(' | ')
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505')
}

function hasUniqueViolationInChain(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (isPostgresUniqueViolation(current)) return true
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return false
}

export function classifyUtiltsResumptionError(error: unknown): 'concurrent' | 'final_conflict' | null {
  const text = errorChainText(error)
  if (UTILTS_FINAL_REPLY_CONFLICT_MARKERS.some((marker) => text.includes(marker))) return 'final_conflict'
  if (hasUniqueViolationInChain(error) || UTILTS_CONCURRENT_ATTEMPT_MARKERS.some((marker) => text.includes(marker))) return 'concurrent'
  return null
}

/**
 * Re-checks resumability, runs the canonical processor from the preserved
 * original and records the outcome on the source. The caller has already
 * verified its actor and tenant scope; `sourceMessage` is a server-read row.
 *
 * `onlyHeldTransactions` (scheduled resume): a source that is no longer held
 * (answered, or never held) is left untouched and no event is written; the
 * operator path records every refusal.
 * `eventPayload` is merged into the attempt event (e.g. who resumed and why).
 */
export async function resumeInboundUtiltsSourceFromOriginal(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  onlyHeldTransactions?: boolean
  eventPayload?: Record<string, unknown>
}): Promise<UtiltsSourceResumptionResult> {
  const { actorUserId, sourceMessage } = params
  const edielMessageId = sourceMessage.id
  const scope = {
    companyId: sourceMessage.company_id,
    sourceMessageId: edielMessageId,
    environment: sourceMessage.environment,
  }

  const before = await readUtiltsSourceResumability(scope)
  if (params.onlyHeldTransactions && before.reason !== 'held_transactions') {
    return { status: 'refused', reason: before.reason }
  }
  if (!before.resumable) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: `Engine kördes inte: ${describeUtiltsSourceResumability(before)}`,
      payload: {
        phase: 'utilts_source_resumption_refused',
        reason: before.reason,
        heldTransactionIds: before.heldTransactionIds,
        rejectedTransactionIds: before.rejectedTransactionIds,
        existingApplicationReplyIds: before.activeApplicationReplyIds,
        ...(params.eventPayload ?? {}),
      },
    })
    return { status: 'refused', reason: before.reason }
  }

  const attemptedAt = new Date().toISOString()
  const basePayload = {
    phase: 'utilts_source_resumption_attempt',
    mode: before.reason,
    actorUserId,
    attemptedAt,
    heldTransactionIdsBefore: before.heldTransactionIds,
    reusedProtocolReplyIds: before.activeProtocolReplyIds,
    existingApplicationReplyIds: before.activeApplicationReplyIds,
    ...(params.eventPayload ?? {}),
  }

  try {
    // Canonical path from the preserved original; every check (including the
    // issuer identity authority) is re-read by the engine.
    await processEdielOperationalMessage({ actorUserId, edielMessageId })
  } catch (error) {
    const kind = classifyUtiltsResumptionError(error)
    const reason = errorChainText(error).slice(0, 500)
    const storedWithoutReply = kind ? null : readUtiltsReplyFailedAfterStore(error)
    if (storedWithoutReply) {
      // F107: values are stored; only the application reply is missing. Report
      // that durably and to the operator instead of an opaque 500.
      const afterFailure = await readUtiltsSourceResumability(scope).catch(() => null)
      const pendingReplyTransactionIds = afterFailure
        ? before.heldTransactionIds.filter((id) => !afterFailure.heldTransactionIds.includes(id) && !afterFailure.finalizedTransactionIds.includes(id))
        : []
      const storedMeterValueCount = storedWithoutReply.storedMeterValueIds.length
      await createEdielMessageEvent({
        actorUserId, edielMessageId, eventType: 'manual_note', eventStatus: 'error',
        message: `Återupptagning lagrade ${storedMeterValueCount} mätvärde(n) från bevarat original, men applikationssvaret (APERAK/UTILTS-ERR) kunde inte skapas: ${storedWithoutReply.error}. Lagrade värden behålls; svaret saknas tills engine körs igen när orsaken är åtgärdad.`,
        payload: {
          ...basePayload,
          outcome: 'reply_failed_after_store',
          error: reason,
          storedMeterValueCount,
          billingUnderlayId: storedWithoutReply.billingUnderlayId,
          pendingReplyTransactionIds,
          heldTransactionIdsAfter: afterFailure?.heldTransactionIds ?? null,
        },
      }).catch(() => null)
      return { status: 'reply_failed_after_store', reason, storedMeterValueCount, pendingReplyTransactionIds }
    }
    if (!kind) {
      await createEdielMessageEvent({
        actorUserId, edielMessageId, eventType: 'manual_note', eventStatus: 'error',
        message: 'Återupptagning av inbound UTILTS misslyckades. Inga tidigare svar har ändrats.',
        payload: { ...basePayload, outcome: 'failed', error: reason },
      }).catch(() => null)
      throw error
    }
    const afterConflict = await readUtiltsSourceResumability(scope).catch(() => null)
    const stillHeldAfterConflict = afterConflict
      ? before.heldTransactionIds.filter((id) => afterConflict.heldTransactionIds.includes(id))
      : before.heldTransactionIds
    await createEdielMessageEvent({
      actorUserId, edielMessageId, eventType: 'manual_note', eventStatus: 'warning',
      message: kind === 'concurrent'
        ? stillHeldAfterConflict.length > 0
          ? `Återupptagning stoppades av databasens dubblettskydd: ett samtidigt försök eller ett befintligt svar spärrade. ${stillHeldAfterConflict.length} transaktion(er) hålls fortfarande; inga dubbla värden eller svar skapades.`
          : 'Återupptagning stoppades: källan bearbetas redan eller är redan klar i ett annat försök. Inga dubbla värden eller svar skapades.'
        : 'Återupptagning stoppades: ny kontroll avviker från ett redan slutligt svar. Det tidigare svaret behålls oförändrat och kräver manuell granskning.',
      payload: {
        ...basePayload,
        outcome: kind === 'concurrent' ? 'already_processing_or_done' : 'final_reply_conflict',
        error: reason,
        heldTransactionIdsAfter: afterConflict?.heldTransactionIds ?? null,
      },
    })
    return kind === 'concurrent'
      ? { status: 'already_processing_or_done', reason }
      : { status: 'final_reply_conflict', reason }
  }

  const after = await readUtiltsSourceResumability(scope)
  const stillHeld = before.heldTransactionIds.filter((id) => after.heldTransactionIds.includes(id))
  const resumed = before.heldTransactionIds.filter((id) => !after.heldTransactionIds.includes(id))
  await createEdielMessageEvent({
    actorUserId,
    edielMessageId,
    eventType: 'manual_note',
    eventStatus: stillHeld.length > 0 ? 'warning' : 'success',
    message: before.reason === 'held_transactions'
      ? stillHeld.length > 0
        ? `Återupptagning kördes från bevarat original: ${stillHeld.length} transaktion(er) hålls fortfarande för intern granskning (underlaget är ännu inte godkänt). Inget svar skickades för dem.`
        : `Återupptagning kördes från bevarat original: ${resumed.length} transaktion(er) lämnade intern granskning och fick svar enligt aktuell kontroll. Tidigare svar återanvändes oförändrade.`
      : 'Engine kördes för inbound UTILTS från bevarat original. Befintlig CONTRL återanvändes och skickades inte igen.',
    payload: {
      ...basePayload,
      outcome: stillHeld.length > 0 ? 'still_held' : 'processed',
      resumedTransactionIds: resumed,
      stillHeldTransactionIds: stillHeld,
      heldTransactionIdsAfter: after.heldTransactionIds,
      applicationReplyIdsAfter: after.activeApplicationReplyIds,
    },
  })
  return { status: 'processed', resumedTransactionIds: resumed, stillHeldTransactionIds: stillHeld }
}
