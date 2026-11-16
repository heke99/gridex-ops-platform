import React from 'react'
import { expect, it, vi } from 'vitest'
import { getAdminNavigationGroups, type AdminNavigationGroup } from '@/lib/admin/navigation'
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/customers', useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/navigation-mode/actions', () => ({ updateAdminNavigationPreference: vi.fn() }))
import { groupBusinessNavigation } from '@/lib/admin/businessNavigation'

it('groups existing authorized destinations without changing items, hrefs, children or requirements', () => {
  const groups = getAdminNavigationGroups({ permissions: ['customers.read', 'customers.write', 'masterdata.read', 'switching.read', 'metering.read', 'billing_underlay.read', 'communication.read', 'poa.read', 'users.read', 'pricing.read', 'contracts.read', 'cases.read'], roles: [], isPlatformAdmin: false, isCompanyLiveEnabled: true, mode: 'company_view' })
  const result = groupBusinessNavigation(groups, 'company_view')
  const before = groups.flatMap(group => group.items)
  const after = result.flatMap(group => group.items)
  expect(after).toHaveLength(before.length)
  for (const item of before) expect(after.find(candidate => candidate.key === item.key)).toBe(item)
  expect(result.find(group => group.title === 'Portfölj & analys')?.items.some(item => item.key === 'analytics')).toBe(true)
  expect(result.find(group => group.title === 'Leveranser')?.items.some(item => item.key === 'info_requests')).toBe(true)
})
it('cannot add destinations for an empty permission set', () => {
  const groups = getAdminNavigationGroups({ permissions: [], roles: ['superadmin'], isPlatformAdmin: false, mode: 'company_view' })
  expect(groupBusinessNavigation(groups, 'company_view').flatMap(group => group.items)).toEqual(groups.flatMap(group => group.items))
})
it('preserves platform navigation by identity and keeps unknown specialist groups', () => {
  const groups: AdminNavigationGroup[] = [{ key: 'future_specialist', title: 'Specialist', description: '', items: [{ key: 'special', label: 'Special', href: '/admin/special' }] }]
  expect(groupBusinessNavigation(groups, 'platform_view')).toBe(groups)
  expect(groupBusinessNavigation(groups, 'company_view')).toEqual(groups)
})

it('renders the actual company sidebar with business workspaces and preserves its destinations', async () => {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { vi } = await import('vitest')
  vi.stubGlobal('React', React)
  const { default: Sidebar } = await import('@/components/admin/AdminSidebar')
  const html = renderToStaticMarkup(React.createElement(Sidebar, { permissions: ['customers.read', 'masterdata.read', 'switching.read', 'metering.read', 'billing_underlay.read', 'poa.read', 'users.read', 'cases.read'], roles: [], isPlatformAdmin: false, isCompanyLiveEnabled: true }))
  expect(html).toContain('Översikt &amp; arbetskö')
  expect(html).toContain('Portfölj &amp; analys')
  expect(html).toContain('/admin/customers')
  expect(html).toContain('/admin/customer-info-requests')
  expect(html).not.toContain('Live Ediel')
})
