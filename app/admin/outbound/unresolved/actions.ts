'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminActionAccess, type GuardResult } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  getOutboundRequestById,
  listUnresolvedOutboundRequests,
  resolveLegacyOutboundRoute,
} from '@/lib/cis/db'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}


async function resolveActionCompanyScope(access: GuardResult): Promise<string | null> {
  const scope = await resolveAdminTenantReadScope(access)
  return scope.companyId
}

function assertOutboundTenantAccess(params: {
  access: GuardResult
  companyId: string | null | undefined
}) {
  if (isPlatformAdminContext(params.access)) return
  const companyId = params.companyId ?? null
  if (!companyId) {
    throw new Error('Outbound-raden saknar company_id och kan inte hanteras av tenant-användare.')
  }
}

function cannotResolveOutboundRoute(reason: string): Error {
  if (reason === 'stale') return new Error('Utskicket har ändrats. Ladda om sidan innan du försöker igen.')
  if (reason === 'route_unavailable') return new Error('Vald route är inte tillgänglig för utskicket.')
  return new Error('Kontrollera utskickets transporthistorik innan du ändrar routen.')
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
  companyId?: string | null
  entityType: string
  entityId: string
  action: string
  metadata?: unknown
  oldValues?: unknown
  newValues?: unknown
}) {
  // Always carry company_id so tenant-scoped audit views can see the entry.
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    company_id: params.companyId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
  })

  if (error) throw error
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
  const access = await requireAdminActionAccess([
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

  if (!before || before.customer_id !== customerId) {
    throw new Error('Utskicket hittades inte för vald kund.')
  }

  const scopedCompanyId = await resolveActionCompanyScope(access)
  if (!isPlatformAdminContext(access) && before.company_id !== scopedCompanyId) {
    throw new Error('Du saknar åtkomst till denna outbound request.')
  }
  assertOutboundTenantAccess({ access, companyId: before.company_id })

  const result = await resolveLegacyOutboundRoute({ actorUserId: actor.id, request: before, mode: 'rerun' })
  if (result.status === 'held') throw cannotResolveOutboundRoute(result.reason)
  await revalidateAll(customerId)
}

export async function assignRouteToUnresolvedOutboundAction(
  formData: FormData
): Promise<void> {
  const access = await requireAdminActionAccess([
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

  if (!before || before.customer_id !== customerId) {
    throw new Error('Utskicket hittades inte för vald kund.')
  }

  const scopedCompanyId = await resolveActionCompanyScope(access)
  if (!isPlatformAdminContext(access) && before.company_id !== scopedCompanyId) {
    throw new Error('Du saknar åtkomst till denna outbound request.')
  }
  assertOutboundTenantAccess({ access, companyId: before.company_id })

  const result = await resolveLegacyOutboundRoute({
    actorUserId: actor.id, request: before, mode: 'manual_assign', routeId: communicationRouteId,
  })
  if (result.status === 'held') throw cannotResolveOutboundRoute(result.reason)
  await revalidateAll(customerId)
}

export async function rerunAllUnresolvedRouteResolutionsAction(): Promise<void> {
  const access = await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const scopedCompanyId = await resolveActionCompanyScope(access)
  const unresolved = await listUnresolvedOutboundRequests({ companyId: scopedCompanyId })

  let resolvedCount = 0
  let stillUnresolvedCount = 0
  let requeuedCount = 0
  let heldCount = 0

  for (const row of unresolved) {
    const result = await resolveLegacyOutboundRoute({ actorUserId: actor.id, request: row, mode: 'bulk' })
    if (result.status === 'held') {
      heldCount += 1
      continue
    }

    const { request: saved, requeued } = result
    if (requeued) requeuedCount += 1

    if (saved.channel_type === 'unresolved') {
      stillUnresolvedCount += 1
    } else {
      resolvedCount += 1
    }


  }

  await insertAuditLog({
    actorUserId: actor.id,
    companyId: scopedCompanyId ?? null,
    entityType: 'outbound_request',
    entityId: actor.id,
    action: 'outbound_unresolved_route_resolution_reran_bulk_summary',
    metadata: {
      scannedCount: unresolved.length,
      resolvedCount,
      stillUnresolvedCount,
      requeuedCount,
      heldCount,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
}
