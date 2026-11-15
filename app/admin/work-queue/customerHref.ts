import { canShowCustomerWorkspaceTab, normalizeWorkspaceTab } from '@/app/admin/customers/[id]/page.part-1'

export function workQueueCustomerHref(href: string, isPlatformAdmin: boolean, canReadContracts: boolean): string {
  if (isPlatformAdmin || !href.startsWith('/admin/customers/')) return href
  const target = new URL(href, 'https://gridex.invalid')
  const requested = target.searchParams.get('tab')
  if (requested && (normalizeWorkspaceTab(requested) !== requested || !canShowCustomerWorkspaceTab(normalizeWorkspaceTab(requested), false, canReadContracts))) {
    // The overview already presents the permitted business action. Never
    // send a company operator to an intentionally platform-only tab.
    return target.pathname
  }
  return href
}
