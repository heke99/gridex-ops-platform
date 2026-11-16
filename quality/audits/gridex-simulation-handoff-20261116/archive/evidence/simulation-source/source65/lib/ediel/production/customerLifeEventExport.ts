import { supabaseService } from '@/lib/supabase/service'
import type { Database } from '@/supabase/database.types'

type CustomerFields = Pick<Database['public']['Tables']['customers']['Row'], 'name' | 'full_name' | 'company_name' | 'org_number' | 'personal_number'>
export type CustomerLifeEventExportProjection = {
  status: 'authorized'
  companyId: string
  customerId: string
  asOf?: string
  sourceMessageId: string | null
  customerVersion: number | null
  effectiveVersionCount: number
  customerFields: Partial<CustomerFields>
  endUserMasterdata: {
    name?: string[]
    street?: string[]
    postCode?: string | null
    city?: string | null
    country?: string | null
  }
}

/** Only source-approved fields whose physical 216 has taken effect. A missing
 * primary owner or availability witness holds the export instead of selecting
 * mutable customer metadata or an older source behind the caller's back. */
export async function readCustomerLifeEventExportProjection(input: {
  companyId: string
  customerId: string
  actorUserId?: string | null
  asOf?: string
}): Promise<CustomerLifeEventExportProjection | null> {
  if (input.asOf !== undefined && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf)))) throw new Error('customer_life_event_export_date_required')
  const { data, error } = await supabaseService.rpc(input.asOf === undefined ? 'ediel_customer_life_event_export_projection_v1' : 'ediel_customer_life_event_export_at_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_actor_user_id: input.actorUserId ?? null,
    ...(input.asOf === undefined ? {} : { p_as_of: input.asOf }),
  })
  if (error) throw error
  if (data?.status === 'not_applicable') return null
  if (data?.status === 'held') throw new Error('customer_life_event_export_source_held')
  const fields = ['name', 'full_name', 'company_name', 'org_number', 'personal_number']
  const address = ['name', 'street', 'postCode', 'city', 'country']
  if (data?.status !== 'authorized' || data.companyId !== input.companyId || data.customerId !== input.customerId
    || (input.asOf !== undefined && (!data.asOf || Date.parse(data.asOf) !== Date.parse(input.asOf)))
    || !Number.isSafeInteger(data.effectiveVersionCount) || data.effectiveVersionCount < 0
    || !data.customerFields || typeof data.customerFields !== 'object' || Array.isArray(data.customerFields)
    || Object.keys(data.customerFields).some(key => !fields.includes(key))
    || Object.values(data.customerFields).some(value => value !== null && typeof value !== 'string')
    || !data.endUserMasterdata || typeof data.endUserMasterdata !== 'object' || Array.isArray(data.endUserMasterdata)
    || Object.keys(data.endUserMasterdata).some(key => !address.includes(key))
    || Object.entries(data.endUserMasterdata).some(([key, value]) => key === 'name' || key === 'street'
      ? !Array.isArray(value) || value.some(part => typeof part !== 'string')
      : value !== null && typeof value !== 'string')
    || (data.effectiveVersionCount > 0 && (typeof data.sourceMessageId !== 'string' || !Number.isSafeInteger(data.customerVersion) || data.customerVersion < 1))) {
    throw new Error('customer_life_event_export_projection_invalid')
  }
  return data
}
