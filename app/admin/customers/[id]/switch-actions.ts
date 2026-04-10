'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  getOutboundRequestById,
  resetOutboundRequestForRetry,
} from '@/lib/cis/db'
import {
  createSupplierSwitchEvent,
  getSupplierSwitchRequestById,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'

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

export async function retryOutboundRequestFromCustomerAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const customerId = formValue(formData, 'customer_id') ?? ''
  const outboundRequestId = formValue(formData, 'outbound_request_id') ?? ''

  if (!customerId || !outboundRequestId) {
    throw new Error('customer_id och outbound_request_id krävs')
  }

  const outboundRequest = await getOutboundRequestById(outboundRequestId)

  if (!outboundRequest) {
    throw new Error('Outbound request hittades inte')
  }

  const reset = await resetOutboundRequestForRetry({
    actorUserId: actor.id,
    outboundRequestId,
    reason: 'Manuell retry från kundkortet.',
  })

  if (
    reset.request_type === 'supplier_switch' &&
    reset.source_type === 'supplier_switch_request' &&
    reset.source_id
  ) {
    const switchRequest = await getSupplierSwitchRequestById(
      supabase,
      reset.source_id
    )

    if (switchRequest && switchRequest.status === 'failed') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'queued',
        externalReference:
          reset.external_reference ?? switchRequest.external_reference,
      })
    }

    if (switchRequest) {
      await createSupplierSwitchEvent(supabase, {
        switchRequestId: switchRequest.id,
        eventType: 'manual_retry_queued',
        eventStatus: reset.status,
        message: `Outbound ${reset.id} återköades manuellt från kundkortet.`,
        payload: {
          outboundRequestId: reset.id,
          customerId,
          attemptsCount: reset.attempts_count,
        },
      })
    }
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: reset.id,
    action: 'outbound_request_manual_retry_from_customer_card',
    newValues: reset,
    metadata: {
      customerId,
      requestType: reset.request_type,
      sourceType: reset.source_type,
      sourceId: reset.source_id,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
}