// app/admin/users/[id]/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { runCanonicalPlatformAccessCommand } from '@/lib/admin/platformUserAccess'
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

async function getCurrentActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user?.id) throw new Error('Aktörens Auth-identitet kunde inte verifieras.')
  return user.id
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
    await requirePlatformAdminActionAccess()

    const userId = formText(formData, 'user_id', 'userId')
    const preserveOverrides = normalizeCheckbox(formData.get('preserve_overrides'))

    if (!userId) {
      return { ok: false, message: 'User ID saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)

    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'set_primary_role',
      roleId,
      preserveOverrides,
      reason: 'Platform role changed from user detail',
    })

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

    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'replace_overrides',
      allowPermissions: allowKeys,
      denyPermissions: denyKeys,
      reason: 'Platform permission overrides replaced from user detail',
    })

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

    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'clear_overrides',
      reason: 'Platform permission overrides cleared from user detail',
    })

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

    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'disable_platform_access',
      reason: 'Platform access disabled from user detail',
    })

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
    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'add_role',
      roleId,
      reason: 'Secondary platform role added',
    })

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

    await runCanonicalPlatformAccessCommand({
      actorUserId: await getCurrentActorUserId(),
      targetUserId: userId,
      action: 'remove_role',
      roleId,
      reason: 'Secondary platform role removed',
    })

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
  await runCanonicalPlatformAccessCommand({
    actorUserId: await getCurrentActorUserId(),
    targetUserId: userId,
    action: 'add_role',
    roleId,
    reason: 'Platform role assigned through compatibility action',
  })

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function removeUserRoleAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()

  const userId = formText(formData, 'user_id', 'userId')
  const userRoleId = formText(formData, 'userRoleId', 'user_role_id')

  if (!userId) throw new Error('User ID saknas.')

  const roleId = userRoleId ? null : await resolveRoleIdFromFormOrKey(formData)
  await runCanonicalPlatformAccessCommand({
    actorUserId: await getCurrentActorUserId(),
    targetUserId: userId,
    action: 'remove_role',
    userRoleId: userRoleId || null,
    roleId,
    reason: 'Platform role removed through compatibility action',
  })

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

  await runCanonicalPlatformAccessCommand({
    actorUserId: await getCurrentActorUserId(),
    targetUserId: userId,
    action: 'upsert_override',
    permissionKey,
    effect,
    reason,
  })

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

  let permissionKey: string
  if (overrideId) {
    const { data, error } = await supabaseService
      .from('user_permission_overrides')
      .select('permission_key')
      .eq('id', overrideId)
      .eq('user_id', userId)
      .is('company_id', null)
      .maybeSingle()
    if (error) throw error
    permissionKey = String(data?.permission_key ?? '').trim()
    if (!permissionKey) throw new Error('Permission-override hittades inte.')
  } else {
    permissionKey = await resolvePermissionKeyFromForm(formData)
  }

  await runCanonicalPlatformAccessCommand({
    actorUserId: await getCurrentActorUserId(),
    targetUserId: userId,
    action: 'remove_override',
    permissionKey,
    reason: 'Platform permission override removed',
  })

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}
