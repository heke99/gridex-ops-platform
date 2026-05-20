// lib/admin/accessModel.ts
export type PermissionRequirement = {
  anyOf?: string[]
  allOf?: string[]
}

export type AdminPageKey =
  | 'dashboard'
  | 'customers.list'
  | 'customers.detail'
  | 'customers.intake'
  | 'customers.segments'
  | 'contracts.catalog'
  | 'companies.manage'
  | 'company.settings'
  | 'platform.security'
  | 'platform.ediel.rules'
  | 'platform.ediel.versions'
  | 'platform.ediel.routes'
  | 'platform.ediel.runtime'
  | 'operations.control_tower'
  | 'operations.sync'
  | 'operations.integrity'
  | 'operations.tasks'
  | 'operations.switches'
  | 'operations.ready_to_execute'
  | 'operations.grid_owner_request_detail'
  | 'outbound.queue'
  | 'outbound.unresolved'
  | 'outbound.ready_switches'
  | 'outbound.missing_meter_values'
  | 'outbound.missing_billing_underlays'
  | 'masterdata.network_owners'
  | 'masterdata.electricity_suppliers'
  | 'masterdata.price_area_localities'
  | 'metering.workspace'
  | 'billing.workspace'
  | 'partner_exports.workspace'
  | 'integrations.routes'
  | 'ediel.workspace'
  | 'ediel.routes'
  | 'users.list'
  | 'users.detail'
  | 'roles.catalog'
  | 'audit.log'

export type RolePermissionProfile = {
  label: string
  description: string
  permissions: string[]
}

export const ADMIN_PAGE_ACCESS: Record<AdminPageKey, PermissionRequirement> = {
  dashboard: {
    anyOf: [
      'customers.read',
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'partner_exports.read',
      'communication.read',
      'pricing.read',
      'audit.read',
      'users.read',
    ],
  },
  'customers.list': { anyOf: ['customers.read'] },
  'customers.detail': { anyOf: ['customers.read'] },
  'customers.intake': { anyOf: ['customers.write'] },
  'customers.segments': { anyOf: ['customers.read', 'reports.read'] },
  'contracts.catalog': { anyOf: ['pricing.read'] },
  'companies.manage': { anyOf: ['tenants.write'] },
  'company.settings': { anyOf: ['tenants.invite', 'users.read', 'users.write'] },
  'platform.security': { anyOf: ['tenants.write'] },
  'platform.ediel.rules': { anyOf: ['tenants.write'] },
  'platform.ediel.versions': { anyOf: ['tenants.write'] },
  'platform.ediel.routes': { anyOf: ['tenants.write'] },
  'platform.ediel.runtime': { anyOf: ['tenants.write'] },
  'operations.control_tower': {
    anyOf: [
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'partner_exports.read',
      'communication.read',
      'poa.read',
    ],
  },
  'operations.sync': {
    anyOf: [
      'customers.read',
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'communication.read',
      'poa.read',
      'pricing.read',
    ],
  },
  'operations.integrity': {
    anyOf: [
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'partner_exports.read',
      'poa.read',
    ],
  },
  'operations.tasks': {
    anyOf: ['switching.read', 'metering.read', 'billing_underlay.read', 'poa.read'],
  },
  'operations.switches': { anyOf: ['switching.read'] },
  'operations.ready_to_execute': { anyOf: ['switching.read'] },
  'operations.grid_owner_request_detail': {
    anyOf: ['metering.read', 'billing_underlay.read', 'communication.read', 'switching.read'],
  },
  'outbound.queue': {
    anyOf: [
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'partner_exports.read',
      'communication.read',
    ],
  },
  'outbound.unresolved': {
    anyOf: ['switching.read', 'metering.read', 'billing_underlay.read', 'communication.read'],
  },
  'outbound.ready_switches': { anyOf: ['switching.read'] },
  'outbound.missing_meter_values': { anyOf: ['metering.read'] },
  'outbound.missing_billing_underlays': { anyOf: ['billing_underlay.read'] },
  'masterdata.network_owners': { anyOf: ['masterdata.read'] },
  'masterdata.electricity_suppliers': { anyOf: ['masterdata.read'] },
  'masterdata.price_area_localities': { anyOf: ['masterdata.read'] },
  'metering.workspace': { anyOf: ['metering.read'] },
  'billing.workspace': { anyOf: ['billing_underlay.read'] },
  'partner_exports.workspace': { anyOf: ['partner_exports.read'] },
  'integrations.routes': {
    anyOf: ['communication.read', 'switching.read', 'metering.read', 'billing_underlay.read'],
  },
  'ediel.workspace': { anyOf: ['communication.read'] },
  'ediel.routes': {
    anyOf: ['communication.read', 'switching.read', 'metering.read', 'billing_underlay.read'],
  },
  'users.list': { anyOf: ['users.read'] },
  'users.detail': { anyOf: ['users.read'] },
  'roles.catalog': { anyOf: ['roles.manage', 'permissions.manage', 'users.read'] },
  'audit.log': { anyOf: ['audit.read'] },
}

export const ROLE_PERMISSION_PROFILES: Record<string, RolePermissionProfile> = {
  super_admin: {
    label: 'Super admin',
    description: 'Full intern åtkomst inklusive accessmodell, användare, pricing, drift och revision.',
    permissions: [
      'users.read',
      'users.write',
      'tenants.read',
      'tenants.write',
      'tenants.invite',
      'roles.manage',
      'permissions.manage',
      'customers.read',
      'customers.write',
      'contracts.read',
      'contracts.write',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'cases.read',
      'cases.write',
      'switching.read',
      'switching.write',
      'metering.read',
      'metering.write',
      'metering_points.read',
      'metering_points.write',
      'sites.read',
      'sites.write',
      'masterdata.read',
      'masterdata.write',
      'billing_underlay.read',
      'billing_underlay.export',
      'partner_exports.read',
      'partner_exports.write',
      'poa.read',
      'poa.write',
      'pricing.read',
      'pricing.write',
      'pricing.publish',
      'reports.read',
      'audit.read',
    ],
  },
  company_admin: {
    label: 'Bolagsansvarig',
    description: 'Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.',
    permissions: [
      'users.read',
      'users.write',
      'customers.read',
      'customers.write',
      'contracts.read',
      'contracts.write',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'cases.read',
      'cases.write',
      'switching.read',
      'switching.write',
      'metering.read',
      'metering.write',
      'metering_points.read',
      'metering_points.write',
      'sites.read',
      'sites.write',
      'masterdata.read',
      'masterdata.write',
      'billing_underlay.read',
      'billing_underlay.export',
      'partner_exports.read',
      'partner_exports.write',
      'poa.read',
      'poa.write',
      'pricing.read',
      'pricing.write',
      'reports.read',
      'audit.read',
      'tenants.invite',
    ],
  },
  admin: {
    label: 'Admin',
    description: 'Bred daglig adminåtkomst men utan individuell permission-governance för andra användare.',
    permissions: [
      'users.read',
      'customers.read',
      'customers.write',
      'contracts.read',
      'contracts.write',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'cases.read',
      'cases.write',
      'switching.read',
      'switching.write',
      'metering.read',
      'metering.write',
      'metering_points.read',
      'metering_points.write',
      'sites.read',
      'sites.write',
      'masterdata.read',
      'masterdata.write',
      'billing_underlay.read',
      'billing_underlay.export',
      'partner_exports.read',
      'partner_exports.write',
      'poa.read',
      'poa.write',
      'pricing.read',
      'pricing.write',
      'reports.read',
      'audit.read',
    ],
  },
  operations_manager: {
    label: 'Operations manager',
    description: 'Kan driva hela operationskedjan för switch, metering, underlag, partnerexporter och kommunikation.',
    permissions: [
      'customers.read',
      'customers.write',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'switching.read',
      'switching.write',
      'metering.read',
      'metering.write',
      'metering_points.read',
      'metering_points.write',
      'sites.read',
      'sites.write',
      'masterdata.read',
      'masterdata.write',
      'billing_underlay.read',
      'billing_underlay.export',
      'partner_exports.read',
      'partner_exports.write',
      'poa.read',
      'poa.write',
      'reports.read',
      'audit.read',
    ],
  },
  operations_agent: {
    label: 'Operations agent',
    description: 'Daglig handläggning i operations utan governance för användare, pricing eller roller.',
    permissions: [
      'customers.read',
      'customers.write',
      'documents.read',
      'documents.write',
      'communication.read',
      'switching.read',
      'switching.write',
      'metering.read',
      'metering.write',
      'metering_points.read',
      'metering_points.write',
      'sites.read',
      'sites.write',
      'masterdata.read',
      'masterdata.write',
      'billing_underlay.read',
      'billing_underlay.export',
      'partner_exports.read',
      'partner_exports.write',
      'poa.read',
      'poa.write',
      'reports.read',
    ],
  },
  customer_service_manager: {
    label: 'Kundtjänst manager',
    description: 'Överblick över kundbilden med operativ läsning och begränsad skrivåtkomst i kundnära flöden.',
    permissions: [
      'users.read',
      'customers.read',
      'customers.write',
      'contracts.read',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'cases.read',
      'cases.write',
      'switching.read',
      'metering.read',
      'metering_points.read',
      'sites.read',
      'masterdata.read',
      'billing_underlay.read',
      'partner_exports.read',
      'poa.read',
      'reports.read',
      'audit.read',
    ],
  },
  customer_service_agent: {
    label: 'Kundtjänst',
    description: 'Supportroll med läsåtkomst till kund- och operationsbild samt dokumenthantering.',
    permissions: [
      'customers.read',
      'contracts.read',
      'documents.read',
      'documents.write',
      'communication.read',
      'cases.read',
      'cases.write',
      'switching.read',
      'metering.read',
      'metering_points.read',
      'sites.read',
      'masterdata.read',
      'billing_underlay.read',
      'poa.read',
      'reports.read',
    ],
  },
  pricing_manager: {
    label: 'Pricing manager',
    description: 'Kan läsa, ändra och förbereda publicering av prisbilder.',
    permissions: [
      'customers.read',
      'contracts.read',
      'contracts.write',
      'pricing.read',
      'pricing.write',
      'reports.read',
      'audit.read',
    ],
  },
  pricing_approver: {
    label: 'Pricing approver',
    description: 'Kan granska och publicera pricing men inte styra övrig drift.',
    permissions: ['contracts.read', 'pricing.read', 'pricing.publish', 'reports.read', 'audit.read'],
  },
  compliance_manager: {
    label: 'Compliance manager',
    description: 'Läsa hela kontrollspåret för revision och efterlevnad.',
    permissions: [
      'users.read',
      'customers.read',
      'contracts.read',
      'documents.read',
      'communication.read',
      'cases.read',
      'switching.read',
      'metering.read',
      'metering_points.read',
      'sites.read',
      'masterdata.read',
      'billing_underlay.read',
      'partner_exports.read',
      'poa.read',
      'pricing.read',
      'reports.read',
      'audit.read',
    ],
  },
  sales_manager: {
    label: 'Sales manager',
    description: 'Kommersiell roll för intag, kundkort och avtal, men inte drift av switch/metering.',
    permissions: [
      'users.read',
      'customers.read',
      'customers.write',
      'contracts.read',
      'documents.read',
      'documents.write',
      'communication.read',
      'communication.send',
      'cases.read',
      'cases.write',
      'poa.read',
      'reports.read',
    ],
  },
  partner_manager: {
    label: 'Partner manager',
    description: 'Ansvarar för integrations- och exportrelationer med läsning i kund- och driftkontext.',
    permissions: [
      'customers.read',
      'documents.read',
      'communication.read',
      'switching.read',
      'metering.read',
      'sites.read',
      'masterdata.read',
      'billing_underlay.read',
      'partner_exports.read',
      'partner_exports.write',
      'reports.read',
      'audit.read',
    ],
  },
  finance_readonly: {
    label: 'Finance readonly',
    description: 'Ekonomi- och controllerläsning utan operativ skrivning.',
    permissions: [
      'customers.read',
      'contracts.read',
      'billing_underlay.read',
      'partner_exports.read',
      'pricing.read',
      'reports.read',
      'audit.read',
    ],
  },
  executive_readonly: {
    label: 'Executive readonly',
    description: 'Ledningsöverblick över kunder, pricing, drift och rapporter utan skrivåtkomst.',
    permissions: [
      'users.read',
      'customers.read',
      'contracts.read',
      'communication.read',
      'switching.read',
      'metering.read',
      'billing_underlay.read',
      'partner_exports.read',
      'pricing.read',
      'reports.read',
      'audit.read',
    ],
  },
  partner_api_user: {
    label: 'Partner API user',
    description: 'Teknisk integrationsidentitet. Ska normalt inte använda admin-UI.',
    permissions: ['partner_exports.read'],
  },
}

export function hasPermissionRequirement(
  currentPermissions: string[],
  requirement?: PermissionRequirement
): boolean {
  if (!requirement) return true

  const current = new Set(currentPermissions)
  const allOf = requirement.allOf ?? []
  const anyOf = requirement.anyOf ?? []

  if (allOf.length > 0 && !allOf.every((permission) => current.has(permission))) {
    return false
  }

  if (anyOf.length > 0 && !anyOf.some((permission) => current.has(permission))) {
    return false
  }

  return true
}

export function getAdminPageRequirement(pageKey: AdminPageKey): PermissionRequirement {
  return ADMIN_PAGE_ACCESS[pageKey]
}

export function getRoleProfilePermissions(roleKey: string): string[] {
  return [...(ROLE_PERMISSION_PROFILES[roleKey]?.permissions ?? [])].sort((a, b) =>
    a.localeCompare(b, 'sv')
  )
}