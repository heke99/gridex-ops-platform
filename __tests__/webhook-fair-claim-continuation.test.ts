import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>, unavailable: false, legacyReads: 0,
}))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({
  allowed: false, reason_code: 'synthetic_tenant_paused', company_status: 'paused',
}) }))
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantReference: vi.fn() }))
vi.mock('@/lib/integrations/publicWebhookTransport', () => ({ postPublicWebhook: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async () => {
    if (fixture.unavailable) return { data: null, error: { code: 'PGRST202', message: 'synthetic missing fair claim' } }
    // The database contract is exercised against PostgreSQL by the native
    // fixture. These literal IDs isolate the dispatch adapter regression.
    const chosen = fixture.rows.filter(row => ['noisy-0', 'quiet-0', 'noisy-1', 'noisy-2'].includes(String(row.id)))
    for (const row of chosen) Object.assign(row, { status: 'processing', locked_by: 'synthetic-batch' })
    return { data: chosen.map(row => ({ ...row })), error: null }
  },
  from: () => {
    let kind = 'read', patch = {}, fields = '*', take = Infinity
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const execute = () => {
      let rows = fixture.rows.filter(row => filters.every(filter => filter(row)))
      if (kind === 'read') {
        fixture.legacyReads += 1
        rows = rows.sort((a, b) => String(a.next_attempt_at).localeCompare(String(b.next_attempt_at))).slice(0, take)
      } else for (const row of rows) Object.assign(row, patch)
      return { data: rows.map(row => fields === 'id' ? { id: row.id } : { ...row }), error: null }
    }
    const query = {
      select(value: string) { fields = value; return query },
      update(value: Record<string, unknown>) { kind = 'update'; patch = value; return query },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
      lt(key: string, value: string) { filters.push(row => typeof row[key] === 'string' && String(row[key]) < value); return query },
      lte(key: string, value: string) { filters.push(row => typeof row[key] === 'string' && String(row[key]) <= value); return query },
      order() { return query }, limit(value: number) { take = value; return query },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null } },
      then(resolve: (value: ReturnType<typeof execute>) => unknown) { return Promise.resolve(execute()).then(resolve) },
    }
    return query
  },
} }))

import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'

describe('webhook tenant-fair claim adapter', () => {
  beforeEach(() => {
    fixture.unavailable = false; fixture.legacyReads = 0
    fixture.rows = [0, 1, 2, 3, 4, 5].map(i => ({ id: `noisy-${i}`, company_id: 'noisy', status: 'queued',
      next_attempt_at: '2020-01-01T00:00:00Z', attempts: 0, max_attempts: 8, locked_by: null }))
    fixture.rows.push({ id: 'quiet-0', company_id: 'quiet', status: 'queued', next_attempt_at: '2020-01-02T00:00:00Z',
      attempts: 0, max_attempts: 8, locked_by: null })
  })

  it('a noisy old backlog does not prevent the quiet tenant from reaching its current tenant-state decision', async () => {
    await dispatchDueWebhookDeliveries(4)
    expect(fixture.rows.find(row => row.id === 'quiet-0')?.status).toBe('blocked_tenant_state')
    expect(fixture.rows.filter(row => row.status === 'blocked_tenant_state')).toHaveLength(4)
    expect(fixture.rows.find(row => row.id === 'noisy-3')?.status).toBe('queued')
  })

  it('missing claim schema fails closed without using the globally ordered legacy queue', async () => {
    fixture.unavailable = true
    await expect(dispatchDueWebhookDeliveries(4)).rejects.toThrow('webhook_schema_not_ready')
    expect(fixture.rows.every(row => row.status === 'queued')).toBe(true)
    expect(fixture.legacyReads).toBe(0)
  })
})
