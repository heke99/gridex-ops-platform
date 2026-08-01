import { describe, expect, it } from 'vitest'
import {
  assertTenantContextCompany,
  bindPayloadToTenant,
  createTenantContext,
  TenantContextError,
} from '@/lib/tenant/context'

function context(companyId = 'company-a') {
  return createTenantContext({
    companyId,
    actorType: 'integration',
    actorId: 'client-a',
    scopes: ['customer.write', 'customer.read', 'customer.write'],
    sourceChannel: 'partner_api',
    correlationId: 'correlation-a',
  })
}

describe('canonical tenant context', () => {
  it('normalizes and freezes trusted context values', () => {
    const current = context()
    expect(current.companyId).toBe('company-a')
    expect(current.scopes).toEqual(['customer.read', 'customer.write'])
    expect(Object.isFrozen(current)).toBe(true)
  })

  it('rejects a cross-tenant relation before domain work begins', () => {
    expect(() => assertTenantContextCompany(context('company-a'), 'company-b'))
      .toThrowError(expect.objectContaining<Partial<TenantContextError>>({
        code: 'TENANT_CONTEXT_MISMATCH',
        status: 403,
      }))
  })

  it('accepts a matching compatibility claim and strips all tenant keys', () => {
    const bound = bindPayloadToTenant(context('company-a'), {
      company_id: 'company-a',
      companyId: 'company-a',
      tenant_id: 'company-a',
      tenantId: 'company-a',
      customer: { name: 'A' },
    })
    expect(bound).toEqual({ customer: { name: 'A' } })
  })

  it('never lets a client select another tenant', () => {
    expect(() => bindPayloadToTenant(context('company-a'), {
      company_id: 'company-b',
      customer: { name: 'B' },
    })).toThrowError(expect.objectContaining<Partial<TenantContextError>>({
      code: 'TENANT_CONTEXT_MISMATCH',
    }))
  })
})
