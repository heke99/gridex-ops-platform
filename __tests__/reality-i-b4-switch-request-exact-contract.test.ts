// reality-defects: I-B4
// I-B4: a signed contract enqueues start_supplier_switch with payload.contract_id. The worker created the switch request
// without it, and the database dispatch guard (gridex_guard_supplier_switch_dispatch) refuses every queued switch without
// an exact contract (supplier_switch_exact_contract_required, 23514). The job's contract must reach the switch request.
// Component SDK ports as in supplier-switch-worker-bound-company.test.ts; real worker and preflight.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[],
  deny: false, rpcError: null as unknown, creates: [] as Record<string, unknown>[], cookies: vi.fn(() => { throw Error('cookies outside request scope') }) }))
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
      ilike: (c: string, v: unknown) => { filters.push(r => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase()); return q },
      or: () => q, neq: () => q, gte: () => q, lte: () => q, range: () => q,
      update: (p: Record<string, unknown>) => { operation = 'update'; payload = p; return q },
      insert: (p: Record<string, unknown>) => { operation = 'insert'; payload = p; return q },
      upsert: (p: Record<string, unknown>) => { operation = 'upsert'; payload = p; return q },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok) })
    return q
  },
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'gridex_create_supplier_switch_v1') {
      const request = args.p_request as Record<string, unknown>
      io.creates.push(request)
      // The dispatch guard: a queued switch needs an exact contract.
      if (!(request.customer_contract_id ?? request.contract_id)) return { data: null, error: { code: '23514', message: 'supplier_switch_exact_contract_required' } }
      return { data: { id: 'created-switch', ...request }, error: null }
    }
    return { data: name === 'gridex_get_user_roles' ? [] : name === 'gridex_actor_has_company_permission' ? !io.deny : null, error: io.rpcError }
  },
} }))
import { processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let job: JobRow
beforeEach(() => {
  vi.clearAllMocks(); io.writes = []; io.creates = []; io.deny = false; io.rpcError = null
  job = { id: id(1), company_id: id(2), customer_id: id(3), customer_site_id: id(4), metering_point_id: id(5),
    job_type: 'start_supplier_switch', status: 'running', priority: 1, idempotency_key: 'own', payload: {}, result: {},
    attempts: 1, max_attempts: 3, run_after: new Date().toISOString(), locked_at: new Date().toISOString(),
    locked_by: 'own-worker', lock_token: id(6), last_error: null, created_by: id(7), operation_id: id(8) }
  const company = { id: id(2), status: 'active', is_active: true, name: 'Elbolaget AB', legal_name: 'Elbolaget AB', org_number: '5560000000' }
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
    supplier_switch_requests: [],
  }
})
afterEach(() => vi.unstubAllEnvs())

const CONTRACT = id(30)
it("a contract-signed job creates its switch request bound to the job's exact contract", async () => {
  job.payload = { trigger: 'contract_signed', contract_id: CONTRACT, requested_start_date: '2027-01-01' }
  const outcome = await processSupplierSwitch(job).catch((e: Error) => ({ thrown: e.message }))
  expect(io.creates, JSON.stringify(outcome)).toHaveLength(1)
  expect(io.creates[0]).toMatchObject({ contract_id: CONTRACT, customer_contract_id: CONTRACT })
})
it('without a contract in the job the request carries none (the guard decides, nothing is invented)', async () => {
  job.payload = { trigger: 'contract_signed', requested_start_date: '2027-01-01' }
  await processSupplierSwitch(job).catch(() => null)
  expect(io.creates[0]).toMatchObject({ contract_id: null, customer_contract_id: null })
})
