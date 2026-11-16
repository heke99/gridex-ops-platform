import type { AdminNavigationGroup } from './navigation'

const EXACT_MATCH_ITEMS = new Set([
  '/admin',
  '/admin/ediel',
  '/admin/controltower',
  '/admin/billing',
  '/admin/ediel/test-center',
])

/** Prefer the most specific visible destination when routes overlap. */
export function findActiveAdminNavigationHref(pathname: string, groups: AdminNavigationGroup[]): string | null {
  let active: string | null = null
  for (const group of groups) {
    for (const { href } of group.items) {
      const matches = pathname === href || (!EXACT_MATCH_ITEMS.has(href) && pathname.startsWith(`${href}/`))
      if (matches && (!active || href.length > active.length)) active = href
    }
  }
  return active
}
