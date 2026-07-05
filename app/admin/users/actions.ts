// app/admin/users/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { requireRoleIdByKeyOrName } from '@/lib/rbac/resolveRoleId'
import { assertSupabaseAdminHealth } from '@/lib/supabase/adminHealth'
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
  // Platform-level role rows have company_id = null. Tenant-scoped role rows
  // (created by the company invite flow) always carry a company_id and must
  // never be touched from the platform users screen.
  const existing = await supabaseService
    .from('user_roles')
    .select('id')
    .eq('user_id', input.userId)
    .eq('role_id', input.roleId)
    .is('company_id', null)
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from('user_roles')
      .update({ role_id: input.roleId, status: 'active', is_active: true })
      .eq('id', existing.data.id)

    if (error) throw error
    return
  }

  const { error } = await supabaseService
    .from('user_roles')
    .insert({
      user_id: input.userId,
      role_id: input.roleId,
      company_id: null,
      status: 'active',
      is_active: true,
    })

  if (error) throw error
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
    return requireRoleIdByKeyOrName(input.roleKey)
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
    await requirePlatformAdminActionAccess()

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
      await assertSupabaseAdminHealth()

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
    await requirePlatformAdminActionAccess()

    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('fullName')) || normalizeText(formData.get('full_name'))
    const password = normalizeText(formData.get('password'))
    const roleId = normalizeText(formData.get('roleId'))
    const roleKey = normalizeText(formData.get('role_key')) || normalizeText(formData.get('role'))
    const actorUserId = await getCurrentActorUserId()

    if (!email) return { ok: false, message: 'E-post saknas.' }
    if (password.length < 10) return { ok: false, message: 'Lösenordet behöver vara minst 10 tecken.' }

    const adminHealth = await assertSupabaseAdminHealth()

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

    const authVerify = await supabaseService.auth.admin.getUserById(data.user.id)
    if (authVerify.error || !authVerify.data.user?.id) {
      throw new Error('Auth-kontot kunde inte verifieras i Supabase Authentication efter skapande.')
    }

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
    return { ok: true, message: `Kontot skapades i Supabase Auth${adminHealth.projectRef ? ` (${adminHealth.projectRef})` : ''} och databasen synkades.` }
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
    await requirePlatformAdminActionAccess()
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
    await requirePlatformAdminActionAccess()
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
    await requirePlatformAdminActionAccess()

    const userId = normalizeText(formData.get('user_id'))
    const roleId = normalizeText(formData.get('roleId'))
    const roleKey = normalizeText(formData.get('role_key')) || normalizeText(formData.get('role'))

    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const resolvedRoleId = await resolveRoleId({ roleId, roleKey })

    const { data: previousRoles, error: previousError } = await supabaseService
      .from('user_roles')
      .select('id,role_id,role,status,is_active')
      .eq('user_id', userId)
      .is('company_id', null)

    if (previousError) throw previousError

    // Only replace the user's platform-level roles (company_id IS NULL).
    // Tenant-scoped roles managed via company invites must survive platform
    // role changes.
    const { error: deleteError } = await supabaseService
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .is('company_id', null)

    if (deleteError) throw deleteError

    await insertActiveUserRole({ userId, roleId: resolvedRoleId })

    const actorUserId = await getCurrentActorUserId()
    if (actorUserId) {
      await logAdminActionAndUsage({
        actorUserId,
        entityType: 'user',
        entityId: userId,
        action: 'PLATFORM_USER_ROLE_CHANGED',
        label: 'Plattformsroll uppdaterad',
        oldValues: { platform_roles: previousRoles ?? [] },
        newValues: { role_id: resolvedRoleId },
        source: 'admin_users',
      }).catch(() => undefined)
    }

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
    await requirePlatformAdminActionAccess()

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
      .select('key')

    if (permissionsError) throw permissionsError

    const existingKeys = new Set((allPermissions ?? []).map((row) => String(row.key)))
    const missing = [...allowKeys, ...denyKeys].filter((key) => !existingKeys.has(key))
    if (missing.length > 0) {
      throw new Error(`Behörigheten hittades inte: ${missing.join(', ')}`)
    }

    const { error: deleteError } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    const rows = [
      ...allowKeys.map((permissionKey) => ({
        user_id: userId,
        permission_key: permissionKey,
        effect: 'allow',
        is_active: true,
      })),
      ...denyKeys.map((permissionKey) => ({
        user_id: userId,
        permission_key: permissionKey,
        effect: 'deny',
        is_active: true,
      })),
    ]

    if (rows.length > 0) {
      const { error: insertError } = await supabaseService.from('user_permission_overrides').insert(rows)
      if (insertError) throw insertError
    }

    const actorUserId = await getCurrentActorUserId()
    if (actorUserId) {
      await logAdminActionAndUsage({
        actorUserId,
        entityType: 'user',
        entityId: userId,
        action: 'PLATFORM_USER_PERMISSION_OVERRIDES_CHANGED',
        label: 'Individuella behörigheter uppdaterade',
        newValues: { allow: allowKeys, deny: denyKeys },
        source: 'admin_users',
      }).catch(() => undefined)
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
    await requirePlatformAdminActionAccess()

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const { error: roleDeleteError } = await supabaseService.from('user_roles').delete().eq('user_id', userId)
    if (roleDeleteError) throw roleDeleteError

    const { error: permissionDeleteError } = await supabaseService
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', userId)

    if (permissionDeleteError) throw permissionDeleteError

    const actorUserId = await getCurrentActorUserId()
    if (actorUserId) {
      await logAdminActionAndUsage({
        actorUserId,
        entityType: 'user',
        entityId: userId,
        action: 'PLATFORM_USER_ACCESS_REVOKED',
        label: 'Intern access borttagen',
        source: 'admin_users',
      }).catch(() => undefined)
    }

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

export async function deleteUserCompletelyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requirePlatformAdminActionAccess()

    const userId = normalizeText(formData.get('user_id'))
    if (!userId) return { ok: false, message: 'Användar-id saknas.' }

    const actorUserId = await getCurrentActorUserId()
    if (actorUserId && actorUserId === userId) {
      return { ok: false, message: 'Du kan inte radera ditt eget superadmin-konto här.' }
    }

    const deleteSteps: Array<{ table: string; column: string }> = [
      { table: 'user_permission_overrides', column: 'user_id' },
      { table: 'user_permissions', column: 'user_id' },
      { table: 'user_roles', column: 'user_id' },
      { table: 'company_memberships', column: 'user_id' },
      { table: 'company_invitations', column: 'invited_user_id' },
      { table: 'auth_email_events', column: 'user_id' },
      { table: 'user_profiles', column: 'id' },
    ]

    for (const step of deleteSteps) {
      const { error } = await supabaseService.from(step.table).delete().eq(step.column, userId)
      if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
    }

    const { error: authError } = await supabaseService.auth.admin.deleteUser(userId)
    if (authError) throw authError

    revalidatePath('/admin/users')
    revalidatePath('/admin/companies')

    return { ok: true, message: 'Användaren raderades från Auth och interna databastabeller.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte radera användaren.',
    }
  }
}
