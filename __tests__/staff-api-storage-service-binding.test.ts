import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROD = 'ayiuxjlfazkjmmtlvhsl'
const DEV = 'piidsfebjqjmnepdpnas'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-public-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('staff storage attestation binds the actual service SDK endpoint', () => {
  it.each([
    { captured: DEV, later: PROD },
    { captured: PROD, later: DEV },
  ])('keeps both SDK clients and attestation on $captured after env changes to $later', async ({ captured, later }) => {
    const capturedUrl = `https://${captured}.supabase.co`
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', capturedUrl)
    const fetcher = vi.fn<typeof fetch>(async () => new Response('[]', {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetcher)

    // Do not mock service.ts or @supabase/supabase-js: exercise the actual
    // captured settings and installed SDK transport with a local fake fetch.
    const { SUPABASE_SERVICE_URL, supabaseService, createSupabaseServiceRequestClient } = await import('@/lib/supabase/service')
    const { staffStorageProjectRef, assertStaffStorageTarget } = await import('@/lib/staff-api/storageTarget')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${later}.supabase.co`)

    expect(SUPABASE_SERVICE_URL).toBe(capturedUrl)
    expect(staffStorageProjectRef()).toBe(captured)
    expect(() => assertStaffStorageTarget(new Headers({ 'x-gridex-expected-project-ref': captured }))).not.toThrow()
    expect(() => assertStaffStorageTarget(new Headers({ 'x-gridex-expected-project-ref': later }))).toThrow(
      expect.objectContaining({ code: 'storage_project_mismatch', status: 412 }),
    )

    const first = await supabaseService.from('synthetic_storage_binding').select('id')
    const second = await createSupabaseServiceRequestClient({ requestId: 'synthetic-request' })
      .from('synthetic_storage_binding').select('id')
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const call of fetcher.mock.calls) {
      const url = new URL(String(call[0]))
      expect(url.origin).toBe(capturedUrl)
      expect(url.pathname).toBe('/rest/v1/synthetic_storage_binding')
    }
  })
})
