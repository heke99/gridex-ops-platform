import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import {
  encodeKeysetCursor,
  keysetPageInput,
  type KeysetCursorV1,
  type KeysetPage,
} from '@/lib/customer-portal/keysetPagination'
import { publicPortalEvent } from '@/lib/customer-portal/publicDto'
import { supabaseService } from '@/lib/supabase/service'

type Row = Record<string, unknown>
type EventSource = 'customer_events' | 'domain_events'

type InternalEventRow = Row & {
  id: string
  occurred_at: string
  source_table: EventSource
  source_rank: number
}

function schemaNotReady(error: unknown): never {
  if (isMissingPortalSchemaError(error)) {
    throw new ApiInputError(
      'Kundportalens eventmodell är inte tillgänglig.',
      'platform_schema_not_ready',
      503,
    )
  }
  throw error
}

function sourceRank(source: string | undefined): number {
  if (source === 'customer_events') return 2
  if (source === 'domain_events') return 1
  return 0
}

function compareRows(left: InternalEventRow, right: InternalEventRow): number {
  const date = right.occurred_at.localeCompare(left.occurred_at)
  if (date !== 0) return date
  const source = right.source_rank - left.source_rank
  if (source !== 0) return source
  return right.id.localeCompare(left.id)
}

function rowAfterCursor(row: InternalEventRow, cursor: KeysetCursorV1 | null): boolean {
  if (!cursor) return true
  if (row.occurred_at < cursor.sort) return true
  if (row.occurred_at > cursor.sort) return false
  const cursorRank = sourceRank(cursor.source)
  if (row.source_rank < cursorRank) return true
  if (row.source_rank > cursorRank) return false
  return row.id < cursor.id
}

async function fetchAllRows(input: {
  table: 'customer_events' | 'domain_events'
  companyId: string
  customerId: string
}): Promise<Row[]> {
  const rows: Row[] = []
  const chunkSize = 1000
  for (let offset = 0; ; offset += chunkSize) {
    let query = supabaseService
      .from(input.table)
      .select('id,event_type,source,occurred_at,created_at')
      .eq('company_id', input.companyId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + chunkSize - 1)

    query = input.table === 'customer_events'
      ? query.eq('customer_id', input.customerId)
      : query.eq('subject_customer_id', input.customerId)

    const { data, error } = await query
    if (error) schemaNotReady(error)
    const batch = (data ?? []) as Row[]
    rows.push(...batch)
    if (batch.length < chunkSize) break
  }
  return rows
}

function normalizeRows(customerEvents: Row[], domainEvents: Row[]): InternalEventRow[] {
  return [
    ...customerEvents.map((row) => ({
      ...row,
      id: String(row.id),
      occurred_at: String(row.occurred_at ?? row.created_at),
      source_table: 'customer_events' as const,
      source_rank: 2,
    })),
    ...domainEvents.map((row) => ({
      ...row,
      id: String(row.id),
      occurred_at: String(row.occurred_at ?? row.created_at),
      source_table: 'domain_events' as const,
      source_rank: 1,
    })),
  ].sort(compareRows)
}

function mapRpcRows(rows: Row[]): InternalEventRow[] {
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    occurred_at: String(row.occurred_at ?? row.created_at),
    source_table: String(row.source_table) as EventSource,
    source_rank: Number(row.source_rank),
  }))
}

export async function readPortalEventsPage(input: {
  companyId: string
  customerId: string
  searchParams: URLSearchParams
}): Promise<{ items: Row[]; page: KeysetPage }> {
  const pageInput = keysetPageInput(input.searchParams)
  const cursor = pageInput.cursor

  let rows: InternalEventRow[] | null = null
  const rpc = await supabaseService.rpc('portal_customer_events_page_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_cursor_occurred_at: cursor?.sort ?? null,
    p_cursor_source_rank: cursor ? sourceRank(cursor.source) : null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: pageInput.limit + 1,
  })

  if (!rpc.error) {
    rows = mapRpcRows((rpc.data ?? []) as Row[])
  } else if (!isMissingPortalSchemaError(rpc.error) && rpc.error.code !== 'PGRST202') {
    throw rpc.error
  }

  if (!rows) {
    const [customerEvents, domainEvents] = await Promise.all([
      fetchAllRows({
        table: 'customer_events',
        companyId: input.companyId,
        customerId: input.customerId,
      }),
      fetchAllRows({
        table: 'domain_events',
        companyId: input.companyId,
        customerId: input.customerId,
      }),
    ])
    rows = normalizeRows(customerEvents, domainEvents)
      .filter((row) => rowAfterCursor(row, cursor))
      .slice(0, pageInput.limit + 1)
  }

  const hasMore = rows.length > pageInput.limit
  const pageRows = rows.slice(0, pageInput.limit)
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last
    ? encodeKeysetCursor({
        v: 1,
        sort: last.occurred_at,
        id: last.id,
        source: last.source_table,
      })
    : null

  return {
    items: pageRows.map((row) => publicPortalEvent(input.companyId, {
      ...row,
      // Make the public event reference source-aware without leaking either
      // underlying UUID. The encrypted cursor still uses the real UUID as an
      // internal tie-breaker.
      id: `${row.source_table}:${row.id}`,
    })),
    page: {
      limit: pageInput.limit,
      returned: pageRows.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  }
}
