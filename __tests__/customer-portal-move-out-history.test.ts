import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  companyId: 'd094a8d5-8851-4014-be49-b8a63b64370b',
  customerId: 'a646face-0292-4ebe-8f59-b33dfd042e12',
  transport: vi.fn<typeof fetch>(),
}))
const row = {
  id: 'cfc06472-7181-488e-8e8b-daed1233ffa4',
  customer_id: fixture.customerId,
  completion_type: 'move_out',
  status: 'submitted',
  created_at: '2026-11-25T10:00:00Z',
  updated_at: '2026-11-25T10:00:00Z',
}
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://portal-readback.example.invalid', 'synthetic-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fixture.transport },
  }) }
})
vi.mock('@/lib/customer-portal/db', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/db')>(),
  getCustomerPortalContext: async () => ({
    companyId: fixture.companyId, customerIds: [fixture.customerId],
    customers: [{ id: fixture.customerId, customer_number: 'P07' }],
  }),
  listPortalInfoRequests: async () => ({ requests: [], nextCursor: null, continued: false, unavailable: false }),
  listPortalSites: async () => [],
}))
vi.mock('@/app/portal/komplettera/actions', () => ({ submitPortalCompletionAction: vi.fn() }))

import PortalCompletionPage from '@/app/portal/komplettera/page'

beforeEach(() => { fixture.transport.mockReset() })

async function history(completion: Record<string, unknown>) {
  fixture.transport.mockImplementation(async (input) => {
    const url = new URL(String(input))
    expect(url.origin).toBe('https://portal-readback.example.invalid')
    expect(url.pathname).toBe('/rest/v1/customer_portal_completions')
    expect(url.searchParams.get('company_id')).toBe('eq.' + fixture.companyId)
    expect(url.searchParams.get('customer_id')).toBe('in.(' + fixture.customerId + ')')
    expect(url.searchParams.get('select')).toContain('submitted_payload')
    return Response.json([completion])
  })
  const html = renderToStaticMarkup(await PortalCompletionPage({}))
  expect(fixture.transport).toHaveBeenCalledOnce()
  return html
}

it('labels the saved submit receipt as a move-out request with its exact desired civil date', async () => {
  const html = await history({ ...row, submitted_payload: {
    requested_move_out_date: '2026-11-30',
    facility_reference: 'internal-facility-fixture',
    customer_contract_reference: 'private-contract-fixture',
    reason: 'raw private fixture reason',
  } })
  expect(html).toContain('Utflyttningsanmälan')
  expect(html).toContain('Önskat utflyttningsdatum')
  expect(html).toContain('dateTime="2026-11-30"')
  expect(html).toContain('Inskickad')
  expect(html).not.toContain('internal-facility-fixture')
  expect(html).not.toContain('private-contract-fixture')
  expect(html).not.toContain('raw private fixture reason')
})

it.each([null, {}, { requested_move_out_date: null }, { requested_move_out_date: '2026-02-30' },
  { requested_move_out_date: '2026-11-30T23:00:00Z' }])('shows legacy move-out requests with %j without inferring a date', async (submitted_payload) => {
  const html = await history({ ...row, submitted_payload })
  expect(html).toContain('Utflyttningsanmälan')
  expect(html).toContain('Inskickad')
  expect(html).not.toContain('Önskat utflyttningsdatum')
  expect(html).not.toContain('2026-02-30')
})

it('keeps a non-move-out completion unchanged even if the payload includes a move-out date', async () => {
  const html = await history({ ...row, completion_type: 'contact_update', submitted_payload: {
    requested_move_out_date: '2026-11-30',
  } })
  expect(html).toContain('Kontaktuppgift')
  expect(html).not.toContain('Utflyttningsanmälan')
  expect(html).not.toContain('Önskat utflyttningsdatum')
})
