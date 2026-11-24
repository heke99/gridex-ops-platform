'use server'

import { redirect } from 'next/navigation'
import { submitInvoiceFile } from './submit'

export async function createInvoiceFileAction(formData: FormData): Promise<void> {
  redirect(await submitInvoiceFile(formData))
}
