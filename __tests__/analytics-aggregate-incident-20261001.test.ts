import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  writes: [] as Array<Record<string, unknown>>,
  reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  issues: [] as Array<{ issue_type: string; severity: string; status: string }>,
  error: null as null | { message: string },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Record<string, unknown> = {}
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query },
    then: (done: (value: unknown) => unknown) => {
      db.reads.push({ table, filters })
      return Promise.resolve({ data: db.issues, error: db.error }).then(done)
    },
    upsert: async (payload: Record<string, unknown>, options: { onConflict: string }) => {
      expect(table).toBe('dashboard_alerts')
      expect(options.onConflict).toBe('company_id,alert_type,entity_type,entity_id,status')
      db.writes.push(payload)
      return { error: db.error }
    },
  }
  return query
} } }))
import { createDashboardAlert, refreshDashboardAlerts } from '@/lib/analytics/alerts'

const companyA = '00000000-0000-4000-8000-000000000001'
const companyB = '00000000-0000-4000-8000-000000000002'
describe('actual aggregate alert adapter and tenant-scoped refresh', () => {
  beforeEach(() => { db.writes = []; db.reads = []; db.issues = []; db.error = null })

  it('gives repeated company aggregates a complete stable conflict identity', async () => {
    for (const title of ['First observation', 'Second observation']) {
      await createDashboardAlert({ companyId: companyA, alertType: 'data_quality', title })
    }
    expect(db.writes).toEqual([
      expect.objectContaining({ entity_type: 'company_aggregate', entity_id: companyA, status: 'open', title: 'First observation' }),
      expect.objectContaining({ entity_type: 'company_aggregate', entity_id: companyA, status: 'open', title: 'Second observation' }),
    ])
  })

  it('keeps explicit entity identities and partial explicit identities unchanged', async () => {
    await createDashboardAlert({ companyId: companyA, alertType: 'data_quality', title: 'Customer', entityType: 'customer', entityId: companyB })
    await createDashboardAlert({ companyId: companyA, alertType: 'data_quality', title: 'Entity group', entityType: 'customer' })
    await createDashboardAlert({ companyId: companyA, alertType: 'data_quality', title: 'Legacy identity', entityId: companyB })
    expect(db.writes.map(row => [row.entity_type, row.entity_id])).toEqual([['customer', companyB], ['customer', null], [null, companyB]])
  })

  it('refreshes only the requested tenant and updates the same aggregate identity', async () => {
    db.issues = [{ issue_type: 'failed_ediel_message', severity: 'critical', status: 'open' }]
    await refreshDashboardAlerts(companyA)
    db.issues.push({ issue_type: 'failed_ediel_message', severity: 'warning', status: 'open' })
    await refreshDashboardAlerts(companyA)
    expect(db.reads).toEqual(Array.from({ length: 2 }, () => ({ table: 'data_quality_issues', filters: { company_id: companyA, status: 'open' } })))
    expect(db.writes).toEqual([
      expect.objectContaining({ company_id: companyA, entity_type: 'company_aggregate', entity_id: companyA, severity: 'critical', title: '1 Ediel-meddelanden har misslyckats' }),
      expect.objectContaining({ company_id: companyA, entity_type: 'company_aggregate', entity_id: companyA, severity: 'critical', title: '2 Ediel-meddelanden har misslyckats' }),
    ])
  })

  it('does not turn a real write failure into a successful alert', async () => {
    db.error = { message: 'permission denied' }
    await expect(createDashboardAlert({ companyId: companyA, alertType: 'data_quality', title: 'Incident' })).rejects.toEqual(db.error)
  })
})
