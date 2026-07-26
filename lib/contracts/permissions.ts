import { requireAdminActionAccess, type GuardResult } from "@/lib/admin/guards";
import { normalizeRoleKey } from "@/lib/rbac/roleKeys";

const SUPER_ADMIN_ROLES = new Set([
  "super_admin",
  "superadmin",
  "platform_superadmin",
  "platform_admin",
]);

const DELEGATABLE_CONTRACT_ROLES = new Set([
  "pricing_manager",
  "contract_manager",
]);

export function isContractSuperAdmin(context: Pick<GuardResult, "roles">): boolean {
  return context.roles.some((role) => {
    const normalized = normalizeRoleKey(role);
    return Boolean(normalized && SUPER_ADMIN_ROLES.has(normalized));
  });
}

export async function requireContractPermissionAction(permission: string): Promise<GuardResult> {
  const context = await requireAdminActionAccess();
  if (isContractSuperAdmin(context)) return context;

  const hasDelegatableRole = context.roles.some((role) => {
    const normalized = normalizeRoleKey(role);
    return Boolean(normalized && DELEGATABLE_CONTRACT_ROLES.has(normalized));
  });
  if (!hasDelegatableRole || !context.permissions.includes(permission)) {
    throw new Error(`Du saknar behörigheten ${permission}.`);
  }
  return context;
}
