import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'

export type CurrentUserPermissionContext = {
  userId: string
  email: string | null
  permissions: string[]
}

export async function getCurrentUserPermissionContext(): Promise<CurrentUserPermissionContext> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const permissions = await getUserPermissions(user.id)

  return {
    userId: user.id,
    email: user.email ?? null,
    permissions,
  }
}

export async function requirePermissionServer(permission: string) {
  const context = await getCurrentUserPermissionContext()

  if (!context.permissions.includes(permission)) {
    redirect('/admin')
  }

  return context
}

export async function requireAnyPermissionServer(permissions: string[]) {
  const context = await getCurrentUserPermissionContext()

  if (!permissions.some((permission) => context.permissions.includes(permission))) {
    redirect('/admin')
  }

  return context
}