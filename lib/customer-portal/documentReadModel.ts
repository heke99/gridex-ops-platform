import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import {
  encodeKeysetCursor,
  keysetPageInput,
  type KeysetCursorV1,
  type KeysetPage,
} from '@/lib/customer-portal/keysetPagination'
import { publicPortalDocument } from '@/lib/customer-portal/publicDto'
import { supabaseService } from '@/lib/supabase/service'

type Row = Record<string, unknown>

type DocumentSource = 'customer_documents' | 'customer_authorization_documents'

type InternalDocumentRow = Row & {
  id: string
  created_at: string
  source_table: DocumentSource
  source_rank: number
}

const CUSTOMER_DOCUMENT_SELECT = [
  'id',
  'document_type',
  'title',
  'file_name',
  'mime_type',
  'file_size_bytes',
  'status',
  'public_url',
  'source_system',
  'source',
  'power_of_attorney_id',
  'document_version',
  'created_at',
].join(',')

const AUTH_DOCUMENT_SELECT = [
  'id',
  'document_type',
  'status',
  'title',
  'file_name',
  'mime_type',
  'file_size_bytes',
  'reference',
  'power_of_attorney_id',
  'uploaded_at',
  'created_at',
].join(',')

function schemaNotReady(error: unknown): never {
  if (isMissingPortalSchemaError(error)) {
    throw new ApiInputError(
      'Kundportalens dokumentmodell är inte tillgänglig.',
      'platform_schema_not_ready',
      503,
    )
  }
  throw error
}

function sourceRank(source: string | undefined): number {
  if (source === 'customer_documents') return 2
  if (source === 'customer_authorization_documents') return 1
  return 0
}

function compareRows(left: InternalDocumentRow, right: InternalDocumentRow): number {
  const date = right.created_at.localeCompare(left.created_at)
  if (date !== 0) return date
  const source = right.source_rank - left.source_rank
  if (source !== 0) return source
  return right.id.localeCompare(left.id)
}

function rowAfterCursor(row: InternalDocumentRow, cursor: KeysetCursorV1 | null): boolean {
  if (!cursor) return true
  if (row.created_at < cursor.sort) return true
  if (row.created_at > cursor.sort) return false
  const cursorRank = sourceRank(cursor.source)
  if (row.source_rank < cursorRank) return true
  if (row.source_rank > cursorRank) return false
  return row.id < cursor.id
}

async function fetchAllRows(
  table: 'customer_documents' | 'customer_authorization_documents',
  select: string,
  companyId: string,
  customerId: string,
): Promise<Row[]> {
  const rows: Row[] = []
  const chunkSize = 1000
  for (let offset = 0; ; offset += chunkSize) {
    let query = supabaseService
      .from(table)
      .select(select)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + chunkSize - 1)
    if (table === 'customer_authorization_documents') {
      query = query.neq('status', 'archived')
    }
    const { data, error } = await query
    if (error) schemaNotReady(error)
    const batch = (data ?? []) as Row[]
    rows.push(...batch)
    if (batch.length < chunkSize) break
  }
  return rows
}

function normalizeRows(
  customerDocuments: Row[],
  authorizationDocuments: Row[],
): InternalDocumentRow[] {
  const rows: InternalDocumentRow[] = [
    ...customerDocuments.map((row) => ({
      ...row,
      id: String(row.id),
      created_at: String(row.created_at),
      source_table: 'customer_documents' as const,
      source_rank: 2,
    })),
    ...authorizationDocuments.map((row) => ({
      ...row,
      id: String(row.id),
      created_at: String(row.created_at ?? row.uploaded_at),
      source_table: 'customer_authorization_documents' as const,
      source_rank: 1,
      source_system: 'customer_authorization_documents',
      source: 'customer_authorization_documents',
      public_url: null,
      document_version: null,
    })),
  ].sort(compareRows)

  const seen = new Set<string>()
  return rows.filter((row) => {
    const poa = String(row.power_of_attorney_id ?? '')
    const key = poa ? `poa:${poa}` : `${row.source_table}:${row.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapRpcRows(rows: Row[]): InternalDocumentRow[] {
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    created_at: String(row.created_at),
    source_table: String(row.source_table) as DocumentSource,
    source_rank: Number(row.source_rank),
  }))
}

export async function readPortalDocumentsPage(input: {
  companyId: string
  customerId: string
  searchParams: URLSearchParams
}): Promise<{ items: Row[]; page: KeysetPage }> {
  const pageInput = keysetPageInput(input.searchParams)
  const cursor = pageInput.cursor

  let rows: InternalDocumentRow[] | null = null
  const rpc = await supabaseService.rpc('portal_customer_documents_page_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_cursor_created_at: cursor?.sort ?? null,
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
    const [customerDocuments, authorizationDocuments] = await Promise.all([
      fetchAllRows(
        'customer_documents',
        CUSTOMER_DOCUMENT_SELECT,
        input.companyId,
        input.customerId,
      ),
      fetchAllRows(
        'customer_authorization_documents',
        AUTH_DOCUMENT_SELECT,
        input.companyId,
        input.customerId,
      ),
    ])
    rows = normalizeRows(customerDocuments, authorizationDocuments)
      .filter((row) => rowAfterCursor(row, cursor))
      .slice(0, pageInput.limit + 1)
  }

  const hasMore = rows.length > pageInput.limit
  const pageRows = rows.slice(0, pageInput.limit)
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last
    ? encodeKeysetCursor({
        v: 1,
        sort: last.created_at,
        id: last.id,
        source: last.source_table,
      })
    : null

  return {
    items: pageRows.map((row) => publicPortalDocument(input.companyId, row)),
    page: {
      limit: pageInput.limit,
      returned: pageRows.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  }
}
