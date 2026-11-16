import type { CustomerWorkspaceTab } from './page.part-1'

/**
 * Tenant customer card: five primary groups instead of a flat tab row.
 * Sub-tabs are shown only inside the active group.
 */
export const TENANT_WORKSPACE_GROUPS: Array<{ id: string; label: string; tabs: CustomerWorkspaceTab[] }> = [
  { id: 'overview', label: 'Översikt', tabs: ['overview', 'legal-readiness'] },
  { id: 'details', label: 'Uppgifter', tabs: ['profile'] },
  { id: 'agreements', label: 'Avtal & anläggningar', tabs: ['contracts', 'sites'] },
  { id: 'invoices', label: 'Fakturor', tabs: ['billing-metering'] },
  { id: 'history', label: 'Ärenden & historik', tabs: ['communication', 'notes', 'lifecycle-decisions'] },
]

export function tenantWorkspaceGroups(visible: (tab: CustomerWorkspaceTab) => boolean) {
  return TENANT_WORKSPACE_GROUPS
    .map((group) => ({ ...group, tabs: group.tabs.filter(visible) }))
    .filter((group) => group.tabs.length > 0)
}

export function activeTenantGroup(groups: ReturnType<typeof tenantWorkspaceGroups>, active: CustomerWorkspaceTab) {
  return groups.find((group) => group.tabs.includes(active)) ?? groups[0]
}

/** Every platform workspace remains reachable, without a flat row of 19 tabs. */
export const PLATFORM_WORKSPACE_GROUPS: typeof TENANT_WORKSPACE_GROUPS = [
  { id: 'overview', label: 'Översikt', tabs: ['overview'] },
  { id: 'details', label: 'Uppgifter', tabs: ['profile', 'contacts-addresses', 'portal-access'] },
  { id: 'agreements', label: 'Avtal & anläggningar', tabs: ['contracts', 'sites', 'metering-points', 'legal-readiness', 'authorization-documents'] },
  { id: 'invoices', label: 'Fakturor', tabs: ['billing-metering', 'analytics'] },
  { id: 'history', label: 'Ärenden & historik', tabs: ['communication', 'notes', 'lifecycle-decisions', 'audit'] },
  { id: 'operations', label: 'Drift', tabs: ['data-requests', 'switch-operations', 'ediel-operations', 'grid-owner-import', 'technical-details'] },
]

export function platformWorkspaceGroups(visible: (tab: CustomerWorkspaceTab) => boolean) {
  return PLATFORM_WORKSPACE_GROUPS
    .map((group) => ({ ...group, tabs: group.tabs.filter(visible) }))
    .filter((group) => group.tabs.length > 0)
}
