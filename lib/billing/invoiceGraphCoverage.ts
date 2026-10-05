import { supabaseService } from '@/lib/supabase/service'

type ExportItemRow = {
  id: string
  billing_underlay_id: string | null
}

type CustomerInvoiceRow = {
  id: string
  invoice_export_item_id: string | null
  billing_underlay_id: string | null
}

export type InvoiceGraphCoverage = {
  ok: boolean
  expectedUnderlayCount: number
  exportItemCount: number
  customerInvoiceCount: number
  missingUnderlayIds: string[]
  unexpectedUnderlayIds: string[]
  duplicateUnderlayIds: string[]
  missingInvoiceItemIds: string[]
  duplicateInvoiceItemIds: string[]
  mismatchedInvoiceItemIds: string[]
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

async function listExportItems(input: {
  companyId: string
  exportRunId: string
}): Promise<ExportItemRow[]> {
  const rows: ExportItemRow[] = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseService
      .from('invoice_export_items')
      .select('id,billing_underlay_id')
      .eq('company_id', input.companyId)
      .eq('export_run_id', input.exportRunId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as ExportItemRow[]))
    if ((data ?? []).length < pageSize) break
  }
  return rows
}

async function listInvoiceMirrors(input: {
  companyId: string
  exportItemIds: string[]
}): Promise<CustomerInvoiceRow[]> {
  const rows: CustomerInvoiceRow[] = []
  for (let offset = 0; offset < input.exportItemIds.length; offset += 200) {
    const ids = input.exportItemIds.slice(offset, offset + 200)
    if (ids.length === 0) continue
    const { data, error } = await supabaseService
      .from('customer_invoices')
      .select('id,invoice_export_item_id,billing_underlay_id')
      .eq('company_id', input.companyId)
      .in('invoice_export_item_id', ids)
    if (error) throw error
    rows.push(...((data ?? []) as CustomerInvoiceRow[]))
  }
  return rows
}

export async function evaluateInvoiceExportGraphCoverage(input: {
  companyId: string
  exportRunId: string
  expectedUnderlayIds: string[]
}): Promise<InvoiceGraphCoverage> {
  const expectedUnderlayIds = unique(input.expectedUnderlayIds).sort()
  const expectedSet = new Set(expectedUnderlayIds)
  const exportItems = await listExportItems(input)
  const actualUnderlayIds = exportItems
    .map((row) => row.billing_underlay_id)
    .filter((value): value is string => Boolean(value))
  const actualSet = new Set(actualUnderlayIds)
  const exportItemIds = exportItems.map((row) => row.id)
  const invoices = await listInvoiceMirrors({
    companyId: input.companyId,
    exportItemIds,
  })
  const invoiceItemIds = invoices
    .map((row) => row.invoice_export_item_id)
    .filter((value): value is string => Boolean(value))
  const invoiceItemSet = new Set(invoiceItemIds)
  const itemUnderlayById = new Map(
    exportItems.map((row) => [row.id, row.billing_underlay_id] as const),
  )

  const missingUnderlayIds = expectedUnderlayIds.filter((id) => !actualSet.has(id))
  const unexpectedUnderlayIds = [...actualSet]
    .filter((id) => !expectedSet.has(id))
    .sort()
  const duplicateUnderlayIds = duplicates(actualUnderlayIds)
  const missingInvoiceItemIds = exportItemIds
    .filter((id) => !invoiceItemSet.has(id))
    .sort()
  const duplicateInvoiceItemIds = duplicates(invoiceItemIds)
  const mismatchedInvoiceItemIds = invoices
    .filter((invoice) => {
      const itemId = invoice.invoice_export_item_id
      if (!itemId) return true
      return itemUnderlayById.get(itemId) !== invoice.billing_underlay_id
    })
    .map((invoice) => invoice.invoice_export_item_id ?? invoice.id)
    .sort()

  const ok =
    expectedUnderlayIds.length > 0 &&
    exportItems.length === expectedUnderlayIds.length &&
    invoices.length === exportItems.length &&
    missingUnderlayIds.length === 0 &&
    unexpectedUnderlayIds.length === 0 &&
    duplicateUnderlayIds.length === 0 &&
    missingInvoiceItemIds.length === 0 &&
    duplicateInvoiceItemIds.length === 0 &&
    mismatchedInvoiceItemIds.length === 0

  return {
    ok,
    expectedUnderlayCount: expectedUnderlayIds.length,
    exportItemCount: exportItems.length,
    customerInvoiceCount: invoices.length,
    missingUnderlayIds,
    unexpectedUnderlayIds,
    duplicateUnderlayIds,
    missingInvoiceItemIds,
    duplicateInvoiceItemIds,
    mismatchedInvoiceItemIds,
  }
}

export async function assertInvoiceExportGraphCoverage(input: {
  companyId: string
  exportRunId: string
  expectedUnderlayIds: string[]
}): Promise<InvoiceGraphCoverage> {
  const coverage = await evaluateInvoiceExportGraphCoverage(input)
  if (!coverage.ok) {
    throw new Error(
      `Canonical fakturagraf är ofullständig för exportkörning ${input.exportRunId}: ` +
        `${coverage.exportItemCount}/${coverage.expectedUnderlayCount} exportposter och ` +
        `${coverage.customerInvoiceCount}/${coverage.expectedUnderlayCount} draftfakturor.`,
    )
  }
  return coverage
}
