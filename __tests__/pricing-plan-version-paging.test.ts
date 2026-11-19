import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PricePlansPage from '@/app/admin/pricing/price-plans/page'

const io = vi.hoisted(() => ({
  admin: vi.fn(),
  scope: vi.fn(),
  reads: [] as URL[],
  versions: [] as Array<{ company_id: string; id: string; version_label: string; status: string; valid_from: string; price_plans: { name: string }; created_at: string }>,
  omitCount: false,
  failRead: false,
  serverRowLimit: 1000,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: io.admin }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-platform-user' } } }) } }) }))
vi.mock('@/lib/tenant/scope', async original => ({
  ...await original<typeof import('@/lib/tenant/scope')>(), getOperationalCompanyScope: io.scope,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: pricePlanTransport },
    }),
  }
})

const companyId = '11000000-0000-4000-8000-000000000001'
const otherCompanyId = '11000000-0000-4000-8000-000000000002'

async function pricePlanTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const query = url.searchParams
  io.reads.push(url)
  if (url.pathname.endsWith('/price_plans')) return Response.json([])
  if (!url.pathname.endsWith('/price_plan_versions') || init?.method !== 'GET') throw new Error('Unexpected synthetic request')
  if (io.failRead) return Response.json({ code: '08006', message: 'Synthetic database dependency failed' }, { status: 500 })
  const rows = io.versions.filter(row => !query.has('company_id') || query.get('company_id') === `eq.${row.company_id}`)
  if (query.get('order') === 'created_at.desc,id.desc') {
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  }
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? rows.length)
  if (rows.length > 0 && offset >= rows.length) {
    return Response.json({ code: 'PGRST103', message: 'Requested range not satisfiable' }, { status: 416 })
  }
  const page = rows.slice(offset, offset + Math.min(limit, io.serverRowLimit))
  const headers = new Headers()
  if (!io.omitCount && new Headers(init.headers).get('prefer')?.includes('count=exact')) {
    headers.set('content-range', page.length === 0 ? `*/${rows.length}` : `${offset}-${offset + page.length - 1}/${rows.length}`)
  }
  return Response.json(page, { headers })
}

function versionQueries() {
  return io.reads.filter(url => url.pathname.endsWith('/price_plan_versions')).map(url => url.searchParams)
}

async function renderPage(page?: string) {
  return renderToStaticMarkup(await PricePlansPage({ searchParams: Promise.resolve({ page }) }))
}

beforeEach(() => {
  io.admin.mockReset().mockResolvedValue({ email: 'synthetic@example.test' })
  io.scope.mockReset().mockResolvedValue({ companyId, companyName: 'Syntetiskt elhandelsbolag' })
  io.reads = []
  io.omitCount = false
  io.failRead = false
  io.serverRowLimit = 1000
  io.versions = Array.from({ length: 82 }, (_, index) => {
    const n = String(index + 1).padStart(3, '0')
    return {
      company_id: index === 81 ? otherCompanyId : companyId,
      id: `22000000-0000-4000-8000-000000000${n}`,
      status: 'published', valid_from: '2026-10-01', created_at: '2026-11-18T12:00:00.000Z',
      version_label: `Version-${n}`, price_plans: { name: index === 81 ? 'Annat bolags prisplan' : 'Historisk energiplan' },
    }
  })
})

describe('price plan version history', () => {
  it('reports the full scoped total and shows the newest stable page', async () => {
    const html = await renderPage()

    expect(html.includes('81 versioner registrerade.')).toBe(true)
    expect(html).toContain('Historisk energiplan')
    expect(html).toContain('Publicerad')
    expect(html).toContain('Version-081')
    expect(html.indexOf('Version-081')).toBeLessThan(html.indexOf('Version-080'))
    expect(html).not.toContain('Version-056')
    expect(html).not.toContain('Annat bolags prisplan')
    expect(html).toContain('href="?page=2"')

    expect(versionQueries()).toHaveLength(1)
    const [query] = versionQueries()
    expect(query.get('company_id')).toBe(`eq.${companyId}`)
    expect(query.get('order')).toBe('created_at.desc,id.desc')
    expect(query.get('limit')).toBe('25')
    expect(query.get('select')).toContain('price_plans!price_plan_versions_company_price_plan_fk(name)')
    expect(query.get('select')).not.toContain('snapshot_json')
  })

  it('renders older versions and the previous link on the last page', async () => {
    const html = await renderPage('4')

    expect(html.includes('Version-001')).toBe(true)
    expect(html).toContain('81 versioner registrerade.')
    expect(html).toContain('Sida 4 av 4')
    expect(html).toContain('href="?page=3"')
    expect(html).not.toContain('Nästa sida')
    expect(html).not.toContain('Version-007')
    expect(versionQueries()[0].get('offset')).toBe('75')
  })

  it('recovers from a stale page link', async () => {
    const html = await renderPage('5')

    expect(html.includes('Sida 1 av 4')).toBe(true)
    expect(versionQueries().map(url => url.get('offset'))).toEqual(['100', '0'])
  })

  it('retains the platform view without an operational company selection', async () => {
    io.scope.mockResolvedValue({ companyId: null, companyName: null })

    const html = await renderPage()

    expect(html.includes('82 versioner registrerade.')).toBe(true)
    expect(html).toContain('Annat bolags prisplan')
    expect(versionQueries()[0].has('company_id')).toBe(false)
  })

  it.each(['missing count', 'database error'])('shows an unavailable list for %s', async failure => {
    io.omitCount = failure === 'missing count'
    io.failRead = failure === 'database error'

    const html = await renderPage()

    expect(html.includes('Versionerna kunde inte läsas.')).toBe(true)
    expect(html).not.toContain('versioner registrerade.')
    expect(html).not.toContain('Synthetic database dependency failed')
  })

  it('distinguishes a successfully counted empty history', async () => {
    io.versions = []

    const html = await renderPage()

    expect(html).toContain('0 versioner registrerade.')
    expect(html).not.toContain('Versionerna kunde inte läsas.')
  })

  it('does not offer a continuation that would skip rows after a short database page', async () => {
    io.serverRowLimit = 10

    const html = await renderPage()

    expect(html).toContain('Versionerna kunde inte läsas.')
    expect(html).not.toContain('Nästa sida')
  })

  it('performs no service reads when platform access is denied', async () => {
    io.admin.mockRejectedValue(new Error('Access denied'))

    await expect(renderPage()).rejects.toThrow('Access denied')
    expect(io.reads).toEqual([])
  })
})
