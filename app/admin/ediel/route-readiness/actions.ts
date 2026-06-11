'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function auditLaunchAction(input: {
  actorUserId: string
  action: string
  actorId?: string | null
  routeId?: string | null
  metadata?: Record<string, unknown>
}) {
  await supabaseService
    .from('audit_logs')
    .insert({
      action: input.action,
      actor_user_id: input.actorUserId,
      entity_type: input.routeId ? 'platform_actor_routes' : 'platform_market_actors',
      entity_id: input.routeId ?? input.actorId ?? 'unknown',
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    })
    .then((result) => {
      if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
    })
}

function revalidateRouteReadiness() {
  revalidatePath('/admin/ediel/route-readiness')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/system-health')
}

export async function verifyActorRouteForManualSendAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const routeId = value(formData, 'routeId')
  if (!actorId) throw new Error('Actor saknas.')

  const actorUpdate = await supabaseService
    .from('platform_market_actors')
    .update({
      status: 'active',
      match_status: 'verified',
      visible_to_tenants: true,
      verified_at: new Date().toISOString(),
      verified_by: context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actorId)
  if (actorUpdate.error) throw actorUpdate.error

  if (routeId) {
    const routeUpdate = await supabaseService
      .from('platform_actor_routes')
      .update({
        status: 'active',
        is_verified: true,
        auto_send_allowed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', routeId)
      .eq('actor_id', actorId)
    if (routeUpdate.error) throw routeUpdate.error
  }

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.verified_manual_send',
    actorId,
    routeId,
    metadata: { auto_send_allowed: false },
  })
  revalidateRouteReadiness()
}

export async function createRouteManualReviewAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const messageFamily = value(formData, 'messageFamily')
  const actorRole = value(formData, 'actorRole')
  const note = value(formData, 'note') ?? 'Route behöver manuell granskning före launch.'
  if (!actorId) throw new Error('Actor saknas.')

  const result = await supabaseService
    .from('platform_actor_import_issues')
    .insert({
      actor_id: actorId,
      issue_type: 'manual_route_review',
      severity: 'blocking',
      status: 'open',
      message: note,
      metadata: {
        message_family: messageFamily,
        actor_role: actorRole,
        created_from: '/admin/ediel/route-readiness',
        created_by: context.userId,
      },
    })
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.manual_review_created',
    actorId,
    metadata: { messageFamily, actorRole, note },
  })
  revalidateRouteReadiness()
}

export async function markRouteNotRelevantAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const messageFamily = value(formData, 'messageFamily')
  const actorRole = value(formData, 'actorRole')
  if (!actorId) throw new Error('Actor saknas.')

  const result = await supabaseService
    .from('platform_actor_import_issues')
    .insert({
      actor_id: actorId,
      issue_type: 'route_not_required',
      severity: 'info',
      status: 'ignored',
      message: 'Route markerad som ej relevant för launch-readiness.',
      metadata: {
        message_family: messageFamily,
        actor_role: actorRole,
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      },
      resolved_at: new Date().toISOString(),
    })
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.not_relevant',
    actorId,
    metadata: { messageFamily, actorRole },
  })
  revalidateRouteReadiness()
}

export async function markContactOnlySupplierAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  if (!actorId) throw new Error('Actor saknas.')

  const existing = await supabaseService
    .from('platform_market_actors')
    .select('metadata')
    .eq('id', actorId)
    .maybeSingle()
  if (existing.error) throw existing.error

  const metadata = {
    ...((existing.data?.metadata ?? {}) as Record<string, unknown>),
    contact_only_supplier: true,
    contact_only_marked_at: new Date().toISOString(),
    contact_only_marked_by: context.userId,
  }

  const result = await supabaseService
    .from('platform_market_actors')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', actorId)
  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'route_readiness.contact_only_supplier',
    actorId,
    metadata,
  })
  revalidateRouteReadiness()
}

export async function saveSupplierContactAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const actorId = value(formData, 'actorId')
  const contactType = value(formData, 'contactType') ?? 'general'
  const email = value(formData, 'email')
  const phone = value(formData, 'phone')
  if (!actorId) throw new Error('Actor saknas.')
  if (!email && !phone) throw new Error('E-post eller telefon krävs.')

  const payload = {
    actor_id: actorId,
    contact_type: contactType,
    email,
    phone,
    contact_name: value(formData, 'contactName'),
    channel: email ? 'email' : 'phone',
    source: 'manual',
    is_verified: true,
    verified_by: context.userId,
    verified_at: new Date().toISOString(),
    notes: value(formData, 'notes'),
    updated_at: new Date().toISOString(),
  }

  let lookup = supabaseService
    .from('platform_actor_contacts')
    .select('id')
    .eq('actor_id', actorId)
    .eq('contact_type', contactType)
    .limit(1)

  lookup = email ? lookup.eq('email', email) : lookup.is('email', null)
  lookup = phone ? lookup.eq('phone', phone) : lookup.is('phone', null)

  const existing = await lookup.maybeSingle()
  if (existing.error) throw existing.error

  const result = existing.data?.id
    ? await supabaseService.from('platform_actor_contacts').update(payload).eq('id', existing.data.id)
    : await supabaseService.from('platform_actor_contacts').insert(payload)

  if (result.error) throw result.error

  await auditLaunchAction({
    actorUserId: context.userId,
    action: 'supplier_contact.verified_upsert',
    actorId,
    metadata: { contactType, email: email ? '[set]' : null, phone: phone ? '[set]' : null },
  })
  revalidateRouteReadiness()
}
