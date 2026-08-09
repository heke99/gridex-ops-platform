const REDACTED = '[REDACTED]'
const MAX_STRING_LENGTH = 1_000
const MAX_ARRAY_ITEMS = 25
const MAX_OBJECT_KEYS = 50
const MAX_DEPTH = 5

const SECRET_KEY_PATTERN = /(^|_)(authorization|cookie|set_cookie|password|passwd|secret|token|access_token|refresh_token|api_key|apikey|private_key|client_secret|signature|raw|payload|body|document|content|certificate|pem|sql|query|statement)(_|$)/i
const PERSONAL_KEY_PATTERN = /(^|_)(email|e_mail|phone|mobile|personnummer|person_number|personal_number|personal_id|ssn|ip|ip_address|address|first_name|last_name|full_name)(_|$)/i

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const SWEDISH_PERSON_NUMBER_PATTERN = /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/g
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
}

function normalizeMetadataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalizedKey = normalizeMetadataKey(key)
  return SECRET_KEY_PATTERN.test(normalizedKey) || PERSONAL_KEY_PATTERN.test(normalizedKey)
}

export function redactLogText(value: string): string {
  return truncate(value)
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_TOKEN]')
    .replace(OPENAI_KEY_PATTERN, '[REDACTED_KEY]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(SWEDISH_PERSON_NUMBER_PATTERN, '[REDACTED_PERSON_NUMBER]')
    .replace(IPV4_PATTERN, '[REDACTED_IP]')
}

function sanitizeLogValueInternal(value: unknown, key: string | null, depth: number): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]'

  if (key && isSensitiveMetadataKey(key)) {
    return REDACTED
  }

  if (typeof value === 'string') return redactLogText(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol' || typeof value === 'function') return String(value)

  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code
    return {
      name: value.name || 'Error',
      code: typeof code === 'string' ? redactLogText(code) : null,
      message: redactLogText(value.message || 'unknown_error'),
    }
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLogValueInternal(item, null, depth + 1))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLogValueInternal(entryValue, entryKey, depth + 1),
      ]),
    )
  }

  return redactLogText(String(value))
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeLogValueInternal(value, null, 0)
}

export function sanitizeLogMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const sanitized = sanitizeLogValueInternal(metadata, null, 0)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {}
}

export function safeLogError(error: unknown): { code: string | null; message: string } {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null
  const code = typeof record?.code === 'string' && record.code.trim()
    ? redactLogText(record.code.trim())
    : null
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : String(error ?? 'unknown_error')

  return {
    code,
    message: redactLogText(message || 'unknown_error'),
  }
}
