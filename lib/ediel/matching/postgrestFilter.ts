// Shared builders for PostgREST `or` filter strings. Values are always quoted
// so caller- or sender-controlled text cannot add filter conditions, and uuid
// columns only receive UUID-shaped values (anything else makes PostgREST
// reject the whole query with 22P02).

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PostgREST quoted value: only `"` and `\` need escaping inside double quotes.
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/["\\]/g, (ch) => `\\${ch}`)}"`
}

/** One quoted equality condition, e.g. `meter_point_id.eq."735…"`. */
export function postgrestEq(column: string, value: string): string {
  return `${column}.eq.${quotePostgrestValue(value)}`
}

/** UUID-shaped values are compared case-insensitively by Postgres; keep them canonical (lower case). */
export function canonicalUuidOrText(value: string): string {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : value
}

/**
 * Builds a PostgREST `or` list comparing every ref with the text columns, and
 * only UUID-shaped refs with the uuid columns. Returns '' when nothing is
 * comparable.
 */
export function postgrestEqAny(textColumns: string[], uuidColumns: string[], refs: string[]): string {
  return refs.flatMap((ref) => [
    ...textColumns.map((column) => postgrestEq(column, ref)),
    ...(UUID_PATTERN.test(ref) ? uuidColumns.map((column) => postgrestEq(column, ref)) : []),
  ]).join(',')
}
