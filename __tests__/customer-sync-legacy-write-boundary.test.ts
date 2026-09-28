import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (['customer_contracts', 'website_customer_applications'].includes(table)) return {
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }) }) }) }) }),
      }
      if (table === 'customers') return {
        select: () => ({ eq: () => ({ eq: () => ({
          maybeSingle: async () => ({ data: { metadata: {} }, error: null }),
        }) }) }),
        update: (payload: Record<string, unknown>) => ({ eq: () => ({ eq: () => ({ select: () => ({
          maybeSingle: async () => {
            fixture.updates.push(payload)
            return { data: { id: 'synthetic-customer' }, error: null }
          },
        }) }) }) }),
      }
      throw new Error(`Unexpected table ${table}`)
    },
  },
}))

import { syncTenantCustomerRecords } from '@/lib/customer-portal/tenantSync'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'

describe('open machine sync transaction gap', () => {
  it('persists a profile change before a later legal validation failure', async () => {
    fixture.updates.length = 0
    await expect(syncTenantCustomerRecords({
      client: { id: 'synthetic-client', company_id: 'synthetic-tenant' } as IntegrationApiClient,
      identity: {
        customer_id: 'synthetic-customer', customer_number: 'SYN-1001',
        external_customer_id: null,
      } as LinkedPortalIdentity,
      payload: {
        customer_number: 'SYN-1001', profile: { first_name: 'Synthetic' },
        legal_acceptances: [{
          document_reference: 'synthetic-document-001', document_code: 'terms',
          document_version: '1', document_hash: 'a'.repeat(64), accepted: true,
          accepted_at: '2026-09-29T00:00:00Z',
        }],
      },
    })).rejects.toThrow('LEGAL_BUNDLE_NOT_RESOLVED')
    expect(fixture.updates).toMatchObject([{ first_name: 'Synthetic' }])
  })
})
