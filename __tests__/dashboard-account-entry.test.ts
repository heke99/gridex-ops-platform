import { NextRequest } from 'next/server'
import { getURLFromRedirectError } from 'next/dist/client/components/redirect'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminLayout from '@/app/admin/layout'
import DashboardLayout from '@/app/dashboard/layout'
import DashboardPage from '@/app/dashboard/page'
import PortalLayout from '@/app/portal/layout'
import PortalPage from '@/app/portal/page'
import { proxy } from '@/proxy'

const actor = '10000000-0000-4000-8000-000000000001'
const company = '10000000-0000-4000-8000-000000000002'
const customer = '10000000-0000-4000-8000-000000000003'
const origin = 'http://127.0.0.1:32174'
const pathname = '/rest/v1/'
const backendDiagnostic = 'test-internal-backend-diagnostic'
const auth = vi.hoisted(() => ({
  persona: 'customer' as 'customer' | 'staff' | 'platform' | 'anon',
  membershipUnavailable: false,
  tables: [] as string[],
}))
const companyRow = { id: company, name: 'Syntetiskt elbolag', status: 'active' }

function roleRows() {
  return auth.persona === 'platform' ? ['platform_admin'] : auth.persona === 'staff' ? ['company_admin'] : []
}

function authClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: auth.persona === 'anon' ? null : { id: actor, email: 'synthetic@example.invalid' } },
        error: null,
      }),
    },
    rpc: async (method: string) => {
      if (method === 'gridex_is_current_session_allowed') return { data: true, error: null }
      if (method === 'gridex_get_user_roles') return { data: roleRows(), error: null }
      expect(method).toBe('canonical_authenticated_tenant_context')
      const staff = auth.persona === 'staff'
      return {
        data: {
          authorized: true,
          user_id: actor,
          is_platform_admin: auth.persona === 'platform',
          selected_company_id: staff ? company : null,
          roles: staff ? ['company_admin'] : ['customer'],
          permissions: staff ? ['customers.read'] : [],
        },
        error: null,
      }
    },
  }
}

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@supabase/ssr', () => ({ createServerClient: authClient }))
vi.mock('@/lib/env/supabasePublic', () => ({ getSupabasePublicEnv: () => ({ url: origin, anonKey: 'synthetic' }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => authClient() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:32174', 'synthetic', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const url = new URL(request.url)
          expect(url.origin).toBe(origin)
          expect(url.pathname.startsWith(pathname)).toBe(true)
          const table = url.pathname.slice(pathname.length)
          auth.tables.push(table)
          const query = url.searchParams

          if (table === 'rpc/gridex_get_user_roles') {
            expect(await request.json()).toEqual({ p_user_id: actor })
            return Response.json(roleRows())
          }
          if (table === 'rpc/gridex_portal_monthly_consumption_v1') {
            expect(await request.json()).toMatchObject({ p_company_id: company, p_customer_ids: [customer] })
            return Response.json([])
          }
          expect(request.method).toBe('GET')
          if (table === 'company_memberships') {
            expect(query.get('user_id')).toBe('eq.' + actor)
            expect(query.get('status')).toBe('eq.active')
            if (auth.membershipUnavailable) {
              return Response.json({ code: 'XX000', message: backendDiagnostic }, { status: 500 })
            }
            return Response.json(auth.persona === 'staff'
              ? [{ company_id: company, membership_role: 'admin', status: 'active', companies: companyRow }]
              : [])
          }
          if (table === 'customer_portal_accounts') {
            expect(query.get('user_id')).toBe('eq.' + actor)
            expect(query.get('is_active')).toBe('eq.true')
            return Response.json([{ company_id: company, customer_id: customer, is_active: true }])
          }
          if (table === 'customers') {
            expect(query.get('id')).toBe('in.(' + customer + ')')
            return Response.json([{
              id: customer, company_id: company, full_name: 'Syntetisk kund',
              customer_number: 'E2E-4321', customer_type: 'private', status: 'active',
            }])
          }
          if (table === 'companies') {
            expect(query.get('id')).toBe('eq.' + company)
            return Response.json([companyRow])
          }
          expect([
            'customer_invoices', 'customer_sites', 'customer_contracts', 'powers_of_attorney',
            'customer_legal_acceptances', 'website_customer_applications',
          ]).toContain(table)
          expect(query.get('company_id')).toBe('eq.' + company)
          expect(query.get('customer_id')).toBe('in.(' + customer + ')')
          return Response.json([])
        },
      },
    }),
  }
})

function request(path: string) {
  return new NextRequest(new URL(path, origin))
}

async function adminRedirect() {
  try {
    await AdminLayout({ children: null })
  } catch (error) {
    if (isRedirectError(error)) return getURLFromRedirectError(error)
    throw error
  }
  throw new Error('Expected the customer to be denied access to administration')
}

async function renderDashboard() {
  const children = await DashboardPage()
  return renderToStaticMarkup(await DashboardLayout({ children }))
}

beforeEach(() => {
  auth.persona = 'customer'
  auth.membershipUnavailable = false
  auth.tables = []
})

describe('return path after denying a non-staff customer account administration access', () => {
  it('follows the admin entry and login proxy to the dashboard and the linked customer portal', async () => {
    expect((await proxy(request('/admin'))).headers.get('location')).toBeNull()
    const loginPath = await adminRedirect()
    expect(loginPath).toBe('/login')
    const login = await proxy(request(loginPath))
    expect(new URL(login.headers.get('location')!).pathname).toBe('/dashboard')

    const markup = await renderDashboard()
    expect(markup).toContain('Du har inte tillgång till administrationen')
    const link = markup.match(/href="(\/portal)"[^>]*>Till Mina sidor<\/a>/)?.[1]
    expect(link).toBe('/portal')
    expect(markup).not.toContain('href="/admin"')
    expect(markup).not.toContain('href="/admin/customers"')
    expect(auth.tables).not.toContain('customers')

    expect((await proxy(request(link!))).headers.get('location')).toBeNull()
    const portal = renderToStaticMarkup(await PortalLayout({ children: await PortalPage({}) }))
    expect(portal).toContain('Mina sidor')
    expect(portal).toContain('E2E-4321')
    expect(portal).not.toContain('href="/admin"')
  })

  it('preserves the dashboard login requirement for an anonymous session', async () => {
    auth.persona = 'anon'

    const response = await proxy(request('/dashboard'))
    const login = new URL(response.headers.get('location')!)
    expect(login.pathname).toBe('/login')
    expect(login.searchParams.get('next')).toBe('/dashboard')
    await expect(renderDashboard()).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(auth.tables).toEqual([])
  })

  it.each([['staff', 'Välkommen till Syntetiskt elbolag'], ['platform', 'Gridex Platform Operations']] as const)(
    'preserves the normal workspace for %s', async (persona, title) => {
      auth.persona = persona
      const markup = await renderDashboard()

      expect(markup).toContain(title)
      expect(markup).toContain('href="/admin"')
      expect(markup).not.toContain('Du har inte tillgång till administrationen')
      expect(auth.tables).not.toContain('customer_portal_accounts')
    },
  )

  it('reports a real membership lookup failure without showing staff links or diagnostics', async () => {
    auth.membershipUnavailable = true
    const markup = await renderDashboard()

    expect(markup).toContain('Arbetsytans åtkomst kunde inte kontrolleras')
    expect(markup).not.toContain(backendDiagnostic)
    expect(markup).not.toContain('Du har inte tillgång till administrationen')
    expect(markup).not.toContain('href="/admin"')
    expect(auth.tables).not.toContain('customer_portal_accounts')
  })
})
