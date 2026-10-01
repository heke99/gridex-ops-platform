import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  after: vi.fn(), usage: vi.fn(), failure: vi.fn(), audit: vi.fn(), rows: [] as Array<{ table: string; row: Row }>,
}))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: f.after }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  return { insert: (row: Row) => {
    f.rows.push({ table, row: structuredClone(row) })
    if (table === 'platform_usage_events') return f.usage(row)
    if (table === 'platform_usage_event_failures') return f.failure(row)
    expect(table).toBe('audit_logs'); return f.audit(row)
  } }
} } }))
import { logUsageEvent, logAdminActionAndUsage, scheduleUsageEvent } from '@/lib/audit/actionLogger'
const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084'
const input = { companyId, apiClientId: clientId, entityType: 'website_contract_quote', entityId: 'quote_synthetic_stable_resource',
  eventKey: 'api.website_quote.created', source: 'website_api', billable: true, billingUnit: 'api_request', metadata: { result_count: 1 } }
const canaries = ['usage-diagnostic-canary@example.invalid', '+46 70 123 45 67', 'Usage Canary Fullname', 'Usage Canary Street 51',
  'capway_api_key_canary_usage_123456', 'sb_secret_canary_usage_123456']
const raw = canaries.join(' | ')
const absent = (value: unknown) => { for (const canary of canaries) expect(inspect(value, { depth: 14 })).not.toContain(canary) }
let log: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks(); f.rows = []
  f.usage.mockResolvedValue({ error: null }); f.failure.mockResolvedValue({ error: null }); f.audit.mockResolvedValue({ error: null })
  f.after.mockImplementation(() => undefined); log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => log.mockRestore())
describe('actual usage helper; primary result and secondary diagnostics', () => {
  it.each([{ name: 'returned SQL fault', thrown: false, code: '23505' }, { name: 'thrown transport fault', thrown: true, code: 'ECONNRESET' },
    { name: 'free provider code', thrown: false, code: raw }])('minimizes $name in actual console, failure insert and diagnostic result without changing the usage event', async ({ code, thrown }) => {
    const fault = { code, message: raw, details: raw, hint: raw }
    if (thrown) f.usage.mockRejectedValue(fault); else f.usage.mockResolvedValue({ error: fault })
    const result = await logUsageEvent(input)
    expect(result.ok).toBe(false); expect(log).toHaveBeenCalledOnce(); expect(f.failure).toHaveBeenCalledOnce()
    expect(f.rows[0]).toMatchObject({ table: 'platform_usage_events', row: { company_id: companyId, api_client_id: clientId, entity_id: input.entityId,
      event_key: input.eventKey, is_billable: true, billing_unit: 'api_request', metadata: input.metadata } })
    expect(f.rows[1]).toMatchObject({ table: 'platform_usage_event_failures', row: { company_id: companyId, api_client_id: clientId,
      entity_id: input.entityId, event_key: input.eventKey, event_payload: f.rows[0].row } })
    absent({ console: log.mock.calls, failurePayload: f.rows[1], result })
    const expectedCode = code === raw ? null : code
    const expectedMessage = code === '23505' ? 'database_error' : code === 'ECONNRESET' ? 'transport_error' : 'technical_error'
    expect(result).toEqual({ ok: false, errorCode: expectedCode, errorMessage: expectedMessage })
    expect(f.rows[1].row).toMatchObject({ database_code: expectedCode, database_message: expectedMessage })
    expect(log.mock.calls[0][1]).toMatchObject({ errorCode: expectedCode, error: expectedMessage })
  })
  it('handles a thrown free string with a constant secondary diagnostic and still never throws', async () => {
    f.usage.mockRejectedValue(raw)
    const result = await logUsageEvent(input)
    expect(result).toEqual({ ok: false, errorCode: null, errorMessage: 'technical_error' }); expect(f.failure).toHaveBeenCalledOnce(); absent({ console: log.mock.calls, failurePayload: f.rows[1], result })
  })
  it('preserves the primary failure even when the secondary failure queue throws', async () => {
    f.usage.mockResolvedValue({ error: { code: '22P02', message: raw } }); f.failure.mockRejectedValue({ code: '23514', message: raw })
    const result = await logUsageEvent(input)
    expect(result).toMatchObject({ ok: false, errorCode: '22P02' }); expect(log).toHaveBeenCalledOnce(); expect(f.failure).toHaveBeenCalledOnce()
    absent({ console: log.mock.calls, failurePayload: f.rows[1], result })
  })
  it('preserves genuine schema suppression and strict original SQLSTATE without a failure queue or console write', async () => {
    f.usage.mockResolvedValue({ error: { code: '42P01', message: 'relation missing' } })
    expect(await logUsageEvent(input)).toMatchObject({ ok: false, errorCode: '42P01' })
    expect(log).not.toHaveBeenCalled(); expect(f.failure).not.toHaveBeenCalled()
  })
  it('preserves stable text resource IDs, billing fields and successful exact usage payload', async () => {
    expect(await logUsageEvent(input)).toEqual({ ok: true }); expect(f.usage).toHaveBeenCalledOnce(); expect(f.failure).not.toHaveBeenCalled()
    expect(f.rows[0].row).toEqual({ company_id: companyId, actor_user_id: null, api_client_id: clientId, customer_id: null,
      entity_type: input.entityType, entity_id: input.entityId, event_key: input.eventKey, action_label: null, source: input.source,
      billable_quantity: 1, billing_unit: input.billingUnit, is_billable: true, metadata: input.metadata })
  })
  it('preserves fail-closed canonical audit error and never creates a secondary usage event after that audit failure', async () => {
    const fault = { code: '23514', message: 'original_canonical_audit_failure' }; f.audit.mockResolvedValue({ error: fault })
    await expect(logAdminActionAndUsage({ actorUserId: clientId, companyId, entityType: 'contract', entityId: input.entityId, action: 'contract.updated',
      oldValues: { revision: 2 }, newValues: { revision: 3 }, metadata: { original: true } })).rejects.toBe(fault)
    expect(f.usage).not.toHaveBeenCalled(); expect(f.failure).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
    expect(f.rows[0].row).toMatchObject({ old_values: { revision: 2 }, new_values: { revision: 3 }, metadata: { original: true } })
  })
  it('preserves actual deferred scheduling without pre-response persistence and original callback payload', async () => {
    await scheduleUsageEvent(input); expect(f.usage).not.toHaveBeenCalled(); expect(f.after).toHaveBeenCalledOnce()
    await f.after.mock.calls[0][0](); expect(f.usage).toHaveBeenCalledOnce(); expect(f.rows[0].row.metadata).toEqual(input.metadata)
  })
})
