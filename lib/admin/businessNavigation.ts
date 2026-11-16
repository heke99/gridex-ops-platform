import type { AdminNavigationGroup, AdminNavigationMode } from '@/lib/admin/navigation'

/** Presentation only: receives already authorized items and preserves each item unchanged. */
export function groupBusinessNavigation(groups: AdminNavigationGroup[], mode: AdminNavigationMode): AdminNavigationGroup[] {
  if (mode === 'platform_view') return groups
  const targets: AdminNavigationGroup[] = [
    { key: 'business_overview', title: 'Översikt & arbetskö', description: 'Dagens uppgifter och kundkontakt', items: [] },
    { key: 'business_customers', title: 'Kunder', description: 'Kunder, registrering och fullmakter', items: [] },
    { key: 'business_deliveries', title: 'Leveranser', description: 'Flyttar, byten, anläggningsuppgifter och mätvärden', items: [] },
    { key: 'business_billing', title: 'Fakturering', description: 'Underlag och överföring till fakturering', items: [] },
    { key: 'business_analytics', title: 'Portfölj & analys', description: 'Kundstock, förbrukning och prognos', items: [] },
    { key: 'business_settings', title: 'Inställningar', description: 'Bolagsuppgifter, åtkomst och anslutningar', items: [] },
  ]
  const extra: AdminNavigationGroup[] = []
  for (const group of groups) {
    // Specialist and future groups retain their own identity and permission-filtered contents.
    if (!['overview', 'customers', 'cases', 'billing', 'operations', 'settings'].includes(group.key)) {
      extra.push(group)
      continue
    }
    for (const item of group.items) {
      const target = ['customer_portfolio', 'analytics'].includes(item.key) ? 4
        : ['info_requests', 'facility_requests', 'messages'].includes(item.key) ? 2
        : item.key === 'billing_integrations' ? 5
        : group.key === 'overview' || group.key === 'cases' ? 0
        : group.key === 'customers' ? 1
        : group.key === 'operations' ? 2
        : group.key === 'billing' ? 3 : 5
      targets[target].items.push(item)
    }
  }
  return [...targets.filter(group => group.items.length > 0), ...extra]
}
