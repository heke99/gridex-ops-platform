import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn(async () => ({ client: {}, actorUserId: 'actor', startedAt: 1 })) }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ get SUPABASE_SERVICE_URL() { return process.env.NEXT_PUBLIC_SUPABASE_URL } }))
import { withStaffApi } from '@/lib/staff-api/http'
import { requireStaffApiContext } from '@/lib/staff-api/context'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
const PROD = 'ayiuxjlfazkjmmtlvhsl'
const DEV = 'piidsfebjqjmnepdpnas'
const options = { scopes: ['staff_cases.write'], permission: 'cases.write' } as const
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${DEV}.supabase.co`) })
describe('staff API requested storage project boundary', () => {
  it.each(['GET', 'POST', 'PATCH'])('refuses a Prod request on a Dev backend before auth, handler or audit writes (%s)', async method => {
    const handler = vi.fn(async () => Response.json({ data: 'wrong project' }))
    const response = await withStaffApi(new NextRequest('https://app.gridex.se/api/v1/staff/cases', { method, headers: { 'x-gridex-expected-project-ref': PROD } }), options, handler)
    expect(response.status).toBe(412); expect((await response.json()).error.code).toBe('storage_project_mismatch')
    expect(requireStaffApiContext).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled(); expect(logIntegrationApiRequest).not.toHaveBeenCalled()
  })
  it('permits the exact requested backend after ordinary API/RBAC authorization and attests JSON or file responses', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${PROD}.supabase.co`)
    const handler = vi.fn(async () => new Response('%PDF-', { headers: { 'content-type': 'application/pdf' } }))
    const response = await withStaffApi(new NextRequest('https://app.gridex.se/api/v1/staff/cases', { headers: { 'x-gridex-expected-project-ref': PROD } }), options, handler)
    expect(response.status).toBe(200); expect(response.headers.get('x-gridex-project-ref')).toBe(PROD)
    expect(requireStaffApiContext).toHaveBeenCalledOnce(); expect(handler).toHaveBeenCalledOnce(); expect(logIntegrationApiRequest).toHaveBeenCalledOnce()
  })
  it('preserves legacy callers without a requested project and rejects malformed selectors', async () => {
    const handler = vi.fn(async () => Response.json({ data: [] }))
    expect((await withStaffApi(new NextRequest('https://app.gridex.se/api/v1/staff/cases'), options, handler)).status).toBe(200)
    vi.clearAllMocks()
    expect((await withStaffApi(new NextRequest('https://app.gridex.se/api/v1/staff/cases', { headers: { 'x-gridex-expected-project-ref': 'https://attacker.invalid' } }), options, handler)).status).toBe(412)
    expect(handler).not.toHaveBeenCalled(); expect(logIntegrationApiRequest).not.toHaveBeenCalled()
  })
})
