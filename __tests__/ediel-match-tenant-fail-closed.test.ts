import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ tables: [] as string[], filters: [] as Array<[string, unknown]> }))

vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: () => chain,
    limit: () => chain,
    or: () => chain,
    in: () => chain,
    eq: (column: string, value: unknown) => {
      calls.filters.push([column, value])
      return chain
    },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  })
  return {
    supabaseService: {
      from: (table: string) => {
        calls.tables.push(table)
        return chain
      },
    },
  }
})

vi.mock('@/lib/customers/matchingService', () => ({
  findCustomersByIdentifierValues: vi.fn(async () => {
    calls.tables.push('customers')
    return []
  }),
}))

import { matchMeteringPointForAutomation } from '@/lib/ediel/matching/meteringPointMatcher'
import { matchPermissionForAutomation } from '@/lib/ediel/matching/permissionMatcher'
import { matchProcessForAutomation } from '@/lib/ediel/matching/processMatcher'
import { matchCustomerForAutomation } from '@/lib/ediel/matching/customerMatcher'
import type { EdielMessageRow } from '@/lib/ediel/types'

function message(companyId: string | null): EdielMessageRow {
  return {
    id: 'msg-1',
    company_id: companyId,
    metering_point_id: '735999000000000001',
    external_reference: 'REF-1',
    transaction_reference: 'TX-1',
    customer_id: null,
    payload: { permissionId: 'PERM-1', customerNumber: 'K1', personalNumber: '19121212-1212' },
  } as unknown as EdielMessageRow
}

describe('Ediel automation matching never crosses tenants', () => {
  beforeEach(() => {
    calls.tables.length = 0
    calls.filters.length = 0
  })

  it('returns nothing and queries nothing when the message has no company', async () => {
    const input = { message: message(null), companyId: null }
    expect(await matchMeteringPointForAutomation(input)).toEqual([])
    expect(await matchPermissionForAutomation(input)).toEqual([])
    expect(await matchCustomerForAutomation(input)).toEqual([])
    expect(await matchProcessForAutomation(input)).toEqual([])
    expect(calls.tables).toEqual([])
  })

  it('scopes the metering-point lookup to the message company', async () => {
    await matchMeteringPointForAutomation({ message: message('company-a'), companyId: null })
    expect(calls.tables).toEqual(['metering_points'])
    expect(calls.filters).toContainEqual(['company_id', 'company-a'])
  })
})
