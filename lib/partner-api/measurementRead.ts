import { ApiInputError } from '@/lib/api/strictRequest'

const PAGE_SIZE = 1000
// Allows a 366-day quarter-hour range across the four supported gross/net
// directions, including DST. Bounds also stop a broken backend looping.
const MAX_ROWS = 150_000
const MAX_PAGES = 2000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUB_MILLISECOND_MICROS = /\.\d{3}(\d{1,3})(?=Z$|[+-]\d{2}:?\d{2}$)/i

function incomplete(): never {
  throw new ApiInputError(
    'The complete measurement range could not be verified. Retry the request.',
    'measurement_read_incomplete',
    503,
  )
}

/**
 * Read an ordered range until the database returns an empty terminal page.
 * PostgREST may cap each page below the requested size, so a short page is
 * never treated as completion. Callers keep tenant/site/current filters and
 * order every page by period_start, then id. This does not promise a database
 * snapshot across concurrent revision changes.
 */
export async function readCompletePartnerMeasurements<T extends { id: string; period_start: string }>(
  readPage: (offset: number, size: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let previous: { milliseconds: number; subMillisecondMicros: number; id: string } | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let result: { data: T[] | null; error: unknown }
    try {
      result = await readPage(rows.length, PAGE_SIZE)
    } catch {
      return incomplete()
    }
    if (result.error) incomplete()
    if (!Array.isArray(result.data) || result.data.length > PAGE_SIZE) incomplete()
    if (result.data.length === 0) return rows
    if (rows.length + result.data.length > MAX_ROWS) incomplete()
    for (const row of result.data) {
      const milliseconds = Date.parse(row.period_start)
      if (!Number.isFinite(milliseconds) || typeof row.id !== 'string' || !UUID.test(row.id)) incomplete()
      // The UTC millisecond ordering from Date.parse loses the final digits of a PostgreSQL timestamp.
      const subMillisecondMicros = Number(SUB_MILLISECOND_MICROS.exec(row.period_start)?.[1].padEnd(3, '0') ?? 0)
      const id = row.id.toLowerCase()
      if (previous) {
        const timeOrder = milliseconds - previous.milliseconds || subMillisecondMicros - previous.subMillisecondMicros
        if (timeOrder < 0 || (timeOrder === 0 && id <= previous.id)) incomplete()
      }
      previous = { milliseconds, subMillisecondMicros, id }
      rows.push(row)
    }
  }
  return incomplete()
}
