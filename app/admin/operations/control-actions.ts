'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  createOutboundRequest,
  createPartnerExport,
  findOpenOutboundBySource,
} from '@/lib/cis/db'
import {
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type {
  BillingUnderlayRow,
  PartnerExportRow,
} from '@/lib/cis/types'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function normalizeMonthInput(
  value: string | null
): { month: number; year: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  }
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
  entityType: string
  entityId: string
  action: string
  metadata?: unknown
  newValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    new_values: params.newValues ?? null,
  })

  if (error) throw error
}

export async function runOperationsAutomationSweepAction(): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
    'partner_exports.write',
  ])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const switchRequests = await listAllSupplierSwitchRequests(supabase, {
    status: 'all',
    requestType: 'all',
    query: '',
  })

  let readinessSynced = 0
  let outboundCreated = 0

  for (const site of sites) {
    const powersOfAttorney = await listPowersOfAttorneyByCustomerId(
      supabase,
      site.customer_id
    )

    const readiness = evaluateSiteSwitchReadiness({
      site,
      meteringPoints: meteringPoints.filter(
        (point) => point.site_id === site.id
      ),
      powersOfAttorney,
    })

    await syncOperationTasksFromReadiness(supabase, readiness)
    readinessSynced += 1
  }

  for (const request of switchRequests) {
    if (!['queued', 'submitted', 'accepted'].includes(request.status)) {
      continue
    }

    const existing = await findOpenOutboundBySource({
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      requestType: 'supplier_switch',
    })

    if (existing) continue

    await createOutboundRequest({
      actorUserId: actor.id,
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: request.grid_owner_id,
      requestType: 'supplier_switch',
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      periodStart: request.requested_start_date ?? null,
      payload: {
        automation: 'batch7_sweep',
        requestType: request.request_type,
        switchStatus: request.status,
      },
    })

    outboundCreated += 1
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'operations_sweep',
    entityId: actor.id,
    action: 'operations_automation_sweep_ran',
    metadata: {
      readinessSynced,
      outboundCreated,
      siteCount: sites.length,
      switchCount: switchRequests.length,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/outbound')
}

export async function bulkQueueReadyBillingExportsAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'billing_underlay.write',
    'partner_exports.write',
  ])

  const actor = await getActor()
  const period = normalizeMonthInput(formValue(formData, 'period_month'))

  if (!period) {
    throw new Error('Välj en månad för exportkörningen')
  }

  const { data: underlays, error: underlaysError } = await supabaseService
    .from('billing_underlays')
    .select('*')
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
      .in('billing_underlay_id', underlayIds)
      .in('status', ['queued', 'sent', 'acknowledged'])

    if (exportsError) throw exportsError
    existingExports = (exportsData ?? []) as PartnerExportRow[]
  }

  const existingByUnderlayId = new Map(
    existingExports
      .filter((row) => row.billing_underlay_id)
      .map((row) => [row.billing_underlay_id as string, row])
  )

  let createdCount = 0

  for (const underlay of typedUnderlays) {
    if (existingByUnderlayId.has(underlay.id)) continue

    await createPartnerExport({
      actorUserId: actor.id,
      customerId: underlay.customer_id,
      siteId: underlay.site_id,
      meteringPointId: underlay.metering_point_id,
      billingUnderlayId: underlay.id,
      exportKind: 'billing_underlay',
      targetSystem: 'billing_partner',
      notes: `Batch 7 export sweep för ${period.year}-${String(
        period.month
      ).padStart(2, '0')}`,
    })

    createdCount += 1
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'partner_export',
    entityId: `${period.year}-${String(period.month).padStart(2, '0')}`,
    action: 'bulk_queue_ready_billing_exports',
    metadata: {
      year: period.year,
      month: period.month,
      createdCount,
      candidateCount: typedUnderlays.length,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing')
  revalidatePath('/admin/partner-exports')
  revalidatePath('/admin/operations')
}