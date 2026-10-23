// reality-defects: F110 (route-readiness hid a newer tenant's blocked routes beyond the 500-row limit)
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as Array<[string, unknown[]]> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const filters: Array<(row: Row) => boolean> = []
      let limit = Infinity
      const query: Record<string, unknown> = {}
      const chain = (name: string, apply?: (...args: unknown[]) => void) => {
        query[name] = (...args: unknown[]) => { io.calls.push([`${table}.${name}`, args]); apply?.(...args); return query }
      }
      chain('select'); chain('or'); chain('order')
      chain('eq', (column, value) => filters.push(row => row[column as string] === value))
      chain('limit', value => { limit = Number(value) })
      query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: io.rows.filter(row => filters.every(f => f(row))).slice(0, limit), error: null }).then(resolve)
      return query
    },
  },
}))

import { COMPANY_ROUTE_READINESS_LIMIT, companyRouteFilterCompanyId, loadCompanyRouteReadiness } from '@/lib/ediel/companyRouteReadinessList'

const base = { query: '16700', environment: 'production', messageFamily: null, messageCode: null, blockerCode: null }
const company = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const blocked = (n: number, code: string) => ({ company_id: company(n), grid_owner_ediel_id: '16700', environment: 'production', message_family: 'PRODAT',
  message_code: code, operational_route_ready: false, send_ready: false })

beforeEach(() => {
  io.calls = []
  // 282 tenants use the same grid owner, as in the reality world: 564 blocked Z01/Z03 rows, more than one page.
  io.rows = Array.from({ length: 282 }, (_, i) => [blocked(i + 1, 'Z01'), blocked(i + 1, 'Z03')]).flat()
})

describe('F110 route readiness lists every tenant that needs an operator action', () => {
  it('a newer tenant beyond the first page is found by its company filter', async () => {
    const newest = company(282)
    const all = await loadCompanyRouteReadiness({ ...base, companyId: null })
    expect(all.rows.some(row => row.company_id === newest)).toBe(false)
    const own = await loadCompanyRouteReadiness({ ...base, companyId: newest })
    expect(own.rows.map(row => `${row.company_id}/${row.message_code}`)).toEqual([`${newest}/Z01`, `${newest}/Z03`])
    expect(own.truncated).toBe(false)
    expect(io.calls).toContainEqual(['gridex_company_route_readiness_v.eq', ['company_id', newest]])
  })

  it('a list cut at the page size says so', async () => {
    const all = await loadCompanyRouteReadiness({ ...base, companyId: null })
    expect(all.rows).toHaveLength(COMPANY_ROUTE_READINESS_LIMIT)
    expect(all.truncated).toBe(true)
  })

  it('only a UUID narrows to one company; anything else is ignored, never interpolated', () => {
    expect(companyRouteFilterCompanyId(` ${company(7).toUpperCase()} `)).toBe(company(7))
    expect(companyRouteFilterCompanyId('x,company_id.neq.y')).toBeNull()
    expect(companyRouteFilterCompanyId('')).toBeNull()
    expect(companyRouteFilterCompanyId(null)).toBeNull()
  })
})
