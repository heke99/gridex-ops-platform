export type TechnicalErrorDiagnostic = { code: string | null; message: string }

// Database/transport diagnostics are technical namespaces, never arbitrary
// application or provider text. A free-text error can contain any customer
// field or opaque credential even when common patterns have been redacted.
const SQLSTATE = /^(?:00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|F0|HV|P0|XX)[A-Z0-9]{3}$/
const POSTGREST_CODE = /^PGRST\d{3}$/
const TRANSPORT_CODES = new Set([
  'EACCES', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENOENT', 'ENOTFOUND', 'EPERM', 'EPIPE', 'ETIMEDOUT',
])

export function technicalErrorDiagnostic(error: unknown): TechnicalErrorDiagnostic {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null
  const candidate = typeof record?.code === 'string' ? record.code.trim() : ''
  const databaseCode = SQLSTATE.test(candidate) || POSTGREST_CODE.test(candidate)
  const transportCode = TRANSPORT_CODES.has(candidate)
  const code = databaseCode || transportCode ? candidate : null

  // These exact guard outcomes are used by existing safe error consumers.
  const guardMessage = record?.message === 'Forbidden' || record?.message === 'Unauthorized'
    ? record.message
    : null
  return { code, message: guardMessage ?? (databaseCode ? 'database_error' : transportCode ? 'transport_error' : 'technical_error') }
}
