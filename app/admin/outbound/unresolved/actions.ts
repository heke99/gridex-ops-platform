'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  getOutboundRequestById,
  listUnresolvedOutboundRequests,
  resetOutboundRequestForRetry,
  refreshOutboundRequestRouteResolution,
} from '@/lib/cis/db'
import { createSupplierSwitchEvent } from '@/lib/operations/db'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  metadata?: unknown
  oldValues?: unknown
  newValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
  })

  if (error) throw error
}

async function syncSwitchRouteEvent(params: {
  outboundRequestId: string
  routeResolved: boolean
  channelType: string
  actorUserId: string
  mode: 'rerun' | 'manual_assign'
}) {
  const outbound = await getOutboundRequestById(params.outboundRequestId)

  if (
    !outbound ||
    outbound.request_type !== 'supplier_switch' ||
    outbound.source_type !== 'supplier_switch_request' ||
    !outbound.source_id
  ) {
    return
  }

  const supabase = await createSupabaseServerClient()

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: outbound.source_id,
    eventType: params.routeResolved
      ? params.mode === 'manual_assign'
        ? 'outbound_route_assigned'
        : 'outbound_route_resolved'
      : 'outbound_route_still_unresolved',
    eventStatus: params.channelType,
    message: params.routeResolved
      ? params.mode === 'manual_assign'
        ? `Outbound ${outbound.id} fick manuellt vald route ${outbound.communication_route_id ?? 'okänd'} och kan gå vidare.`
        : `Outbound ${outbound.id} fick route ${outbound.communication_route_id ?? 'okänd'} och är inte längre unresolved.`
      : `Outbound ${outbound.id} är fortfarande unresolved efter ny route-upplösning.`,
    payload: {
      outboundRequestId: outbound.id,
      channelType: params.channelType,
      communicationRouteId: outbound.communication_route_id,
      actorUserId: params.actorUserId,
      mode: params.mode,
    },
  })
}

async function revalidateAll(customerId: string) {
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/customers/${customerId}`)
}

export async function rerunUnresolvedRouteResolutionAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const outboundRequestId = formValue(formData, 'outbound_request_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!outboundRequestId || !customerId) {
    throw new Error('outbound_request_id och customer_id krävs')
  }

  const before = await getOutboundRequestById(outboundRequestId)

  if (!before) {
    throw new Error('Outbound request hittades inte')
  }

  const refreshed = await refreshOutboundRequestRouteResolution({
    actorUserId: actor.id,
    outboundRequestId,
  })

  let saved = refreshed
  let requeued = false

  if (
    refreshed.channel_type !== 'unresolved' &&
    (before.status === 'failed' || before.status === 'cancelled')
  ) {
    saved = await resetOutboundRequestForRetry({
      actorUserId: actor.id,
      outboundRequestId: refreshed.id,
      reason:
        'Route löstes från unresolved-sidan och requesten återköades för nytt försök.',
    })
    requeued = true
  }

  await syncSwitchRouteEvent({
    outboundRequestId: saved.id,
    routeResolved: saved.channel_type !== 'unresolved',
    channelType: saved.channel_type,
    actorUserId: actor.id,
    mode: 'rerun',
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: saved.id,
    action: 'outbound_request_route_resolution_reran',
    oldValues: before,
    newValues: saved,
    metadata: {
      customerId,
      beforeChannelType: before.channel_type,
      afterChannelType: saved.channel_type,
      beforeRouteId: before.communication_route_id,
      afterRouteId: saved.communication_route_id,
      requeued,
    },
  })

  await revalidateAll(customerId)
}

export async function assignRouteToUnresolvedOutboundAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const outboundRequestId = formValue(formData, 'outbound_request_id') ?? ''
  const communicationRouteId = formValue(formData, 'communication_route_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!outboundRequestId || !communicationRouteId || !customerId) {
    throw new Error('outbound_request_id, communication_route_id och customer_id krävs')
  }

  const before = await getOutboundRequestById(outboundRequestId)

  if (!before) {
    throw new Error('Outbound request hittades inte')
  }

  const routeQuery = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', communicationRouteId)
    .eq('is_active', true)
    .maybeSingle()

  if (routeQuery.error) throw routeQuery.error

  const route = routeQuery.data

  if (!route) {
    throw new Error('Vald route hittades inte eller är inte aktiv')
  }

  const allowedScope =
    before.request_type === 'supplier_switch'
      ? 'supplier_switch'
      : before.request_type === 'meter_values'
        ? 'meter_values'
        : 'billing_underlay'

  if (route.route_scope !== allowedScope) {
    throw new Error('Vald route har fel scope för denna outbound request')
  }

  const updateQuery = await supabaseService
    .from('outbound_requests')
    .update({
      communication_route_id: route.id,
      channel_type: route.route_type,
      updated_by: actor.id,
    })
    .eq('id', outboundRequestId)
    .select('*')
    .single()

  if (updateQuery.error) throw updateQuery.error

  let saved = updateQuery.data
  let requeued = false

  if (before.status === 'failed' || before.status === 'cancelled') {
    saved = await resetOutboundRequestForRetry({
      actorUserId: actor.id,
      outboundRequestId: saved.id,
      reason:
        'Manuell route kopplades från unresolved-sidan och requesten återköades.',
    })
    requeued = true
  }

  const { error: eventError } = await supabaseService
    .from('outbound_dispatch_events')
    .insert({
      outbound_request_id: saved.id,
      event_type: 'queued',
      event_status: saved.status,
      message: requeued
        ? `Manuell route ${route.route_name} valdes och requesten återköades.`
        : `Manuell route ${route.route_name} valdes från unresolved-sidan.`,
      payload: {
        communicationRouteId: route.id,
        routeName: route.route_name,
        routeType: route.route_type,
        manuallyAssigned: true,
        requeued,
      },
      created_by: actor.id,
    })

  if (eventError) throw eventError

  await syncSwitchRouteEvent({
    outboundRequestId: saved.id,
    routeResolved: true,
    channelType: saved.channel_type,
    actorUserId: actor.id,
    mode: 'manual_assign',
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: saved.id,
    action: 'outbound_request_route_assigned_manually',
    oldValues: before,
    newValues: saved,
    metadata: {
      customerId,
      communicationRouteId: route.id,
      routeName: route.route_name,
      routeType: route.route_type,
      beforeChannelType: before.channel_type,
      afterChannelType: saved.channel_type,
      beforeRouteId: before.communication_route_id,
      afterRouteId: saved.communication_route_id,
      requeued,
    },
  })

  await revalidateAll(customerId)
}

export async function rerunAllUnresolvedRouteResolutionsAction(): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const unresolved = await listUnresolvedOutboundRequests()

  let resolvedCount = 0
  let stillUnresolvedCount = 0
  let requeuedCount = 0

  for (const row of unresolved) {
    const refreshed = await refreshOutboundRequestRouteResolution({
      actorUserId: actor.id,
      outboundRequestId: row.id,
    })

    let saved = refreshed
    let requeued = false

    if (
      refreshed.channel_type !== 'unresolved' &&
      (row.status === 'failed' || row.status === 'cancelled')
    ) {
      saved = await resetOutboundRequestForRetry({
        actorUserId: actor.id,
        outboundRequestId: refreshed.id,
        reason: 'Bulk route resolution löste route och återköade requesten.',
      })
      requeued = true
      requeuedCount += 1
    }

    if (saved.channel_type === 'unresolved') {
      stillUnresolvedCount += 1
    } else {
      resolvedCount += 1
    }

    await syncSwitchRouteEvent({
      outboundRequestId: saved.id,
      routeResolved: saved.channel_type !== 'unresolved',
      channelType: saved.channel_type,
      actorUserId: actor.id,
      mode: 'rerun',
    })

    await insertAuditLog({
      actorUserId: actor.id,
      entityType: 'outbound_request',
      entityId: saved.id,
      action: 'outbound_request_route_resolution_reran_bulk',
      oldValues: row,
      newValues: saved,
      metadata: {
        customerId: row.customer_id,
        beforeChannelType: row.channel_type,
        afterChannelType: saved.channel_type,
        beforeRouteId: row.communication_route_id,
        afterRouteId: saved.communication_route_id,
        requeued,
      },
    })
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: actor.id,
    action: 'outbound_unresolved_route_resolution_reran_bulk_summary',
    metadata: {
      scannedCount: unresolved.length,
      resolvedCount,
      stillUnresolvedCount,
      requeuedCount,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
}