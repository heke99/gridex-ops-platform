// reality-defects: I-B5
// I-B5 (scenario I, batch 5): every automatic switch of a production tenant was prepared without an environment, and
// prepareAndQueueProdatSwitch falls back to 'test'. The test-lane route decision found no route profile
// (route_profile_missing) and threw after startSupplierSwitch had claimed its business-action key. The retry then saw
// the claim as a duplicate and the job completed without any Z03. Now the tenant's own Z03 environment is resolved
// before the claim (as the Z01 customer-information flow does), and a claim whose preparation threw is released.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  keys: [] as Array<{ company_id: string; dedupe_key: string; metadata: Record<string, unknown> }>,
  prepare: vi.fn(),
  resolver: vi.fn(),
}))
const COMPANY = '00000000-0000-4000-8000-000000000002'
const CUSTOMER = '00000000-0000-4000-8000-000000000003'
const SITE = '00000000-0000-4000-8000-000000000004'
const POINT = '00000000-0000-4000-8000-000000000005'
const SWITCH = '00000000-0000-4000-8000-000000000006'

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const eqs: [string, unknown][] = []
      let op: 'select' | 'insert' | 'delete' = 'select'
      let row: Record<string, unknown> | null = null
      const value = (r: Record<string, unknown>, c: string) => c === 'metadata->>scope' ? (r.metadata as Record<string, unknown>)?.scope : r[c]
      const run = () => {
        if (table === 'supplier_switch_requests') {
          return { data: { id: SWITCH, company_id: COMPANY, customer_id: CUSTOMER, requested_start_date: '2027-01-01', status: 'queued',
            request_type: 'switch', prodat_variant: 'L', prodat_reason: null, site_id: SITE, metering_point_id: POINT }, error: null }
        }
        if (table !== 'ediel_dedupe_keys') throw Error(`unexpected table ${table}`)
        if (op === 'insert') {
          if (io.keys.some(k => k.company_id === row!.company_id && k.dedupe_key === row!.dedupe_key)) return { data: null, error: { code: '23505' } }
          io.keys.push(row as never); return { data: null, error: null }
        }
        if (op === 'delete') { io.keys = io.keys.filter(k => !eqs.every(([c, v]) => value(k, c) === v)); return { data: null, error: null } }
        return { data: null, error: null }
      }
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, eq: (c: string, v: unknown) => { eqs.push([c, v]); return q },
        insert: (r: Record<string, unknown>) => { op = 'insert'; row = r; return q }, delete: () => { op = 'delete'; return q },
        maybeSingle: async () => run(), then: (ok: (x: unknown) => unknown) => Promise.resolve(run()).then(ok),
      })
      return q
    },
  },
}))
vi.mock('@/lib/operations/businessActions/actionPreflight', () => ({
  actionPreflight: async () => ({ ok: true, companyId: COMPANY, siteId: SITE, meteringPointId: POINT, issues: [] }),
  actionPreflightForSupplierSwitchWorker: async () => ({ ok: true, companyId: COMPANY, siteId: SITE, meteringPointId: POINT, issues: [] }),
}))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: async () => ({ ok: true, blockers: [] }) }))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({
  checkSupplierSwitchReadiness: async () => ({ ready: true, blockers: [], readinessSnapshot: {} }),
  persistSwitchReadinessSnapshot: async () => undefined,
}))
vi.mock('@/lib/operations/switchRequestedMethodPreparation', () => ({ deriveRequestedMethodBeforeSwitch: async () => undefined }))
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueEdielZ03: io.prepare }))
vi.mock('@/lib/ediel/customerInfoEnvironmentResolver', () => ({ resolveCustomerInfoOperationEnvironment: io.resolver }))

import { startSupplierSwitch } from '@/lib/operations/businessActions/startSupplierSwitch'
import { resolveSwitchDispatchEnvironment } from '@/lib/operations/switchDispatchEnvironment'

const input = { actorUserId: 'automation', customerId: CUSTOMER, switchRequestId: SWITCH, siteId: SITE, meteringPointId: POINT, idempotencyKey: `customer-operation-start:${SWITCH}` }
beforeEach(() => {
  io.keys = []
  io.prepare.mockReset().mockResolvedValue({ id: 'z03', message_code: 'Z03' })
  io.resolver.mockReset().mockResolvedValue({ status: 'resolved', environment: 'production', blocker: null })
})

it("a switch is prepared in the tenant's own Z03 environment, never a silent 'test'", async () => {
  const started = await startSupplierSwitch(input)
  expect(started).toMatchObject({ ok: true })
  expect(io.resolver).toHaveBeenCalledWith({ companyId: COMPANY, messageFamily: 'PRODAT', messageCode: 'Z03' })
  expect(io.prepare).toHaveBeenCalledWith(expect.objectContaining({ switchRequestId: SWITCH, environment: 'production' }))
})

it('an unresolvable environment refuses before the action is claimed', async () => {
  io.resolver.mockResolvedValue({ status: 'blocked', environment: null, blocker: { blocker_code: 'route_profile_missing', blocker_reason: 'Route profile saknas.' } })
  const started = await startSupplierSwitch(input)
  expect(started).toMatchObject({ ok: false, blockerCode: 'route_profile_missing', message: 'Route profile saknas.' })
  expect(io.prepare).not.toHaveBeenCalled()
  expect(io.keys).toEqual([])
})

it('a preparation that throws keeps its claim, and the retry never prepares a second Z03 (main a749614d5 supersedes the release)', async () => {
  io.prepare.mockRejectedValueOnce(new Error('route_profile_missing'))
  await expect(startSupplierSwitch(input)).rejects.toThrow('route_profile_missing')
  expect(io.keys).toHaveLength(1)
  const retried = await startSupplierSwitch(input).then(result => result, (error: unknown) => error)
  expect(retried).not.toMatchObject({ ok: true, message: { id: 'z03' } })
  expect(io.prepare).toHaveBeenCalledTimes(1)
})

it('an explicit environment wins and the resolver is not asked', async () => {
  await expect(resolveSwitchDispatchEnvironment({ companyId: COMPANY, explicitEnvironment: 'test' })).resolves.toEqual({ ok: true, environment: 'test' })
  expect(io.resolver).not.toHaveBeenCalled()
  await expect(resolveSwitchDispatchEnvironment({ companyId: null })).resolves.toMatchObject({ ok: false, code: 'environment_not_resolved' })
})
