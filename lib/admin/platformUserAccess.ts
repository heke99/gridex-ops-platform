import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

export type CanonicalPlatformAccessAction =
  | 'set_primary_role'
  | 'add_role'
  | 'remove_role'
  | 'replace_overrides'
  | 'clear_overrides'
  | 'upsert_override'
  | 'remove_override'
  | 'disable_platform_access'

type CanonicalPlatformAccessCommand = {
  actorUserId: string
  targetUserId: string
  action: CanonicalPlatformAccessAction
  roleId?: string | null
  userRoleId?: string | null
  permissionKey?: string | null
  effect?: 'allow' | 'deny' | null
  allowPermissions?: string[]
  denyPermissions?: string[]
  preserveOverrides?: boolean
  reason?: string | null
  idempotencyKey?: string
}

export type CanonicalPlatformAccessResult = {
  changed: boolean
  target_user_id: string
  action: CanonicalPlatformAccessAction
  state?: Record<string, unknown>
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} saknas.`)
  return normalized
}

/**
 * Executes all global platform-role and permission changes inside one database
 * transaction. Tenant-scoped user_roles are never touched by this command.
 */
export async function runCanonicalPlatformAccessCommand(
  command: CanonicalPlatformAccessCommand,
): Promise<CanonicalPlatformAccessResult> {
  const actorUserId = required(command.actorUserId, 'Aktör')
  const targetUserId = required(command.targetUserId, 'Användare')
  const idempotencyKey = command.idempotencyKey?.trim()
    || `platform-user-access:${command.action}:${targetUserId}:${randomUUID()}`

  const { data, error } = await supabaseService.rpc(
    'canonical_manage_platform_user_access',
    {
      p_command: {
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        action: command.action,
        role_id: command.roleId ?? null,
        user_role_id: command.userRoleId ?? null,
        permission_key: command.permissionKey ?? null,
        effect: command.effect ?? null,
        allow_permissions: command.allowPermissions ?? [],
        deny_permissions: command.denyPermissions ?? [],
        preserve_overrides: command.preserveOverrides ?? false,
        reason: command.reason ?? null,
        idempotency_key: idempotencyKey,
      },
    },
  )

  if (error) throw error
  if (!data || typeof data !== 'object') {
    throw new Error('Canonical platform access returnerade inget giltigt resultat.')
  }

  return data as unknown as CanonicalPlatformAccessResult
}
