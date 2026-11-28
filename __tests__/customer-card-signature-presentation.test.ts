import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ids = vi.hoisted(() => ({
  company: '73020000-0000-4000-8000-000000000001',
  customer: '73020000-0000-4000-8000-000000000002',
  contract: '73020000-0000-4000-8000-000000000003',
}))
const state = vi.hoisted(() => ({
  permissions: ['customers.read'],
  platform: false,
  actorMayWrite: true,
  companyMaySign: true,
  source: 'manual',
  reads: [] as string[],
  filters: [] as Array<[string, string]>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({
    companyId: ids.company,
    permissions: state.permissions,
    roles: [],
    isPlatformAdmin: state.platform,
  }),
  isPlatformAdminContext: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
  requireAdminActionAccess: async (requirement: { allOf: string[] }) => {
    state.reads.push('action-context')
    expect(requirement.allOf).toEqual(['contracts.write', 'contracts.create'])
    if (!state.actorMayWrite) throw new Error('Forbidden')
  },
}))
vi.mock('@/lib/tenant/entityGuards', () => ({
  guardIsPlatformAdmin: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
  loadCustomerTenantContext: async (customerId: string) => {
    expect(customerId).toBe(ids.customer)
    state.reads.push('customer-company')
    return { companyId: ids.company }
  },
}))
vi.mock('@/lib/tenant/governance', () => ({
  canSendSignatureForCompany: async (companyId: string) => {
    expect(companyId).toBe(ids.company)
    state.reads.push('company-signing-context')
    return state.companyMaySign
  },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      state.reads.push(table)
      const query = {
        select: () => query,
        eq: (field: string, value: string) => {
          state.filters.push([field, value])
          return query
        },
        in: () => query,
        is: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: { company_id: ids.company, source: state.source }, error: null }),
        limit: async () => ({
          data: [{ id: ids.contract, contract_name: 'Provavtal', status: 'draft' }], error: null,
        }),
      }
      return query
    },
  },
}))
vi.mock('@/components/admin/customers/CustomerActionsMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))

import CustomerWorkspaceLayout from '@/app/admin/customers/[id]/layout'

async function renderLayout() {
  return renderToStaticMarkup(await CustomerWorkspaceLayout({
    params: Promise.resolve({ id: ids.customer }),
    children: React.createElement('p', null, 'Ordinarie kunduppgifter'),
  }))
}

describe('customer card signature shortcuts', () => {
  beforeEach(() => {
    state.permissions = ['customers.read']
    state.platform = false
    state.actorMayWrite = true
    state.companyMaySign = true
    state.source = 'manual'
    state.reads = []
    state.filters = []
    vi.stubGlobal('React', React)
  })

  it.each([null, 'contracts.read', 'contracts.write'])('keeps readable customer content without a signature shortcut (%s)', async permission => {
    if (permission) state.permissions.push(permission)
    const html = await renderLayout()
    expect(html).toContain('Ordinarie kunduppgifter')
    expect(html).not.toContain('Online-signering')
    expect(state.reads).toEqual(['customers', 'customer-company'])
  })

  it('keeps the shortcut only when the canonical actor and the exact company can sign', async () => {
    state.permissions.push('contracts.write', 'contracts.create')
    const html = await renderLayout()
    expect(html).toContain(`href="/admin/customers/${ids.customer}/contracts/${ids.contract}/signature"`)
    expect(state.reads).toEqual(['customers', 'customer-company', 'action-context', 'company-signing-context', 'customer_contracts'])
    expect(state.filters).toContainEqual(['company_id', ids.company])
    expect(state.filters).toContainEqual(['customer_id', ids.customer])
  })

  it('withholds the shortcut after a canonical write denial', async () => {
    state.permissions.push('contracts.write', 'contracts.create')
    state.actorMayWrite = false
    expect(await renderLayout()).not.toContain('Online-signering')
    expect(state.reads).toEqual(['customers', 'customer-company', 'action-context'])
  })

  it('withholds the shortcut for a paused exact company even for a platform actor', async () => {
    state.platform = true
    state.permissions = []
    state.companyMaySign = false
    expect(await renderLayout()).not.toContain('Online-signering')
    expect(state.reads).toEqual(['customers', 'customer-company', 'action-context', 'company-signing-context'])
  })

  it('leaves Ediel control customers to their dedicated display without signing affordances', async () => {
    state.platform = true
    state.source = 'ediel_portal_test'
    expect(await renderLayout()).not.toContain('Online-signering')
    expect(state.reads).toEqual(['customers'])
  })
})
