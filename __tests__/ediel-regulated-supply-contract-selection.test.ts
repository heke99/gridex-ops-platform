import { createClient } from '@supabase/supabase-js'
import { Children, isValidElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import RegulatedSupplyPage from '@/app/admin/ediel/regulated-supply/page'
import type RegulatedSupplyWorkspace from '@/app/admin/ediel/regulated-supply/workspace'

const ports = vi.hoisted(() => ({ guard: vi.fn(), db: vi.fn(), service: null as unknown }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageAccess: ports.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: ports.db }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return ports.service } }))

const id = (n: number) => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const companyId = id(1)
const foreignCompany = id(2)
const customerId = id(3)
const pointId = id(4)
const contractId = id(5)
const artifactId = id(6)
const read = ['communication.read', 'contracts.read', 'metering.read']
const write = ['communication.write', 'metering.write']
const agreement = { id: id(8), company_id: companyId, environment: 'test', capability_code: 'PRODAT:Z04:A', source_reference: 'Synthetic agreement', is_enabled: true }
const reference = 'SYNTHETIC-CONTRACT'
const ambiguous = 'Inget entydigt undertecknat avtal med aktuell anläggning kunde bekräftas i valt bolag.'
type Row = Record<string, string | boolean | null>

function contract(overrides: Row = {}): Row {
  return { id: contractId, company_id: companyId, customer_id: customerId, metering_point_id: pointId, contract_number: reference,
    status: 'signed', signed_at: '2026-09-01T10:00:00Z', signed_version: 'v2', contract_version: 'v2', ...overrides }
}

function point(overrides: Row = {}): Row {
  return { id: pointId, company_id: companyId, customer_id: customerId, ediel_metering_point_id: 'SYNTHETIC-POINT', product_direction: 'consumption', ...overrides }
}

function period(n: number, overrides: Row = {}): Row {
  return { id: id(n), company_id: companyId, customer_id: customerId, metering_point_id: id(16), status: 'active',
    start_date: '2026-09-01', end_date: null, ...overrides }
}

type Read = { table: string; method: string; filters: URLSearchParams }
type Fixture = { contracts?: Row[]; points?: Row[]; periods?: Row[]; cap?: number; omitCount?: boolean; fail?: (read: Read) => boolean }

function database(data: Fixture = {}) {
  const requests: Read[] = []
  const tables: Record<string, Row[]> = {
    customer_contracts: data.contracts ?? [contract()],
    metering_points: data.points ?? [point()],
    customer_supply_periods: data.periods ?? [],
    tenant_bilateral_agreements: [agreement],
  }
  const client = createClient('https://regulated-selector.example.invalid', 'synthetic-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const table = url.pathname.split('/').at(-1) ?? ''
        const filters = url.searchParams
        const request = { table, method: init?.method ?? 'GET', filters }
        requests.push(request)
        expect(tables[table]).toBeDefined()
        expect(filters.get('company_id')).toMatch(/^eq\./)
        if (data.fail?.(request)) return Response.json({ code: '08006', message: 'Synthetic source failure' }, { status: 409 })

        const belongs = (row: Row, joined: Row | undefined) => [...filters].every(([name, value]) => {
          const content = name.startsWith('point.') ? joined?.[name.slice(6)] : row[name]
          if (value.startsWith('eq.')) return (content === true ? 'true' : content) === value.slice(3)
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(content))
          if (value.startsWith('gt.')) return typeof content === 'string' && content > value.slice(3)
          if (value === 'not.is.null') return content !== null && content !== undefined
          return true
        })
        const joinsPoint = filters.get('select')?.includes('!customer_supply_periods_company_meter_fkey!inner')
        let rows = tables[table].flatMap(row => {
          const meter = joinsPoint ? tables.metering_points.find(candidate => candidate.company_id === row.company_id && candidate.id === row.metering_point_id) : undefined
          return belongs(row, meter) && (!joinsPoint || meter) ? [{ row, meter }] : []
        })
        if (request.method === 'HEAD') {
          expect(filters.has('ediel_metering_point_id')).toBe(true)
          expect(new Headers(init?.headers).get('prefer')).toContain('count=exact')
          return new Response(null, { status: 200, headers: data.omitCount ? {} : { 'content-range': `*/${rows.length}` } })
        }
        if (filters.get('order') === 'id.asc') rows = rows.sort((a, b) => String(a.row.id).localeCompare(String(b.row.id)))
        return Response.json(rows.slice(0, Math.min(Number(filters.get('limit') ?? Infinity), data.cap ?? Infinity))
          .map(({ row, meter }) => meter ? { ...row, point: meter } : row))
      },
    },
  })
  ports.db.mockReturnValue(client)
  ports.service = client
  return requests
}

async function render(contract?: string) {
  const tree = await RegulatedSupplyPage({ searchParams: Promise.resolve({ artifactId, contract }) })
  const html = renderToStaticMarkup(tree)
  const choices = html.match(/<select aria-label="Avtal och anläggning"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? ''
  type WorkspaceProps = ComponentProps<typeof RegulatedSupplyWorkspace>
  const workspace = Children.toArray(tree.props.children).find((child): child is ReactElement<WorkspaceProps> =>
    isValidElement<WorkspaceProps>(child) && child.props.initialArtifactId === artifactId)?.props
  return { html, choices, workspace }
}

beforeEach(() => {
  ports.guard.mockReset().mockResolvedValue({ companyId, permissions: [...read, ...write] })
  ports.db.mockReset()
})

it('finds the exact contract and meter beyond independent tenant-wide list windows', async () => {
  const unrelated = Array.from({ length: 200 }, (_, index) => point({ id: id(1000 + index), customer_id: id(19), ediel_metering_point_id: `OTHER-${index}` }))
  const recent = Array.from({ length: 200 }, (_, index) => contract({ id: id(1300 + index), customer_id: id(19), metering_point_id: id(1000 + index), contract_number: `OTHER-${index}` }))
  const reads = database({ contracts: [...recent, contract()], points: [...unrelated, point()] })
  const result = await render(reference)

  expect(result.choices).toContain(`value="${contractId}"`)
  expect(result.choices).toContain('SYNTHETIC-POINT')
  expect(result.html).toContain(`name="artifactId" value="${artifactId}"`)
  expect(reads[0].filters.get('contract_number')).toBe(`eq.${reference}`)
  expect(reads.find(r => r.table === 'metering_points' && r.method === 'GET')?.filters.get('id')).toBe(`eq.${pointId}`)
  expect(reads.find(r => r.method === 'HEAD')?.filters.get('ediel_metering_point_id')).toBe('eq.SYNTHETIC-POINT')
})

it('rejects a duplicate metering identity even beyond the returned row cap', async () => {
  const unrelated = Array.from({ length: 199 }, (_, index) => point({ id: id(1000 + index), ediel_metering_point_id: `OTHER-${index}` }))
  database({ points: [point(), ...unrelated, point({ id: id(900), customer_id: id(99) })], cap: 1 })
  const result = await render(contractId)
  expect(result.choices).not.toContain(`value="${contractId}"`)
  expect(result.html).toContain(ambiguous)
})

it('counts only native matching signed versions and checks scoped continuation before declaring uniqueness', async () => {
  const stale = [contract({ id: id(20), contract_number: 'STALE-1', signed_version: 'v1' }),
    contract({ id: id(21), contract_number: 'STALE-2', signed_version: null, contract_version: null })]
  const reads = database({ contracts: [contract(), ...stale], cap: 1 })
  expect((await render(contractId)).choices).toContain(`value="${contractId}"`)
  expect(reads.filter(r => r.filters.get('id')?.startsWith('gt.'))).toHaveLength(3)

  database({ contracts: [contract(), ...stale, contract({ id: id(22), contract_number: 'OTHER-ACTIVE', status: 'active' })], cap: 1 })
  expect((await render(contractId)).html).toContain(ambiguous)
})

it('loads linked consumption periods for the selected production customer through the company-bound meter relation', async () => {
  const periods = [period(30), period(31), period(32, { metering_point_id: id(38) }), period(33, { company_id: foreignCompany }),
    period(34, { customer_id: id(40) }), period(35, { status: 'cancelled' })]
  const reads = database({ points: [point({ product_direction: 'production' }), point({ id: id(16), ediel_metering_point_id: 'OWN-CONSUMPTION' }),
    point({ id: id(38), customer_id: id(40), ediel_metering_point_id: 'WRONG-CUSTOMER' })], periods, cap: 1 })
  const result = await render(contractId)
  expect(result.choices).toContain(`value="${contractId}"`)
  expect(result.workspace?.consumption.map(option => option.id)).toEqual([id(30), id(31)])
  const linked = reads.filter(r => r.table === 'customer_supply_periods')
  expect(linked).toHaveLength(3)
  expect(linked.every(r => r.filters.get('customer_id') === `eq.${customerId}` && r.filters.get('point.product_direction') === 'eq.consumption')).toBe(true)
})

it('keeps artifact access and offers no foreign matches after changing company', async () => {
  const reads = database()
  expect((await render(contractId)).choices).toContain(`value="${contractId}"`)
  ports.guard.mockResolvedValueOnce({ companyId: foreignCompany, permissions: [...read, ...write] })
  const result = await render(contractId)
  expect(result.choices).not.toContain('SYNTHETIC-POINT')
  expect(result.html).toContain(ambiguous)
  expect(result.workspace).toMatchObject({ initialArtifactId: artifactId, canArchive: true, canReview: false })
  expect(reads.at(-1)?.filters.get('company_id')).toBe(`eq.${foreignCompany}`)
})

it.each(['missing count', 'partial contract read'])('reports a read failure for %s without presenting an eligible choice', async (fault) => {
  database({ omitCount: fault === 'missing count', cap: 1, fail: read => fault === 'partial contract read' && read.filters.get('id')?.startsWith('gt.') === true })
  const result = await render(contractId)
  expect(result.html).toContain('role="alert"')
  expect(result.html).not.toContain(ambiguous)
  expect(result.choices).not.toContain('SYNTHETIC-POINT')
  expect(result.workspace).toMatchObject({ initialArtifactId: artifactId, canArchive: true, choices: [] })
})

it('uses a single discovery read before selection and preserves current read-only artifact access', async () => {
  const reads = database()
  const initial = await render()
  expect(initial.choices).not.toContain('SYNTHETIC-POINT')
  expect(initial.html).toContain('Läs anläggning')
  expect(reads.map(r => r.table)).toEqual(['customer_contracts'])

  ports.guard.mockResolvedValueOnce({ companyId, permissions: read })
  const readonly = await render(contractId)
  expect(readonly.workspace).toMatchObject({ initialArtifactId: artifactId, canArchive: false, canReview: false })
  expect(reads).toHaveLength(1)
  expect(ports.guard).toHaveBeenCalledWith({ allOf: read })
})
