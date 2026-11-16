/**
 * PostgreSQL/PostgREST serializes UTC timestamptz values with +00:00 while
 * Date#toISOString() emits Z. They describe the same instant and must produce
 * the same immutable quote hash.
 */
export function canonicalQuoteTimestamptz(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}

/** @deprecated Prefer canonicalQuoteTimestamptz for any top-level timestamptz. */
export function canonicalQuoteValidUntil(value: string): string {
  return canonicalQuoteTimestamptz(value)
}

/**
 * Grid area is intentionally nullable while only the price area is required for
 * pricing/quote. Normalize missing, blank and case variants so comparisons stay
 * fail-closed without inventing false mismatches.
 */
export function canonicalQuoteGridAreaCode(
  value: unknown,
): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null
}
