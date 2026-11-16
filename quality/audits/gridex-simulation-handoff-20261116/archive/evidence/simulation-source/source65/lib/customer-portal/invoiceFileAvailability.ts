import 'server-only'
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
