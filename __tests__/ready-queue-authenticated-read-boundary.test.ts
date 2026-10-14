import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  company: '11111111-1111-4111-8111-111111111111' as string | null,
  platform: false, permission: true, sessionClients: 0,
  reads: [] as Array<{ table: string; credential: string | null; query: URLSearchParams; prefer: string | null }>,
  outboundError: null as null | { code: string; message: string },
  outboundCap: Infinity,
}))
const company = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
function request(n: number, companyId = company): Row {
  return { id: id(n), company_id: companyId, customer_id: id(100 + n), site_id: id(200 + n), metering_point_id: id(300 + n),
    status: 'accepted', request_type: 'switch_in', inbound_z04_message_id: id(400 + n),
    confirmed_start_date: '2026-10-01', requested_start_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z' }
}
function outbound(n: number, companyId = company, sourceId = id(n)): Row {
  return { id: id(500 + n), company_id: companyId, source_id: sourceId, source_type: 'supplier_switch_request',
    request_type: 'supplier_switch', status: 'acknowledged', created_at: '2026-10-01T00:00:00Z' }
}
function sdk(credential: 'synthetic-session-key' | 'synthetic-service-key') {
  return createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: 'Bearer ' + credential },
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input)), table = url.pathname.split('/').at(-1)!
        const headers = new Headers(init?.headers)
        io.reads.push({ table, credential: headers.get('authorization'), prefer: headers.get('prefer'), query: url.searchParams })
        const reply = (body: unknown, status = 200, count?: number) => new Response(JSON.stringify(body), { status, headers: {
          'content-type': 'application/json', ...(count === undefined ? {} : { 'content-range': '*/' + count }),
        } })
        // The boundary must request the user's session, never service bypass.
        // No native RLS is fabricated; credential rejection is an HTTP port.
        if (table === 'outbound_requests' && headers.get('authorization') !== 'Bearer synthetic-session-key') {
          return reply({ code: '42501', message: 'Unexpected service-role reader' }, 403)
        }
        if (table === 'outbound_requests' && io.outboundError) return reply(io.outboundError, 403)
        let rows = [...(io.tables[table] ?? [])]
        for (const [column, filter] of url.searchParams) {
          if (['select', 'order', 'limit'].includes(column)) continue
          if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[column]) === filter.slice(3))
          else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[column])))
          else throw new Error('Unexpected authenticated reader filter: ' + column + '=' + filter)
        }
        const count = rows.length
        const order = url.searchParams.get('order')?.split(',') ?? []
        rows.sort((a, b) => {
          for (const entry of order) {
            const [field, direction] = entry.split('.')
            const diff = String(a[field]).localeCompare(String(b[field]))
            if (diff) return diff * (direction === 'desc' ? -1 : 1)
          }
          return 0
        })
        rows = rows.slice(0, Math.min(Number(url.searchParams.get('limit') ?? Infinity), table === 'outbound_requests' ? io.outboundCap : Infinity))
        return reply(rows, 200, count)
      },
    },
  })
}
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async (key: string) => {
    if (!io.permission || key !== 'operations.ready_to_execute') throw new Error('Synthetic permission refusal')
    return { userId: id(999), email: 'operator@example.test', roles: [], permissions: [], companyId: io.company, isPlatformAdmin: io.platform }
  },
  isPlatformAdminContext: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => { throw new Error('Unexpected legacy fallback') } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => { io.sessionClients++; return sdk('synthetic-session-key') } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: sdk('synthetic-service-key') }))
vi.mock('@/app/admin/operations/actions', () => ({ bulkFinalizeReadySupplierSwitchesAction: async () => {}, finalizeSupplierSwitchExecutionAction: async () => {} }))
vi.mock('@/components/admin/CustomerName', () => ({ default: ({ id }: { id: string }) => React.createElement('span', null, id) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
import Page from '@/app/admin/operations/ready-to-execute/page'
const render = async () => renderToStaticMarkup(await Page())
const outboundReads = () => io.reads.filter(read => read.table === 'outbound_requests')
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  io.company = company; io.platform = false; io.permission = true; io.sessionClients = 0; io.reads = []; io.outboundError = null; io.outboundCap = Infinity
  io.tables = { supplier_switch_requests: [request(1)], customer_sites: [{ id: id(201), company_id: company, site_name: 'Anläggning A' }], outbound_requests: [outbound(1)] }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('actual ready page uses the authenticated correlated outbound read', () => {
  it('reads outbound with the session credential and renders complete known auxiliary data', async () => {
    const html = await render()
    expect(outboundReads()).toHaveLength(1)
    expect(outboundReads()[0].credential).toBe('Bearer synthetic-session-key')
    expect(outboundReads()[0].prefer).toContain('count=exact')
    expect(html).not.toContain('Vissa uppgifter kunde inte läsas')
    expect(html).toContain(`name="request_id" value="${id(1)}"`)
  })
  it('retains company and actual request/source predicates before the outbound cap', async () => {
    io.tables.outbound_requests.push(outbound(2, foreign, id(1)), outbound(3, company, id(99)), { ...outbound(4), request_type: 'meter_values' })
    const html = await render(), read = outboundReads()[0]
    expect(read.credential).toBe('Bearer synthetic-session-key')
    expect(read.query.get('company_id')).toBe('eq.' + company)
    expect(read.query.get('source_id')).toBe('in.(' + id(1) + ')')
    expect(read.query.get('source_type')).toBe('eq.supplier_switch_request')
    expect(read.query.get('request_type')).toBe('eq.supplier_switch')
    expect(read.query.get('limit')).toBe('1000')
    expect(html).not.toContain('Vissa uppgifter kunde inte läsas')
  })
  it('keeps explicitly authorized platform-global scope with the same session boundary', async () => {
    io.platform = true
    io.tables.supplier_switch_requests.push(request(2, foreign))
    io.tables.customer_sites.push({ id: id(202), company_id: foreign, site_name: 'Anläggning B' })
    io.tables.outbound_requests.push(outbound(2, foreign))
    const html = await render()
    expect(outboundReads()[0].credential).toBe('Bearer synthetic-session-key')
    expect(outboundReads()[0].query.has('company_id')).toBe(false)
    expect(html).toContain(`name="request_id" value="${id(2)}"`)
    expect(html).not.toContain('Vissa uppgifter kunde inte läsas')
  })
  it.each(['permission', 'canonical-null'])('rejects %s before creating the session client or reading business data', async mode => {
    if (mode === 'permission') io.permission = false
    else io.company = null
    await expect(render()).rejects.toThrow()
    expect(io.sessionClients).toBe(0); expect(io.reads).toEqual([])
  })
  it.each(['42501', '42P01', '08006'])('keeps auxiliary failure %s explicitly unknown without hiding ready work', async code => {
    io.outboundError = { code, message: 'Private session detail' }
    const html = await render()
    expect(outboundReads()[0].credential).toBe('Bearer synthetic-session-key')
    expect(html).toContain('Vissa uppgifter kunde inte läsas')
    expect(html).not.toContain('Private session detail')
    expect(html).toContain(`name="request_id" value="${id(1)}"`)
  })
  it('retains explicit unknown when the authenticated outbound transport is incomplete', async () => {
    io.outboundCap = 0
    const html = await render()
    expect(outboundReads()[0].credential).toBe('Bearer synthetic-session-key')
    expect(html).toContain('Vissa uppgifter kunde inte läsas')
    expect(html).toContain('Uppgift saknas')
  })
  it('contains cross-company correlation conflict in authorized global mode', async () => {
    io.platform = true; io.tables.outbound_requests = [outbound(2, foreign, id(1))]
    const html = await render()
    expect(outboundReads()[0].credential).toBe('Bearer synthetic-session-key')
    expect(html).toContain('Vissa uppgifter kunde inte läsas')
    expect(html).toContain(`name="request_id" value="${id(1)}"`)
  })
  it('does not read auxiliary outbound data for a genuine empty candidate list', async () => {
    io.tables.supplier_switch_requests = []
    expect(await render()).toContain('Inga byten är redo för leveransstart')
    expect(outboundReads()).toEqual([])
  })
})
