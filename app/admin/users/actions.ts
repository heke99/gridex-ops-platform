// app/admin/users/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import {
  findAuthUserByEmail,
  getBaseAppUrl,
  recordAuthEmailEvent,
  sendConfirmationEmailForKnownUser,
  sendPasswordResetEmailForKnownUser,
  upsertAuthUserProfile,
} from '@/lib/auth/authEmailFlow'

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

async function getCurrentActorUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

async function insertActiveUserRole(input: { userId: string; roleId: string }) {
  const first = await supabaseService.from('user_roles').upsert(
    {
      user_id: input.userId,
      role_id: input.roleId,
      status: 'active',
      is_active: true,
    },
    { onConflict: 'user_id,role_id' }
  )

  if (!first.error) return

  if ((first.error.message ?? '').includes('status') || first.error.code === '42703') {
    const second = await supabaseService.from('user_roles').upsert(
      {
        user_id: input.userId,
        role_id: input.roleId,
        is_active: true,
      },
      { onConflict: 'user_id,role_id' }
    )

    if (!second.error) return

    if ((second.error.message ?? '').includes('is_active') || second.error.code === '42703') {
      const third = await supabaseService.from('user_roles').upsert(
        {
          user_id: input.userId,
          role_id: input.roleId,
        },
        { onConflict: 'user_id,role_id' }
      )
      if (third.error) throw third.error
      return
    }

    throw second.error
  }

  throw first.error
}

async function resolveRoleId(input: { roleId?: string; roleKey?: string }) {
  if (input.roleId) {
    const { data, error } = await supabaseService
      .from('roles')
      .select('id,key')
      .eq('id', input.roleId)
      .maybeSingle()

    if (error) throw error
    if (data?.id) return data.id as string
  }

  if (input.roleKey) {
    const { data, error } = await supabaseService
      .from('roles')
      .select('id,key')
      .eq('key', input.roleKey)
      .maybeSingle()

    if (error) throw error
    if (data?.id) return data.id as string
    throw new Error(`Rollen hittades inte: ${input.roleKey}`)
  }

  throw new Error('Roll saknas.')
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

  const user = await findAuthUserByEmail(email)
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
    const fullName = normalizeText(formData.get('full_name')) || normalizeText(formData.get('fullName'))
    const roleId = normalizeText(formData.get('roleId'))
    const roleKey = normalizeText(formData.get('role_key')) || normalizeText(formData.get('role'))
    const sendInviteRaw = formData.get('send_invite')
    const sendInvite = sendInviteRaw === null ? true : normalizeCheckbox(sendInviteRaw)
    const actorUserId = await getCurrentActorUserId()

    if (!email) return { ok: false, message: 'E-post saknas.' }

    const resolvedRoleId = roleId || roleKey ? await resolveRoleId({ roleId, roleKey }) : null
    let userId: string | null = null

    if (sendInvite) {
      const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${getBaseAppUrl()}/auth/callback?next=${encodeURIComponent('/login/update-password')}`,
        data: fullName ? { full_name: fullName } : undefined,
      })

      if (!error && data.user?.id) {
        userId = data.user.id
        await upsertAuthUserProfile({
          userId,
          email,
          fullName: fullName || null,
          lastInviteSentAt: new Date().toISOString(),
          lastAction: 'invite_sent',
        })
        await recordAuthEmailEvent({
          userId,
          email,
          eventType: 'invite_sent',
          status: 'sent',
          source: 'admin_users_invite',
          actorUserId,
        })
      } else if (error && !/already|registered|exists/i.test(error.message ?? '')) {
        throw error
      }
    }

    if (!userId) {
      const existingUser = await resolveUserByIdOrEmail({ email })
      userId = existingUser.id
      await upsertAuthUserProfile({
        userId,
        email,
        fullName: fullName || null,
        lastAction: sendInvite ? 'invite_existing_user_matched' : 'role_assigned',
      })
    }

    if (resolvedRoleId) {
      await insertActiveUserRole({ userId, roleId: resolvedRoleId })
    }

    revalidatePath('/admin/users')
    revalidatePath('/admin/roles')

    return {
      ok: true,
      message: sendInvite
        ? 'Användaren bjöds in och accessen synkades.'
        : 'Access kopplades till befintlig användare.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skapa/inbjuda användare.',
    }
  }
}

export async function createDirectAdminUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })

    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('fullName')) || normalizeText(formData.get('full_name'))
    const password = normalizeText(formData.get('password'))
    const roleId = normalizeText(formData.get('roleId'))
    const roleKey = normalizeText(formData.get('role_key')) || normalizeText(formData.get('role'))
    const actorUserId = await getCurrentActorUserId()

    if (!email) return { ok: false, message: 'E-post saknas.' }
    if (password.length < 10) return { ok: false, message: 'Lösenordet behöver vara minst 10 tecken.' }

    const existingUser = await findAuthUserByEmail(email)
    if (existingUser) return { ok: false, message: 'Det finns redan ett konto med den e-postadressen.' }

    const { data, error } = await supabaseService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

    if (error) throw error
    if (!data.user?.id) throw new Error('Auth-kontot skapades inte korrekt.')

    await upsertAuthUserProfile({
      userId: data.user.id,
      email,
      fullName: fullName || null,
      emailConfirmedAt: new Date().toISOString(),
      lastAction: 'direct_user_created',
    })

    if (roleId || roleKey) {
      await insertActiveUserRole({
        userId: data.user.id,
        roleId: await resolveRoleId({ roleId, roleKey }),
      })
    }

    await recordAuthEmailEvent({
      userId: data.user.id,
      email,
      eventType: 'direct_user_created',
      status: 'created',
      source: 'admin_users_create_direct',
      actorUserId,
    })

    revalidatePath('/admin/users')
    return { ok: true, message: 'Kontot skapades och databasen synkades.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skapa konto.',
    }
  }
}

export async function sendAdminPasswordResetAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })
    const email = normalizeEmail(formData.get('email'))
    if (!email) return { ok: false, message: 'E-post saknas.' }

    await sendPasswordResetEmailForKnownUser({
      email,
      actorUserId: await getCurrentActorUserId(),
      source: 'admin_users_password_reset',
    })

    revalidatePath('/admin/users')
    return { ok: true, message: 'Återställningslänk skickades.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skicka återställningslänk.',
    }
  }
}

export async function sendAdminConfirmationEmailAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['users.write'] })
    const email = normalizeEmail(formData.get('email'))
    if (!email) return { ok: false, message: 'E-post saknas.' }

    await sendConfirmationEmailForKnownUser({
      email,
      actorUserId: await getCurrentActorUserId(),
      source: 'admin_users_confirmation',
    })

    revalidatePath('/admin/users')
    return { ok: true, message: 'Bekräftelsemail skickades.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skicka bekräftelsemail.',
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
    const roleId = normalizeText(formData.get('roleId'))
    const roleKey = normalizeText(formData.get('role_key')) || normalizeText(formData.get('role'))

    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const resolvedRoleId = await resolveRoleId({ roleId, roleKey })

    const { error: deleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    await insertActiveUserRole({ userId, roleId: resolvedRoleId })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return { ok: true, message: 'Rollen uppdaterades.' }
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

    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const allowKeys = allowRaw.split(',').map((value) => value.trim()).filter(Boolean)
    const denyKeys = denyRaw.split(',').map((value) => value.trim()).filter(Boolean)

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
      ...allowIds.map((permissionId) => ({ user_id: userId, permission_id: permissionId, is_allowed: true })),
      ...denyIds.map((permissionId) => ({ user_id: userId, permission_id: permissionId, is_allowed: false })),
    ]

    if (rows.length > 0) {
      const { error: insertError } = await supabaseService.from('user_permissions').insert(rows)
      if (insertError) throw insertError
    }

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return { ok: true, message: 'Individuella behörigheter uppdaterades.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte uppdatera individuella behörigheter.',
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
    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const { error: roleDeleteError } = await supabaseService.from('user_roles').delete().eq('user_id', userId)
    if (roleDeleteError) throw roleDeleteError

    const { error: permissionDeleteError } = await supabaseService
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)

    if (permissionDeleteError) throw permissionDeleteError

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)

    return { ok: true, message: 'Användarens interna access togs bort.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte ta bort access.',
    }
  }
}

/**
 * Bakåtkompatibla exportnamn så dina befintliga pages bygger utan att du behöver byta imports direkt.
 */
export async function inviteUserAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  return inviteAdminUserAction(prevState, formData)
}

export async function createUserAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  return createDirectAdminUserAction(prevState, formData)
}
