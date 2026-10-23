// One monotonic rule for automatic writers of outbound_requests.status (F105).
//
// An outbound request moves forward through dispatch (queued → prepared → sent) and the counterparty's technical
// acknowledgements (CONTRL → syntax_accepted, APERAK → application_accepted, both final → acknowledged). The
// counterparty's business answer (Z04 → confirmed, Z02/Z14/UTILTS → business_response_received), its rejection
// (syntax_/application_/functional_rejected) and a terminal decision (completed, cancelled) settle the request.
//
// Ediel does not order these files: a Z04 can be received before the positive APERAK (P-11), and the mail intake and
// the canonical runtime process the CONTRL/APERAK of one Z03 at different times. A technical or dispatch status that
// arrives or is processed later must therefore never replace a settled status, nor a later technical step. The
// technical facts (acknowledged_at, ACK message ids) are still recorded by the writer; only the status stays.
//
// Negative acknowledgements and explicit operator transitions are not technical progress and are not decided here.

/** Settled statuses that dispatch or technical-ACK progress never replaces. */
export const OUTBOUND_SETTLED_STATUSES = [
  'confirmed',
  'business_response_received',
  'completed',
  'rejected',
  'syntax_rejected',
  'application_rejected',
  'functional_rejected',
  'cancelled',
] as const

/** Dispatch and positive technical-ACK statuses, ranked in the order the protocol produces them. */
const TECHNICAL_PROGRESS_RANK: Readonly<Record<string, number>> = {
  draft: 0,
  queued: 0,
  prepared: 1,
  sent: 2,
  syntax_accepted: 3,
  application_accepted: 4,
  acknowledged: 4,
}

/** PostgREST `not.in` list of settled statuses, for writers that guard inside their own UPDATE statement. */
export const OUTBOUND_SETTLED_STATUS_FILTER = `(${OUTBOUND_SETTLED_STATUSES.map((status) => `"${status}"`).join(',')})`

/**
 * PostgREST `not.in` list for a positive CONTRL written at mail intake: besides the settled statuses, a CONTRL
 * processed after the APERAK (or after the final ACK) never moves the request back to 'syntax_accepted'.
 */
export const OUTBOUND_POSITIVE_CONTRL_GUARD_FILTER = `(${[...OUTBOUND_SETTLED_STATUSES, 'application_accepted', 'acknowledged']
  .map((status) => `"${status}"`).join(',')})`

export type OutboundStatusSnapshot = {
  status?: string | null
  acknowledged_at?: string | null
  response_payload?: Record<string, unknown> | null
}

export type OutboundStatusHoldReason =
  | 'settled_status'
  | 'attention_after_acknowledgement'
  | 'counterparty_rejection'
  | 'later_technical_step'

export type OutboundStatusResolution =
  | { held: false; status: string }
  | { held: true; status: string; reason: OutboundStatusHoldReason }

const ACKNOWLEDGEMENT_STAGE_STATUSES: readonly string[] = ['syntax_accepted', 'application_accepted', 'acknowledged']

export function isOutboundTechnicalProgressStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(TECHNICAL_PROGRESS_RANK, status)
}

function isAcknowledgementStageStatus(status: string): boolean {
  return ACKNOWLEDGEMENT_STAGE_STATUSES.includes(status)
}

export function isOutboundSettledStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && (OUTBOUND_SETTLED_STATUSES as readonly string[]).includes(status)
}

/**
 * Decides the status an automatic writer may store. Only a proposed dispatch/technical-ACK status can be held; any
 * other proposal (failed, cancelled, a business status, waiting_attention) passes through unchanged. A dispatch
 * status (queued/prepared/sent) is held only by a settled status; a technical-ACK status is also held by an
 * acknowledged watch flag, a counterparty rejection and a later technical step.
 */
export function resolveAutomaticOutboundStatus(
  current: OutboundStatusSnapshot | null | undefined,
  proposed: string,
): OutboundStatusResolution {
  const currentStatus = current?.status ?? null
  if (!currentStatus || !isOutboundTechnicalProgressStatus(proposed)) return { held: false, status: proposed }

  if (isOutboundSettledStatus(currentStatus)) return { held: true, status: currentStatus, reason: 'settled_status' }
  if (!isAcknowledgementStageStatus(proposed)) return { held: false, status: proposed }

  // A watch flag raised after the request was already acknowledged (Z04/Z14 overdue, Z04 held) is not cleared by a
  // repeated or late technical ACK. A flag raised while waiting for the first ACK is cleared by that ACK.
  if (currentStatus === 'waiting_attention' && current?.acknowledged_at) {
    return { held: true, status: currentStatus, reason: 'attention_after_acknowledgement' }
  }

  // A request failed by the counterparty's negative CONTRL/APERAK is not revived by a positive ACK processed later.
  // A transport failure followed by a positive ACK is evidence of delivery and still progresses.
  if (currentStatus === 'failed' && current?.response_payload?.inboundAckOutcome === 'negative') {
    return { held: true, status: currentStatus, reason: 'counterparty_rejection' }
  }

  if (isOutboundTechnicalProgressStatus(currentStatus) && TECHNICAL_PROGRESS_RANK[proposed] < TECHNICAL_PROGRESS_RANK[currentStatus]) {
    return { held: true, status: currentStatus, reason: 'later_technical_step' }
  }

  return { held: false, status: proposed }
}
