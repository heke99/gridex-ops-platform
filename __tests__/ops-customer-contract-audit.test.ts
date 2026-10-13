import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { publicPortalContract, publicPortalInvoice, publicPortalMeteringValue } from '@/lib/customer-portal/publicDto'
import { publicReference } from '@/lib/integrations/publicReferences'
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: vi.fn(), tenantInsert: vi.fn() }))
const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')
const company = '00000000-0000-4000-8000-000000000001'
const customer = '00000000-0000-4000-8000-000000000002'
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const provider = { id: 'synthetic', company_id: company, kind: 'tenant_key' as const, display_name: 'synthetic', issuer: 'synthetic-issuer', audience: 'synthetic-audience', jwks_uri: null, public_jwk: keys.publicKey.export({ format: 'jwk' }), subject_claim: 'sub', enforcement: 'enforce' as const }
const now = Math.floor(Date.now() / 1000)
function signed(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: provider.issuer, aud: provider.audience, sub: customer, jti: 'synthetic-jti-1234', ...claims })).toString('base64url')
  return `${header}.${body}.${sign('sha256', Buffer.from(`${header}.${body}`), keys.privateKey).toString('base64url')}`
}
describe('OPS customer contract audit direct repro', () => {
  it.each([
    ['missing iat', { exp: now + 900 }],
    ['future iat hidden by nbf', { iat: now + 86400, nbf: now, exp: now + 87300 }],
  ])('rejects signed assertion with %s', async (_label, claims) => {
    const { gateCustomerAssertion } = await import('@/lib/customer-portal/customerAssertion')
    const result = await gateCustomerAssertion({ token: signed(claims), provider, expectedSubject: customer, companyId: company, clientId: 'synthetic' })
    expect(result.allowed).toBe(false)
  })
  it('preserves unknown monetary and energy amounts as null', () => {
    expect(publicPortalInvoice(company, { id: customer, total_kwh: null, amount_inc_vat: null })).toMatchObject({ total_kwh: null, amount_inc_vat: null })
    expect(publicPortalMeteringValue(company, { id: customer, quantity_kwh: null }).quantity_kwh).toBeNull()
  })
  it('uses the existing spot markup when the canonical markup is null', () => {
    expect(publicPortalContract(company, { id: customer, markup_ore_per_kwh: null, spot_markup_ore_per_kwh: 8.5 }).markup_ore_per_kwh).toBe(8.5)
  })
  it.each(['2026-10-02.3', '2026-10-04.1', '2026-10-09.1'])('records runtime support detail strict-schema compatibility for %s', async (revision) => {
    const { customerPortalJson } = await import('@/lib/customer-portal/externalApi')
    const document = JSON.parse(readFileSync(`docs/openapi/releases/${revision}/customer-portal-v1.json`, 'utf8'))
    const response = customerPortalJson({ data: { case_reference: publicReference('support_case', company, customer), title: 'synthetic', description: null, status: 'received', channel: 'customer_portal', created_at: '2026-10-12T12:00:00Z', updated_at: '2026-10-12T12:00:00Z', resolved_at: null, messages: [] } })
    const errors = validateResponse(document, '/api/v1/customer/support/cases/{reference}', await response.json())
    if (revision === '2026-10-09.1') expect(errors).toEqual([])
    else expect(errors).toContainEqual(expect.stringContaining('contract_schema_version'))
    if (revision === '2026-10-02.3') expect(errors).toContainEqual(expect.stringContaining('messages'))
  })
})
