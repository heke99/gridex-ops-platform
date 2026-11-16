'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { createDocumentAiExtraction, reviewDocumentAiExtraction } from '@/lib/customers/documentAiExtraction'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

export async function createDocumentAiExtractionAction(formData: FormData) {
  await requireAdminActionAccess(['customers.write', 'documents.write'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')

  const companyId = await requireOperationalCompanyId(user.id)
  const rawText = text(formData, 'raw_text')
  if (rawText.length < 20) throw new Error('Klistra in text från PDF/OCR innan analysen skapas.')

  await createDocumentAiExtraction({
    companyId,
    actorUserId: user.id,
    customerId: text(formData, 'customer_id') || null,
    sourceFileName: text(formData, 'source_file_name') || null,
    rawText,
    reviewNotes: text(formData, 'review_notes') || null,
  })

  revalidatePath('/admin/billing/ai-parser')
}

export async function reviewDocumentAiExtractionAction(formData: FormData) {
  await requireAdminActionAccess(['customers.write', 'documents.write'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')

  const companyId = await requireOperationalCompanyId(user.id)
  const extractionId = text(formData, 'extraction_id')
  const status = text(formData, 'status')
  if (!extractionId) throw new Error('extraction_id saknas.')
  if (!['needs_review', 'approved_for_manual_create', 'rejected'].includes(status)) {
    throw new Error('Ogiltig granskningsstatus.')
  }

  await reviewDocumentAiExtraction({
    companyId,
    actorUserId: user.id,
    extractionId,
    status: status as 'needs_review' | 'approved_for_manual_create' | 'rejected',
    reviewNotes: text(formData, 'review_notes') || null,
  })

  revalidatePath('/admin/billing/ai-parser')
}
