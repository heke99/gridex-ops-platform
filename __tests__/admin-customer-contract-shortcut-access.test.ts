import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerWorkspaceLayout from '@/app/admin/customers/[id]/layout'
import { hasPermissionRequirement, type PermissionRequirement } from '@/lib/admin/accessModel'

const ids = {
  company: '22000000-0000-4000-8000-000000000001',
  outsideCompany: '22000000-0000-4000-8000-000000000002',
  customer: '44000000-0000-4000-8000-000000000001',
  draft: '55000000-0000-4000-8000-000000000001',
  pending: '55000000-0000-4000-8000-000000000002',
}
const fixture = vi.hoisted(() => ({
  permissions: ['customers.read'],
  platform: false,
  hasActiveCompany: true,
  outsideTenant: false,
  noSignableContracts: false,
  actionDenied: false,
  reads: [] as string[],
  appScopes: [] as unknown[],
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
  requireAdminPageAccess: async (requirement: PermissionRequirement) => {
    if (!fixture.platform && !hasPermissionRequirement(fixture.permissions, requirement)) {
      throw new Error('Synthetic admin page denied')
    }
    return {
      roles: [], permissions: fixture.permissions, isPlatformAdmin: fixture.platform,
      companyId: fixture.hasActiveCompany ? ids.company : null,
    }
  },
  requireAdminActionAccess: async (requirement: string[]) => {
    fixture.appScopes.push(requirement)
    if (!fixture.platform && (fixture.actionDenied || !hasPermissionRequirement(fixture.permissions, { anyOf: requirement }))) {
      throw new Error('Forbidden')
    }
  },
  requireCompanyScopedActionAccess: async () => {
    throw new Error('Unexpected company action presentation boundary')
  },
}))

vi.mock('@/lib/tenant/entityGuards', () => ({
  guardIsPlatformAdmin: (context: { isPlatformAdmin: boolean }) => context.isPlatformAdmin,
  loadCustomerTenantContext: async (customerId: string) => {
    expect(customerId).toBe(ids.customer)
    return { companyId: ids.company }
  },
}))

vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: async () => { throw new Error('Unexpected company lookup') },
  isCompanyOperationalForWrites: () => true,
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:32175', 'synthetic-service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        expect(url.origin).toBe('http://127.0.0.1:32175')
        expect(request.method).toBe('GET')
        fixture.reads.push(url.pathname)
        if (url.pathname === '/rest/v1/customers') {
          expect(url.searchParams.get('id')).toBe('eq.' + ids.customer)
          return Response.json([{ company_id: fixture.outsideTenant ? ids.outsideCompany : ids.company, source: 'manual' }])
        }
        if (url.pathname === '/rest/v1/customer_contracts') {
          expect(url.searchParams.get('company_id')).toBe('eq.' + ids.company)
          expect(url.searchParams.get('customer_id')).toBe('eq.' + ids.customer)
          expect(url.searchParams.get('status')).toBe('in.(draft,pending_signature,signature_failed)')
          expect(url.searchParams.get('signed_at')).toBe('is.null')
          expect(url.searchParams.get('order')).toBe('created_at.desc')
          expect(url.searchParams.get('limit')).toBe('10')
          if (fixture.noSignableContracts) return Response.json([])
          return Response.json([
            { id: ids.draft, contract_name: 'E2E Utkast Alfa', contract_number: 'E2E-ALFA-0001', status: 'draft', signed_at: null },
            { id: ids.pending, contract_name: 'E2E Pågående Beta', contract_number: 'E2E-BETA-0002', status: 'pending_signature', signed_at: null },
          ])
        }
        throw new Error('Unexpected synthetic data path')
      } },
    }),
  }
})

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))

vi.mock('@/components/admin/customers/CustomerActionsMenu', () => ({
  default: ({ label, children }: { label: string; children: React.ReactNode }) =>
    React.createElement('details', null, React.createElement('summary', null, label), children),
}))

async function render(id = ids.customer): Promise<string> {
  const page = await CustomerWorkspaceLayout({
    params: Promise.resolve({ id }),
    children: React.createElement('div', null, 'E2E Kundkort'),
  })
  return renderToStaticMarkup(page)
}

beforeEach(() => {
  fixture.permissions = ['customers.read']
  fixture.platform = false
  fixture.hasActiveCompany = true
  fixture.outsideTenant = false
  fixture.noSignableContracts = false
  fixture.actionDenied = false
  fixture.reads = []
  fixture.appScopes = []
  vi.stubGlobal('React', React)
})
afterEach(() => vi.unstubAllGlobals())

describe('customer card signing shortcut', () => {
  it('skips contract read and removes details for a customer reader', async () => {
    const html = await render()

    expect(html).toContain('E2E Kundkort')
    expect(html).not.toContain('E2E Utkast Alfa')
    expect(html).not.toContain('E2E-ALFA-0001')
    expect(html).not.toContain('/signature')
    expect(fixture.reads).toEqual(['/rest/v1/customers'])
    expect(fixture.appScopes).toEqual([])
  })

  it('permits contract read with view-only shortcut copy', async () => {
    fixture.permissions = ['contracts.read']
    const html = await render()

    expect(html).toContain('Visa signering')
    expect(html).toContain('E2E-ALFA-0001')
    expect(html).toContain('/signature')
    expect(html).not.toContain('Skicka')
    expect(html).not.toContain('Signera avtal')
    expect(fixture.reads).toEqual(['/rest/v1/customers', '/rest/v1/customer_contracts'])
    expect(fixture.appScopes).toEqual([])
  })

  it('uses send and resend copy for a contract writer', async () => {
    fixture.permissions = ['contracts.write']
    const html = await render()

    expect(html).toContain('Skicka länk')
    expect(html).toContain('Skicka ny länk')
    expect(fixture.appScopes).toEqual([['contracts.write']])
  })

  it('keeps write-blocked actor on view-only copy', async () => {
    fixture.permissions = ['contracts.write']
    fixture.actionDenied = true
    const html = await render()

    expect(html).toContain('Visa signering')
    expect(html).not.toContain('Skicka')
    expect(html).not.toContain('Signera avtal')
  })

  it('uses the platform guard bypass and preserves valid shortcuts', async () => {
    fixture.permissions = []
    fixture.platform = true
    const html = await render()

    expect(html).toContain('Skicka länk')
    expect(html).toContain('/signature')
  })

  it('preserves the empty state without a write check when no rows exist', async () => {
    fixture.permissions = ['contracts.read']
    fixture.noSignableContracts = true
    const html = await render()

    expect(html).toContain('E2E Kundkort')
    expect(html).not.toContain('/signature')
    expect(fixture.appScopes).toEqual([])
  })

  it('denies a different tenant before querying contracts', async () => {
    fixture.permissions = ['contracts.write']
    fixture.outsideTenant = true

    await expect(render()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/)
    expect(fixture.reads).toEqual(['/rest/v1/customers'])
    expect(fixture.appScopes).toEqual([])
  })

  it('skips the shortcut when the actor has no active company', async () => {
    fixture.permissions = ['contracts.write']
    fixture.hasActiveCompany = false
    const html = await render()

    expect(html).toContain('E2E Kundkort')
    expect(html).not.toContain('/signature')
    expect(fixture.reads).toEqual(['/rest/v1/customers'])
  })

  it('rejects malformed ID before the customer or contract query', async () => {
    await expect(render('not-a-uuid')).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/)
    expect(fixture.reads).toEqual([])
  })
})
