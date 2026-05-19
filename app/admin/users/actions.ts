// app/admin/users/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logTenantGovernanceEvent } from '@/lib/tenant/governance'

type ActionState = {
  ok: boolean
  message: string
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeCheckbox(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true' || value === '1'
}

function getBaseAppUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    'http://localhost:3000'
  )
}


async function getCurrentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Inloggning krävs.')
  return user.id
}

async function upsertOptionalUserProfile(input: { userId: string; email: string; fullName: string | null }) {
  const { error } = await supabaseService.from('user_profiles').upsert(
    {
      id: input.userId,
      email: input.email,
      full_name: input.fullName,
    },
    { onConflict: 'id' }
  )

  if (error && !['42P01', 'PGRST205'].includes(error.code ?? '')) {
    throw error
  }
}

async function insertActiveUserRole(input: { userId: string; roleId: string }) {
  const first = await supabaseService.from('user_roles').insert({
    user_id: input.userId,
    role_id: input.roleId,
    status: 'active',
  })

  if (!first.error) return

  if ((first.error.message ?? '').includes('status') || first.error.code === '42703') {
    const second = await supabaseService.from('user_roles').insert({
      user_id: input.userId,
      role_id: input.roleId,
      is_active: true,
    })

    if (!second.error) return

    if ((second.error.message ?? '').includes('is_active') || second.error.code === '42703') {
      const third = await supabaseService.from('user_roles').insert({
        user_id: input.userId,
        role_id: input.roleId,
      })
      if (third.error) throw third.error
      return
    }

    throw second.error
  }

  throw first.error
}

async function resolveRoleIdByKey(roleKey: string) {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', roleKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) {
    throw new Error(`Rollen hittades inte: ${roleKey}`)
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

  if (!roleKey) {
    throw new Error('Roll saknas.')
  }

  return resolveRoleIdByKey(roleKey)
}

async function resolveUserByIdOrEmail(input: { userId?: string; email?: string }) {
  if (input.userId) {
    const { data, error } = await supabaseService.auth.admin.getUserById(input.userId)
    if (error) throw error
    if (!data.user) throw new Error('Användaren hittades inte')
    return data.user
  }

  const email = input.email?.trim().toLowerCase()
  if (!email) throw new Error('Användaruppgift saknas')

  const { data, error } = await supabaseService.auth.admin.listUsers()
  if (error) throw error

  const user = (data.users ?? []).find(
    (row) => (row.email ?? '').trim().toLowerCase() === email
  )

  if (!user) {
    throw new Error(`Ingen användare hittades med e-post ${email}`)
  }

  return user
}

export async function inviteAdminUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('full_name'))
    const sendInviteRaw = formData.get('send_invite')
    const sendInvite =
      sendInviteRaw === null ? true : normalizeCheckbox(sendInviteRaw)

    if (!email) {
      return { ok: false, message: 'E-post saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)
    const redirectTo = `${getBaseAppUrl()}/login`

    let userId: string | null = null

    if (sendInvite) {
      const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: fullName ? { full_name: fullName } : undefined,
      })

      if (error) throw error
      userId = data.user?.id ?? null
    }

    if (!userId) {
      const existingUser = await resolveUserByIdOrEmail({ email })
      userId = existingUser.id
    }

    await upsertOptionalUserProfile({
      userId,
      email,
      fullName: fullName || null,
    })

    const { error: deleteRolesError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (deleteRolesError) throw deleteRolesError

    await insertActiveUserRole({ userId, roleId })

    revalidatePath('/admin/users')
    revalidatePath('/admin/roles')

    return {
      ok: true,
      message: sendInvite
        ? 'Användaren bjöds in och rollen kopplades.'
        : 'Roll kopplades till befintlig användare.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skapa/inbjuda användare.',
    }
  }
}

export async function setUserRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) {
      return { ok: false, message: 'Användar-id saknas.' }
    }

    const roleId = await resolveRoleIdFromFormOrKey(formData)

    const { error: deleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    await insertActiveUserRole({ userId, roleId })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Rollen uppdaterades.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte uppdatera rollen.',
    }
  }
}

export async function setUserPermissionOverridesAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['permissions.manage', 'users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    const allowRaw = normalizeText(formData.get('allow_permissions'))
    const denyRaw = normalizeText(formData.get('deny_permissions'))

    if (!userId) {
      return { ok: false, message: 'Användar-id saknas.' }
    }

    const allowKeys = allowRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const denyKeys = denyRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const overlap = allowKeys.filter((key) => denyKeys.includes(key))
    if (overlap.length > 0) {
      return {
        ok: false,
        message: `Samma permission kan inte vara både allow och deny: ${overlap.join(', ')}`,
      }
    }

    const { data: allPermissions, error: permissionsError } = await supabaseService
      .from('permissions')
      .select('id,key')

    if (permissionsError) throw permissionsError

    const byKey = new Map((allPermissions ?? []).map((row) => [row.key as string, row.id as string]))

    const allowIds = allowKeys.map((key) => {
      const id = byKey.get(key)
      if (!id) throw new Error(`Behörigheten hittades inte: ${key}`)
      return id
    })

    const denyIds = denyKeys.map((key) => {
      const id = byKey.get(key)
      if (!id) throw new Error(`Behörigheten hittades inte: ${key}`)
      return id
    })

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
      message: 'Individuella behörigheter uppdaterades.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Kunde inte uppdatera individuella behörigheter.',
    }
  }
}

export async function deactivateUserAccessAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) {
      return { ok: false, message: 'Användar-id saknas.' }
    }

    const { error: roleDeleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (roleDeleteError) throw roleDeleteError

    const { error: permissionDeleteError } = await supabaseService
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)

    if (permissionDeleteError) throw permissionDeleteError

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: 'Användarens interna access togs bort.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte ta bort access.',
    }
  }
}



export async function disablePlatformUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })
    const actorUserId = await getCurrentUserId()
    const userId = normalizeText(formData.get('user_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!userId) return { ok: false, message: 'Användar-id saknas.' }
    if (userId === actorUserId) return { ok: false, message: 'Du kan inte stänga av ditt eget konto från denna vy.' }

    const updateAuth = await supabaseService.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    })

    if (updateAuth.error) throw updateAuth.error

    const profileUpdate = await supabaseService
      .from('user_profiles')
      .update({
        user_status: 'disabled',
        disabled_at: new Date().toISOString(),
        disabled_by: actorUserId,
        disabled_reason: reason,
      })
      .eq('id', userId)

    if (profileUpdate.error && !['42P01', 'PGRST205', '42703'].includes(profileUpdate.error.code ?? '')) {
      throw profileUpdate.error
    }

    const roleStatusUpdate = await supabaseService
      .from('user_roles')
      .update({ status: 'disabled', is_active: false })
      .eq('user_id', userId)

    if (roleStatusUpdate.error && !['42P01', 'PGRST205', '42703'].includes(roleStatusUpdate.error.code ?? '')) {
      throw roleStatusUpdate.error
    }

    const membershipUpdate = await supabaseService
      .from('company_memberships')
      .update({
        status: 'disabled',
        disabled_at: new Date().toISOString(),
        disabled_by: actorUserId,
        status_reason: reason,
      })
      .eq('user_id', userId)
      .eq('status', 'active')

    if (membershipUpdate.error && !['42P01', 'PGRST205', '42703'].includes(membershipUpdate.error.code ?? '')) {
      throw membershipUpdate.error
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_USER_DISABLED',
      actorUserId,
      targetUserId: userId,
      reason,
    })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)
    revalidatePath('/admin/companies')

    return { ok: true, message: 'Användaren stängdes av utan att historik raderades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte stängas av.' }
  }
}

export async function reactivatePlatformUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })
    const actorUserId = await getCurrentUserId()
    const userId = normalizeText(formData.get('user_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const updateAuth = await supabaseService.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    })

    if (updateAuth.error) throw updateAuth.error

    const profileUpdate = await supabaseService
      .from('user_profiles')
      .update({
        user_status: 'active',
        disabled_at: null,
        disabled_by: null,
        disabled_reason: null,
        reactivated_at: new Date().toISOString(),
        reactivated_by: actorUserId,
      })
      .eq('id', userId)

    if (profileUpdate.error && !['42P01', 'PGRST205', '42703'].includes(profileUpdate.error.code ?? '')) {
      throw profileUpdate.error
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_USER_REACTIVATED',
      actorUserId,
      targetUserId: userId,
      reason,
    })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)
    revalidatePath('/admin/companies')

    return { ok: true, message: 'Användaren återaktiverades. Roller behöver vid behov kopplas på igen.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte återaktiveras.' }
  }
}

/**
 * Bakåtkompatibla exportnamn så dina befintliga pages bygger utan att du behöver byta imports direkt.
 */
export async function inviteUserAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  return inviteAdminUserAction(prevState, formData)
}

export async function createUserAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  return inviteAdminUserAction(prevState, formData)
}