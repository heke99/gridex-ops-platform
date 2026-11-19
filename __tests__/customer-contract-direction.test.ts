import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ contractQueries: [] as URL[], rows: [] as Row[], legacySchema: false }))

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const contractId = '00000000-0000-4000-8000-000000000003'
const installedAt = '2026-10-10T12:00:00Z'
const emptyBundleTables = new Set([
  'customer_sites',
  'metering_points',
  'customer_legal_acceptances',
  'powers_of_attorney',
  'website_customer_applications',
  'customer_notifications',
])

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn(),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  logCustomerPortalSuccess: vi.fn(),
  requireCustomerPortalApiContext: async () => ({
    ok: true,
    client: { id: 'synthetic-client', company_id: companyId },
    identity: {
      id: 'synthetic-identity',
      customer_id: customerId,
      external_customer_id: 'synthetic-subject',
      customer_number: 'synthetic-number',
      provider: 'synthetic-provider',
      customer: { id: customerId, customer_type: 'private', status: 'active', full_name: 'Testkund' },
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('http://127.0.0.1:54321')
        const table = url.pathname.split('/').at(-1)
        if (table === 'customer_portal_api_access_logs' && init?.method === 'POST') return new Response(null, { status: 201 })
        if (table && emptyBundleTables.has(table)) return Response.json([])
        if (table !== 'customer_contracts') throw new Error(`Unsupported synthetic table ${table}`)
        io.contractQueries.push(url)
        const fields = url.searchParams.get('select')?.split(',') ?? []
        if (io.legacySchema && fields.includes('customer_contract_reference')) {
          return Response.json({ code: '42703', message: 'column customer_contract_reference does not exist' }, { status: 400 })
        }
        const matching = io.rows.filter(row =>
          url.searchParams.get('company_id') === `eq.${row.company_id}` &&
          url.searchParams.get('customer_id') === `eq.${row.customer_id}`,
        )
        return Response.json(matching.map(row =>
          Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]])),
        ))
      },
    },
  }),
}))

import { GET as getContracts } from '@/app/api/v1/customer/contracts/route'
import { GET as getBundle } from '@/app/api/v1/customer/portal-bundle/route'

const endpoints = ['contracts', 'portal-bundle'] as const

async function readContracts(endpoint: typeof endpoints[number]) {
  const include = endpoint === 'portal-bundle' ? '?include=notifications' : ''
  const request = new NextRequest(`https://ops.example.test/api/v1/customer/${endpoint}${include}`)
  const response = await (endpoint === 'contracts' ? getContracts : getBundle)(request)
  expect(response.status).toBe(200)
  const { data } = await response.json()
  return endpoint === 'contracts' ? data : data.contracts
}

beforeEach(() => {
  const production = {
    id: contractId, company_id: companyId, customer_id: customerId, created_at: installedAt,
    customer_contract_reference: 'contract_synthetic_production', contract_name: 'Produktionsavtal',
    status: 'active', energy_direction: 'production', auto_renew_enabled: true,
  }
  io.rows = [
    production,
    {
      ...production, id: '00000000-0000-4000-8000-000000000004',
      customer_contract_reference: 'contract_synthetic_consumption', contract_name: 'Förbrukningsavtal',
      energy_direction: 'consumption', auto_renew_enabled: false,
    },
    { ...production, company_id: 'different-company', contract_name: 'Avtal utanför bolaget' },
  ]
  io.contractQueries = []
  io.legacySchema = false
})

describe('customer contract direction and renewal', () => {
  it.each(endpoints)('projects the stored direction and renewal through GET %s', async endpoint => {
    expect(await readContracts(endpoint)).toMatchObject([
      { contract_name: 'Produktionsavtal', energy_direction: 'production', auto_renew_enabled: true },
      { contract_name: 'Förbrukningsavtal', energy_direction: 'consumption', auto_renew_enabled: false },
    ])
    expect(io.contractQueries).toHaveLength(1)
    const [query] = io.contractQueries
    expect(query.searchParams.get('select')?.split(',')).toEqual(expect.arrayContaining(['energy_direction', 'auto_renew_enabled']))
    expect(query.searchParams.get('company_id')).toBe(`eq.${companyId}`)
    expect(query.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
  })

  it.each(endpoints)('preserves the historical schema defaults through GET %s', async endpoint => {
    io.legacySchema = true
    io.rows = [{
      id: contractId, company_id: companyId, customer_id: customerId, created_at: installedAt,
      contract_name: 'Äldre avtal', status: 'active',
    }]
    expect(await readContracts(endpoint)).toMatchObject([
      { contract_name: 'Äldre avtal', energy_direction: 'consumption', auto_renew_enabled: false },
    ])
    expect(io.contractQueries).toHaveLength(2)
  })
})
