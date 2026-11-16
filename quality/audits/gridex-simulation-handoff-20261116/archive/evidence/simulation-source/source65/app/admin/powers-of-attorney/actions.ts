'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { resolveManualReplyReview } from '@/lib/inbound-mail/manualReplyReview'

export async function resolvePoaReplyAction(form: FormData) {
  const guard = await requireAdminActionAccess(['poa.write', 'customers.write'])
  const requestId = String(form.get('request_id') ?? '')
  const powerOfAttorneyId = String(form.get('poa_id') ?? '')
  if (!guard.isPlatformAdmin && !guard.companyId) throw new Error('Bolagskoppling saknas.')
  const client = await createSupabaseServerClient()
  let query = client.from('grid_owner_information_requests').select('id,company_id,customer_id,poa_id').eq('id', requestId).eq('poa_id', powerOfAttorneyId)
  if (!guard.isPlatformAdmin) query = query.eq('company_id', guard.companyId!)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data?.company_id) throw new Error('Ärendet hittades inte.')
  await assertCompanyAccessForGuard(data.company_id, guard)
  await assertUserCanOperateCompany(guard.userId, data.company_id)
  await resolveManualReplyReview({ companyId: data.company_id, requestId, powerOfAttorneyId, actorUserId: guard.userId,
    note: String(form.get('resolution_note') ?? '') })
  revalidatePath('/admin/powers-of-attorney')
  revalidatePath('/admin/manual-requests')
  if (data.customer_id) revalidatePath(`/admin/customers/${data.customer_id}`)
}
