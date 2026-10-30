// lib/ediel/utilts/utiltsReplyAfterStore.ts
//
// FINDINGS F107: an inbound UTILTS run stores its meter values (and billing
// underlay) through idempotent sinks before it creates the application reply
// (APERAK / UTILTS-ERR). When only the reply fails afterwards, for example
// F111's `ediel_ack_atomic_foreign_source_resource`, the stored values stay and
// the transaction waits for its reply. This helper records that state durably
// on the source and marks the original error, so the operator action can
// report "stored, reply missing" instead of an opaque 500. The original error
// is rethrown unchanged for every other caller.
import { createEdielMessageEvent } from '@/lib/ediel/db'

const MARK = Symbol.for('gridex.ediel.utiltsReplyFailedAfterStore')

export type UtiltsReplyFailedAfterStore = {
  sourceMessageId: string
  storedMeterValueIds: string[]
  billingUnderlayId: string | null
  error: string
}

export function describeUtiltsReplyError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) parts.push(current.message)
    else if (typeof current === 'object' && 'message' in current) parts.push(String((current as { message?: unknown }).message))
    else parts.push(String(current))
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return parts.join(' | ').slice(0, 500)
}

/** The stored-but-unanswered state attached to an error by {@link createUtiltsRepliesAfterStore}, or null. */
export function readUtiltsReplyFailedAfterStore(error: unknown): UtiltsReplyFailedAfterStore | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<symbol, unknown>)[MARK]
  return value && typeof value === 'object' ? (value as UtiltsReplyFailedAfterStore) : null
}

/**
 * Runs the reply creation that follows stored values. Without stored values or
 * billing underlay, a failure is rethrown untouched (nothing was stored).
 */
export async function createUtiltsRepliesAfterStore<T>(params: {
  actorUserId: string
  sourceMessageId: string
  storedMeterValueIds: readonly string[]
  billingUnderlayId?: string | null
}, createReplies: () => Promise<T>): Promise<T> {
  try {
    return await createReplies()
  } catch (caught) {
    const storedMeterValueIds = [...params.storedMeterValueIds]
    const billingUnderlayId = params.billingUnderlayId ?? null
    if (storedMeterValueIds.length === 0 && !billingUnderlayId) throw caught
    const error = caught && typeof caught === 'object' ? caught : new Error(String(caught), { cause: caught })
    const failure: UtiltsReplyFailedAfterStore = {
      sourceMessageId: params.sourceMessageId, storedMeterValueIds, billingUnderlayId, error: describeUtiltsReplyError(caught),
    }
    try {
      Object.defineProperty(error, MARK, { value: failure, enumerable: false, configurable: true })
    } catch { /* a frozen error keeps the old behaviour: the action reports a plain failure */ }
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessageId,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: `${storedMeterValueIds.length} mätvärde(n) lagrades${billingUnderlayId ? ' och fakturaunderlag skapades' : ''}, men applikationssvaret (APERAK/UTILTS-ERR) kunde inte skapas: ${failure.error}. Lagrade värden behålls; svaret saknas tills engine körs igen.`,
      payload: {
        phase: 'utilts_reply_failed_after_store',
        storedMeterValueCount: storedMeterValueIds.length,
        storedMeterValueIds,
        billingUnderlayId,
        error: failure.error,
      },
    }).catch(() => null)
    throw error
  }
}
