// Ediel automation matching builds PostgREST `or` filters from message
// references. A non-UUID reference must never be compared with a uuid column
// (PostgREST rejects the whole query with 22P02), and every value must be
// quoted so a sender-controlled reference cannot add filter conditions.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ ors: [] as Array<{ table: string; filter: string }>, current: '' }))

vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: () => chain,
    limit: () => chain,
    in: () => chain,
    eq: () => chain,
    or: (filter: string) => {
      calls.ors.push({ table: calls.current, filter })
      return chain
    },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  })
  return {
    supabaseService: {
      from: (table: string) => {
        calls.current = table
        return chain
      },
    },
  }
})

import { matchProcessForAutomation, postgrestEqAny } from '@/lib/ediel/matching/processMatcher'
import { matchPermissionForAutomation } from '@/lib/ediel/matching/permissionMatcher'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const UUID_REF = '22222222-2222-4222-8222-222222222222'

function message(overrides: Partial<EdielMessageRow>): EdielMessageRow {
  return { id: 'msg-1', company_id: COMPANY, ...overrides } as unknown as EdielMessageRow
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

const UUID_COLUMNS = ['id', 'grid_owner_data_request_id', 'outbound_request_id']

describe('Ediel matching reference filters', () => {
  beforeEach(() => { calls.ors.length = 0 })

  it('never compares a non-UUID document reference with a uuid column', async () => {
    await matchProcessForAutomation({ message: message({ external_reference: 'Z02-22a882c6' } as Partial<EdielMessageRow>), companyId: COMPANY })
    expect(calls.ors.map((o) => o.table).sort()).toEqual(['customer_info_requests', 'supplier_switch_requests'])
    for (const { filter } of calls.ors) {
      const conds = conditions(filter)
      expect(conds.length).toBeGreaterThan(0)
      for (const cond of conds) {
        const column = cond.slice(0, cond.indexOf('.'))
        expect(UUID_COLUMNS).not.toContain(column)
      }
      expect(conds).toContain('external_reference.eq."Z02-22a882c6"')
    }
  })

  it('still compares a UUID reference with id and uuid foreign-key columns', async () => {
    await matchProcessForAutomation({ message: message({ outbound_request_id: UUID_REF } as Partial<EdielMessageRow>), companyId: COMPANY })
    const info = calls.ors.find((o) => o.table === 'customer_info_requests')!
    const conds = conditions(info.filter)
    for (const column of UUID_COLUMNS) expect(conds).toContain(`${column}.eq."${UUID_REF}"`)
    expect(conds).toContain(`external_reference.eq."${UUID_REF}"`)
  })

  it('quotes sender-controlled references so they cannot add filter conditions', async () => {
    const hostile = 'x),id.neq.0,(a.eq."b\\'
    await matchProcessForAutomation({ message: message({ external_reference: hostile } as Partial<EdielMessageRow>), companyId: COMPANY })
    const sw = calls.ors.find((o) => o.table === 'supplier_switch_requests')!
    // Exactly the two text columns, each a single quoted equality condition.
    expect(conditions(sw.filter)).toEqual([
      'external_reference.eq."x),id.neq.0,(a.eq.\\"b\\\\"',
      'automation_key.eq."x),id.neq.0,(a.eq.\\"b\\\\"',
    ])
  })

  it('applies the same rules to the permission filter shape', () => {
    // permissionMatcher builds its filter with exactly these column groups.
    expect(matchPermissionForAutomation).toBeTypeOf('function')
    expect(postgrestEqAny(['permission_reference', 'external_permission_id'], ['id'], ['PERM-1'])).toBe(
      'permission_reference.eq."PERM-1",external_permission_id.eq."PERM-1"')
    expect(postgrestEqAny(['permission_reference'], ['id'], [UUID_REF])).toBe(
      `permission_reference.eq."${UUID_REF}",id.eq."${UUID_REF}"`)
  })

  it('returns no conditions when no reference is usable', () => {
    expect(postgrestEqAny([], ['id'], ['not-a-uuid'])).toBe('')
  })
})
