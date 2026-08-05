/**
 * PostgreSQL/PostgREST serializes UTC timestamptz values with +00:00 while
 * Date#toISOString() emits Z. They describe the same instant and must produce
 * the same immutable quote hash for every top-level hashed timestamptz field.
 */
export function canonicalQuoteTimestamptz(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}

/** @deprecated Prefer canonicalQuoteTimestamptz; kept for call-site clarity. */
export function canonicalQuoteValidUntil(value: string): string {
  return canonicalQuoteTimestamptz(value)
}
