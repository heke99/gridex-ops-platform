// app/admin/users/[id]/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireAdminActionAccess } from '@/lib/admin/guards'

type ActionState = {
  ok: boolean
  message: string
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeCheckbox(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true' || value === '1'
}

async function resolveRoleIdByKey(roleKey: string) {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', roleKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) {
    throw new Error(`Role not found: ${roleKey}`)
  }

  return data.id as string
}


function resolveRoleIdFromForm(formData: FormData): string | null {
  const roleId = normalizeText(formData.get('roleId')) || normalizeText(formData.get('role_id'))
  return roleId || null
}

async function resolveRoleIdFromFormOrKey(formData: FormData): Promise<string> {
  const directRoleId = resolveRoleIdFromForm(formData)
  if (directRoleId) return directRoleId

  const roleKey =
    normalizeText(formData.get('role_key')) ||
    normalizeText(formData.get('role'))

  if (!roleKey) throw new Error('Roll saknas.')
  return resolveRoleIdByKey(roleKey)
}

async function resolvePermissionIdByKey(permissionKey: string) {
  const { data, error } = await supabaseService
    .from('permissions')
    .select('id,key')
    .eq('key', permissionKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) {
    throw new Error(`Permission not found: ${permissionKey}`)
  }

  return data.id as string
}


async function resolvePermissionIdFromFormOrKey(formData: FormData): Promise<string> {
  const directPermissionId = normalizeText(formData.get('permissionId')) || normalizeText(formData.get('permission_id'))
  if (directPermissionId) return directPermissionId

  const permissionKey =
    normalizeText(formData.get('permission_key')) ||
    normalizeText(formData.get('permission'))

  if (!permissionKey) throw new Error('Permission saknas.')
  return resolvePermissionIdByKey(permissionKey)
}

async function resolvePermissionIds(permissionKeys: string[]) {
  if (permissionKeys.length === 0) return []

  const { data, error } = await supabaseService
    .from('permissions')
    .select('id,key')
    .in('key', permissionKeys)

  if (error) throw error

  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.id as string]))
  const missing = permissionKeys.filter((key) => !byKey.has(key))

  if (missing.length > 0) {
    throw new Error(`Permissions not found: ${missing.join(', ')}`)
  }

  return permissionKeys.map((key) => byKey.get(key) as string)
}

function parsePermissionList(raw: string) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export async function updateUserRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
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

    const { error: insertRoleError } = await supabaseService
      .from('user_roles')
      .insert({
        user_id: userId,
        role_id: roleId,
        status: 'active',
      })

    if (insertRoleError) throw insertRoleError

    if (!preserveOverrides) {
      const { error: deleteOverridesError } = await supabaseService
        .from('user_permissions')
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
    await requireAdminActionAccess({ anyOf: ['permissions.manage', 'users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    const allowKeys = parsePermissionList(normalizeText(formData.get('allow_permissions')))
    const denyKeys = parsePermissionList(normalizeText(formData.get('deny_permissions')))

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

    const allowIds = await resolvePermissionIds(allowKeys)
    const denyIds = await resolvePermissionIds(denyKeys)

    const { error: deleteError } = await supabaseService
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    const rows = [
      ...allowIds.map((permissionId) => ({
        user_id: userId,
        permission_id: permissionId,
        is_allowed: true,
      })),
      ...denyIds.map((permissionId) => ({
        user_id: userId,
        permission_id: permissionId,
        is_allowed: false,
      })),
    ]

    if (rows.length > 0) {
      const { error: insertError } = await supabaseService
        .from('user_permissions')
        .insert(rows)

      if (insertError) throw insertError
    }

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
    await requireAdminActionAccess({ anyOf: ['permissions.manage', 'users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const { error } = await supabaseService
      .from('user_permissions')
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
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const { error: roleDeleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (roleDeleteError) throw roleDeleteError

    const { error: permissionsDeleteError } = await supabaseService
      .from('user_permissions')
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
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)

    const { error } = await supabaseService
      .from('user_roles')
      .upsert(
        {
          user_id: userId,
          role_id: roleId,
          status: 'active',
        },
        { onConflict: 'user_id,role_id' }
      )

    if (error) throw error

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
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
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
  await requireAdminActionAccess({ anyOf: ['users.write'] })

  const userId = normalizeText(formData.get('user_id'))
  if (!userId) throw new Error('User ID saknas.')

  const roleId = await resolveRoleIdFromFormOrKey(formData)

  const { error } = await supabaseService
    .from('user_roles')
    .upsert(
      {
        user_id: userId,
        role_id: roleId,
        status: 'active',
      },
      { onConflict: 'user_id,role_id' }
    )

  if (error) throw error

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function removeUserRoleAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess({ anyOf: ['users.write'] })

  const userId = normalizeText(formData.get('user_id'))
  const userRoleId = normalizeText(formData.get('userRoleId')) || normalizeText(formData.get('user_role_id'))

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
  await requireAdminActionAccess({ anyOf: ['permissions.manage', 'users.write'] })

  const userId = normalizeText(formData.get('user_id'))
  const effectRaw =
    normalizeText(formData.get('effect')) ||
    normalizeText(formData.get('mode')) ||
    normalizeText(formData.get('value'))

  if (!userId) throw new Error('User ID saknas.')

  const permissionId = await resolvePermissionIdFromFormOrKey(formData)
  const isAllowed = effectRaw === 'deny' ? false : true

  const { error } = await supabaseService
    .from('user_permissions')
    .upsert(
      {
        user_id: userId,
        permission_id: permissionId,
        is_allowed: isAllowed,
      },
      { onConflict: 'user_id,permission_id' }
    )

  if (error) throw error

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function removeUserPermissionOverrideAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess({ anyOf: ['permissions.manage', 'users.write'] })

  const userId = normalizeText(formData.get('user_id'))
  const overrideId = normalizeText(formData.get('overrideId')) || normalizeText(formData.get('override_id'))

  if (!userId) throw new Error('User ID saknas.')

  if (overrideId) {
    const { error } = await supabaseService
      .from('user_permissions')
      .delete()
      .eq('id', overrideId)
      .eq('user_id', userId)

    if (error) throw error
  } else {
    const permissionId = await resolvePermissionIdFromFormOrKey(formData)
    const { error } = await supabaseService
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('permission_id', permissionId)

    if (error) throw error
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}
