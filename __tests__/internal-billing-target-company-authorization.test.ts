import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selected: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  targetPermissions: [] as string[],
  selectedPermissions: ['billing_underlay.read', 'billing_underlay.export'],
  platform: false,
  frozenChannels: [] as string[],
  purchaseModes: [] as string[],
  resolvedOverride: null as string | null,
  effects: [] as Array<{ operation: string; companyId: string }>,
  resolutions: [] as Array<string | null>,
}))

function effect(operation: string, companyId: string) {
  state.effects.push({ operation, companyId })
  return { status: 'synthetic' }
}

function query(table: string, session = false) {
  const filters: Record<string, unknown> = {}
  let patch: Record<string, unknown> | null = null
  const result = () => {
    if (table === 'company_memberships') return { data: [state.selected, state.target].map(id => ({
      company_id: id, membership_role: id === state.selected ? 'finance' : 'viewer', status: 'active',
      companies: { id, name: 'Synthetic company', status: 'active' },
    })), error: null }
    if (table === 'companies') return { data: { id: filters.id, status: 'active', invoice_export_target_system: 'capway', billing_provider_environment: 'test', outbound_frozen_channels: filters.id === state.target ? state.frozenChannels : [] }, error: null }
    if (table === 'invoice_export_items') {
      effect(patch ? 'invoice_update' : 'invoice_read', String(filters.company_id))
      return { data: {
        id: 'synthetic-item',
        company_id: filters.company_id,
        export_run_id: '44444444-4444-4444-8444-444444444444',
        provider: 'capway_aptic',
        environment: 'test',
        provider_invoice_guid: 'synthetic-guid',
        status: 'sent',
        purchase_status: null,
        provider_purchase_confirmed_at: null,
        response_payload: {},
        updated_at: '2026-10-13T00:00:00Z',
      }, error: null }
    }
    return { data: { id: 'synthetic-item', company_id: filters.company_id, environment: 'test', provider_invoice_guid: 'synthetic-guid' }, error: null }
  }
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => { filters[key] = value; return chain },
    is: (key: string, value: unknown) => { filters[key] = value; return chain },
    update: (value: Record<string, unknown>) => { patch = value; return chain },
    single: async () => result(), maybeSingle: async () => result(),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  void session
  return chain
}

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: state.selected }) }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }) },
  rpc: async (_name: string, input: { p_selected_company_id: string | null }) => {
    const companyId = input.p_selected_company_id
    state.resolutions.push(companyId)
    return { data: {
      authorized: true, user_id: state.userId, is_platform_admin: state.platform,
      selected_company_id: state.resolvedOverride ?? companyId,
      roles: state.platform ? ['platform_admin'] : ['finance'],
      permissions: companyId === state.target ? state.targetPermissions : state.selectedPermissions,
      active_permission_keys: ['billing_underlay.read', 'billing_underlay.export', 'customers.read'],
      denied_permissions: [],
    }, error: null }
  },
  from: (table: string) => query(table, true),
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => query(table),
  rpc: async (name: string, input: { p_company_id?: string }) => {
    if (name === 'gridex_get_user_roles') return { data: state.platform ? ['platform_admin'] : ['finance'], error: null }
    if (name === 'gridex_reserve_manual_capway_purchase_v1') {
      if (input.p_company_id === state.target && state.frozenChannels.some(channel => channel === 'invoice_export' || channel === '*')) {
        return { data: null, error: { code: '23514', message: 'invoice_export_outbound_frozen' } }
      }
      effect(name, input.p_company_id ?? '')
      return { data: true, error: null }
    }
    effect(name, input.p_company_id ?? '')
    if (name === 'gridex_record_invoice_purchase_request_v1') {
      return { data: { event_id: '55555555-5555-4555-8555-555555555555' }, error: null }
    }
    return { data: {}, error: null }
  },
} }))
vi.mock('@/lib/integrations/billing/invoiceExportCore', () => ({
  getInvoiceExportRun: async ({ companyId }: { companyId: string }) => effect('export_read', companyId),
  resetFailedInvoiceExportItems: async ({ companyId }: { companyId: string }) => effect('export_retry', companyId),
}))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({ sendApprovedInvoiceExportRun: async ({ companyId }: { companyId: string }) => effect('export_send', companyId) }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: async ({ companyId }: { companyId: string }) => effect('export_prepare', companyId) }))
vi.mock('@/lib/billing/providers/registry', () => ({ requireTenantInvoiceProvider: () => ({ environment: 'test', provider: 'capway' }) }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ createCapwayApticClient: async ({ companyId }: { companyId: string }) => ({
  dispute: async () => effect('provider_dispute', companyId),
  getInvoice: async () => ({ ...effect('provider_invoice', companyId), status: 1, financeStatus: 2 }),
  getFinancialDetails: async () => effect('provider_financial', companyId),
  getPurchase: async () => effect('provider_purchase_read', companyId),
  getRecourse: async () => effect('provider_recourse', companyId),
}) }))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ requestCapwayInvoicePurchase: async ({ companyId, financingMode }: { companyId: string; financingMode: string }) => {
  state.purchaseModes.push(financingMode)
  return effect('provider_purchase', companyId)
} }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))

import { GET as exportRead } from '@/app/api/internal/invoice-exports/[id]/route'
import { POST as exportRetry } from '@/app/api/internal/invoice-exports/[id]/retry/route'
import { POST as exportSend } from '@/app/api/internal/invoice-exports/[id]/send/route'
import { POST as exportCreate } from '@/app/api/internal/invoice-exports/create/route'
import { POST as dispute } from '@/app/api/internal/invoices/[id]/dispute/route'
import { POST as purchase } from '@/app/api/internal/invoices/[id]/purchase/route'
import { GET as providerStatus } from '@/app/api/internal/invoices/[id]/provider-status/route'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'

const routes = [
  { name: 'export read', method: 'GET', handler: exportRead },
  { name: 'export retry', method: 'POST', handler: exportRetry },
  { name: 'export send', method: 'POST', handler: exportSend },
  { name: 'export create', method: 'POST', handler: exportCreate },
  { name: 'invoice dispute', method: 'POST', handler: dispute },
  { name: 'invoice purchase', method: 'POST', handler: purchase },
  { name: 'provider status', method: 'GET', handler: providerStatus },
]

function call(route: typeof routes[number], target: string | null = state.target) {
  const request = new Request(`http://localhost/api/internal/test${target && route.method === 'GET' ? `?companyId=${target}` : ''}`, {
    method: route.method,
    ...(route.method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(target ? { companyId: target } : {}), billingMonth: '2026-09' }) } : {}),
  })
  return route.handler(request, { params: Promise.resolve({ id: 'synthetic-item' }) })
}

beforeEach(() => {
  state.targetPermissions = ['billing_underlay.read']
  state.selectedPermissions = ['billing_underlay.read', 'billing_underlay.export']
  state.effects = []
  state.resolutions = []
  state.platform = false
  state.frozenChannels = []
  state.purchaseModes = []
  state.resolvedOverride = null
})

describe('internal billing authorizes the actual target company', () => {
  for (const route of routes) {
    it(`${route.name} rejects company A permissions for a viewer target B before effects`, async () => {
      state.targetPermissions = ['customers.read']
      const response = await call(route)
      expect(response.status).toBe(403)
      expect(state.effects).toEqual([])
    })
    it(`${route.name} accepts target B permissions even when selected A lacks billing rights`, async () => {
      state.selectedPermissions = ['customers.read']
      state.targetPermissions = ['billing_underlay.read', 'billing_underlay.export']
      const response = await call(route)
      expect(response.status).toBe(200)
      expect(state.effects.length).toBeGreaterThan(0)
      expect(state.effects.every(effect => effect.companyId === state.target)).toBe(true)
      expect(state.resolutions).toContain(state.target)
    })
    it(`${route.name} preserves selected company behavior when no target is supplied`, async () => {
      const response = await call(route, null)
      expect(response.status).toBe(200)
      expect(state.effects.every(effect => effect.companyId === state.selected)).toBe(true)
    })
  }
  it('keeps canonical platform authority when operating an explicit target', async () => {
    state.platform = true
    state.targetPermissions = []
    const response = await call(routes.find(route => route.name === 'invoice dispute')!)
    expect(response.status).toBe(200)
    expect(state.effects.every(effect => effect.companyId === state.target)).toBe(true)
  })
  it('rejects a canonical context that resolves a different company instead of the explicit target', async () => {
    state.resolvedOverride = state.selected
    state.targetPermissions = ['billing_underlay.read', 'billing_underlay.export']
    const response = await call(routes.find(route => route.name === 'invoice dispute')!)
    expect(response.status).toBe(403)
    expect(state.effects).toEqual([])
  })
  it('preserves default guard selection for unrelated callers', async () => {
    const result = await requireAdminApiAccess(['billing_underlay.export'])
    expect(result.guard?.companyId).toBe(state.selected)
    expect(state.resolutions).toEqual([state.selected])
  })
})

describe('invoice export preparation validates the requested month', () => {
  it.each(['2026-00', '2026-13', '2026-9', 'not-a-month'])(
    'rejects %s before starting preparation',
    async billingMonth => {
      const response = await exportCreate(new Request('http://localhost/api/internal/invoice-exports/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ billingMonth }),
      }))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'billing_month måste anges som YYYY-MM.' })
      expect(state.effects).toEqual([])
    },
  )

  it('rejects a null JSON payload without starting preparation', async () => {
    const response = await exportCreate(new Request('http://localhost/api/internal/invoice-exports/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'billing_month krävs.' })
    expect(state.effects).toEqual([])
  })
})

describe.each([exportSend, exportRetry])('invoice export commands validate the optional JSON object', handler => {
  const params = Promise.resolve({ id: 'synthetic-item' })

  it.each(['null', '[]', '{'])('rejects %s before operating on an export', async body => {
    const response = await handler(new Request('https://example.invalid/internal', { method: 'POST', body }), { params })
    expect(response.status).toBe(400)
    expect(state.effects).toEqual([])
  })

  it('keeps the authorized selected-company behavior when no payload is provided', async () => {
    const response = await handler(new Request('https://example.invalid/internal', { method: 'POST' }), { params })
    expect(response.status).toBe(200)
    expect(state.effects).toHaveLength(1)
    expect(state.effects[0].companyId).toBe(state.selected)
  })
})


describe('manual purchase input and the scoped outbound stop', () => {
  const callPurchase = (body: string) => purchase(new Request('http://localhost/api/internal/invoices/synthetic-item/purchase', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }), { params: Promise.resolve({ id: 'synthetic-item' }) })

  it.each(['{', '', 'null', '[]', 'true'] as const)(
    'rejects non-object or malformed input %j without reserving or contacting the provider',
    async body => {
      const result = await callPurchase(body)
      expect(result.status).toBe(400)
      expect(state.effects).toEqual([])
    },
  )

  it.each([
    { financing_mode: 'invoice_service' },
    { financingMode: null },
    { financing_mode: 'factoring_without_recourse', financingMode: 'factoring_with_recourse' },
  ])('rejects ambiguous or unsupported financing before writes: %j', async mode => {
    const result = await callPurchase(JSON.stringify(mode))
    expect(result.status).toBe(400)
    expect(state.effects).toEqual([])
  })

  it.each(['invoice_export', '*'])('holds a new manual purchase under the target company %s freeze', async frozenChannel => {
    state.targetPermissions = ['billing_underlay.export']
    state.frozenChannels = [frozenChannel]
    const result = await callPurchase(JSON.stringify({ companyId: state.target, financingMode: 'factoring_with_recourse' }))
    expect(result.status).toBe(423)
    expect(await result.json()).toMatchObject({ code: 'outbound_frozen' })
    expect(state.effects.filter(entry => entry.operation !== 'invoice_read')).toEqual([])
  })

  it.each([
    [{}, 'factoring_without_recourse'],
    [{ financing_mode: 'factoring_with_recourse' }, 'factoring_with_recourse'],
    [{ financing_mode: 'factoring_without_recourse', financingMode: 'factoring_without_recourse' }, 'factoring_without_recourse'],
  ] as const)('preserves a valid manual purchase %j in authorization and effect order', async (mode, expected) => {
    state.targetPermissions = ['billing_underlay.export']
    state.frozenChannels = ['webhook']
    const result = await callPurchase(JSON.stringify({ companyId: state.target, ...mode }))
    expect(result.status).toBe(200)
    expect(state.effects.map(entry => entry.operation)).toEqual([
      'invoice_read', 'gridex_reserve_manual_capway_purchase_v1', 'provider_purchase', 'gridex_record_invoice_purchase_request_v1',
    ])
    expect(state.effects.every(entry => entry.companyId === state.target)).toBe(true)
    expect(state.purchaseModes).toEqual([expected])
  })
})


describe('manual purchase company selector', () => {
  const purchaseFor = (target: Record<string, unknown>) => purchase(new Request('http://localhost/api/internal/invoices/synthetic-item/purchase', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...target, financingMode: 'factoring_with_recourse' }),
  }), { params: Promise.resolve({ id: 'synthetic-item' }) })

  it.each([
    { companyId: 123 },
    { company_id: null },
    { companyId: '  ' },
    { company_id: 'not-a-company' },
    { companyId: ['22222222-2222-4222-8222-222222222222'] },
    { companyId: '22222222-2222-4222-8222-222222222222', company_id: 123 },
    { companyId: '22222222-2222-4222-8222-222222222222', company_id: '11111111-1111-4111-8111-111111111111' },
  ])('refuses explicit invalid or conflicting company input before scope fallback: %j', async target => {
    state.targetPermissions = ['billing_underlay.export']
    const response = await purchaseFor(target)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invoice_purchase_invalid_company' })
    expect(state.resolutions).toEqual([])
    expect(state.effects).toEqual([])
  })

  it('authorizes the same normalized company for both valid aliases and does not use selected permissions', async () => {
    state.target = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    try {
      state.targetPermissions = ['billing_underlay.export']
      const response = await purchaseFor({ companyId: ` ${state.target.toUpperCase()} `, company_id: state.target })
      expect(response.status).toBe(200)
      expect(state.resolutions).toEqual([state.target])
      expect(state.effects.every(entry => entry.companyId === state.target)).toBe(true)
      expect(state.effects.map(entry => entry.operation)).toEqual([
        'invoice_read', 'gridex_reserve_manual_capway_purchase_v1', 'provider_purchase', 'gridex_record_invoice_purchase_request_v1',
      ])
    } finally {
      state.target = '22222222-2222-4222-8222-222222222222'
    }
  })

  it('accepts only the canonical target authorization for a single snake-case UUID', async () => {
    state.targetPermissions = ['billing_underlay.read']
    const response = await purchaseFor({ company_id: state.target })
    expect(response.status).toBe(403)
    expect(state.resolutions).toEqual([state.target])
    expect(state.effects).toEqual([])
  })
})
