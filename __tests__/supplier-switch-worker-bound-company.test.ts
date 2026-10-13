// Component SDK ports only; real worker, tenant authorization and business preflight.
// Does not replace the source-bound native113 proof or confer whole-ID credit.
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
import { supabaseService } from '@/lib/supabase/service'
import { authorizeSupplierSwitchWorkerJob, consumeSupplierSwitchWorkerAuthority } from '@/lib/operations/businessActions/supplierSwitchWorkerAuthority'
import { actionPreflightForSupplierSwitchWorker } from '@/lib/operations/businessActions/actionPreflight'
import { startSupplierSwitch } from '@/lib/operations/businessActions/startSupplierSwitch'
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
const target = () => ({ actorUserId: id(7), customerId: id(3), siteId: id(4), meteringPointId: id(5) })
const capability = () => authorizeSupplierSwitchWorkerJob(job, supabaseService)
it('executes an eligible claimed LK job without selecting an HTTP cookie tenant', async () => {
  const outcome = await processSupplierSwitch(job)
  expect(outcome.status).toBe('needs_review') // real later dispatch/readiness can lawfully hold
  expect(outcome.result?.preflight).toMatchObject({ companyId: id(2), customerId: id(3), siteId: id(4), meteringPointId: id(5) })
  expect(io.cookies).not.toHaveBeenCalled()
})
it('preflights the job company even when the actor owns another eligible company', async () => {
  const result = await actionPreflightForSupplierSwitchWorker({ ...target(), actionType: 'start_supplier_switch' }, await capability())
  expect(result).toMatchObject({ companyId: id(2), customerId: id(3), siteId: id(4), meteringPointId: id(5) })
  expect(io.cookies).not.toHaveBeenCalled()
})
it('authorizes the configured executor when the persisted job has no assigned actor', async () => {
  job.created_by = null; io.tables.customer_operation_jobs[0].created_by = null
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', id(7))
  expect(await capability()).toMatchObject({ companyId: id(2), actorUserId: id(7) })
})
it.each(['paused', 'suspended', 'archived', 'closed'])('refuses current company %s before readiness effects', async status => {
  io.tables.companies[0].status = status
  await expect(processSupplierSwitch(job)).rejects.toThrow('scope_forbidden')
  expect(io.writes).toEqual([]); expect(io.cookies).not.toHaveBeenCalled()
})
it.each(['revoked-membership', 'inactive-membership', 'unaccepted-membership', 'inactive-actor', 'permission-deny', 'inactive-company'])('refuses current %s before readiness effects', async denial => {
  const membership = io.tables.company_memberships[1]
  if (denial === 'revoked-membership') membership.status = 'revoked'
  if (denial === 'inactive-membership') membership.is_active = false
  if (denial === 'unaccepted-membership') membership.accepted_at = null
  if (denial === 'inactive-actor') io.tables.user_profiles[0].user_status = 'inactive'
  if (denial === 'permission-deny') io.deny = true
  if (denial === 'inactive-company') io.tables.companies[0].is_active = false
  // A valid configuration must not replace a denied assigned actor.
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', id(21))
  await expect(processSupplierSwitch(job)).rejects.toThrow(/forbidden/)
  expect(io.writes).toEqual([])
})
it('propagates permission SDK errors before readiness effects', async () => {
  io.rpcError = { code: '08006' }
  await expect(processSupplierSwitch(job)).rejects.toEqual(io.rpcError)
  expect(io.writes).toEqual([])
})
it.each(['foreign-company', 'foreign-customer', 'foreign-site', 'wrong-purpose', 'lost-token', 'released-job', 'wrong-worker'])('rejects a %s claimed-row substitution', async mutation => {
  if (mutation === 'foreign-company') job.company_id = id(20)
  if (mutation === 'foreign-customer') job.customer_id = id(30)
  if (mutation === 'foreign-site') job.customer_site_id = id(40)
  if (mutation === 'wrong-purpose') job.job_type = 'request_customer_data'
  if (mutation === 'lost-token') io.tables.customer_operation_jobs[0].lock_token = id(60)
  if (mutation === 'released-job') io.tables.customer_operation_jobs[0].status = 'completed'
  if (mutation === 'wrong-worker') io.tables.customer_operation_jobs[0].locked_by = 'another-worker'
  await expect(processSupplierSwitch(job)).rejects.toThrow('scope_forbidden')
  expect(io.writes).toEqual([])
})
it('rejects a copied or fabricated authority without reading cookies or writing', async () => {
  const original = await capability()
  await expect(consumeSupplierSwitchWorkerAuthority({ ...original }, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  await expect(consumeSupplierSwitchWorkerAuthority({ actorUserId: id(7), companyId: id(20) }, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  expect(io.writes).toEqual([]); expect(io.cookies).not.toHaveBeenCalled()
})
it('binds authority to the same service client and action purpose', async () => {
  const original = await capability()
  await expect(consumeSupplierSwitchWorkerAuthority(original, {} as typeof supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  await expect(consumeSupplierSwitchWorkerAuthority(original, supabaseService, target(), 'end_agreement' as never)).rejects.toThrow('scope_forbidden')
  await expect(actionPreflightForSupplierSwitchWorker({ ...target(), actionType: 'end_agreement' }, original)).rejects.toThrow('scope_forbidden')
  expect(io.writes).toEqual([])
})
it('rejects an actor or target substitution after qualification', async () => {
  const original = await capability()
  for (const changed of [{ actorUserId: id(21) }, { customerId: id(30) }, { siteId: id(40) }, { meteringPointId: id(50) }])
    await expect(consumeSupplierSwitchWorkerAuthority(original, supabaseService, { ...target(), ...changed }, 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  expect(io.writes).toEqual([])
})
it('rechecks current permission and claim rather than reusing minted authority', async () => {
  const original = await capability(); io.deny = true
  await expect(consumeSupplierSwitchWorkerAuthority(original, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow(/forbidden/)
  io.deny = false
  await expect(consumeSupplierSwitchWorkerAuthority(original, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  const second = await capability(); io.tables.customer_operation_jobs[0].lock_token = id(60)
  await expect(consumeSupplierSwitchWorkerAuthority(second, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
})
it('rechecks paused company and revoked actor after minting a capability', async () => {
  const first = await capability(); io.tables.companies[0].status = 'paused'
  await expect(consumeSupplierSwitchWorkerAuthority(first, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow('scope_forbidden')
  io.tables.companies[0].status = 'active'
  const second = await capability(); io.tables.user_profiles[0].user_status = 'inactive'
  await expect(consumeSupplierSwitchWorkerAuthority(second, supabaseService, target(), 'start_supplier_switch')).rejects.toThrow(/forbidden/)
  expect(io.writes).toEqual([])
})
it('consumes the qualified authority once at the real preflight boundary', async () => {
  const original = await capability()
  await actionPreflightForSupplierSwitchWorker({ ...target(), actionType: 'start_supplier_switch' }, original)
  await expect(actionPreflightForSupplierSwitchWorker({ ...target(), actionType: 'start_supplier_switch' }, original)).rejects.toThrow('scope_forbidden')
})
it('keeps public HTTP preflight on its request-authenticated tenant path despite forged worker arguments', async () => {
  const input = { ...target(), switchRequestId: id(11), companyId: id(20), workerAuthority: await capability() }
  await expect(startSupplierSwitch(input)).rejects.toThrow('cookies outside request scope')
  expect(io.writes).toEqual([])
})
