import { redirect } from 'next/navigation'
import {
  isPlatformAdminContext,
  requireAdminAccess,
  type GuardResult,
} from '@/lib/admin/guards'

export type CurrentUserPermissionContext = GuardResult

export async function getCurrentUserPermissionContext(): Promise<CurrentUserPermissionContext> {
  return requireAdminAccess()
}

export async function requirePermissionServer(permission: string) {
  const context = await getCurrentUserPermissionContext()

  if (isPlatformAdminContext(context)) {
    return context
  }

  if (!context.permissions.includes(permission)) {
    redirect('/admin')
  }

  return context
}

export async function requireAnyPermissionServer(permissions: string[]) {
  const context = await getCurrentUserPermissionContext()

  if (isPlatformAdminContext(context)) {
    return context
  }

  if (!permissions.some((permission) => context.permissions.includes(permission))) {
    redirect('/admin')
  }

  return context
}

export async function requireAllPermissionsServer(permissions: string[]) {
  const context = await getCurrentUserPermissionContext()

  if (isPlatformAdminContext(context)) {
    return context
  }

  if (!permissions.every((permission) => context.permissions.includes(permission))) {
    redirect('/admin')
  }

  return context
}
