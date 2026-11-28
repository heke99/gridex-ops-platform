'use server'

import { redirect } from 'next/navigation'
import { createConsolidatedInvoiceNeutralFileForAdmin } from '@/lib/billing/consolidatedInvoiceFileAdmin'

export async function createConsolidatedInvoiceNeutralFileAction(formData: FormData) {
  const fileId = await createConsolidatedInvoiceNeutralFileForAdmin(formData.get('invoice_id'), formData.get('group_review_hash'))
  redirect('/admin/billing/group-invoice-files/' + fileId)
}
