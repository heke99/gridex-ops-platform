// The customer matcher compared every message reference with customers.id
// (uuid). A UTILTS BGM document number such as M260901015169 made PostgREST
// reject the whole query with 22P02, so the automation pipeline trace was lost
// for every such file. Same rule as processMatcher/permissionMatcher: only
// UUID-shaped values reach uuid columns, and every value is quoted.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ ors: [] as Array<{ table: string; filter: string }>, current: '' }))

vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: () => chain,
    limit: () => chain,
    eq: () => chain,
    or: (filter: string) => {
      calls.ors.push({ table: calls.current, filter })
      return chain
    },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  })
  return { supabaseService: { from: (table: string) => { calls.current = table; return chain } } }
})

const canonical = vi.hoisted(() => ({ references: [] as Array<{ qualifier: string; value: string }> }))
vi.mock('@/lib/ediel/core/canonicalMessage', () => ({ parseCanonicalMessageRow: () => ({ references: canonical.references }) }))

import { matchCustomerForAutomation } from '@/lib/ediel/matching/customerMatcher'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'

function message(overrides: Partial<EdielMessageRow>): EdielMessageRow {
  return { id: 'msg-1', company_id: COMPANY, customer_id: null, external_reference: null, ...overrides } as unknown as EdielMessageRow
}

// Split a PostgREST `or` list on top-level commas (outside double quotes).
function conditions(filter: string): string[] {
  const out: string[] = []
  let current = '', quoted = false
  for (let i = 0; i < filter.length; i++) {
    const ch = filter[i]
    if (ch === '\\' && quoted) { current += ch + filter[++i]; continue }
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) { out.push(current); current = ''; continue }
    current += ch
  }
  out.push(current)
  return out
}

describe('Ediel customer matcher filter', () => {
  beforeEach(() => { calls.ors.length = 0; canonical.references = [] })

  it('does not compare a BGM document number with customers.id', async () => {
    await matchCustomerForAutomation({ message: message({ external_reference: 'M260901015169' } as Partial<EdielMessageRow>), companyId: COMPANY })
    expect(calls.ors).toHaveLength(1)
    const conds = conditions(calls.ors[0].filter)
    expect(conds.filter((cond) => cond.startsWith('id.'))).toEqual([])
    expect(conds).toContain('customer_number.eq."M260901015169"')
  })

  it('still compares an already linked customer uuid with customers.id', async () => {
    await matchCustomerForAutomation({ message: message({ external_reference: 'M260901015169', customer_id: CUSTOMER } as Partial<EdielMessageRow>), companyId: COMPANY })
    expect(conditions(calls.ors[0].filter)).toContain(`id.eq."${CUSTOMER}"`)
  })

  it('keeps a sender-controlled reference inside one quoted value', async () => {
    canonical.references = [{ qualifier: 'UD', value: 'X,company_id.neq.null' }]
    await matchCustomerForAutomation({ message: message({}), companyId: COMPANY })
    const conds = conditions(calls.ors[0].filter)
    expect(conds.every((cond) => /^(customer_number|personal_number|org_number|email)\.eq\."X,company_id\.neq\.null"$/.test(cond))).toBe(true)
  })
})
