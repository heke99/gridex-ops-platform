'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import {
  createOutboundRequest,
  createPartnerExport,
  findOpenOutboundBySource,
  listOutboundRequests,
  refreshOutboundRequestRouteResolution,
  resetOutboundRequestForRetry,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'
import {
  createSupplierSwitchEvent,
  getSupplierSwitchRequestById,
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type {
  BillingUnderlayRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

const RETRY_COOLDOWN_MINUTES = 15
const MAX_AUTOMATION_RETRIES = 3

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

function isAutoAckChannel(channelType: OutboundRequestRow['channel_type']): boolean {
  return channelType === 'email_manual' || channelType === 'file_export'
}

function hasRetryCooldownElapsed(
  outboundRequest: OutboundRequestRow,
  cooldownMinutes = RETRY_COOLDOWN_MINUTES
): boolean {
  if (!outboundRequest.failed_at) return true

  const failedAt = new Date(outboundRequest.failed_at).getTime()
  if (Number.isNaN(failedAt)) return true

  const cooldownMs = cooldownMinutes * 60 * 1000
  return Date.now() - failedAt >= cooldownMs
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
  oldValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    new_values: params.newValues ?? null,
    old_values: params.oldValues ?? null,
  })

  if (error) throw error
}

async function syncSwitchRequestFromOutbound(params: {
  actorUserId: string
  outboundRequest: OutboundRequestRow
}): Promise<SupplierSwitchRequestRow | null> {
  const { outboundRequest } = params

  if (
    outboundRequest.request_type !== 'supplier_switch' ||
    outboundRequest.source_type !== 'supplier_switch_request' ||
    !outboundRequest.source_id
  ) {
    return null
  }

  const supabase = await createSupabaseServerClient()
  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    outboundRequest.source_id
  )

  if (!switchRequest) {
    return null
  }

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'outbound_status_sync',
    eventStatus: outboundRequest.status,
    message: `Outbound ${outboundRequest.id} uppdaterad till ${outboundRequest.status} via automation sweep.`,
    payload: {
      outboundRequestId: outboundRequest.id,
      outboundStatus: outboundRequest.status,
      outboundChannelType: outboundRequest.channel_type,
      externalReference: outboundRequest.external_reference,
      failureReason: outboundRequest.failure_reason,
      automation: true,
    },
  })

  if (outboundRequest.status === 'sent') {
    if (['draft', 'queued'].includes(switchRequest.status)) {
      return updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'submitted',
        externalReference:
          outboundRequest.external_reference ?? switchRequest.external_reference,
      })
    }

    return switchRequest
  }

  if (outboundRequest.status === 'acknowledged') {
    if (['draft', 'queued', 'submitted'].includes(switchRequest.status)) {
      return updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'accepted',
        externalReference:
          outboundRequest.external_reference ?? switchRequest.external_reference,
      })
    }

    return switchRequest
  }

  if (
    outboundRequest.status === 'failed' ||
    outboundRequest.status === 'cancelled'
  ) {
    if (!['completed', 'rejected', 'failed'].includes(switchRequest.status)) {
      return updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'failed',
        externalReference:
          outboundRequest.external_reference ?? switchRequest.external_reference,
        failureReason:
          outboundRequest.failure_reason ??
          (outboundRequest.status === 'cancelled'
            ? 'Outbound dispatch avbröts av automationen.'
            : 'Outbound dispatch misslyckades i automation sweep.'),
      })
    }

    return switchRequest
  }

  return switchRequest
}

async function finalizeAcceptedSwitchFromAcknowledgedOutbound(params: {
  actorUserId: string
  request: SupplierSwitchRequestRow
  outboundRequest: OutboundRequestRow
}): Promise<boolean> {
  const { actorUserId, request, outboundRequest } = params

  if (request.status !== 'accepted') return false
  if (outboundRequest.status !== 'acknowledged') return false
  if (outboundRequest.source_type !== 'supplier_switch_request') return false
  if (outboundRequest.source_id !== request.id) return false

  const supabase = await createSupabaseServerClient()

  const siteQuery = await supabase
    .from('customer_sites')
    .select('*')
    .eq('id', request.site_id)
    .maybeSingle()

  if (siteQuery.error) throw siteQuery.error

  const siteBefore = (siteQuery.data as CustomerSiteRow | null) ?? null
  if (!siteBefore) {
    throw new Error(`Kunde inte hitta site för switch ${request.id}`)
  }

  let meteringPointBefore: MeteringPointRow | null = null
  if (request.metering_point_id) {
    const meteringPointQuery = await supabase
      .from('metering_points')
      .select('*')
      .eq('id', request.metering_point_id)
      .maybeSingle()

    if (meteringPointQuery.error) throw meteringPointQuery.error
    meteringPointBefore =
      (meteringPointQuery.data as MeteringPointRow | null) ?? null
  }

  const siteUpdatePayload = {
    current_supplier_name: request.incoming_supplier_name,
    current_supplier_org_number: request.incoming_supplier_org_number,
    status: siteBefore.status === 'closed' ? 'closed' : 'active',
    grid_owner_id: siteBefore.grid_owner_id ?? request.grid_owner_id ?? null,
    price_area_code: siteBefore.price_area_code ?? request.price_area_code ?? null,
    updated_by: actorUserId,
  }

  const siteUpdate = await supabase
    .from('customer_sites')
    .update(siteUpdatePayload)
    .eq('id', siteBefore.id)
    .select('*')
    .single()

  if (siteUpdate.error) throw siteUpdate.error
  const siteAfter = siteUpdate.data as CustomerSiteRow

  let meteringPointAfter: MeteringPointRow | null = meteringPointBefore

  if (meteringPointBefore) {
    const pointUpdate = await supabase
      .from('metering_points')
      .update({
        status: meteringPointBefore.status === 'closed' ? 'closed' : 'active',
        grid_owner_id:
          meteringPointBefore.grid_owner_id ?? request.grid_owner_id ?? null,
        price_area_code:
          meteringPointBefore.price_area_code ?? request.price_area_code ?? null,
        updated_by: actorUserId,
      })
      .eq('id', meteringPointBefore.id)
      .select('*')
      .single()

    if (pointUpdate.error) throw pointUpdate.error
    meteringPointAfter = pointUpdate.data as MeteringPointRow
  }

  const completedRequest = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: request.id,
    status: 'completed',
    externalReference:
      outboundRequest.external_reference ?? request.external_reference,
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: request.id,
    eventType: 'execution_completed',
    eventStatus: 'completed',
    message: `Switchen slutfördes automatiskt efter kvitterad outbound ${outboundRequest.id}.`,
    payload: {
      automation: true,
      outboundRequestId: outboundRequest.id,
      previousSupplierName: siteBefore.current_supplier_name,
      newSupplierName: completedRequest.incoming_supplier_name,
      siteStatusBefore: siteBefore.status,
      siteStatusAfter: siteAfter.status,
      meteringPointStatusBefore: meteringPointBefore?.status ?? null,
      meteringPointStatusAfter: meteringPointAfter?.status ?? null,
    },
  })

  await insertAuditLog({
    actorUserId,
    entityType: 'supplier_switch_request',
    entityId: completedRequest.id,
    action: 'supplier_switch_request_execution_completed_by_automation',
    oldValues: request,
    newValues: completedRequest,
    metadata: {
      outboundRequestId: outboundRequest.id,
      customerId: completedRequest.customer_id,
      siteId: completedRequest.site_id,
      meteringPointId: completedRequest.metering_point_id,
    },
  })

  await insertAuditLog({
    actorUserId,
    entityType: 'customer_site',
    entityId: siteAfter.id,
    action: 'customer_site_updated_from_supplier_switch_execution_by_automation',
    oldValues: siteBefore,
    newValues: siteAfter,
    metadata: {
      switchRequestId: completedRequest.id,
      customerId: siteAfter.customer_id,
      outboundRequestId: outboundRequest.id,
    },
  })

  if (meteringPointBefore && meteringPointAfter) {
    await insertAuditLog({
      actorUserId,
      entityType: 'metering_point',
      entityId: meteringPointAfter.id,
      action: 'metering_point_updated_from_supplier_switch_execution_by_automation',
      oldValues: meteringPointBefore,
      newValues: meteringPointAfter,
      metadata: {
        switchRequestId: completedRequest.id,
        customerId: completedRequest.customer_id,
        siteId: completedRequest.site_id,
        outboundRequestId: outboundRequest.id,
      },
    })
  }

  return true
}

async function autoProcessOutboundRequest(params: {
  actorUserId: string
  outboundRequest: OutboundRequestRow
}): Promise<{
  routedResolved: number
  retried: number
  retryCooldownSkipped: number
  retryLimitSkipped: number
  unresolvedSkipped: number
  prepared: number
  sent: number
  acknowledged: number
  syncedSwitches: number
}> {
  const stats = {
    routedResolved: 0,
    retried: 0,
    retryCooldownSkipped: 0,
    retryLimitSkipped: 0,
    unresolvedSkipped: 0,
    prepared: 0,
    sent: 0,
    acknowledged: 0,
    syncedSwitches: 0,
  }

  let current = params.outboundRequest

  if (current.channel_type === 'unresolved') {
    const refreshed = await refreshOutboundRequestRouteResolution({
      actorUserId: params.actorUserId,
      outboundRequestId: current.id,
    })

    if (
      current.channel_type === 'unresolved' &&
      refreshed.channel_type !== 'unresolved'
    ) {
      stats.routedResolved += 1
    }

    current = refreshed
  }

  if (current.status === 'failed') {
    if (current.attempts_count >= MAX_AUTOMATION_RETRIES) {
      stats.retryLimitSkipped += 1
      return stats
    }

    if (!hasRetryCooldownElapsed(current)) {
      stats.retryCooldownSkipped += 1
      return stats
    }

    current = await resetOutboundRequestForRetry({
      actorUserId: params.actorUserId,
      outboundRequestId: current.id,
      reason:
        'Automation sweep återköade requesten efter cooldown för nytt försök.',
    })
    stats.retried += 1
  }

  if (current.channel_type === 'unresolved') {
    stats.unresolvedSkipped += 1
    return stats
  }

  if (current.status === 'queued') {
    current = await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: current.id,
      status: 'prepared',
      responsePayload: {
        automation: true,
        automation_step: 'prepare',
      },
    })
    stats.prepared += 1
  }

  if (current.status === 'prepared') {
    current = await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: current.id,
      status: 'sent',
      responsePayload: {
        automation: true,
        automation_step: 'send',
      },
    })
    stats.sent += 1

    const synced = await syncSwitchRequestFromOutbound({
      actorUserId: params.actorUserId,
      outboundRequest: current,
    })

    if (synced) {
      stats.syncedSwitches += 1
    }
  }

  if (current.status === 'sent' && isAutoAckChannel(current.channel_type)) {
    current = await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: current.id,
      status: 'acknowledged',
      responsePayload: {
        automation: true,
        automation_step: 'acknowledge',
        autoAckChannel: current.channel_type,
      },
    })
    stats.acknowledged += 1

    const synced = await syncSwitchRequestFromOutbound({
      actorUserId: params.actorUserId,
      outboundRequest: current,
    })

    if (synced) {
      stats.syncedSwitches += 1
    }
  }

  return stats
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
  let routedResolved = 0
  let retried = 0
  let retryCooldownSkipped = 0
  let retryLimitSkipped = 0
  let unresolvedSkipped = 0
  let preparedCount = 0
  let sentCount = 0
  let acknowledgedCount = 0
  let syncedSwitches = 0
  let executedSwitches = 0

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

    const created = await createOutboundRequest({
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
        automation: 'batch8_sweep',
        requestType: request.request_type,
        switchStatus: request.status,
      },
    })

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: request.id,
      eventType: 'outbound_queued',
      eventStatus: created.status,
      message: `Outbound ${created.id} köades automatiskt av automation sweep.`,
      payload: {
        outboundRequestId: created.id,
        channelType: created.channel_type,
        routeId: created.communication_route_id,
        automation: true,
      },
    })

    outboundCreated += 1
  }

  const outboundRequests = await listOutboundRequests({
    status: 'all',
    requestType: 'all',
    channelType: 'all',
    query: '',
  })

  const automationCandidates = outboundRequests.filter((request) =>
    ['queued', 'prepared', 'sent', 'failed'].includes(request.status)
  )

  for (const outboundRequest of automationCandidates) {
    const result = await autoProcessOutboundRequest({
      actorUserId: actor.id,
      outboundRequest,
    })

    routedResolved += result.routedResolved
    retried += result.retried
    retryCooldownSkipped += result.retryCooldownSkipped
    retryLimitSkipped += result.retryLimitSkipped
    unresolvedSkipped += result.unresolvedSkipped
    preparedCount += result.prepared
    sentCount += result.sent
    acknowledgedCount += result.acknowledged
    syncedSwitches += result.syncedSwitches
  }

  const refreshedSwitchRequests = await listAllSupplierSwitchRequests(supabase, {
    status: 'all',
    requestType: 'all',
    query: '',
  })

  const refreshedOutboundRequests = await listOutboundRequests({
    status: 'acknowledged',
    requestType: 'supplier_switch',
    channelType: 'all',
    query: '',
  })

  for (const request of refreshedSwitchRequests) {
    if (request.status !== 'accepted') continue

    const outboundRequest = refreshedOutboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id &&
        row.status === 'acknowledged'
    )

    if (!outboundRequest) continue

    const executed = await finalizeAcceptedSwitchFromAcknowledgedOutbound({
      actorUserId: actor.id,
      request,
      outboundRequest,
    })

    if (executed) {
      executedSwitches += 1
    }
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'operations_sweep',
    entityId: actor.id,
    action: 'operations_automation_sweep_ran',
    metadata: {
      readinessSynced,
      outboundCreated,
      routedResolved,
      retried,
      retryCooldownSkipped,
      retryLimitSkipped,
      unresolvedSkipped,
      preparedCount,
      sentCount,
      acknowledgedCount,
      syncedSwitches,
      executedSwitches,
      candidateCount: automationCandidates.length,
      siteCount: sites.length,
      switchCount: switchRequests.length,
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
  candidateCount: number
  batchKey: string
}> {
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
      payload: {
        underlayYear: underlay.underlay_year,
        underlayMonth: underlay.underlay_month,
        sourceSystem: underlay.source_system,
      },
      notes: `Batch 7 export sweep för ${period.year}-${String(
        period.month
      ).padStart(2, '0')}`,
    })

    createdCount += 1
  }

  const skippedCount = Math.max(0, typedUnderlays.length - createdCount)
  const batchKey = `billing-export:${period.year}-${String(period.month).padStart(2, '0')}`

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'partner_export',
    entityId: `${period.year}-${String(period.month).padStart(2, '0')}`,
    action: 'bulk_queue_ready_billing_exports',
    metadata: {
      year: period.year,
      month: period.month,
      createdCount,
      skippedCount,
      candidateCount: typedUnderlays.length,
      batchKey,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing')
  revalidatePath('/admin/partner-exports')
  revalidatePath('/admin/operations')

  return {
    year: period.year,
    month: period.month,
    createdCount,
    skippedCount,
    candidateCount: typedUnderlays.length,
    batchKey,
  }
}