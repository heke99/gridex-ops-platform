import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: [] as Row[], reads: [] as URLSearchParams[], readHeaders: [] as Array<string | null>, effects: [] as string[], audit: [] as Row[],
  company: '11111111-1111-4111-8111-111111111111' as string | null,
  platform: false, permission: true, signedIn: true, cap: Infinity,
  countMissing: false, failure: null as null | { code: string; message: string },
  moveSeenPriority: false,
}))
const company = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
function request(n: number, patch: Row = {}): Row {
  return { id: id(n), company_id: company, customer_id: id(9001), site_id: id(9002), metering_point_id: null,
    status: 'accepted', inbound_z04_message_id: id(9003), confirmed_start_date: '2026-10-01', requested_start_date: '2026-10-01',
    created_at: `2026-10-01T00:00:00.${String(n).padStart(6, '0')}Z`, ...patch }
}
function parts(text: string): string[] {
  let depth = 0, start = 0
  const result: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') depth--
    if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i)); start = i + 1 }
  }
  return [...result, text.slice(start)]
}
function matches(row: Row, filter: string): boolean {
  if (filter.startsWith('and(')) return parts(filter.slice(4, -1)).every(f => matches(row, f))
  const [field, op, ...rest] = filter.split('.'), value = rest.join('.')
  if (op === 'is') return value === 'null' && row[field] == null
  if (row[field] == null) return false
  if (op === 'eq') return String(row[field]) === value
  if (op === 'gt') return String(row[field]) > value
  throw new Error('Unsupported bulk candidate transport filter: ' + filter)
}
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => {
    if (!io.permission) throw new Error('Synthetic permission denied')
    return { userId: id(9004), email: 'operator@example.test', roles: [], permissions: [], companyId: io.company, isPlatformAdmin: io.platform }
  },
  isPlatformAdminContext: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => { throw new Error('Legacy company must not redirect the canonical guard') } }))
vi.mock('@/lib/cis/db', () => ({ getOutboundRequestById: () => { throw new Error('Unexpected sender read') }, resetOutboundRequestForRetry: () => { throw new Error('Unexpected sender effect') } }))
vi.mock('@/lib/operations/db', () => ({
  finalizeSupplierSwitchExecution: async (_client: unknown, input: { requestId: string }) => {
    io.effects.push(input.requestId)
    const row = io.rows.find(row => row.id === input.requestId)!
    const before = { ...row }
    row.status = 'completed'
    const site = { id: row.site_id, customer_id: row.customer_id }
    return { requestBefore: before, request: { ...row }, siteBefore: site, siteAfter: site, meteringPointBefore: null, meteringPointAfter: null }
  },
  createSupplierSwitchEvent: async () => {}, syncCustomerOperationsForCustomer: async () => {},
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input)), table = url.pathname.split('/').at(-1)!
      if (table === 'audit_logs' && init?.method === 'POST') {
        io.audit.push(JSON.parse(String(init.body)) as Row)
        return new Response(null, { status: 201 })
      }
      if (table !== 'supplier_switch_requests') throw new Error('Unexpected bulk read/effect: ' + table)
      io.reads.push(url.searchParams)
      io.readHeaders.push(new Headers(init?.headers).get('prefer'))
      if (io.failure) return new Response(JSON.stringify(io.failure), { status: 500 })
      let rows = [...io.rows]
      for (const [key, value] of url.searchParams) {
        if (['select', 'order', 'limit'].includes(key)) continue
        rows = rows.filter(row => key === 'or' ? parts(value.slice(1, -1)).some(f => matches(row, f)) : matches(row, key + '.' + value))
      }
      const order = url.searchParams.get('order')?.split(',') ?? []
      rows.sort((a, b) => {
        for (const term of order) {
          const [field, direction, nullOrder] = term.split('.')
          if (a[field] == null && b[field] == null) continue
          if (a[field] == null || b[field] == null) return (a[field] == null ? 1 : -1) * (nullOrder === 'nullsfirst' ? -1 : 1)
          const diff = String(a[field]).localeCompare(String(b[field]))
          if (diff) return diff * (direction === 'desc' ? -1 : 1)
        }
        return 0
      })
      const count = rows.length
      rows = rows.slice(0, Math.min(io.cap, Number(url.searchParams.get('limit') ?? Infinity)))
      const body = JSON.stringify(rows)
      // The first response snapshot still has the old accepted priority. The
      // stored source changes before the next query, as a concurrent date edit
      // can do; its ID now appears again at a strictly later keyset tuple.
      if (io.moveSeenPriority && io.reads.length === 1) {
        io.rows[0].confirmed_start_date = '2026-10-02'
        io.rows[0].requested_start_date = '2026-10-02'
      }
      return new Response(body, { headers: {
        'content-type': 'application/json', ...(io.countMissing ? {} : { 'content-range': `*/${count}` }),
      } })
    } },
  })
  return { supabaseService: client }
})
vi.mock('@/lib/supabase/server', async () => {
  const { supabaseService } = await import('@/lib/supabase/service')
  return { createSupabaseServerClient: async () => {
    supabaseService.auth.getUser = async () => ({ data: { user: io.signedIn ? { id: id(9004) } : null }, error: null }) as Awaited<ReturnType<typeof supabaseService.auth.getUser>>
    return supabaseService
  } }
})
import { bulkFinalizeReadySupplierSwitchesAction as run } from '@/app/admin/operations/actions'

beforeEach(() => {
  io.rows = []; io.reads = []; io.readHeaders = []; io.effects = []; io.audit = []; io.company = company; io.platform = false
  io.permission = true; io.signedIn = true; io.cap = Infinity; io.countMissing = false; io.failure = null
  io.moveSeenPriority = false
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('actual bulk action candidate composition before effects', () => {
  it('reaches ready work behind an implicit transport cap instead of reporting an empty bulk selection', async () => {
    io.cap = 30
    io.rows = [...Array.from({ length: 200 }, (_, n) => request(n + 1, { inbound_z04_message_id: null })), request(201)]
    await run()
    expect(io.effects).toEqual([id(201)])
    expect(io.reads.length).toBeGreaterThan(1)
    expect(io.reads.length).toBeLessThanOrEqual(10)
    expect(io.readHeaders.every(header => header?.includes('count=exact'))).toBe(true)
  })
  it('completes all accepted discovery before the first finalizer mutates status', async () => {
    io.cap = 30; io.rows = Array.from({ length: 205 }, (_, n) => request(n + 1))
    await run()
    expect(io.effects).toEqual(Array.from({ length: 205 }, (_, n) => id(n + 1)))
    expect(io.rows.every(row => row.status === 'completed')).toBe(true)
  })
  it('refuses a repeated request identity moved to a later priority between actual SDK reads before any effect', async () => {
    io.cap = 30; io.moveSeenPriority = true
    io.rows = Array.from({ length: 60 }, (_, n) => request(n + 1))
    await expect(run()).rejects.toThrow(/individuell aktivering/i)
    expect(io.reads).toHaveLength(3)
    expect(io.rows[0].confirmed_start_date).toBe('2026-10-02')
    expect(io.effects).toEqual([])
    expect(io.audit).toEqual([])
    expect(io.rows.every(row => row.status === 'accepted')).toBe(true)
  })
  it('retains all old ordering prefixes and NULL tails, with ID as stable tie breaker', async () => {
    io.cap = 2
    io.rows = [request(5, { confirmed_start_date: null, requested_start_date: '2026-09-01' }),
      request(4, { confirmed_start_date: '2026-09-01', requested_start_date: null }),
      request(3, { confirmed_start_date: '2026-09-01', requested_start_date: '2026-09-02', created_at: null }),
      request(2, { confirmed_start_date: '2026-09-01', requested_start_date: '2026-09-01', created_at: null }),
      request(1, { confirmed_start_date: '2026-09-01', requested_start_date: '2026-09-01' })]
    await run(); expect(io.effects).toEqual([id(1), id(2), id(3), id(4), id(5)])
    expect(io.reads[0].get('order')).toBe('confirmed_start_date.asc.nullslast,requested_start_date.asc.nullslast,created_at.asc.nullslast,id.asc')
  })
  it('traverses equal priority/microsecond tuples and NULL created dates without omissions', async () => {
    io.cap = 30; io.rows = [...Array.from({ length: 130 }, (_, n) => request(n + 1)), request(131, { created_at: null }), request(132, { created_at: null })]
    await run(); expect(io.effects).toEqual(Array.from({ length: 132 }, (_, n) => id(n + 1)))
  })
  it('uses canonical tenant company before reading or finalizing another permitted membership', async () => {
    io.rows = [request(1), request(2, { company_id: foreign })]
    await run(); expect(io.effects).toEqual([id(1)])
    expect(io.reads.every(q => q.get('company_id') === 'eq.' + company)).toBe(true)
  })
  it('preserves authorized platform-global selection', async () => {
    io.platform = true; io.rows = [request(1), request(2, { company_id: foreign })]
    await run(); expect(io.effects).toEqual([id(1), id(2)])
  })
  it('refuses canonical tenant null before any candidate read or effect', async () => {
    io.company = null; io.rows = [request(1)]
    await expect(run()).rejects.toThrow(); expect(io.reads).toEqual([]); expect(io.effects).toEqual([])
  })
  it.each(['permission', 'authentication'])('preserves %s refusal before candidate read/effect', async mode => {
    if (mode === 'permission') io.permission = false
    else io.signedIn = false
    await expect(run()).rejects.toThrow(); expect(io.reads).toEqual([]); expect(io.effects).toEqual([])
  })
  it('retains accepted/Z04/Stockholm reached-date eligibility and genuine empty selection', async () => {
    await run(); expect(io.effects).toEqual([])
    io.rows = [request(1), request(2, { status: 'submitted' }), request(3, { inbound_z04_message_id: null }), request(4, { confirmed_start_date: '2099-01-01' })]
    await run(); expect(io.effects).toEqual([id(1)])
  })
  it('allows a proved-complete selection at the exact1000-row budget', async () => {
    io.rows = [...Array.from({ length: 999 }, (_, n) => request(n + 1, { inbound_z04_message_id: null })), request(1000)]
    await run(); expect(io.effects).toEqual([id(1000)]); expect(io.reads.length).toBeLessThanOrEqual(10)
  })
  it.each([Infinity, 30])('refuses incomplete selection before effects when transport cap is %j', async cap => {
    io.cap = cap; io.rows = Array.from({ length: 1001 }, (_, n) => request(n + 1, { inbound_z04_message_id: null }))
    await expect(run()).rejects.toThrow(/individuell aktivering/i)
    expect(io.effects).toEqual([]); expect(io.audit).toEqual([]); expect(io.reads.length).toBeLessThanOrEqual(10)
  })
  it('refuses missing exact count instead of certifying a partial transport as complete', async () => {
    io.countMissing = true; io.rows = [request(1)]
    await expect(run()).rejects.toThrow(/individuell aktivering/i); expect(io.effects).toEqual([])
  })
  it('propagates source unavailability before any effect using safe bulk instruction', async () => {
    io.failure = { code: '08006', message: 'Private backend detail' }
    await expect(run()).rejects.toThrow(/individuell aktivering/i); expect(io.effects).toEqual([])
  })
  it('refuses malformed accepted owner rows before any finalizer', async () => {
    io.rows = [request(1), request(2, { company_id: null })]; io.platform = true
    await expect(run()).rejects.toThrow(/individuell aktivering/i); expect(io.effects).toEqual([])
  })
})
