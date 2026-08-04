import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  usageInsert: vi.fn(),
  failureInsert: vi.fn(),
  auditInsert: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: mocks.from,
  },
}))

import {
  logAdminActionAndUsage,
  logUsageEvent,
} from '@/lib/audit/actionLogger'
import { integrationWriteRequestHash } from '@/lib/integrations/writeIdempotency'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.usageInsert.mockResolvedValue({ error: null })
  mocks.failureInsert.mockResolvedValue({ error: null })
  mocks.auditInsert.mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table: string) => {
    if (table === 'platform_usage_events') {
      return { insert: mocks.usageInsert }
    }
    if (table === 'platform_usage_event_failures') {
      return { insert: mocks.failureInsert }
    }
    if (table === 'audit_logs') {
      return { insert: mocks.auditInsert }
    }
    throw new Error(`Unexpected table in test: ${table}`)
  })
})

describe('platform usage telemetry boundary', () => {
  it('accepts stable text resource references without owning business success', async () => {
    const result = await logUsageEvent({
      companyId: 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca',
      apiClientId: 'bf2f3755-4a84-446a-b361-b6aa7149c39a',
      entityType: 'website_contract_quote',
      entityId: 'quote_fatqD8HXi1TmCEAxbTzEQ-rH',
      eventKey: 'api.website_quote.created',
      source: 'website_api',
      billable: true,
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.usageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'website_contract_quote',
        entity_id: 'quote_fatqD8HXi1TmCEAxbTzEQ-rH',
      }),
    )
  })

  it('queues a telemetry failure and never throws after a committed operation', async () => {
    mocks.usageInsert.mockResolvedValue({
      error: {
        code: '22P02',
        message: 'invalid input syntax for type uuid',
      },
    })

    await expect(
      logUsageEvent({
        companyId: 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca',
        entityType: 'website_contract_quote',
        entityId: 'quote_reference',
        eventKey: 'api.website_quote.created',
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: '22P02',
    })

    expect(mocks.failureInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: 'quote_reference',
        database_code: '22P02',
      }),
    )
  })

  it('keeps the legal audit log fail-closed', async () => {
    mocks.auditInsert.mockResolvedValue({
      error: { code: '23514', message: 'audit invariant failed' },
    })

    await expect(
      logAdminActionAndUsage({
        actorUserId: '6c39fe9e-377d-4d57-8ae5-43902b09c311',
        entityType: 'contract',
        entityId: 'contract_reference',
        action: 'contract.updated',
      }),
    ).rejects.toMatchObject({ code: '23514' })

    expect(mocks.usageInsert).not.toHaveBeenCalled()
  })
})

describe('integration write request hashing', () => {
  it('is deterministic across object key order', () => {
    expect(
      integrationWriteRequestHash({
        offer_reference: 'offer_1',
        site_count: 1,
        selected_component_references: ['component_a'],
      }),
    ).toBe(
      integrationWriteRequestHash({
        selected_component_references: ['component_a'],
        site_count: 1,
        offer_reference: 'offer_1',
      }),
    )
  })

  it('changes when a commercial quote selection changes', () => {
    const first = integrationWriteRequestHash({
      offer_reference: 'offer_1',
      invoice_delivery_method: 'email',
    })
    const second = integrationWriteRequestHash({
      offer_reference: 'offer_1',
      invoice_delivery_method: 'paper',
    })

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})
