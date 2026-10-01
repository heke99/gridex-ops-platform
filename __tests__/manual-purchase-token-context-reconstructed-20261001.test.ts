import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { clearCapwayTokenCache, getCapwayAccessToken } from '@/lib/integrations/billing/capway/auth'
import type { CapwayConnectionConfig } from '@/lib/integrations/billing/capway/types'

const base: CapwayConnectionConfig = { companyId: 'synthetic-company', environment: 'test', provider: 'capway_aptic',
  baseUrl: 'https://original-api.invalid', authMode: 'oauth2', tokenUrl: 'https://original-realm.invalid/token',
  clientId: 'synthetic-client', clientSecret: 'synthetic-original-secret', defaultService: 'Invoicing', defaultFinancingMode: 'invoice_service',
  rawSettings: { scope: 'original-scope', audience: 'original-audience' } }
const transport = vi.fn<typeof fetch>()
beforeEach(() => {
  clearCapwayTokenCache(); transport.mockReset()
  transport.mockImplementation(async () => new Response(JSON.stringify({ access_token: 'token-'+transport.mock.calls.length, expires_in: 3300 }), { status: 200 }))
  vi.stubGlobal('fetch', transport)
})
afterEach(() => { clearCapwayTokenCache(); vi.unstubAllGlobals() })
it.each([
  ['realm', { tokenUrl: 'https://changed-realm.invalid/token' }], ['client', { clientId: 'changed-client' }],
  ['credential', { clientSecret: 'synthetic-changed-secret' }],
  ['scope', { rawSettings: { scope: 'changed-scope', audience: 'original-audience' } }],
  ['audience', { rawSettings: { scope: 'original-scope', audience: 'changed-audience' } }],
  ['grant', { rawSettings: { scope: 'original-scope', audience: 'original-audience', grant_type: 'changed-grant' } }],
  ['endpoint', { baseUrl: 'https://changed-api.invalid' }],
] as const)('does not reuse another %s configuration token for the same company/environment', async (_name, changes) => {
  expect(await getCapwayAccessToken(base)).toBe('token-1')
  expect(await getCapwayAccessToken({ ...base, ...changes })).toBe('token-2')
  expect(transport).toHaveBeenCalledTimes(2)
})
it('the exact same context retains the established token cache behavior', async () => {
  expect(await getCapwayAccessToken(base)).toBe('token-1')
  expect(await getCapwayAccessToken(structuredClone(base))).toBe('token-1')
  expect(transport).toHaveBeenCalledTimes(1)
})
it('company cache invalidation clears every configuration for that company', async () => {
  await getCapwayAccessToken(base); await getCapwayAccessToken({ ...base, clientId: 'changed-client' })
  clearCapwayTokenCache(base.companyId)
  expect(await getCapwayAccessToken(base)).toBe('token-3')
})
