'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { portalValidationReportStorageRows } from '@/lib/ediel/portal/parsePortalValidationReport'
import { supabaseService } from '@/lib/supabase/service'

function formString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function importPortalValidationFeedbackAction(formData: FormData) {
  const context = await requireAdminActionAccess({ anyOf: ['communication.write', 'communication.read'] })
  const rawReport = formString(formData.get('rawReport'))
  if (!rawReport) throw new Error('Klistra in portalrapporten först.')

  const rows = portalValidationReportStorageRows({
    rawReport,
    companyId: formString(formData.get('companyId')),
    edielMessageId: formString(formData.get('edielMessageId')),
    testRunId: formString(formData.get('testRunId')),
  }).map((row) => ({ ...row, created_by: context.userId }))

  if (rows.length === 0) throw new Error('Portalrapporten innehöll inga tolkbara steg.')

  const { error } = await supabaseService.from('ediel_portal_validation_feedback').insert(rows)
  if (error) throw error

  revalidatePath('/admin/ediel/portal-feedback')
  revalidatePath('/admin/ediel/automation')
}
