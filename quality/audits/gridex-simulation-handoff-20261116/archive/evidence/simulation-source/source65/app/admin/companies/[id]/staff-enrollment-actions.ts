'use server'

import { revalidatePath } from 'next/cache'
import {
  externalStaffEnrollmentAdmin,
  type ExternalStaffEnrollmentState,
} from '@/lib/auth/externalStaffEnrollmentAdmin'

export async function enrollExternalStaffAdminAction(
  companyId: string,
  _previous: ExternalStaffEnrollmentState,
  form: FormData,
): Promise<ExternalStaffEnrollmentState> {
  const result = await externalStaffEnrollmentAdmin.enroll(companyId, form)
  if (result.ok) revalidatePath(`/admin/companies/${companyId}/users`)
  return result
}
