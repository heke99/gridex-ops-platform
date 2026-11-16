import { requireAdminActionAccess, type GuardResult } from "@/lib/admin/guards";
import { normalizeRoleKey } from "@/lib/rbac/roleKeys";

import { supabaseService } from "@/lib/supabase/service";

const DELEGATABLE_CONTRACT_ROLES = new Set([
  "pricing_manager",
  "contract_manager",
]);

export function isContractSuperAdmin(context: Pick<GuardResult, "isPlatformAdmin">): boolean {
  return context.isPlatformAdmin === true;
}

export async function requireContractPermissionAction(permission: string, targetCompanyId: string | null): Promise<GuardResult> {
  const context = await requireAdminActionAccess();
  if (!targetCompanyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetCompanyId)) {
    throw new Error("Bolag saknas eller är ogiltigt.");
  }

  const hasDelegatableRole = context.roles.some((role) => {
    const normalized = normalizeRoleKey(role);
    return Boolean(normalized && DELEGATABLE_CONTRACT_ROLES.has(normalized));
  });
  if (!isContractSuperAdmin(context) && (!hasDelegatableRole || !context.permissions.includes(permission))) {
    throw new Error(`Du saknar behörigheten ${permission}.`);
  }
  const { data, error } = await supabaseService.rpc("gridex_actor_has_company_permission", {
    p_actor_user_id: context.userId,
    p_company_id: targetCompanyId,
    p_permission: permission,
  });
  if (error || data !== true) {
    throw new Error(`Du saknar behörigheten ${permission}.`);
  }
  return context;
}
