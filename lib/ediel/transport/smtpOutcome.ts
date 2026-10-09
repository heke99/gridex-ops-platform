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
      return `ediel_smtp_uncertain_cause:${typeof code === 'string' && known.includes(code) ? code : 'unknown'}`
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
