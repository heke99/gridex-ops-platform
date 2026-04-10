'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  getOutboundRequestById,
  listUnresolvedOutboundRequests,
  refreshOutboundRequestRouteResolution,
  resetOutboundRequestForRetry,
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
      ? 'outbound_route_resolved'
      : 'outbound_route_still_unresolved',
    eventStatus: params.channelType,
    message: params.routeResolved
      ? `Outbound ${outbound.id} fick route ${outbound.communication_route_id ?? 'okänd'} och är inte längre unresolved.`
      : `Outbound ${outbound.id} är fortfarande unresolved efter ny route-upplösning.`,
    payload: {
      outboundRequestId: outbound.id,
      channelType: params.channelType,
      communicationRouteId: outbound.communication_route_id,
      actorUserId: params.actorUserId,
    },
  })
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

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/customers/${customerId}`)
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