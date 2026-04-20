'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

async function requireUsersWrite() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const permissions = await getUserPermissions(user.id)

  if (!permissions.includes('users.write')) {
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

export async function inviteUserAction(formData: FormData) {
  const { user, permissions } = await requireUsersWrite()

  const email = normalizeEmail(formData.get('email'))
  const roleId = String(formData.get('roleId') ?? '').trim()

  if (!email) {
    throw new Error('E-post saknas')
  }

  if (roleId && !permissions.includes('roles.manage')) {
    throw new Error('Du får inte sätta roller vid inbjudan.')
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? undefined

  const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl ? `${siteUrl.replace(/\/$/, '')}/login` : undefined,
  })

  if (error) throw error

  const invitedUserId = data.user?.id

  if (invitedUserId && roleId) {
    const { error: roleError } = await supabaseService.from('user_roles').upsert({
      user_id: invitedUserId,
      role_id: roleId,
      granted_by: user.id,
      is_active: true,
    })

    if (roleError) throw roleError
  }

  await auditLog({
    actorUserId: user.id,
    entityType: 'auth_user',
    entityId: invitedUserId ?? email,
    action: 'invite_user',
    newValues: { email, roleId: roleId || null },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin/roles')
}

export async function createUserAction(formData: FormData) {
  const { user, permissions } = await requireUsersWrite()

  const email = normalizeEmail(formData.get('email'))
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('fullName') ?? '').trim()
  const roleId = String(formData.get('roleId') ?? '').trim()

  if (!email || !password) {
    throw new Error('E-post och lösenord krävs')
  }

  if (password.length < 10) {
    throw new Error('Lösenord måste vara minst 10 tecken')
  }

  if (roleId && !permissions.includes('roles.manage')) {
    throw new Error('Du får inte sätta roller vid skapande av användare.')
  }

  const { data, error } = await supabaseService.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })

  if (error) throw error

  const createdUserId = data.user?.id

  if (!createdUserId) {
    throw new Error('Kunde inte skapa användare')
  }

  if (roleId) {
    const { error: roleError } = await supabaseService.from('user_roles').upsert({
      user_id: createdUserId,
      role_id: roleId,
      granted_by: user.id,
      is_active: true,
    })

    if (roleError) throw roleError
  }

  await auditLog({
    actorUserId: user.id,
    entityType: 'auth_user',
    entityId: createdUserId,
    action: 'create_user',
    newValues: {
      email,
      fullName: fullName || null,
      roleId: roleId || null,
    },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin/roles')
}