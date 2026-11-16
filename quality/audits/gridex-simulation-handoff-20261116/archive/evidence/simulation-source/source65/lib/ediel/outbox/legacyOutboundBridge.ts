// lib/ediel/outbox/legacyOutboundBridge.ts
//
// Legacy outbound_requests bridge (PART 3). The intent → outbox → message chain
// is the single source of truth for outbound Ediel. Legacy `outbound_requests`
// rows may still exist (prepared for the old pipeline, stale, or waiting for the
// outbox bridge) but they MUST NOT be treated as a competing source of truth.
//
// In particular a legacy row that is `queued` with `attempts_count = 0` and
// `sent_at = null` is NOT sent and NOT "waiting for counterparty". It only means
// "prepared for the old pipeline / needs the outbox bridge".

import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

export type LegacyOutboundRow = {
  id?: string | null
  status?: string | null
  attempts_count?: number | null
  sent_at?: string | null
  prepared_at?: string | null
  response_payload?: JsonRecord | null
  metadata?: JsonRecord | null
  ediel_message_id?: string | null
} & JsonRecord

// Statuses that, combined with real delivery evidence, indicate a legacy row
// actually left the building.
const LEGACY_SENT_STATUSES = new Set([
  'sent',
  'delivery_uncertain',
  'acknowledged',
  'completed',
])

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// The authoritative "is this legacy row actually sent?" predicate.
//
// A queued row with attempts_count = 0 and no sent_at is NEVER sent. We require
// either a real send timestamp, or at least one delivery attempt combined with a
// terminal/sent status. This is intentionally strict: the intent/outbox/message
// chain is the real truth, and the legacy row is only diagnostic.
export function isLegacyOutboundActuallySent(row: LegacyOutboundRow | null | undefined): boolean {
  if (!row) return false
  if (clean(row.sent_at)) return true
  const status = String(row.status ?? '').toLowerCase()
  if (LEGACY_SENT_STATUSES.has(status) && num(row.attempts_count) > 0) return true
  return false
}

// A legacy row is only "waiting for counterparty" once it has actually been sent.
// Merely being `queued`/`prepared` is not waiting — it is pre-dispatch.
export function isLegacyOutboundWaitingForCounterparty(
  row: LegacyOutboundRow | null | undefined,
): boolean {
  return isLegacyOutboundActuallySent(row)
}

// Marks a legacy outbound_requests row as superseded by the intent pipeline so it
// is never re-interpreted as a live send. This is additive metadata only; it does
// not delete or hard-fail the row (no destructive action).
export async function markLegacyOutboundSupersededByIntent(input: {
  companyId: string
  outboundRequestId: string
  intentId: string
  edielMessageId?: string | null
  actorUserId?: string | null
}): Promise<void> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id,metadata,response_payload')
    .eq('company_id', input.companyId)
    .eq('id', input.outboundRequestId)
    .maybeSingle()
  if (error) throw error
  const row = (data as LegacyOutboundRow | null) ?? null
  if (!row) return

  const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as JsonRecord
  const responsePayload = (row.response_payload && typeof row.response_payload === 'object'
    ? row.response_payload
    : {}) as JsonRecord

  const patch: JsonRecord = {
    updated_at: new Date().toISOString(),
    metadata: {
      ...metadata,
      superseded_by_intent: {
        intent_id: input.intentId,
        ediel_message_id: clean(input.edielMessageId),
        superseded_at: new Date().toISOString(),
      },
    },
    response_payload: {
      ...responsePayload,
      intentId: input.intentId,
      edielMessageId: clean(input.edielMessageId) ?? responsePayload.edielMessageId ?? null,
      supersededByIntentPipeline: true,
    },
  }
  if (clean(input.actorUserId)) patch.updated_by = clean(input.actorUserId)

  const { error: updateError } = await supabaseService
    .from('outbound_requests')
    .update(patch)
    .eq('company_id', input.companyId)
    .eq('id', input.outboundRequestId)
  if (updateError) throw updateError
}
