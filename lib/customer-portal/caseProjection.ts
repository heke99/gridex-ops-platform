import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { requirePortalRetentionAccess } from '@/lib/ediel/retention/customerRecordClasses'
import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

export async function customerMayReadPortalRecords(companyId: string, customerId: string): Promise<boolean> {
  try {
    await requirePortalRetentionAccess({ companyId, customerId })
    return true
  } catch (error) {
    const failure = error as { code?: string; message?: string } | null
    if (failure?.code === 'P0001' && (
      failure.message === 'portal_customer_retention_access_revoked'
      || failure.message === 'customer_record_customer_scope_required'
    )) return false
    throw error
  }
}

export function isPortalCompletionCase(source: string | null, reasonCategory: string | null) {
  return reasonCategory === 'portal_completion' && ['customer_portal', 'customer_portal_api'].includes(source ?? '')
}

type CompletionScope = {
  companyId: string
  customerId: string
  caseId: string
  siteId: string | null
  completionId: unknown
}

/** The case and the completion must prove the opposite ends of the same link. */
export async function readLinkedPortalCompletion({ companyId, customerId, caseId, siteId, completionId }: CompletionScope) {
  if (typeof completionId !== 'string' || !isUuid(completionId)) return null
  let query = supabaseService.from('customer_portal_completions').select(
    'id,company_id,customer_id,site_id,linked_case_id,completion_type,completion_reference,message:submitted_payload->>message,facility:submitted_payload->>facilityId,meterPoint:submitted_payload->>meterPointId,phone:submitted_payload->>phone,email:submitted_payload->>email')
    .eq('company_id', companyId).eq('id', completionId).eq('customer_id', customerId).eq('linked_case_id', caseId)
  query = siteId ? query.eq('site_id', siteId) : query.is('site_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data || data.id !== completionId || data.company_id !== companyId || data.customer_id !== customerId
    || data.linked_case_id !== caseId || data.site_id !== siteId) return null
  return {
    reference: data.completion_reference,
    fields: [
      ['Meddelande', data.message], ['Anläggnings-ID', data.facility], ['Mätpunkts-ID', data.meterPoint],
      ['Telefon', data.phone], ['E-post', data.email],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  }
}

export async function readPortalCaseSite(companyId: string, customerId: string, siteId: string) {
  const { data, error } = await supabaseService.from('customer_sites').select('id,company_id,customer_id,site_name,street,facility_id')
    .eq('company_id', companyId).eq('id', siteId).eq('customer_id', customerId).maybeSingle()
  if (error) throw error
  if (!data || data.id !== siteId || data.company_id !== companyId || data.customer_id !== customerId) return null
  return { id: siteId, label: [data.site_name, data.street, data.facility_id].filter(Boolean).join(' · ') || 'utan namn' }
}

/** Restore an exact, read-only case link when its site is older than the normal site list. */
export async function includeRequestedCaseSite(
  db: SupabaseClient, companyId: string | null, customerId: string,
  requestedId: string | string[] | undefined, listedSites: CustomerSiteRow[],
): Promise<CustomerSiteRow[]> {
  if (!companyId || typeof requestedId !== 'string' || !isUuid(requestedId)
    || listedSites.some(site => site.id === requestedId)) return listedSites
  const { data, error } = await db.from('customer_sites').select('*')
    .eq('company_id', companyId).eq('customer_id', customerId).eq('id', requestedId).maybeSingle()
  if (error) throw error
  if (!data || data.id !== requestedId || data.company_id !== companyId || data.customer_id !== customerId) return listedSites
  return [...listedSites, data as CustomerSiteRow]
}
