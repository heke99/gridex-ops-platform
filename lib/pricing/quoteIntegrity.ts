/**
 * PostgreSQL/PostgREST serializes UTC timestamptz values with +00:00 while
 * Date#toISOString() emits Z. They describe the same instant and must produce
 * the same immutable quote hash when either representation is hashed.
 */
export function canonicalQuoteTimestamp(
  value: string | null | undefined,
): string | null {
  if (value == null) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}

export function canonicalQuoteValidUntil(value: string): string {
  return canonicalQuoteTimestamp(value) ?? value
}
