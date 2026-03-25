import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import { redirect } from 'next/navigation'

export async function requirePermissionServer(permission: string) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=/admin`)
  }

  const permissions = await getUserPermissions(user.id)

  if (!permissions.includes(permission)) {
    redirect('/login?error=Du saknar behörighet för denna sida&next=/admin')
  }

  return { user, permissions }
}