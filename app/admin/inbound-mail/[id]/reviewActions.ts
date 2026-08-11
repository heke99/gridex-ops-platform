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
    return { error: 'Beslutet kunde inte sparas. Kontrollera uppgifterna och försök igen.' }
  }
}
