export type NativeForeignImage = {rowCount: number; sha256: string}

// Internal native SQL expression: hash the complete, ordered row array inside
// PostgreSQL before sending its image through the process output buffer.
// The supplied expression retains its full to_jsonb rows and tenant predicate.
export function nativeForeignRowArrayImage(rowArraySql: string): string {
  return `(SELECT jsonb_build_object('rowCount',jsonb_array_length(image),
    'sha256',encode(extensions.digest(image::text,'sha256'),'hex'))
    FROM (SELECT ${rowArraySql} AS image) captured)`
}
