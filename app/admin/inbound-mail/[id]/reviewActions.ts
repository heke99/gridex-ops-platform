'use server'

import { resolveInboundManualReviewAction } from '@/app/admin/inbound-mail/actions'

export type ManualReviewActionState = {
  error: string | null
}

export async function resolveInboundManualReviewUiAction(
  _previousState: ManualReviewActionState,
  formData: FormData,
): Promise<ManualReviewActionState> {
  try {
    await resolveInboundManualReviewAction(formData)
    return { error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('inbound_processing_job_not_open_for_manual_review')) {
      return { error: 'Granskningen är redan hanterad. Ladda om sidan för att se aktuell status.' }
    }
    if (message.includes('inbound_processing_job_not_found')) {
      return { error: 'Granskningsjobbet finns inte längre. Ladda om sidan.' }
    }
    if (message.includes('inbound_processing_job_message_mismatch')) {
      return { error: 'Jobbet hör inte till detta inbound-mail. Ladda om sidan.' }
    }
    if (message.includes('manual_review_resolution_required')) {
      return { error: 'Beskriv vad som verifierades eller korrigerades.' }
    }
    if (message.includes('manual_review_next_status_invalid')) {
      return { error: 'Nästa status är ogiltig.' }
    }
    return { error: 'Beslutet kunde inte sparas. Kontrollera uppgifterna och försök igen.' }
  }
}
