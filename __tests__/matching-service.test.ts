import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabaseCall, type Row } from './helpers/supabaseMock'

const state: { tables: Record<string, Row[]>; calls: FakeSupabaseCall[] } = { tables: {}, calls: [] }

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const fake = createFakeSupabase({ tables: state.tables })
      const builder = fake.client.from(table)
      state.calls.push(...fake.calls)
      return builder
    },
  },
}))

import {
  matchCustomerIdentity,
  normalizeIdentityDigits,
  normalizeMatchEmail,
  normalizeMatchPhone,
} from '@/lib/customers/matchingService'

function customer(overrides: Partial<Row> = {}): Row {
  return {
    id: `customer-${Math.random().toString(36).slice(2, 8)}`,
    company_id: 'company-1',
    customer_number: 'K-1001',
    email: 'anna@example.com',
    normalized_email: 'anna@example.com',
    personal_number: '19900101-1234',
    normalized_personal_number: '199001011234',
    org_number: null,
    normalized_org_number: null,
    phone: '+46701234567',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  state.tables = { customers: [] }
  state.calls = []
})

describe('identity normalization', () => {
  it('normalizes personal/org numbers to digits only', () => {
    expect(normalizeIdentityDigits('19900101-1234')).toBe('199001011234')
    expect(normalizeIdentityDigits('556677-8899')).toBe('5566778899')
    expect(normalizeIdentityDigits('')).toBeNull()
    expect(normalizeIdentityDigits(null)).toBeNull()
  })

  it('normalizes emails to trimmed lowercase', () => {
    expect(normalizeMatchEmail('  Anna@Example.COM ')).toBe('anna@example.com')
    expect(normalizeMatchEmail('   ')).toBeNull()
  })

  it('normalizes Swedish phone numbers to E.164', () => {
    expect(normalizeMatchPhone('070-123 45 67')).toBe('+46701234567')
    expect(normalizeMatchPhone('0046701234567')).toBe('+46701234567')
    expect(normalizeMatchPhone('+46701234567')).toBe('+46701234567')
    expect(normalizeMatchPhone('123')).toBeNull()
  })
})

describe('matchCustomerIdentity', () => {
  it('requires a tenant (companyId)', async () => {
    await expect(matchCustomerIdentity({ companyId: '' })).rejects.toThrow(/companyId/)
  })

  it('matches a private customer on normalized personal number', async () => {
    const existing = customer({ id: 'customer-a' })
    state.tables.customers = [existing]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      personalNumber: '19900101-1234',
      email: 'other@example.com',
    })

    expect(decision.outcome).toBe('matched')
    expect(decision.customer?.id).toBe('customer-a')
    expect(decision.matchedBy).toBe('personal_number')
    expect(decision.needsReview).toBe(false)
    expect(decision.auditMetadata.matched_customer_id).toBe('customer-a')
  })

  it('matches a company customer on normalized org number', async () => {
    state.tables.customers = [
      customer({
        id: 'customer-org',
        personal_number: null,
        normalized_personal_number: null,
        org_number: '556677-8899',
        normalized_org_number: '5566778899',
      }),
    ]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      orgNumber: '5566 77-8899',
    })

    expect(decision.outcome).toBe('matched')
    expect(decision.matchedBy).toBe('org_number')
    expect(decision.customer?.id).toBe('customer-org')
  })

  it('falls back to email when no strong identity matches', async () => {
    state.tables.customers = [
      customer({ id: 'customer-email', normalized_personal_number: '999999999999', personal_number: null }),
    ]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      personalNumber: '19851231-0000',
      email: 'Anna@Example.com',
    })

    expect(decision.outcome).toBe('matched')
    expect(decision.matchedBy).toBe('email')
    expect(decision.customer?.id).toBe('customer-email')
  })

  it('flags ambiguity (needs review) when a strong signal hits multiple customers', async () => {
    state.tables.customers = [
      customer({ id: 'customer-1a' }),
      customer({ id: 'customer-1b' }),
    ]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      personalNumber: '19900101-1234',
    })

    expect(decision.outcome).toBe('ambiguous')
    expect(decision.needsReview).toBe(true)
    expect(decision.customer).toBeNull()
    expect(decision.candidates.length).toBe(2)
    expect(decision.auditMetadata.candidate_customer_ids).toHaveLength(2)
  })

  it('never auto-matches on phone alone (weak signal)', async () => {
    state.tables.customers = [
      customer({
        id: 'customer-phone',
        normalized_personal_number: null,
        personal_number: null,
        normalized_email: null,
        email: null,
      }),
    ]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      phone: '+46701234567',
    })

    expect(decision.outcome).toBe('no_match')
    expect(decision.customer).toBeNull()
    expect(decision.candidates.map((candidate) => candidate.customer.id)).toContain('customer-phone')
  })

  it('never matches across tenants', async () => {
    state.tables.customers = [customer({ id: 'other-tenant', company_id: 'company-2' })]

    const decision = await matchCustomerIdentity({
      companyId: 'company-1',
      personalNumber: '19900101-1234',
      email: 'anna@example.com',
    })

    expect(decision.outcome).toBe('no_match')
    expect(decision.candidates).toHaveLength(0)

    // Every customers query must be tenant-scoped.
    const customerSelects = state.calls.filter((call) => call.table === 'customers')
    expect(customerSelects.length).toBeGreaterThan(0)
    for (const call of customerSelects) {
      expect(call.filters.some((filter) => filter.method === 'eq' && filter.column === 'company_id' && filter.value === 'company-1')).toBe(true)
    }
  })
})
