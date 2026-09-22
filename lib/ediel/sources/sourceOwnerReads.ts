import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceRecord, isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {getGridOwner} from '@/lib/routes/dynamicReceiverResolver'

const columns = {
  metering_points:'id,company_id,meter_point_id,site_id,customer_site_id,grid_owner_id',
  customer_sites:'id,company_id,facility_id,grid_owner_id',
  supplier_switch_requests:'id,company_id,customer_id,metering_point_id,site_id,inbound_z04_message_id,status,confirmed_start_date',
  customer_supply_periods:'id,company_id,customer_id,metering_point_id,source_message_id,status,start_date',
} as const

/** Closed, tenant-scoped primary-key reads. maybeSingle preserves cardinality
 * failures; never use limit(1) to turn an ambiguous owner into a match. */
export async function readSourceOwnerRow(table:keyof typeof columns, companyId:string, id:string, signal:AbortSignal):Promise<Record<string,unknown>> {
  if (!isEvidenceUuid(companyId) || !isEvidenceUuid(id)) throw new Error('source_owner_identity_invalid')
  const {data,error} = await supabaseService.from(table).select(columns[table])
    .eq('company_id',companyId).eq('id',id).abortSignal(signal).maybeSingle()
  if (error || !isEvidenceRecord(data) || data.id !== id || data.company_id !== companyId
    || columns[table].split(',').some(key => !Object.hasOwn(data,key) || data[key] === undefined)) {
    throw new Error('source_owner_row_unavailable')
  }
  return structuredClone(data)
}

/** Selected facility provenance, not outbound routing or historic ownership.
 * The append RPC rechecks these exact projections in one database snapshot. */
export async function readSelectedFacilityEvidence(input:{companyId:string;environment:'test'|'production';meteringPointId:string;siteId:string;objectId:string;signal:AbortSignal}) {
  const observedAt = new Date().toISOString()
  const point = await readSourceOwnerRow('metering_points', input.companyId, input.meteringPointId, input.signal)
  const site = await readSourceOwnerRow('customer_sites', input.companyId, input.siteId, input.signal)
  if (point.site_id !== site.id || (point.customer_site_id !== null && point.customer_site_id !== site.id)
    || point.meter_point_id !== input.objectId || site.facility_id !== input.objectId
    || !isEvidenceUuid(point.grid_owner_id) || site.grid_owner_id !== point.grid_owner_id) throw new Error('source_owner_facility_mismatch')
  const gridOwner = await getGridOwner(point.grid_owner_id, input.signal)
  if (!gridOwner || gridOwner.id !== point.grid_owner_id || gridOwner.is_active !== true || gridOwner.lifecycle_status !== 'active'
    || gridOwner.environment !== input.environment || typeof gridOwner.ediel_id !== 'string'
    || !/^[^\x00-\x20\x7f]{1,128}$/.test(gridOwner.ediel_id)
    || (input.environment === 'production' && ['91100','91109'].includes(gridOwner.ediel_id))) throw new Error('source_owner_grid_owner_unavailable')
  return {owner:'selected-facility-grid-owner-v1' as const, observedAt, completedAt:new Date().toISOString(),
    consistency:'independent_reads' as const, historicalKnowledge:'not_established' as const,
    meteringPoint:point, site, gridOwner:structuredClone(gridOwner)}
}
