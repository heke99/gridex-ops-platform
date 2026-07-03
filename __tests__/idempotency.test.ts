import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const state: { tables: Record<string, Row[]> } = { tables: {} }

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const fake = createFakeSupabase({ tables: state.tables })
      return fake.client.from(table)
    },
  },
}))

import {
  computePayloadHash,
  getOrCreateCustomerApplicationIntake,
} from '@/lib/intakes/customerApplicationIntakes'

beforeEach(() => {
  state.tables = { customer_application_intakes: [] }
})

describe('computePayloadHash', () => {
  it('is deterministic for identical payloads', () => {
    const payload = { customerType: 'private', email: 'anna@example.com', quantity: 1 }
    expect(computePayloadHash(payload)).toBe(computePayloadHash({ ...payload }))
    expect(computePayloadHash(payload)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different payloads', () => {
    expect(computePayloadHash({ email: 'anna@example.com' })).not.toBe(computePayloadHash({ email: 'bo@example.com' }))
  })

  it('treats null and undefined payloads identically', () => {
    expect(computePayloadHash(null)).toBe(computePayloadHash(undefined))
  })
})

describe('getOrCreateCustomerApplicationIntake', () => {
  const baseInput = {
    companyId: 'company-1',
    apiClientId: null,
    route: 'admin/customers/intake',
    method: 'POST',
    idempotencyKey: 'customer_create:company-1:abc123',
  }

  it('creates a new intake on first call', async () => {
    const { intake, created } = await getOrCreateCustomerApplicationIntake({
      ...baseInput,
      payload: { email: 'anna@example.com' },
    })

    expect(created).toBe(true)
    expect(intake).toBeTruthy()
    expect(intake?.stage).toBe('received')
    expect(state.tables.customer_application_intakes).toHaveLength(1)
  })

  it('returns the existing intake on replay with the same payload (no duplicate)', async () => {
    const payload = { email: 'anna@example.com' }
    const first = await getOrCreateCustomerApplicationIntake({ ...baseInput, payload })
    const second = await getOrCreateCustomerApplicationIntake({ ...baseInput, payload })

    expect(second.created).toBe(false)
    expect(second.intake?.id).toBe(first.intake?.id)
    expect(state.tables.customer_application_intakes).toHaveLength(1)
  })

  it('rejects reuse of the same idempotency key with a different payload', async () => {
    await getOrCreateCustomerApplicationIntake({ ...baseInput, payload: { email: 'anna@example.com' } })

    await expect(
      getOrCreateCustomerApplicationIntake({ ...baseInput, payload: { email: 'bo@example.com' } })
    ).rejects.toMatchObject({ code: 'idempotent_failed' })
    expect(state.tables.customer_application_intakes).toHaveLength(1)
  })

  it('scopes idempotency to the tenant: same key in another tenant creates a new intake', async () => {
    await getOrCreateCustomerApplicationIntake({ ...baseInput, payload: { email: 'anna@example.com' } })
    const other = await getOrCreateCustomerApplicationIntake({
      ...baseInput,
      companyId: 'company-2',
      payload: { email: 'anna@example.com' },
    })

    expect(other.created).toBe(true)
    expect(state.tables.customer_application_intakes).toHaveLength(2)
  })

  it('treats different idempotency keys as separate intakes', async () => {
    await getOrCreateCustomerApplicationIntake({ ...baseInput, payload: { email: 'anna@example.com' } })
    const second = await getOrCreateCustomerApplicationIntake({
      ...baseInput,
      idempotencyKey: 'customer_create:company-1:def456',
      payload: { email: 'anna@example.com', siteName: 'Sommarstugan' },
    })

    expect(second.created).toBe(true)
    expect(state.tables.customer_application_intakes).toHaveLength(2)
  })
})
