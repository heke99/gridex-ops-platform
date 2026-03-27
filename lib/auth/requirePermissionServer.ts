import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type PermissionRpcRow = {
  gridex_get_user_permissions?: string[] | null
}

function normalizePermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      return value.filter((item): item is string => typeof item === 'string')
    }

    const firstRow = value[0] as PermissionRpcRow | undefined
    const nested = firstRow?.gridex_get_user_permissions

    if (Array.isArray(nested)) {
      return nested.filter((item): item is string => typeof item === 'string')
    }
  }

  if (value && typeof value === 'object') {
    const nested = (value as PermissionRpcRow).gridex_get_user_permissions

    if (Array.isArray(nested)) {
      return nested.filter((item): item is string => typeof item === 'string')
    }
  }

  return []
}

export async function requirePermissionServer(permission: string) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const { data, error } = await supabase.rpc('gridex_get_user_permissions', {
    p_user_id: user.id,
  })

  if (error) {
    throw error
  }

  const permissions = normalizePermissions(data)

  if (!permissions.includes(permission)) {
    redirect('/admin')
  }

  return {
    userId: user.id,
    permissions,
  }
}