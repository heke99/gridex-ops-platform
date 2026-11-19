import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalContractsPage from '@/app/portal/avtal/page'

type Contract = { id: string; company_id: string; customer_id: string; contract_name: string; status: string | null }

const io = vi.hoisted(() => ({
  context: vi.fn(),
  contracts: [] as Contract[],
  reads: [] as URLSearchParams[],
}))

vi.mock('@/lib/customer-portal/db', async original => ({
  ...await original<typeof import('@/lib/customer-portal/db')>(), getCustomerPortalContext: io.context,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/customer-portal/invoiceFileAvailability', () => ({ readInvoiceFileAvailability: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: contractTransport },
    }),
  }
})

const companyId = 'synthetic-company'
const customerId = 'synthetic-customer'

async function contractTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!url.pathname.endsWith('/customer_contracts') || init?.method !== 'GET') throw new Error('Unexpected synthetic request')
  const query = url.searchParams
  io.reads.push(query)
  const customers = (query.get('customer_id') ?? '').slice(4, -1).split(',')
  const rows = io.contracts.filter(row => query.get('company_id') === `eq.${row.company_id}` && customers.includes(row.customer_id))
  return Response.json(rows)
}

function contract(status: Contract['status'], overrides: Partial<Contract> = {}): Contract {
  return { id: 'portal-contract', company_id: companyId, customer_id: customerId, contract_name: 'Syntetiskt elavtal', status, ...overrides }
}

async function renderContracts() {
  return renderToStaticMarkup(await PortalContractsPage())
}

function badge(html: string) {
  const span = html.match(/<article[^>]*>[\s\S]*?<span class="([^"]+)">([^<]+)<\/span>/)
  if (!span) throw new Error('Contract status badge was not rendered')
  return { classes: span[1], label: span[2] }
}

beforeEach(() => {
  io.context.mockReset().mockResolvedValue({ companyId, customerIds: [customerId] })
  io.contracts = []
  io.reads = []
})

describe('customer portal contract status', () => {
  it.each([
    ['draft', 'Utkast', 'slate'],
    ['pending_signature', 'Väntar på signering', 'amber'],
    ['signature_failed', 'Signering misslyckades – försök igen', 'rose'],
    ['signed', 'Signerat', 'emerald'],
    ['active', 'Aktivt', 'emerald'],
    ['terminated', 'Avslutat', 'slate'],
    ['expired', 'Utgånget', 'slate'],
    ['cancelled', 'Avbrutet', 'slate'],
  ])('renders the native %s status in the expected tone', async (status, label, tone) => {
    io.contracts = [contract(status)]

    const rendered = badge(await renderContracts())
    expect(rendered.label).toBe(label)
    expect(rendered.classes).toContain(`bg-${tone}-50`)
  })

  it.each(['cancelled_by_customer', 'manual_review', null])('shows unconfirmed status %s without a positive badge', async status => {
    io.contracts = [contract(status)]

    const rendered = badge(await renderContracts())
    expect(rendered.label).toBe('Status behöver kontrolleras')
    expect(rendered.classes).toContain('bg-slate-50')
  })

  it('shows a cancelled contract within the verified customer and company scope', async () => {
    io.contracts = [
      contract('cancelled'),
      contract('active', { id: 'foreign-company', company_id: 'other-company', contract_name: 'Annat bolags avtal' }),
      contract('signed', { id: 'unlinked', customer_id: 'unlinked-customer', contract_name: 'Okopplad kunds avtal' }),
    ]

    const html = await renderContracts()
    expect(badge(html).label).toBe('Avbrutet')
    expect(html).not.toContain('Annat bolags avtal')
    expect(html).not.toContain('Okopplad kunds avtal')
    expect(io.reads.map(query => [query.get('company_id'), query.get('customer_id')])).toEqual([
      [`eq.${companyId}`, `in.(${customerId})`],
    ])
  })
})
