import type { CustomerWorkspaceTab } from './page.part-1'

/**
 * Tenant customer card: five primary groups instead of a flat tab row.
 * Sub-tabs are shown only inside the active group; platform admins keep the full row.
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
