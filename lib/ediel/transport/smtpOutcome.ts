// Plain database messages can contain row values. Keep a closed code category
// and the original cause; observation must not undo SMTP uncertainty.
function smtpUncertainCauseMessage(cause: unknown): string {
  try {
    if (cause instanceof Error) {
      const message: unknown = cause.message
      return typeof message === 'string' ? message : 'ediel_smtp_uncertain_cause:unknown'
    }
    if (cause && typeof cause === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(cause, 'code')
      const code: unknown = descriptor && 'value' in descriptor ? descriptor.value : null
      const known = ['23505', '23503', '23514', '23P01', '42501', '42P01', '42703', 'P0001', 'P0002', 'PGRST116', 'PGRST202', 'PGRST204']
      const category = `ediel_smtp_uncertain_cause:${typeof code === 'string' && known.includes(code) ? code : 'unknown'}`
      if (code !== 'P0001') return category
      // Literal RAISE tags from ediel_project_accepted_source_state_v1 only.
      // A token-shaped row value is still private and must not be copied.
      const guards = [
        'ediel_source_projection_scope_required',
        'ediel_source_projection_original_changed',
        'ediel_source_projection_accepted_receipt_required',
        'ediel_source_projection_frozen_clock_required',
        'ediel_source_projection_accepted_lane_required',
        'ediel_source_projection_accepted_binding_required',
        'ediel_source_projection_frozen_technical_plan_required',
        'ediel_source_projection_technical_plan_invalid',
        'ediel_source_projection_frozen_expectation_required',
        'ediel_source_projection_expectation_clock_changed',
        'ediel_source_projection_frozen_z02_deadline_required',
        'ediel_source_projection_owned_outbound_request_required',
        'ediel_source_projection_owned_data_request_required',
        'ediel_source_projection_info_request_not_unique',
        'ediel_source_projection_owned_info_request_required',
      ]
      try {
        const messageDescriptor = Object.getOwnPropertyDescriptor(cause, 'message')
        const raised: unknown = messageDescriptor && 'value' in messageDescriptor ? messageDescriptor.value : null
        return typeof raised === 'string' && guards.includes(raised) ? `${category}:${raised}` : category
      } catch {
        return category
      }
    }
    return String(cause)
  } catch {
    return 'ediel_smtp_uncertain_cause:unknown'
  }
}

export class SmtpDeliveryUncertainError extends Error {
  readonly code = 'ediel_delivery_uncertain'
  constructor(cause: unknown, readonly smtpMessageId: string | null = null) {
    super(smtpUncertainCauseMessage(cause), { cause })
    this.name = 'SmtpDeliveryUncertainError'
  }
}

export function isSmtpDeliveryUncertain(error: unknown): boolean {
  if (error instanceof SmtpDeliveryUncertainError) return true
  if (!error || typeof error !== 'object') return false
  const smtp = error as { code?: unknown; command?: unknown; responseCode?: unknown; syscall?: unknown }
  // SMTP's explicit negative response is different from losing the response.
  if (typeof smtp.responseCode === 'number' && smtp.responseCode >= 400 && smtp.responseCode < 600) return false
  if (smtp.syscall === 'connect') return false
  // Nodemailer labels socket closure/timeouts CONN even while awaiting DATA's
  // final response. It exposes no reliable transaction phase on these errors;
  // reconciliation is required, without claiming that submission succeeded.
  return ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'].includes(String(smtp.code)) &&
    ['CONN', 'DATA'].includes(String(smtp.command))
}
