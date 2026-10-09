// Supabase/PostgREST errors are plain objects; keep their fixed code and message
// (never details/hint, which can carry row values) instead of "[object Object]".
function smtpUncertainCauseMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === 'object') {
    const { code, message } = cause as { code?: unknown; message?: unknown }
    if (typeof message === 'string') return typeof code === 'string' && code ? `${code}: ${message}` : message
  }
  return String(cause)
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
