import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import {
  encodeKeysetCursor,
  keysetPageInput,
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

function schemaNotReady(error: unknown): never {
  if (
    isMissingPortalSchemaError(error) ||
    (error as { code?: string } | null)?.code === 'PGRST202'
  ) {
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

function rowsFromUnknown(data: unknown): Row[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (row): row is Row => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  )
}

function mapRpcRows(data: unknown): InternalDocumentRow[] {
  return rowsFromUnknown(data).map((row) => {
    const sourceTable = String(row.source_table ?? '')
    if (
      sourceTable !== 'customer_documents' &&
      sourceTable !== 'customer_authorization_documents'
    ) {
      throw new Error('portal_document_source_invalid')
    }
    const id = String(row.id ?? '').trim()
    const createdAt = String(row.created_at ?? '').trim()
    const rank = Number(row.source_rank)
    if (!id || !createdAt || !Number.isInteger(rank)) {
      throw new Error('portal_document_page_row_invalid')
    }
    return {
      ...row,
      id,
      created_at: createdAt,
      source_table: sourceTable,
      source_rank: rank,
    }
  })
}

/**
 * Document pagination is intentionally database-level. The merged two-source
 * feed is deduplicated and keyset-paginated by portal_customer_documents_page_v1;
 * missing database support fails closed with 503 rather than falling back to
 * loading the full customer history into application memory.
 */
export async function readPortalDocumentsPage(input: {
  companyId: string
  customerId: string
  searchParams: URLSearchParams
}): Promise<{ items: Row[]; page: KeysetPage }> {
  const pageInput = keysetPageInput(input.searchParams)
  const cursor = pageInput.cursor

  const rpc = await supabaseService.rpc('portal_customer_documents_page_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_cursor_created_at: cursor?.sort ?? null,
    p_cursor_source_rank: cursor ? sourceRank(cursor.source) : null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: pageInput.limit + 1,
  })
  if (rpc.error) schemaNotReady(rpc.error)

  const rows = mapRpcRows(rpc.data)
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
