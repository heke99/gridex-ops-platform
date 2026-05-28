// app/admin/users/[id]/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { requireRoleIdByKeyOrName } from '@/lib/rbac/resolveRoleId'

type ActionState = {
  ok: boolean
  message: string
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function formText(formData: FormData, ...names: string[]) {
  for (const name of names) {
    const value = normalizeText(formData.get(name))
    if (value) return value
  }
  return ''
}

function normalizeCheckbox(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true' || value === '1'
}

async function resolveRoleIdByKey(roleKey: string) {
  return requireRoleIdByKeyOrName(roleKey)
}

function resolveRoleIdFromForm(formData: FormData): string | null {
  const roleId = formText(formData, 'roleId', 'role_id')
  return roleId || null
}

async function resolveRoleIdFromFormOrKey(formData: FormData): Promise<string> {
  const directRoleId = resolveRoleIdFromForm(formData)
  if (directRoleId) return directRoleId

  const roleKey = formText(formData, 'role_key', 'role')
  if (!roleKey) throw new Error('Roll saknas.')
  return resolveRoleIdByKey(roleKey)
}

async function activateUserRole(input: { userId: string; roleId: string }) {
  const existingById = await supabaseService
    .from('user_roles')
    .select('id')
    .eq('user_id', input.userId)
    .eq('role_id', input.roleId)
    .limit(1)
    .maybeSingle()

  if (existingById.error) throw existingById.error

  if (existingById.data?.id) {
    const { error } = await supabaseService
      .from('user_roles')
      .update({ role_id: input.roleId, status: 'active', is_active: true })
      .eq('id', existingById.data.id)
    if (error) throw error
    return
  }

  const { error } = await supabaseService
    .from('user_roles')
    .insert({
      user_id: input.userId,
      role_id: input.roleId,
      status: 'active',
      is_active: true,
    })

  if (error) throw error
}

async function resolvePermissionKeyFromForm(formData: FormData): Promise<string> {
  const directPermissionKey = formText(formData, 'permission_key', 'permission')
  if (directPermissionKey) return directPermissionKey

  const permissionId = formText(formData, 'permissionId', 'permission_id')
  if (!permissionId) throw new Error('Permission saknas.')

  const { data, error } = await supabaseService
    .from('permissions')
    .select('key,name')
    .eq('id', permissionId)
    .maybeSingle()

  if (error) throw error
  const key = String(data?.key ?? data?.name ?? '').trim()
  if (!key) throw new Error('Permission hittades inte.')
  return key
}

async function ensurePermissionKeys(permissionKeys: string[]) {
  if (permissionKeys.length === 0) return []

  const { data, error } = await supabaseService
    .from('permissions')
    .select('key')
    .in('key', permissionKeys)

  if (error) throw error

  const existing = new Set((data ?? []).map((row) => String(row.key)))
  const missing = permissionKeys.filter((key) => !existing.has(key))

  if (missing.length > 0) {
    throw new Error(`Permissions not found: ${missing.join(', ')}`)
  }

  return permissionKeys
}

function parsePermissionList(raw: string) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

async function replacePermissionOverrides(input: {
  userId: string
  allowKeys: string[]
  denyKeys: string[]
}) {
  await ensurePermissionKeys([...input.allowKeys, ...input.denyKeys])

  const { error: deleteError } = await supabaseService
    .from('user_permission_overrides')
    .delete()
    .eq('user_id', input.userId)

  if (deleteError) throw deleteError

  const rows = [
    ...input.allowKeys.map((permissionKey) => ({
      user_id: input.userId,
      permission_key: permissionKey,
      effect: 'allow',
      is_active: true,
    })),
    ...input.denyKeys.map((permissionKey) => ({
      user_id: input.userId,
      permission_key: permissionKey,
      effect: 'deny',
      is_active: true,
    })),
  ]

  if (rows.length > 0) {
    const { error: insertError } = await supabaseService
      .from('user_permission_overrides')
      .insert(rows)

    if (insertError) throw insertError
  }
}

export async function updateUserRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    const preserveOverrides = normalizeCheckbox(formData.get('preserve_overrides'))

    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)

    const { error: deleteRolesError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (deleteRolesError) throw deleteRolesError

    await activateUserRole({ userId, roleId })

    if (!preserveOverrides) {
      const { error: deleteOverridesError } = await supabaseService
        .from('user_permission_overrides')
        .delete()
        .eq('user_id', userId)

      if (deleteOverridesError) throw deleteOverridesError
    }

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: preserveOverrides
        ? 'Roll uppdaterades. Befintliga overrides behölls.'
        : 'Roll uppdaterades och gamla overrides rensades.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte uppdatera rollen.',
    }
  }
}

export async function updateUserPermissionOverridesAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    const allowKeys = parsePermissionList(formText(formData, 'allow_permissions'))
    const denyKeys = parsePermissionList(formText(formData, 'deny_permissions'))

    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const overlap = allowKeys.filter((key) => denyKeys.includes(key))
    if (overlap.length > 0) {
      return {
        ok: false,
        message: `Samma permission kan inte ligga i både allow och deny: ${overlap.join(', ')}`,
      }
    }

    await replacePermissionOverrides({ userId, allowKeys, denyKeys })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Permission-overrides sparades.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Kunde inte uppdatera permission-overrides.',
    }
  }
}

export async function clearUserPermissionOverridesAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const { error } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', userId)

    if (error) throw error

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Alla permission-overrides togs bort.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Kunde inte rensa permission-overrides.',
    }
  }
}

export async function disableUserInternalAccessAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const { error: roleDeleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (roleDeleteError) throw roleDeleteError

    const { error: permissionsDeleteError } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', userId)

    if (permissionsDeleteError) throw permissionsDeleteError

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Intern access stängdes av för användaren.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Kunde inte stänga av användarens access.',
    }
  }
}

export async function addSecondaryRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)
    await activateUserRole({ userId, roleId })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Extra roll lades till.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte lägga till extra roll.',
    }
  }
}

export async function removeSecondaryRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)

    const { error } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId)

    if (error) throw error

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Extra roll togs bort.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte ta bort extra roll.',
    }
  }
}

/**
 * Bakåtkompatibla exportnamn för dina befintliga pages.
 */
export async function assignUserRoleAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()

  const userId = formText(formData, 'user_id', 'userId')
  if (!userId) throw new Error('User ID saknas.')

  const roleId = await resolveRoleIdFromFormOrKey(formData)
  await activateUserRole({ userId, roleId })

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function removeUserRoleAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()

  const userId = formText(formData, 'user_id', 'userId')
  const userRoleId = formText(formData, 'userRoleId', 'user_role_id')

  if (!userId) throw new Error('User ID saknas.')

  if (userRoleId) {
    const { error } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('id', userRoleId)
      .eq('user_id', userId)

    if (error) throw error
  } else {
    const roleId = await resolveRoleIdFromFormOrKey(formData)
    const { error } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId)

    if (error) throw error
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function addUserPermissionOverrideAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()

  const userId = formText(formData, 'user_id', 'userId')
  const effectRaw = formText(formData, 'effect', 'mode', 'value')
  const reason = formText(formData, 'reason') || null

  if (!userId) throw new Error('User ID saknas.')

  const permissionKey = await resolvePermissionKeyFromForm(formData)
  const effect = effectRaw === 'deny' ? 'deny' : 'allow'

  const { error: deleteError } = await supabaseService
    .from('user_permission_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('permission_key', permissionKey)

  if (deleteError) throw deleteError

  const { error } = await supabaseService
    .from('user_permission_overrides')
    .insert({
      user_id: userId,
      permission_key: permissionKey,
      effect,
      reason,
      is_active: true,
    })

  if (error) throw error

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function removeUserPermissionOverrideAction(
  formData: FormData
): Promise<void> {
  await requirePlatformAdminActionAccess()

  const userId = formText(formData, 'user_id', 'userId')
  const overrideId = formText(formData, 'overrideId', 'override_id')

  if (!userId) throw new Error('User ID saknas.')

  if (overrideId) {
    const { error } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('id', overrideId)
      .eq('user_id', userId)

    if (error) throw error
  } else {
    const permissionKey = await resolvePermissionKeyFromForm(formData)
    const { error } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('permission_key', permissionKey)

    if (error) throw error
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}
