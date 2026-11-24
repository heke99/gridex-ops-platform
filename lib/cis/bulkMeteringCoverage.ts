import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import { supabaseService } from '@/lib/supabase/service'
import { createGridOwnerDataRequest } from '@/lib/cis/db'
import { prepareAndQueueUtiltsE73 } from '@/lib/ediel/orchestrator'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

const PAGE_SIZE = 100
const MAX_DISCOVERY_PAGES = 100

type CoverageStatus = 'complete' | 'partial' | 'empty' | 'review'
type RequestStatus = 'none' | 'resume' | 'existing' | 'review'
type PointCoverage = { status: CoverageStatus; request: RequestStatus }
export type BulkMeterEdielEnvironment = 'test' | 'production'

export function bulkMeteringEnvironment(value: unknown): BulkMeterEdielEnvironment {
  if (value === 'test' || value === 'production') return value
  throw new Error('Välj Ediel-miljö innan mätvärdesbegäran köas.')
}

export function bulkMeteringPeriod(month: string) {
  const bounds = stockholmMonthBounds(month)
  return {
    ...bounds,
    month,
    periodStart: bounds.startDate,
    periodEnd: new Date(Date.UTC(bounds.year, bounds.month, 0)).toISOString().slice(0, 10),
  }
}

async function readAll<T extends { id: string }>(
  read: (after: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    const { data, error } = await read(after)
    if (error) throw error
    if (!Array.isArray(data) || data.length > PAGE_SIZE) throw new Error('Mätunderlaget kunde inte kontrolleras.')
    for (const row of data) {
      if (!row || typeof row.id !== 'string' || (after !== null && row.id <= after)) {
        throw new Error('Mätunderlaget kunde inte kontrolleras.')
      }
      rows.push(row)
      after = row.id
    }
    if (data.length < PAGE_SIZE) return rows
  }
  throw new Error('Urvalet är för stort för att köa mätvärden i ett steg.')
}

export async function loadBulkMeteringCoverage(
  supabase: SupabaseClient,
  companyId: string | null,
  month: string,
  environment: BulkMeterEdielEnvironment,
) {
  const period = bulkMeteringPeriod(month)
  const sites = await readAll<CustomerSiteRow>((after) => {
    let query = supabase.from('customer_sites').select('*').order('id').limit(PAGE_SIZE)
    if (companyId) query = query.eq('company_id', companyId)
    if (after) query = query.gt('id', after)
    return query
  })
  const sitesById = new Map(sites.map((site) => [site.id, site]))
  const pointsById = new Map<string, MeteringPointRow>()
  const siteBatchSize = 50
  for (let offset = 0; offset < sites.length; offset += siteBatchSize) {
    const siteIds = sites.slice(offset, offset + siteBatchSize).map(site => site.id).join(',')
    const points = await readAll<MeteringPointRow>((after) => {
      let query = supabase.from('metering_points').select('*').order('id').limit(PAGE_SIZE)
        .or(`site_id.in.(${siteIds}),customer_site_id.in.(${siteIds})`)
      if (companyId) query = query.eq('company_id', companyId)
      if (after) query = query.gt('id', after)
      return query
    })
    for (const point of points) pointsById.set(point.id, point)
    if (pointsById.size > PAGE_SIZE * MAX_DISCOVERY_PAGES) {
      throw new Error('Urvalet är för stort för att köa mätvärden i ett steg.')
    }
  }
  const meteringPoints = [...pointsById.values()]

  const pointIdsByCompany = new Map<string, string[]>()
  const coverage = new Map<string, PointCoverage>()
  for (const point of meteringPoints) {
    coverage.set(point.id, { status: 'review', request: 'review' })
    const siteCompanyId = sitesById.get(point.customer_site_id ?? point.site_id)?.company_id
    if (!siteCompanyId || point.company_id !== siteCompanyId || (companyId && siteCompanyId !== companyId)) continue
    const ids = pointIdsByCompany.get(siteCompanyId) ?? []
    ids.push(point.id)
    pointIdsByCompany.set(siteCompanyId, ids)
  }

  for (const [targetCompanyId, ids] of pointIdsByCompany) {
    for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
      const pointIds = ids.slice(offset, offset + PAGE_SIZE)
      const unresolved = new Set(pointIds)
      const { data, error } = await supabaseService.rpc('gridex_read_bulk_metering_coverage_v1', {
        p_company_id: targetCompanyId,
        p_point_ids: pointIds,
        p_month: period.periodStart,
        p_environment: environment,
      })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Mätunderlaget kunde inte kontrolleras.')
      for (const row of data) {
        if (!row || !unresolved.delete(row.point_id) || !['none', 'resume', 'existing', 'review'].includes(row.request_status)
          || !['complete', 'partial', 'empty', 'review'].includes(row.coverage_status)) {
          throw new Error('Mätunderlaget kunde inte kontrolleras.')
        }
        coverage.set(row.point_id, { status: row.coverage_status, request: row.request_status })
      }
    }
  }
  return { period, sites, meteringPoints, coverage }
}

export function canQueueMissingMetering(coverage: PointCoverage | undefined): boolean {
  return Boolean(coverage && (coverage.request === 'none' || coverage.request === 'resume')
    && (coverage.status === 'partial' || coverage.status === 'empty'))
}

export async function queueStaffBulkMeteringRequests(input: {
  actorUserId: string
  environment: BulkMeterEdielEnvironment
  selection: Awaited<ReturnType<typeof loadBulkMeteringCoverage>>
}) {
  const { period, sites, meteringPoints, coverage } = input.selection
  const sitesById = new Map(sites.map(site => [site.id, site]))
  const candidates = meteringPoints.flatMap(point => {
    if (!canQueueMissingMetering(coverage.get(point.id))) return []
    const site = sitesById.get(point.customer_site_id ?? point.site_id)
    const companyId = site?.company_id
    const gridOwnerId = point.grid_owner_id
    if (!companyId || !site || point.company_id !== companyId || point.customer_id !== site.customer_id || !gridOwnerId) return []
    return [{ point, site, companyId, gridOwnerId }]
  })

  for (const companyId of new Set(candidates.map(candidate => candidate.companyId))) {
    await assertUserCanOperateCompany(input.actorUserId, companyId)
    await assertEdielTenantActor({ companyId, actorUserId: input.actorUserId, permission: 'communication.write' })
  }

  const batchKey = `meter_values_${randomUUID()}`
  const outcomes: Array<{ meteringPointId: string; status: 'queued' | 'review'; dataRequestId?: string; messageId?: string }> = []

  for (const { point, site, companyId, gridOwnerId } of candidates) {
    const key = `meter-values:${companyId}:${point.id}:${period.month}`
    const request = await createGridOwnerDataRequest({
      actorUserId: input.actorUserId,
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      gridOwnerId,
      requestScope: 'meter_values',
      requestedPeriodStart: period.start,
      requestedPeriodEnd: period.end,
      automationOrigin: 'staff_bulk_metering_v1',
      automationKey: key,
      requestPayload: { billing_month: period.month, time_zone: period.timeZone, ediel_environment: input.environment, dispatch_batch_key: batchKey },
    })

    const persisted = request.request_payload
    if (request.company_id !== companyId || request.customer_id !== site.customer_id || request.site_id !== site.id
      || request.metering_point_id !== point.id || request.grid_owner_id !== gridOwnerId || request.request_scope !== 'meter_values'
      || request.automation_origin !== 'staff_bulk_metering_v1' || request.automation_key !== key
      || request.status !== 'pending' || persisted.ediel_environment !== input.environment
      || persisted.billing_month !== period.month || persisted.time_zone !== period.timeZone
      || persisted.requested_period_start !== period.start || persisted.requested_period_end !== period.end) {
      outcomes.push({ meteringPointId: point.id, dataRequestId: request.id, status: 'review' })
      continue
    }

    const claim = { p_company_id: companyId, p_actor_user_id: input.actorUserId, p_request_id: request.id }
    const { data: token, error } = await supabaseService.rpc('gridex_claim_staff_bulk_metering_e73_v1', {
      ...claim, p_environment: input.environment,
    })
    if (error) throw error
    if (typeof token !== 'string') {
      outcomes.push({ meteringPointId: point.id, dataRequestId: request.id, status: 'review' })
      continue
    }

    try {
      const message = await prepareAndQueueUtiltsE73({
        actorUserId: input.actorUserId,
        gridOwnerDataRequestId: request.id,
        environment: input.environment,
        staffBulkDispatchToken: token,
      })
      outcomes.push({ meteringPointId: point.id, dataRequestId: request.id, messageId: message.id, status: 'queued' })
    } catch {
      const released = await supabaseService.rpc('gridex_release_staff_bulk_metering_e73_v1', { ...claim, p_token: token })
      if (released.error) throw released.error
      outcomes.push({ meteringPointId: point.id, dataRequestId: request.id, status: 'review' })
    }
  }

  const createdCount = outcomes.filter(outcome => outcome.status === 'queued').length
  return { batchKey, createdCount, skippedCount: meteringPoints.length - createdCount, outcomes }
}
