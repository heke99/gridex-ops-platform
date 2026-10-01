import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ missingNewColumns: false, selects: [] as string[], filters: [] as Array<[string, unknown]> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async () => ({ data: [], error: null }),
  from: (table: string) => {
    let selection = ''
    const filters = new Map<string, unknown>()
    const customer: Record<string, unknown> = {
      id: '11111111-1111-4111-8111-111111111111', company_id: '22222222-2222-4222-8222-222222222222',
      customer_number: 'SYN-REVISIONS', status: 'active', email: 'contact@example.invalid', contact_revision: 4,
      billing_profile_revision: 7, profile_revision: 2, preferred_language: 'sv',
      metadata: { portal_timezone: 'Europe/Stockholm', internal_note: 'Do not expose' },
    }
    const result = () => {
      if (table !== 'customers') return { data: [], error: null }
      if (fixture.missingNewColumns && selection.includes('billing_profile_revision')) return {
        data: null, error: { code: '42703', message: 'column customers.billing_profile_revision does not exist' },
      }
      if ([...filters].some(([field, value]) => customer[field] !== value)) return { data: [], error: null }
      return { data: [Object.fromEntries(selection.split(',').map((field) => field.includes(':')
        ? [field.split(':')[0], (customer.metadata as Record<string, unknown>).portal_timezone]
        : [field, customer[field] ?? null]))], error: null }
    }
    const query = {
      select: (value: string) => { selection = value; fixture.selects.push(value); return query },
      eq: (field: string, value: unknown) => { filters.set(field, value); fixture.filters.push([field, value]); return query },
      limit: () => query,
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  },
} }))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const resolution = await resolvePortalCustomer({
      client: { id: '33333333-3333-4333-8333-333333333333', company_id: '22222222-2222-4222-8222-222222222222' } as Parameters<typeof resolvePortalCustomer>[0]['client'],
      identifiers: { customerNumber: 'SYN-REVISIONS' },
    })
    if (!resolution.ok) throw new Error('synthetic customer could not resolve')
    return { ok: true, identity: resolution.customer, startedAt: 1,
      client: { id: '33333333-3333-4333-8333-333333333333', company_id: '22222222-2222-4222-8222-222222222222' },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: () => Response.json({ code: 'unexpected_error' }, { status: 500 }),
}))

import { GET } from '@/app/api/v1/customer/me/route'

describe('customer profile revisions through the actual resolver selector and /me DTO (mock DB boundary)', () => {
  beforeEach(() => { fixture.selects.length = 0; fixture.filters.length = 0; fixture.missingNewColumns = false })

  it('returns separately selected current revisions and the allowed preferences without raw metadata', async () => {
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/me'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ contact_revision: 4, billing_revision: 7, profile_revision: 2,
      language_code: 'sv', timezone: 'Europe/Stockholm', email: 'contact@example.invalid',
    })
    expect(JSON.stringify(body)).not.toContain('Do not expose')
    expect(body.data).not.toHaveProperty('metadata')
    expect(fixture.filters).toContainEqual(['company_id', '22222222-2222-4222-8222-222222222222'])
    expect(fixture.selects.some(selection => selection.includes('portal_timezone:metadata->>portal_timezone'))).toBe(true)
  })

  it('preserves the real contact revision but returns null new revisions on an older schema', async () => {
    fixture.missingNewColumns = true
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/me'))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ contact_revision: 4, billing_revision: null, profile_revision: null })
    expect(fixture.selects.filter(selection => selection.includes('contact_revision'))).toHaveLength(2)
  })
})
