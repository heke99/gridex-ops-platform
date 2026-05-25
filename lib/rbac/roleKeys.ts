export type RoleKeyLike = string | null | undefined

const ROLE_ALIASES: Record<string, string> = {
  superadmin: 'super_admin',
  super_admin: 'super_admin',
  platformadmin: 'platform_admin',
  platform_admin: 'platform_admin',
  companyadmin: 'company_admin',
  company_admin: 'company_admin',
  company_owner: 'company_admin',
  tenant_admin: 'company_admin',
  bolagsansvarig: 'company_admin',
  compliance_officer: 'compliance_manager',
  kundservice: 'customer_service_agent',
  customer_service: 'customer_service_agent',
  support: 'customer_service_agent',
  ekonomi: 'finance_readonly',
  finance: 'finance_readonly',
  finance_readonly: 'finance_readonly',
}

export function normalizeRoleKey(value: RoleKeyLike): string | null {
  if (!value) return null

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!normalized) return null
  return ROLE_ALIASES[normalized] ?? normalized
}

export function resolveRoleKey(input: {
  key?: RoleKeyLike
  role_key?: RoleKeyLike
  code?: RoleKeyLike
  name?: RoleKeyLike
  role?: RoleKeyLike
} | null | undefined): string | null {
  if (!input) return null
  return (
    normalizeRoleKey(input.role_key) ??
    normalizeRoleKey(input.key) ??
    normalizeRoleKey(input.code) ??
    normalizeRoleKey(input.role) ??
    normalizeRoleKey(input.name)
  )
}
