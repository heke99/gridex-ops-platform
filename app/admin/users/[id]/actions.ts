'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'

async function requireCurrentPermissions() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')

  const permissions = await getUserPermissions(user.id)

  return { user, permissions }
}

async function requireRoleManager() {
  const { user, permissions } = await requireCurrentPermissions()

  if (!permissions.includes('roles.manage')) {
    throw new Error('Forbidden')
  }

  return { user, permissions }
}

async function requirePermissionManager() {
  const { user, permissions } = await requireCurrentPermissions()

  if (!permissions.includes('permissions.manage')) {
    throw new Error('Forbidden')
  }

  return { user, permissions }
}

async function auditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  oldValues?: unknown
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

function revalidateUserAccessPaths(userId: string) {
  revalidatePath(`/admin/users/${userId}`)
  revalidatePath('/admin/users')
  revalidatePath('/admin/roles')
}

export async function assignUserRoleAction(formData: FormData) {
  const { user } = await requireRoleManager()

  const userId = String(formData.get('userId') ?? '')
  const roleId = String(formData.get('roleId') ?? '')

  if (!userId || !roleId) throw new Error('Missing fields')

  const { error } = await supabaseService.from('user_roles').upsert({
    user_id: userId,
    role_id: roleId,
    granted_by: user.id,
    is_active: true,
    expires_at: null,
  })

  if (error) throw error

  await auditLog({
    actorUserId: user.id,
    entityType: 'user_role',
    entityId: userId,
    action: 'assign_role',
    newValues: { roleId },
  })

  revalidateUserAccessPaths(userId)
}

export async function removeUserRoleAction(formData: FormData) {
  const { user } = await requireRoleManager()

  const userRoleId = String(formData.get('userRoleId') ?? '')
  const userId = String(formData.get('userId') ?? '')

  if (!userRoleId || !userId) throw new Error('Missing fields')

  const { error } = await supabaseService
    .from('user_roles')
    .update({ is_active: false, granted_by: user.id })
    .eq('id', userRoleId)

  if (error) throw error

  await auditLog({
    actorUserId: user.id,
    entityType: 'user_role',
    entityId: userId,
    action: 'remove_role',
    newValues: { userRoleId },
  })

  revalidateUserAccessPaths(userId)
}

export async function addUserPermissionOverrideAction(formData: FormData) {
  const { user } = await requirePermissionManager()

  const userId = String(formData.get('userId') ?? '')
  const permissionId = String(formData.get('permissionId') ?? '')
  const effect = String(formData.get('effect') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (!userId || !permissionId || !['allow', 'deny'].includes(effect)) {
    throw new Error('Invalid fields')
  }

  const { error } = await supabaseService.from('user_permission_overrides').upsert({
    user_id: userId,
    permission_id: permissionId,
    effect,
    reason: reason || null,
    granted_by: user.id,
    expires_at: null,
  })

  if (error) throw error

  await auditLog({
    actorUserId: user.id,
    entityType: 'user_permission_override',
    entityId: userId,
    action: 'add_permission_override',
    newValues: { permissionId, effect, reason },
  })

  revalidateUserAccessPaths(userId)
}

export async function removeUserPermissionOverrideAction(formData: FormData) {
  const { user } = await requirePermissionManager()

  const overrideId = String(formData.get('overrideId') ?? '')
  const userId = String(formData.get('userId') ?? '')

  if (!overrideId || !userId) throw new Error('Missing fields')

  const { error } = await supabaseService
    .from('user_permission_overrides')
    .delete()
    .eq('id', overrideId)

  if (error) throw error

  await auditLog({
    actorUserId: user.id,
    entityType: 'user_permission_override',
    entityId: userId,
    action: 'remove_permission_override',
    newValues: { overrideId },
  })

  revalidateUserAccessPaths(userId)
}