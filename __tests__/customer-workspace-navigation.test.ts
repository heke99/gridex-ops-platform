import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_WORKSPACE_TABS,
  canShowCustomerWorkspaceTab,
} from '@/app/admin/customers/[id]/page.part-1'
import {
  platformWorkspaceGroups,
  tenantWorkspaceGroups,
} from '@/app/admin/customers/[id]/workspaceGroups'

describe('customer workspace navigation availability', () => {
  it('keeps every platform workspace reachable exactly once', () => {
    const groups = platformWorkspaceGroups((tab) =>
      canShowCustomerWorkspaceTab(tab, true, true),
    )
    const actual = groups.flatMap((group) => group.tabs)
    const expected = CUSTOMER_WORKSPACE_TABS.map((tab) => tab.id)

    expect([...actual].sort()).toEqual([...expected].sort())
    expect(new Set(actual).size).toBe(actual.length)
    expect(groups.every((group) => group.tabs.length > 0)).toBe(true)
  })

  it.each([true, false])(
    'preserves tenant navigation permissions with contracts.read=%s',
    (canReadContracts) => {
      const visible = (tab: (typeof CUSTOMER_WORKSPACE_TABS)[number]['id']) =>
        canShowCustomerWorkspaceTab(tab, false, canReadContracts)
      const groups = tenantWorkspaceGroups(visible)
      const actual = groups.flatMap((group) => group.tabs)
      const expected = CUSTOMER_WORKSPACE_TABS.filter((tab) => visible(tab.id))
        .map((tab) => tab.id)

      expect([...actual].sort()).toEqual([...expected].sort())
      expect(actual.includes('contracts')).toBe(canReadContracts)
      expect(actual).not.toContain('ediel-operations')
      expect(actual).not.toContain('technical-details')
      expect(groups.every((group) => group.tabs.length > 0)).toBe(true)
    },
  )
})
