import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import StaffApiGuide from '@/app/developers/staff-api/page'
import { GET as getStaffCustomer } from '@/app/api/v1/staff/customers/[ref]/route'
import { publicReference } from '@/lib/integrations/publicReferences'

const independentReference = 'https://github.com/heke99/gridex-ops-platform/blob/main/docs/staff-api/server-reference-integration.md'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), staff = uuid(3), client = uuid(4)
const customerRef = publicReference('customer', company, customer)!

vi.mock('server-only', () => ({}))
vi.mock('@/lib/staff-api/context', () => ({
  requireStaffApiContext: async (_request: NextRequest, requirements: unknown) => {
    expect(requirements).toEqual({ scopes: ['staff_customers.read'], permission: 'customers.read' })
    return {
      companyId: company, actorUserId: staff, apiClientId: client, startedAt: Date.now(),
      permissions: ['customers.read'], client: { company_id: company, id: client },
    }
  },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const origin = 'https://synthetic.example.test'
  return {
    SUPABASE_SERVICE_URL: origin,
    supabaseService: createClient(origin, 'synthetic-fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: staffPreviewTransport },
    }),
  }
})

async function staffPreviewTransport(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  if (url.pathname === '/rest/v1/rpc/gridex_staff_customer_id_for_reference_v1') {
    expect(await request.json()).toEqual({ p_company_id: company, p_reference: customerRef })
    return Response.json(customer)
  }
  if (url.pathname === '/rest/v1/rpc/ediel_customer_record_tombstones_v1') {
    expect(await request.json()).toEqual({ p_company_id: company, p_customer_id: customer })
    return Response.json([{
      retentionClass: 'customer_address_history', targetId: uuid(2000), sourceHash: 'a'.repeat(64),
      journalRetainUntil: '2028-01-01T00:00:00Z', personalDataAvailable: false,
    }])
  }
  if (url.pathname === '/rest/v1/integration_api_requests') return new Response(null, { status: 201 })
  expect(request.method).toBe('GET')
  expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
  if (url.pathname === '/rest/v1/customers') {
    expect(url.searchParams.get('id')).toBe(`eq.${customer}`)
    return Response.json([{ id: customer, status: 'active', customer_type: 'private' }])
  }
  const collections: Record<string, { start: number; size: number }> = {
    customer_contacts: { start: 1000, size: 101 },
    customer_addresses: { start: 2000, size: 101 },
    customer_sites: { start: 3000, size: 100 },
  }
  expect(url.searchParams.get('customer_id')).toBe(`eq.${customer}`)
  expect(url.searchParams.get('limit')).toBe('101')
  const collection = collections[url.pathname.split('/').at(-1) ?? '']
  if (!collection) throw new Error('Unexpected Staff preview query')
  return Response.json(Array.from({ length: collection.size }, (_, index) => ({ id: uuid(collection.start + index) })))
}

describe('public Staff API identity guidance', () => {
  it('visibly labels the copyable Node.js example as central identity', () => {
    const html = renderToStaticMarkup(createElement(StaffApiGuide))

    expect(html).toContain('>Central Staff identity (Node.js)</span>')
    expect(html).toContain('aria-label="Central Staff identity (Node.js)"')
    expect(html).toContain('aria-label="Copy code example"')
    expect(html).toContain('function staffAssertion(authenticatedStaffGridexUserId)')
  })

  it('links the independent reference from the claims guidance before the central example', () => {
    const html = renderToStaticMarkup(createElement(StaffApiGuide))
    const claims = html.indexOf('Clients registered for an independent staff identity')
    const example = html.indexOf('aria-label="Copy code example"')

    expect(claims).toBeGreaterThan(0)
    expect(example).toBeGreaterThan(claims)
    expect(html.slice(claims, example)).toContain(
      `href="${independentReference}">independent Staff server reference</a>`,
    )
  })
})

describe('Staff customer detail preview', () => {
  it('returns bounded preview metadata from the actual customer detail route', async () => {
    const response = await getStaffCustomer(new NextRequest(`https://synthetic.example.test/api/v1/staff/customers/${customerRef}`), {
      params: Promise.resolve({ ref: customerRef }),
    })
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.customer.contacts).toHaveLength(100)
    expect(data.customer.addresses).toHaveLength(99)
    expect(data.customer.sites).toHaveLength(100)
    expect(data.customer.contacts_page).toEqual({ limit: 100, returned: 100, has_more: true })
    expect(data.customer.addresses_page).toEqual({ limit: 100, returned: 99, has_more: true })
    expect(data.customer.sites_page).toEqual({ limit: 100, returned: 100, has_more: false })
  })

  it('explains where the customer preview ends separately from the complete case history', () => {
    const html = renderToStaticMarkup(createElement(StaffApiGuide))
    const history = html.indexOf('Read complete case history')
    const preview = html.indexOf('Customer detail previews')
    expect(preview).toBeGreaterThan(history)
    expect(html.slice(history, preview)).toContain('Follow next_cursor')
    const guidance = html.slice(preview, html.indexOf('>Errors</h2>', preview))
    for (const field of ['contacts_page', 'addresses_page', 'sites_page', 'returned', 'has_more']) {
      expect(guidance).toContain(`<code>${field}</code>`)
    }
    expect(guidance).toContain('up to 100 records per collection')
    expect(guidance).toContain('The customer detail response ends at this preview')
  })
})
