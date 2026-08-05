/**
 * PostgreSQL/PostgREST serializes UTC timestamptz values with +00:00 while
 * Date#toISOString() emits Z. They describe the same instant and must produce
 * the same immutable quote hash.
 */
export function canonicalQuoteValidUntil(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}
