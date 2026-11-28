import type { ParsedCustomerImport } from '@/lib/customers/importParser'

type ImportRelation = 'customer_import_batches' | 'customer_import_rows'

export function isMissingCustomerImportRelation(error: unknown, relation: ImportRelation): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return false
  if (typeof error.message !== 'string') return false

  if (error.code === '42P01') {
    return [`relation "public.${relation}" does not exist`, `relation "${relation}" does not exist`].includes(error.message)
  }

  return error.code === 'PGRST205' &&
    error.message === `Could not find the table 'public.${relation}' in the schema cache`
}

export const CUSTOMER_IMPORT_AUDIT_ACTION = 'customer_bulk_import_completed'
export const CUSTOMER_IMPORT_AUDIT_ENTITY = 'customer_bulk_import'

export type CustomerImportReviewStore = 'available' | 'unavailable' | 'incomplete'

type ImportAuditSummary = {
  receiptId: string
  createdAt: string
  sourceKind: ParsedCustomerImport['sourceKind']
  totalRows: number
  createdRows: number
  reviewRows: number
  failedRows: number
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function toCustomerImportAuditSummary(row: unknown): ImportAuditSummary | null {
  if (!row || typeof row !== 'object') return null
  const { id, created_at, source_kind, total_rows, created_rows, review_rows, failed_rows } = row as Record<string, unknown>
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null
  if (typeof created_at !== 'string' || !Number.isFinite(Date.parse(created_at))) return null
  if (source_kind !== 'text' && source_kind !== 'csv' && source_kind !== 'excel' && source_kind !== 'pdf') return null
  if (!isCount(total_rows) || !isCount(created_rows) || !isCount(review_rows) || !isCount(failed_rows)) return null
  if (total_rows < 1 || created_rows + review_rows + failed_rows !== total_rows) return null

  return {
    receiptId: id,
    createdAt: created_at,
    sourceKind: source_kind,
    totalRows: total_rows,
    createdRows: created_rows,
    reviewRows: review_rows,
    failedRows: failed_rows,
  }
}

export function shortCustomerImportReceipt(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
