import { createClient } from '@supabase/supabase-js'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import SignedBrpPage from '@/app/admin/ediel/signed-brp-declarations/page'

const ports = vi.hoisted(() => ({ access: vi.fn(), serverClient: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageAccess: ports.access }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: ports.serverClient }))

const uuid = (n: number) => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const companyId = uuid(1)
const readPermissions = ['communication.read', 'customers.read', 'contracts.read']
const writePermissions = ['communication.write', 'customers.write', 'contracts.write']
const artifactId = uuid(5)

type Contract = {
  id: string
  company_id: string
  contract_number: string | null
  signed_at: string | null
  status: string
}

function contract(n: number, fields: Partial<Contract> = {}): Contract {
  return {
    id: uuid(n), company_id: companyId, contract_number: `SIGNED-${n}`,
    signed_at: new Date(Date.UTC(2026, 8, 1, n)).toISOString(), status: 'signed', ...fields,
  }
}

function serverContracts(rows: Contract[], error = false) {
  const reads: URLSearchParams[] = []
  ports.serverClient.mockReturnValue(createClient('https://brp-probe.example.invalid', 'synthetic-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        expect(url.pathname).toBe('/rest/v1/customer_contracts')
        expect(init?.method).toBe('GET')
        const filters = url.searchParams
        reads.push(filters)
        expect(filters.get('company_id')).toBe(`eq.${companyId}`)
        expect(filters.get('signed_at')).toBe('not.is.null')
        if (error) return Response.json({ code: '08006', message: 'synthetic read error' }, { status: 409 })

        const status = filters.get('status') ?? ''
        const statuses = status.startsWith('in.(') ? status.slice(4, -1).split(',') : [status.slice(3)]
        const number = filters.get('contract_number')?.slice(3)
        const ref = filters.get('or')?.match(/^\(id\.eq\."([^"]+)",contract_number\.eq\."([^"]+)"\)$/)
        const order = filters.get('order') ?? ''
        expect(order).toMatch(/^signed_at\.desc(,id\.desc)?$/)
        const result = rows
          .filter(row => row.company_id === companyId && row.signed_at !== null && statuses.includes(row.status))
          .filter(row => number === undefined || row.contract_number === number)
          .filter(row => !ref || row.id === ref[1] || row.contract_number === ref[2])
          .sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)) || (order.endsWith('id.desc') ? b.id.localeCompare(a.id) : 0))
          .slice(0, Number(filters.get('limit')))
        return Response.json(result.map(({ id, contract_number, signed_at }) => ({ id, contract_number, signed_at })))
      },
    },
  }))
  return reads
}

async function render(params: { artifactId?: string; contract?: string } = {}) {
  return renderToStaticMarkup(await SignedBrpPage({ searchParams: Promise.resolve(params) }))
}

function options(html: string) {
  return html.match(/<select aria-label="Undertecknat avtal"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? ''
}

beforeEach(() => {
  ports.access.mockReset().mockResolvedValue({ companyId, permissions: [...readPermissions, ...writePermissions] })
  ports.serverClient.mockReset()
})

it('shows actively signed and signed contracts before the first-page cap', async () => {
  const active = contract(202, { status: 'active', contract_number: 'ACTIVE-SIGNED' })
  const reads = serverContracts([
    contract(10, { contract_number: 'OLDER-SIGNED' }),
    ...Array.from({ length: 101 }, (_, i) => contract(100 + i)),
    active,
    contract(203, { status: 'active', signed_at: null, contract_number: 'ACTIVE-UNSIGNED' }),
    contract(204, { status: 'draft', contract_number: 'DRAFT' }),
    contract(205, { company_id: uuid(6), contract_number: 'OTHER-COMPANY' }),
  ])
  const html = await render()

  expect(options(html)).toContain('ACTIVE-SIGNED')
  expect(options(html).match(/<option\b/g)).toHaveLength(100)
  expect(options(html)).not.toMatch(/OLDER-SIGNED|ACTIVE-UNSIGNED|DRAFT|OTHER-COMPANY/)
  expect(html).toContain('Sök på avtalsnummer eller avtals-ID')
  expect(html).toContain('Visar de 100 senaste undertecknade avtalen.')
  expect(reads).toHaveLength(1)
  expect(reads[0].get('status')).toBe('in.(signed,active)')
  expect(reads[0].get('order')).toBe('signed_at.desc,id.desc')
  expect(reads[0].get('limit')).toBe('101')
})

it('finds and selects an older exact contract number while preserving the artifact reference', async () => {
  const old = contract(10, { contract_number: 'OLDER-SIGNED' })
  const reads = serverContracts([old, ...Array.from({ length: 101 }, (_, i) => contract(100 + i))])
  const html = await render({ contract: '  OLDER-SIGNED  ', artifactId })

  expect(options(html)).toContain('OLDER-SIGNED')
  expect(options(html).match(/<option\b/g)).toHaveLength(1)
  expect(options(html)).toContain(`value="${old.id}" selected`)
  const searchForm = html.match(/<form[^>]*action="\/admin\/ediel\/signed-brp-declarations"[^>]*>/)?.[0]
  expect(searchForm).toContain('method="get"')
  expect(html).toContain(`name="artifactId" value="${artifactId}"`)
  expect(html).toContain(`aria-label="Arkiverat underlags-ID"`)
  expect(html).not.toContain('Visar de 100 senaste undertecknade avtalen.')
  expect(reads).toHaveLength(1)
  expect(reads[0].get('contract_number')).toBe('eq.OLDER-SIGNED')
})

it('accepts exact contract ID for an older contract without a number', async () => {
  const old = contract(10, { contract_number: null })
  const reads = serverContracts([old, ...Array.from({ length: 101 }, (_, i) => contract(100 + i))])
  const html = await render({ contract: old.id })

  expect(options(html)).toContain(`value="${old.id}" selected`)
  expect(options(html).match(/<option\b/g)).toHaveLength(1)
  expect(reads[0].get('or')).toBe(`(id.eq."${old.id}",contract_number.eq."${old.id}")`)
})

it('prioritizes an exact ID when the same text also matches a newer contract number', async () => {
  const older = contract(10, { contract_number: null })
  const newer = contract(20, { contract_number: older.id })
  serverContracts([older, newer])
  const html = await render({ contract: older.id })

  expect(options(html)).toContain(`value="${older.id}" selected`)
  expect(options(html)).toContain(`value="${newer.id}"`)
})

it('keeps authorized artifact operations available when the exact contract lookup is empty', async () => {
  serverContracts([
    contract(10, { company_id: uuid(6), contract_number: 'UNAVAILABLE' }),
    contract(11, { status: 'active', signed_at: null, contract_number: 'UNAVAILABLE' }),
  ])
  const html = await render({ contract: 'UNAVAILABLE', artifactId })

  expect(html).toContain('Inget undertecknat avtal matchar sökningen.')
  expect(html).toContain('Arkivera original')
  expect(html).toMatch(/<select aria-label="Undertecknat avtal"[^>]*required=""[^>]*><\/select>/)
  expect(options(html)).toBe('')
  expect(html).toContain('Arkiverat underlags-ID')
  expect(html).toContain(`name="artifactId" value="${artifactId}"`)
})

it('does not grant archive or review through contract and artifact URL values', async () => {
  ports.access.mockResolvedValueOnce({ companyId, permissions: readPermissions })
  serverContracts([contract(10)])
  const html = await render({ contract: 'SIGNED-10', artifactId })

  expect(html).toContain('Arkiverat underlags-ID')
  expect(html).toContain(`value="${artifactId}"`)
  expect(html).not.toContain('Arkivera original')
  expect(html).not.toContain('Sök på avtalsnummer eller avtals-ID')
})

it('keeps missing permission and read failure distinct', async () => {
  ports.access.mockResolvedValueOnce({ companyId, permissions: readPermissions.slice(1) })
  expect(await render()).toContain('Välj ett bolag där du får läsa kommunikation, kunder och avtal.')
  expect(ports.serverClient).not.toHaveBeenCalled()
  expect(ports.access).toHaveBeenCalledWith({ allOf: readPermissions })

  serverContracts([], true)
  expect(await render({ contract: 'OLDER-SIGNED' })).toContain('Bolagets undertecknade avtal kunde inte läsas med aktuell behörighet.')
})
