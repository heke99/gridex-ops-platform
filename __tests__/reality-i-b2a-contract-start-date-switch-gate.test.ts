// reality-defects: I-B2a
// I-B2a: a signed contract enqueues start_supplier_switch with payload.requested_start_date (the contract's requested
// start). The worker's readiness gate refused it with "Inflyttningsdatum saknas" because the site has no move_in_date,
// although the same worker then uses that payload date as the switch's requested start. The date in the job is the start.
// Component SDK ports as in supplier-switch-worker-bound-company.test.ts; real worker and preflight.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[],
  deny: false, rpcError: null as unknown, cookies: vi.fn(() => { throw Error('cookies outside request scope') }) }))
vi.mock('next/headers', () => ({ cookies: io.cookies }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  from: (table: string) => {
    let operation = 'select', payload: Record<string, unknown> | null = null
    const filters: ((r: Record<string, unknown>) => boolean)[] = []
    const run = () => {
      const rows = io.tables[table] ?? []
      const hit = rows.filter(r => filters.every(f => f(r)))
      if (operation !== 'select') {
        io.writes.push(table)
        if (operation === 'update') hit.forEach(r => Object.assign(r, payload))
        else { const r = { id: 'generated', ...payload }; rows.push(r); io.tables[table] = rows; return [r] }
      }
      return hit
    }
    const q: Record<string, unknown> = {}
    Object.assign(q, { select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q },
      in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return q },
      not: (c: string, op: string, v: unknown) => { filters.push(r => op !== 'is' || r[c] != v); return q },
      is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return q },
      update: (p: Record<string, unknown>) => { operation = 'update'; payload = p; return q },
      insert: (p: Record<string, unknown>) => { operation = 'insert'; payload = p; return q },
      upsert: (p: Record<string, unknown>) => { operation = 'upsert'; payload = p; return q },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok) })
    return q
  },
  rpc: async (name: string) => ({ data: name === 'gridex_get_user_roles' ? [] : name === 'gridex_actor_has_company_permission' ? !io.deny : null, error: io.rpcError }),
} }))
import { processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let job: JobRow
beforeEach(() => {
  vi.clearAllMocks(); io.writes = []; io.deny = false; io.rpcError = null
  job = { id: id(1), company_id: id(2), customer_id: id(3), customer_site_id: id(4), metering_point_id: id(5),
    job_type: 'start_supplier_switch', status: 'running', priority: 1, idempotency_key: 'own', payload: {}, result: {},
    attempts: 1, max_attempts: 3, run_after: new Date().toISOString(), locked_at: new Date().toISOString(),
    locked_by: 'own-worker', lock_token: id(6), last_error: null, created_by: id(7), operation_id: id(8) }
  const company = { id: id(2), status: 'active', is_active: true }
  io.tables = {
    customer_operation_jobs: [structuredClone(job)], companies: [company, { id: id(20), status: 'active', is_active: true }],
    company_memberships: [{ company_id: id(20), user_id: id(7), status: 'active', is_active: true, accepted_at: '2026-01-01', membership_role: 'owner', companies: { id: id(20), status: 'active' } },
      { company_id: id(2), user_id: id(7), status: 'active', is_active: true, accepted_at: '2026-01-01', companies: company }],
    user_profiles: [{ id: id(7), user_status: 'active' }],
    customers: [{ id: id(3), company_id: id(2), status: 'active' }],
    customer_sites: [{ id: id(4), company_id: id(2), customer_id: id(3), facility_id: '735123456789012345',
      move_in_date: '2027-01-01', grid_owner_id: id(9), grid_area_code: 'TES', price_area_code: 'SE3', current_supplier_unknown: true }],
    metering_points: [{ id: id(5), company_id: id(2), customer_id: id(3), site_id: id(4), status: 'active',
      meter_point_id: '735123456789012345', ediel_metering_point_id: '735123456789012345', grid_owner_id: id(9), grid_area_code: 'TES', price_area_code: 'SE3' }],
    powers_of_attorney: [{ id: id(10), company_id: id(2), customer_id: id(3), site_id: id(4), scope: 'supplier_switch', status: 'signed', signed_at: '2026-01-01' }],
    gridex_verified_grid_owners_v: [{ grid_owner_id: id(9), verification_status: 'verified', verified_for_customer_flow: true, can_start_supplier_switch: true }],
    supplier_switch_requests: [{ id: id(11), company_id: id(2), customer_id: id(3), site_id: id(4), customer_site_id: id(4), metering_point_id: id(5), status: 'draft', request_type: 'move_in', requested_start_date: '2027-01-01' }],
  }
})
afterEach(() => vi.unstubAllEnvs())

const site = () => io.tables.customer_sites[0]
it('a contract-signed job with a requested start date passes the gate although the site has no move-in date', async () => {
  site().move_in_date = null
  job.payload = { trigger: 'contract_signed', requested_start_date: '2027-01-01' }
  const outcome = await processSupplierSwitch(job)
  expect(outcome.result?.blockers ?? []).not.toContain('Inflyttningsdatum saknas')
  expect(outcome.result?.preflight).toMatchObject({ companyId: id(2), customerId: id(3), siteId: id(4), meteringPointId: id(5) })
})
it('without any start date (job or site) the switch still waits for one', async () => {
  site().move_in_date = null
  job.payload = { trigger: 'contract_signed' }
  const outcome = await processSupplierSwitch(job)
  expect(outcome.status).toBe('needs_review')
  expect(outcome.result?.blockers).toContain('Inflyttningsdatum saknas')
  expect(outcome.result?.preflight).toBeUndefined()
})
it('other readiness issues still block a dated job', async () => {
  site().move_in_date = null; site().grid_owner_id = null; io.tables.metering_points[0].grid_owner_id = null
  job.payload = { trigger: 'contract_signed', requested_start_date: '2027-01-01' }
  const outcome = await processSupplierSwitch(job)
  expect(outcome.status).toBe('needs_review')
  expect(outcome.result?.blockers).toEqual(expect.arrayContaining(['verifierad nätägare']))
  expect(outcome.result?.preflight).toBeUndefined()
})
