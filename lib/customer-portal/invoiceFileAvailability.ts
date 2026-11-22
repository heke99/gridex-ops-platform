import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import { requireInvoiceFileCopyAvailable } from '@/lib/ediel/retention/invoiceFileRetention'

export type InvoiceFileAvailability = 'not_retired' | 'retired'

/** Negative copy state only. A pass certifies neither Storage bytes nor a ready PDF. */
export async function readInvoiceFileAvailability(
  input: Parameters<typeof requireInvoiceFileCopyAvailable>[0],
): Promise<InvoiceFileAvailability> {
  try {
    await requireInvoiceFileCopyAvailable(input)
    return 'not_retired'
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23514'
      && 'message' in error && error.message === 'invoice_file_copy_retention_tombstoned') {
      return 'retired'
    }
    throw error
  }
}


export async function readRetiredInvoiceDocuments(companyId: string, invoiceId: string, documentIds: string[]) {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return new Set<string>()
  const { data, error } = await supabaseService.rpc('gridex_portal_invoice_document_availability_v1', {
    p_company_id: companyId,
    p_invoice_id: invoiceId,
    p_document_ids: ids,
  })
  if (error) throw error
  const pending = new Set(ids)
  const retired = new Set<string>()
  for (const row of data ?? []) {
    if (!pending.delete(row.document_id) || typeof row.retired !== 'boolean') {
      throw new Error('Invoice document availability response was invalid.')
    }
    if (row.retired) retired.add(row.document_id)
  }
  if (pending.size > 0) throw new Error('Invoice document availability response was incomplete.')
  return retired
}
