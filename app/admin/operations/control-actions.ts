'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { listOutboundRequests, queueReadyBillingUnderlayExports, resolveLegacyOutboundRoute } from '@/lib/cis/db'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { parseBillingMonth } from '@/lib/time/stockholm'
import {
  listPowersOfAttorneyByCustomerIds,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type {
  BillingUnderlayRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'

const ROUTE_WRITE_PERMISSIONS = ['switching.write', 'metering.write', 'billing_underlay.write']

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')
  return user
}

async function insertAuditLog(params: {
  actorUserId: string
  companyId?: string
  entityType: string
  entityId: string
  action: string
  metadata?: unknown
  newValues?: unknown
  oldValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    company_id: params.companyId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    new_values: params.newValues ?? null,
    old_values: params.oldValues ?? null,
  })

  if (error) throw error
}

export async function runOperationsAutomationSweepAction(): Promise<void> {
  const access = await requireAdminActionAccess([...ROUTE_WRITE_PERMISSIONS, 'partner_exports.write'])

  const actor = await getActor()
  const companyScope = await resolveAdminSelectedCompanyReadScope(access)
  const companyId = companyScope.companyId

  if (!companyId) {
    throw new Error('Automation sweep måste köras mot ett valt operativt bolag.')
  }

  await requireCompanyOperationalForWrites(companyId)

  const supabase = await createSupabaseServerClient()

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id),
    { companyId }
  )

  let readinessSynced = 0
  let routedResolved = 0
  let requeuedCount = 0
  let heldCount = 0
  let stillUnresolvedCount = 0
  let candidateCount = 0

  const powersOfAttorney = await listPowersOfAttorneyByCustomerIds(
    supabase,
    sites.map((site) => site.customer_id),
    { companyId }
  )
  const powersOfAttorneyByCustomerId = new Map<string, typeof powersOfAttorney>()
  for (const powerOfAttorney of powersOfAttorney) {
    const customerId = powerOfAttorney.customer_id
    if (!customerId) continue
    const rows = powersOfAttorneyByCustomerId.get(customerId) ?? []
    rows.push(powerOfAttorney)
    powersOfAttorneyByCustomerId.set(customerId, rows)
  }

  for (const site of sites) {
    const readiness = evaluateSiteSwitchReadiness({
      site,
      meteringPoints: meteringPoints.filter(
        (point) => point.site_id === site.id
      ),
      powersOfAttorney: powersOfAttorneyByCustomerId.get(site.customer_id) ?? [],
    })

    await syncOperationTasksFromReadiness(supabase, readiness)
    readinessSynced += 1
  }

  const canResolveRoutes = isPlatformAdminContext(access)
    || ROUTE_WRITE_PERMISSIONS.some(permission => access.permissions.includes(permission))
  if (canResolveRoutes) {
    const unresolved = await listOutboundRequests({ companyId, channelType: 'unresolved' })
    for (const request of unresolved) {
      if (request.company_id !== companyId || request.channel_type !== 'unresolved'
        || !['queued', 'prepared', 'failed'].includes(request.status)) continue

      candidateCount += 1
      const result = await resolveLegacyOutboundRoute({ actorUserId: actor.id, request, mode: 'bulk' })
      if (result.status === 'held') {
        heldCount += 1
        continue
      }
      if (result.request.channel_type === 'unresolved') stillUnresolvedCount += 1
      else routedResolved += 1
      if (result.requeued) requeuedCount += 1
    }
  }

  await insertAuditLog({
    actorUserId: actor.id,
    companyId,
    entityType: 'operations_sweep',
    entityId: actor.id,
    action: 'operations_automation_sweep_ran',
    metadata: {
      readinessSynced,
      routedResolved,
      requeuedCount,
      heldCount,
      stillUnresolvedCount,
      candidateCount,
      siteCount: sites.length,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/outbound/unresolved')
}

export async function bulkQueueReadyBillingExportsAction(
  formData: FormData
): Promise<{
  year: number
  month: number
  createdCount: number
  skippedCount: number
  flaggedCount: number
  blockedCount: number
  candidateCount: number
  batchKey: string
}> {
  const access = await requireAdminActionAccess([
    'billing_underlay.write',
    'partner_exports.write',
  ])

  const actor = await getActor()
  const companyScope = await resolveAdminSelectedCompanyReadScope(access)
  const companyId = companyScope.companyId
  const month = formValue(formData, 'period_month')
  const targetSystem = formValue(formData, 'target_system') || 'billing_partner'

  if (!month) {
    throw new Error('Välj en månad för exportkörningen')
  }
  const period = parseBillingMonth(month)

  if (!companyId) {
    throw new Error('Aktivt bolag saknas för exportkörningen.')
  }

  await requireCompanyOperationalForWrites(companyId)

  const { data: underlays, error: underlaysError } = await supabaseService
    .from('billing_underlays')
    .select('*')
    .eq('company_id', companyId)
    .eq('underlay_year', period.year)
    .eq('underlay_month', period.month)
    .in('status', ['received', 'validated'])
    .order('created_at', { ascending: false })

  if (underlaysError) throw underlaysError

  const typedUnderlays = (underlays ?? []) as BillingUnderlayRow[]
  const underlayIds = typedUnderlays.map((row) => row.id)

  let existingExports: PartnerExportRow[] = []
  if (underlayIds.length > 0) {
    const { data: exportsData, error: exportsError } = await supabaseService
      .from('partner_exports')
      .select('*')
      .eq('company_id', companyId)
      .in('billing_underlay_id', underlayIds)
      .in('status', ['queued', 'sent', 'acknowledged'])

    if (exportsError) throw exportsError
    existingExports = (exportsData ?? []) as PartnerExportRow[]
  }

  const { data: meteringData, error: meteringError } = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('company_id', companyId)
    .order('read_at', { ascending: false })
    .limit(5000)

  if (meteringError) throw meteringError

  const batchKey = `billing-export:${companyId}:${period.year}-${String(period.month).padStart(2, '0')}`
  const result = await queueReadyBillingUnderlayExports({
    actorUserId: actor.id,
    underlays: typedUnderlays,
    meterValues: (meteringData ?? []) as MeteringValueRow[],
    partnerExports: existingExports,
    targetSystem,
    batchKey,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    companyId,
    entityType: 'partner_export',
    entityId: `${period.year}-${String(period.month).padStart(2, '0')}`,
    action: 'bulk_queue_ready_billing_exports',
    metadata: {
      companyId,
      targetSystem,
      year: period.year,
      month: period.month,
      createdCount: result.createdCount,
      skippedCount: result.skippedCount,
      flaggedCount: result.flaggedCount,
      blockedCount: result.blockedCount,
      candidateCount: result.candidateCount,
      batchKey,
      mode: 'partial_batch_ready_rows_only',
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing')
  revalidatePath('/admin/partner-exports')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/controltower')

  return {
    year: period.year,
    month: period.month,
    createdCount: result.createdCount,
    skippedCount: result.skippedCount,
    flaggedCount: result.flaggedCount,
    blockedCount: result.blockedCount,
    candidateCount: result.candidateCount,
    batchKey,
  }
}
