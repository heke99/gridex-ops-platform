'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { completeFacilityLookup, markFacilityLookupSentManually } from '@/lib/facility/facilityLookupWorkflow'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function required(formData: FormData, key: string, label: string): string {
  const raw = value(formData, key)
  if (!raw) throw new Error(`${label} saknas.`)
  return raw
}

async function resolveCompanyForRequest(requestId: string, guard: Awaited<ReturnType<typeof requireAdminActionAccess>>): Promise<string> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('company_id')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  const companyId = (data as { company_id?: string | null } | null)?.company_id ?? null
  if (!companyId) throw new Error('Anläggningsbegäran saknar bolagskoppling.')
  if (!isPlatformAdminContext(guard)) {
    const scopedCompanyId = await requireOperationalCompanyId(guard.userId)
    if (scopedCompanyId !== companyId) throw new Error('Du saknar åtkomst till bolagets anläggningsbegäran.')
  }
  return companyId
}

export async function markFacilityLookupSentManuallyAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['customers.write'])
  const requestId = required(formData, 'request_id', 'Anläggningsbegäran')
  const companyId = await resolveCompanyForRequest(requestId, guard)
  const channel = (value(formData, 'manual_channel') ?? 'portal') as 'email' | 'phone' | 'portal' | 'other'
  await markFacilityLookupSentManually({
    companyId,
    requestId,
    actorUserId: guard.userId,
    manualChannel: ['email', 'phone', 'portal', 'other'].includes(channel) ? channel : 'other',
    note: value(formData, 'note'),
  })
  revalidatePath('/admin/facility-requests')
}

export async function completeFacilityLookupAction(formData: FormData) {
  const guard = await requireAdminActionAccess(['customers.write'])
  const requestId = required(formData, 'request_id', 'Anläggningsbegäran')
  const companyId = await resolveCompanyForRequest(requestId, guard)
  await completeFacilityLookup({
    companyId,
    requestId,
    actorUserId: guard.userId,
    source: 'manual',
    facilityId: value(formData, 'facility_id'),
    meteringPointId: value(formData, 'metering_point_id'),
    gridAreaCode: value(formData, 'grid_area_code'),
    priceAreaCode: value(formData, 'price_area_code'),
    note: value(formData, 'note'),
    rawPayload: {
      entered_from: 'admin_facility_requests_page',
      note: value(formData, 'note'),
    },
  })
  revalidatePath('/admin/facility-requests')
}
