import { redactLogText } from '@/lib/logging/redaction'

// F97: supabase-js returns PostgREST failures as plain objects
// ({code,message,details,hint}); `if (error) throw error` rethrows that object
// and String(error) stored '[object Object]' as ediel_outbox.last_error.
// Stored operator/SLA text keeps only a code-shaped `code` and the redacted
// server `message`. `details`/`hint` can carry row values and are never copied
// (same privacy rule as transport/smtpOutcome.ts).
export const EDIEL_UNREADABLE_ERROR = 'ediel_error_unreadable'

const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/

function ownString(record: object, key: 'code' | 'message'): string | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function edielStoredErrorMessage(error: unknown): string {
  try {
    // Unchanged for thrown Errors and literal reason strings.
    if (error instanceof Error) return error.message || EDIEL_UNREADABLE_ERROR
    if (typeof error === 'string') return error.trim() ? error : EDIEL_UNREADABLE_ERROR
    if (error && typeof error === 'object') {
      const rawCode = ownString(error, 'code')
      const code = rawCode && CODE_SHAPE.test(rawCode) ? rawCode : null
      const rawMessage = ownString(error, 'message')
      const message = rawMessage ? redactLogText(rawMessage) : null
      if (code && message) return `${code}: ${message}`
      return message ?? code ?? EDIEL_UNREADABLE_ERROR
    }
    if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)
    return EDIEL_UNREADABLE_ERROR
  } catch {
    return EDIEL_UNREADABLE_ERROR
  }
}
