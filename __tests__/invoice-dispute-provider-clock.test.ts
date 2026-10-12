import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ row: {} as Record<string, unknown>, race: false, alwaysRace: false, providerCalls: 0, saved: 0 }))
vi.mock('@/lib/admin/apiGuards', async original => ({ ...await original<typeof import('@/lib/admin/apiGuards')>(), requireAdminApiAccess: async () => ({ guard: { userId: 'actor', companyId: 'company' } }) }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async (_actor: string, company: string) => company, requireOperationalCompanyId: async () => 'company' }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ createCapwayApticClient: async () => ({ dispute: async () => { m.providerCalls++; return { accepted: true } } }) }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  if (table !== 'invoice_export_items') throw new Error('Unexpected table')
  const filters: Array<[string, unknown]> = []; let patch: Record<string, unknown> | null = null
  const read = async () => {
    if (patch && (m.race || m.alwaysRace)) { m.race = false; m.row.provider_status = 'credited'; m.row.status_payload = { last_provider_event_occurred_at: '2026-10-12T15:00:00Z', credit: 'signed-new-event' }; m.row.updated_at = '2026-10-12T15:00:00Z' }
    const matches = filters.every(([key, value]) => key === 'status_payload' && typeof value === 'string' ? JSON.stringify(m.row[key]) === value : (m.row[key] ?? null) === value)
    if (!matches || (patch && m.alwaysRace)) return { data: null, error: null }
    if (patch) { Object.assign(m.row, patch); m.saved++ }
    return { data: structuredClone(m.row), error: null }
  }
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q }, is: (key: string, value: unknown) => { filters.push([key, value]); return q }, update: (value: Record<string, unknown>) => { patch = value; return q }, single: read, maybeSingle: read }
  return q
} } }))
import { POST } from '@/app/api/internal/invoices/[id]/dispute/route'
import { emitDomainEvent } from '@/lib/events/domainEvents'
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); m.race = false; m.alwaysRace = false; m.providerCalls = 0; m.saved = 0; m.row = { id: 'invoice', company_id: 'company', environment: 'test', provider_invoice_guid: 'guid', provider_status: 'unpaid', status_payload: { last_provider_event_occurred_at: '2026-10-12T14:00:00Z', source: 'signed-event' }, updated_at: '2026-10-12T14:00:00Z' } })
const submit = () => POST(new Request('https://example.invalid/dispute', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: 'invoice' }) })
describe('Disputes preserve the signed provider event clock', () => {
  it('merges the dispute receipt without deleting provider ordering evidence', async () => {
    expect((await submit()).status).toBe(200)
    expect(m.row.status_payload).toEqual({ last_provider_event_occurred_at: '2026-10-12T14:00:00Z', source: 'signed-event', dispute: { accepted: true } })
    expect(m.providerCalls).toBe(1); expect(m.saved).toBe(1)
  })
  it('rereads a concurrent credit and retains its terminal state and newer clock', async () => {
    m.race = true; expect((await submit()).status).toBe(200)
    expect(m.row.provider_status).toBe('credited')
    expect(m.row.status_payload).toMatchObject({ last_provider_event_occurred_at: '2026-10-12T15:00:00Z', credit: 'signed-new-event', dispute: { accepted: true } })
    expect(m.providerCalls).toBe(1); expect(m.saved).toBe(1)
  })
  it('reports an uncertain local receipt after provider success and never repeats the provider action inside retries', async () => {
    m.alwaysRace = true; const response = await submit()
    expect(response.status).toBe(503); expect((await response.json()).code).toBe('invoice_dispute_completion_uncertain')
    expect(m.providerCalls).toBe(1); expect(m.saved).toBe(0); expect(emitDomainEvent).not.toHaveBeenCalled()
  })
})
