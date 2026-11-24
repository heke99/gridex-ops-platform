import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const company = '00000000-0000-4000-8000-000000000001'
  const run = '00000000-0000-4000-8000-000000000002'
  return {
    company,
    run,
    requestedCompany: company,
    visible: true,
    storedTotal: 1_001,
    actualTotal: 1_001,
    maxRows: 1_000,
    secondPage: 'normal',
    runFilters: [] as URLSearchParams[],
    itemFilters: [] as { query: URLSearchParams; prefer: string | null }[],
  }
})

vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async (permissions: string[], input: { companyId: string }) => {
    expect(permissions).toEqual(['billing_underlay.read'])
    expect(input.companyId).toBe(fixture.requestedCompany)
    return fixture.requestedCompany === fixture.company
      ? { guard: { userId: 'staff-reader' } }
      : { response: new Response(null, { status: 403 }) }
  },
  requireAdminReadableCompany: async () => fixture.company,
}))

vi.mock('@/lib/billing/invoiceReadiness', () => ({}))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({}))
vi.mock('@/lib/integrations/billing/capway/client', () => ({}))
vi.mock('@/lib/integrations/billing/capway/payloadBuilder', () => ({}))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({}))
vi.mock('@/lib/integrations/billing/capway/statusMapper', () => ({}))
vi.mock('@/lib/events/domainEvents', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({}))
vi.mock('@/lib/platform/outboundFreeze', () => ({}))
vi.mock('@/lib/automation/locks', () => ({}))

function item(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index + 32).padStart(12, '0')}`,
    company_id: fixture.company,
    export_run_id: fixture.run,
    created_at: '2026-11-14T08:00:00+00:00',
    status: index === fixture.actualTotal - 1 ? 'configuration_error' : 'sent',
  }
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient('https://local-export-fixture.invalid', 'fixture', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const query = url.searchParams
        if (url.pathname.endsWith('/invoice_export_runs')) {
          fixture.runFilters.push(query)
          const rows = fixture.visible ? [{
            id: fixture.run,
            company_id: fixture.company,
            total_items: fixture.storedTotal,
          }] : []
          return Response.json(rows)
        }
        expect(url.pathname).toBe('/rest/v1/invoice_export_items')
        const prefer = headers.get('prefer')
        fixture.itemFilters.push({ query, prefer })
        const offset = Number(query.get('offset') ?? 0)
        const limit = Math.min(Number(query.get('limit') ?? fixture.maxRows), fixture.maxRows)
        if (offset > 0 && fixture.secondPage === 'failed') {
          return Response.json({ code: 'fixture_read_error', message: 'read failed' }, { status: 500 })
        }

        const rowCount = Math.max(0, Math.min(limit, fixture.actualTotal - offset))
        const rows = Array.from({ length: rowCount }, (_, n) => item(offset + n))
        let total: number | '*' = fixture.actualTotal
        if (offset > 0) {
          if (fixture.secondPage === 'different_count') total += 1
          if (fixture.secondPage === 'missing_count') total = '*'
          if (fixture.secondPage === 'empty') rows.length = 0
          if (fixture.secondPage === 'duplicate') rows[0] = item(offset - 1)
          if (fixture.secondPage === 'wrong_run') rows[0].export_run_id = fixture.company
        }
        const range = rows.length === 0 ? '*' : `${offset}-${offset + rows.length - 1}`
        return Response.json(rows, {
          headers: { 'content-range': `${range}/${prefer?.includes('count=exact') ? total : '*'}` },
        })
      },
    },
  }),
}))

import { GET } from '@/app/api/internal/invoice-exports/[id]/route'

function read() {
  const request = new Request(`https://local.example.invalid/api/internal/invoice-exports/${fixture.run}?companyId=${fixture.requestedCompany}`)
  return GET(request, { params: Promise.resolve({ id: fixture.run }) })
}

beforeEach(() => {
  fixture.requestedCompany = fixture.company
  fixture.visible = true
  fixture.storedTotal = 1_001
  fixture.actualTotal = 1_001
  fixture.maxRows = 1_000
  fixture.secondPage = 'normal'
  fixture.runFilters = []
  fixture.itemFilters = []
})

describe('invoice export run detail through the ordinary GET', () => {
  it('returns all 1,001 tied timestamps in item ID order', async () => {
    const response = await read()
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.run.total_items).toBe(1_001)
    expect(data.items).toEqual(Array.from({ length: 1_001 }, (_, index) => item(index)))
    expect(data.items.at(-1).status).toBe('configuration_error')
    expect(fixture.itemFilters.map(page => page.query.get('offset'))).toEqual(['0', '1000'])
    for (const { query, prefer } of fixture.itemFilters) {
      expect(query.get('order')).toBe('created_at.asc,id.asc')
      expect(query.get('company_id')).toBe(`eq.${fixture.company}`)
      expect(query.get('export_run_id')).toBe(`eq.${fixture.run}`)
      expect(prefer).toContain('count=exact')
    }
  })

  it('uses physical count with a stale historical total and a lower PostgREST limit', async () => {
    fixture.actualTotal = 155
    fixture.storedTotal = 1
    fixture.maxRows = 73
    const response = await read()
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.run.total_items).toBe(1)
    expect(data.items).toHaveLength(155)
    expect(fixture.itemFilters.map(page => page.query.get('offset'))).toEqual(['0', '73', '146'])
  })

  it.each([0, 1, 1_000])('returns %i rows in a single page', async count => {
    fixture.storedTotal = count
    fixture.actualTotal = count
    const response = await read()
    expect(response.status).toBe(200)
    expect((await response.json()).data.items).toHaveLength(count)
    expect(fixture.itemFilters).toHaveLength(1)
  })

  it.each(['failed', 'different_count', 'missing_count', 'empty', 'duplicate', 'wrong_run'])(
    'rejects a %s second page without an incomplete success body',
    async issue => {
      fixture.secondPage = issue
      const response = await read()
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.code).toBe('invoice_export_read_failed')
      expect(body.data).toBeUndefined()
    },
  )

  it('returns 404 for an unknown run before reading its items', async () => {
    fixture.visible = false
    const response = await read()
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('invoice_export_not_found')
    expect(fixture.itemFilters).toHaveLength(0)
  })

  it('keeps the existing selected-company denial', async () => {
    fixture.requestedCompany = '00000000-0000-4000-8000-000000000003'
    expect((await read()).status).toBe(403)
    expect(fixture.runFilters).toHaveLength(0)
    expect(fixture.itemFilters).toHaveLength(0)
  })
})
