import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selected: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  targetPermissions: [] as string[],
  selectedPermissions: ['billing.read', 'billing.write', 'billing.export'],
  platform: false,
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
    if (table === 'companies') return { data: { id: filters.id, status: 'active', invoice_export_target_system: 'capway', billing_provider_environment: 'test' }, error: null }
    if (table === 'invoice_export_items') effect(patch ? 'invoice_update' : 'invoice_read', String(filters.company_id))
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
    }, error: null }
  },
  from: (table: string) => query(table, true),
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => query(table),
  rpc: async (name: string, input: { p_company_id?: string }) => {
    if (name === 'gridex_get_user_roles') return { data: state.platform ? ['platform_admin'] : ['finance'], error: null }
    effect(name, input.p_company_id ?? '')
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
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ requestCapwayInvoicePurchase: async ({ companyId }: { companyId: string }) => effect('provider_purchase', companyId) }))
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
  state.targetPermissions = ['billing.read']
  state.selectedPermissions = ['billing.read', 'billing.write', 'billing.export']
  state.effects = []
  state.resolutions = []
  state.platform = false
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
      state.targetPermissions = ['billing.read', 'billing.write', 'billing.export']
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
    state.targetPermissions = ['billing.read', 'billing.write', 'billing.export']
    const response = await call(routes.find(route => route.name === 'invoice dispute')!)
    expect(response.status).toBe(403)
    expect(state.effects).toEqual([])
  })
  it('preserves default guard selection for unrelated callers', async () => {
    const result = await requireAdminApiAccess(['billing.write'])
    expect(result.guard?.companyId).toBe(state.selected)
    expect(state.resolutions).toEqual([state.selected])
  })
})
