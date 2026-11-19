import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  site: {} as Record<string, unknown>,
  pendingAddress: null as Record<string, unknown> | null,
  history: [] as Record<string, unknown>[],
  historyUnavailable: false,
  queries: [] as { method: string; filters: URLSearchParams }[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: vi.fn() }))
vi.mock('@/lib/supabase/service', async () => ({
  supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/rest/v1/customer_site_address_history' && method === 'POST') {
          if (io.historyUnavailable) return Response.json({ code: '08006', message: 'Synthetic connection error' }, { status: 503 })
          io.history.push(JSON.parse(String(init?.body)))
          return new Response(null, { status: 201 })
        }
        if (url.pathname !== '/rest/v1/customer_sites') throw new Error(`Unexpected synthetic endpoint ${url.pathname}`)
        io.queries.push({ method, filters: url.searchParams })
        if (method === 'PATCH' && io.pendingAddress) Object.assign(io.site, io.pendingAddress)
        const matched = [...url.searchParams].filter(([key]) => key !== 'select').every(([key, filter]) => {
          if (filter === 'is.null') return io.site[key] === null
          if (filter.startsWith('eq.')) return String(io.site[key]) === filter.slice(3)
          throw new Error(`Unexpected synthetic filter ${filter}`)
        })
        if (method === 'GET') return Response.json(matched ? [io.site] : [])
        if (method === 'PATCH') {
          if (matched) Object.assign(io.site, JSON.parse(String(init?.body)))
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected synthetic method ${method}`)
      },
    },
  }),
}))

import { applyCustomerSiteAddressCandidate } from '@/lib/customer-sites/addressIntake'

const initialIncompleteAddress = {
  street: null, postal_code: null, city: null, country: 'SE', address_hash: null,
  address_source: null, address_verified_at: null, address_verification_method: null,
  address_status: 'unknown', address_quality_status: 'unknown',
}
const verifiedAddress = {
  street: 'Nätgatan 1', postal_code: '12345', city: 'Syntetisk stad', country: 'SE',
  address_hash: 'a'.repeat(64), address_source: 'grid_owner_response',
  address_verified_at: '2026-10-01T10:00:00Z', address_verification_method: 'grid_owner_response',
  address_status: 'verified', address_quality_status: 'valid',
}
const candidate = () => applyCustomerSiteAddressCandidate({
  companyId: 'company', customerId: 'customer', siteId: 'site',
  address: { city: 'Ny ort', source: 'customer_portal', sourceReference: 'proposal-1' },
})

beforeEach(() => {
  io.site = { id: 'site', company_id: 'company', customer_id: 'customer', ...initialIncompleteAddress }
  io.pendingAddress = null
  io.history = []
  io.historyUnavailable = false
  io.queries = []
})

describe('incomplete customer site address proposals', () => {
  it('saves the proposal without changing the verified canonical address', async () => {
    Object.assign(io.site, verifiedAddress)
    const before = { ...io.site }
    expect(await candidate()).toMatchObject({ status: 'incomplete', reason: 'missing_site_address_fields' })
    expect(io.site).toEqual(before)
    expect(io.queries.map(query => query.method)).toEqual(['GET'])
    expect(io.history).toEqual([expect.objectContaining({
      company_id: 'company', customer_id: 'customer', customer_site_id: 'site', address_hash: null,
      source: 'customer_portal', source_reference: 'proposal-1',
      snapshot: expect.objectContaining({ city: 'Ny ort', street: null }),
    })])
  })

  it('preserves a complete older address whose hash has never been backfilled', async () => {
    Object.assign(io.site, verifiedAddress, { address_hash: null, address_verified_at: null, address_verification_method: null, address_source: 'import' })
    const before = { ...io.site }
    expect(await candidate()).toMatchObject({ status: 'incomplete' })
    expect(io.site).toEqual(before)
    expect(io.queries.map(query => query.method)).toEqual(['GET'])
    expect(io.history).toHaveLength(1)
  })

  it('marks a site that has never had a complete address and scopes the write to its customer', async () => {
    expect(await candidate()).toMatchObject({ status: 'incomplete' })
    expect(io.site).toMatchObject({ address_status: 'incomplete', address_quality_status: 'incomplete', address_source: 'customer_portal' })
    expect(io.queries.find(query => query.method === 'PATCH')?.filters.get('customer_id')).toBe('eq.customer')
    expect(io.history).toHaveLength(1)
  })

  it('does not overwrite an address that becomes canonical after the initial read', async () => {
    io.pendingAddress = verifiedAddress
    expect(await candidate()).toMatchObject({ status: 'incomplete' })
    expect(io.site).toMatchObject(verifiedAddress)
    expect(io.history).toHaveLength(1)
  })

  it('keeps a partial candidate from changing site status if its history cannot be recorded', async () => {
    io.historyUnavailable = true
    await expect(candidate()).rejects.toMatchObject({ code: '08006' })
    expect(io.site).toMatchObject(initialIncompleteAddress)
    expect(io.queries.map(query => query.method)).toEqual(['GET'])
  })
})
