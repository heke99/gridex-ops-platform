// masterplan: SC-010
// Real routes/parser/export adapter/worker; auth and RPC are finite ports.
// Database leases, grant denial and durable output are proved separately.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import * as enqueueModule from '@/app/api/ediel/beneficiary/series/[seriesId]/exports/route'
import * as readModule from '@/app/api/ediel/beneficiary/exports/[jobId]/route'
import * as processModule from '@/app/api/ediel/beneficiary/exports/process/route'

const ports = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: ports.auth }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), actor = uuid(2), grant = uuid(3), series = uuid(4), key = uuid(5), job = uuid(6), token = uuid(7)
const query = new URLSearchParams({ grantId: grant, grantVersion: '2', purpose: 'analysis', fields: 'quantity',
  start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z', limit: '100' })

beforeEach(() => {
  vi.resetAllMocks()
  ports.auth.mockResolvedValue({ guard: { companyId: company, userId: actor } })
})

const enqueue = (body: unknown = { idempotencyKey: key }, values = query) => new NextRequest(
  `https://example.test/api/ediel/beneficiary/series/${series}/exports?${values}`, { method: 'POST', body: JSON.stringify(body) })
const run = () => new NextRequest('https://example.test/api/ediel/beneficiary/exports/process', { method: 'POST' })
const read = () => new NextRequest(`https://example.test/api/ediel/beneficiary/exports/${job}`)
describe('SC010 reachable internal beneficiary export consumer', () => {
  it('executes the real queue/lease/current-grant/internal-sink SQL assertions through the existing bounded harness', () => {
    const require = createRequire(import.meta.url)
    const execution = spawnSync(process.execPath, [resolve('scripts/ediel-sc-010-beneficiary-export-sql-regression.mjs')], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000,
      env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: process.cwd(), EDIEL_EXPORT_BASELINE: '0' },
    })
    expect(execution.error).toBeUndefined()
    expect(execution.status, execution.stderr?.slice(-3000)).toBe(0)
    expect(execution.stdout).toContain('Beneficiary export SQL: 12 PASS')
  }, 35000)

  it('queues the trusted selected tenant/actor and exact captured scope without putting values in the response', async () => {
    ports.rpc.mockResolvedValue({ data: { jobId: job, status: 'queued' }, error: null })
    const response = await enqueueModule.POST(enqueue(), { params: Promise.resolve({ seriesId: series }) })
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ jobId: job, status: 'queued' })
    expect(ports.rpc).toHaveBeenCalledExactlyOnceWith('ediel_queue_beneficiary_export_v1', {
      p_beneficiary_company_id: company, p_actor_user_id: actor, p_idempotency_key: key,
      p_grant_id: grant, p_expected_grant_version: 2, p_series_id: series, p_purpose: 'analysis', p_fields: ['quantity'],
      p_start: '2026-01-01T00:00:00.000Z', p_end: '2026-02-01T00:00:00.000Z', p_limit: 100, p_after_at: null, p_after_id: null,
    })
  })

  it.each([{ idempotencyKey: key, actorUserId: uuid(20) }, { idempotencyKey: key, companyId: uuid(20) }, {}, { idempotencyKey: 'old-cache' }])(
    'rejects caller authority overrides and malformed idempotency input before queueing: %j', async body => {
      const response = await enqueueModule.POST(enqueue(body), { params: Promise.resolve({ seriesId: series }) })
      expect(response.status).toBe(400); expect(ports.rpc).not.toHaveBeenCalled()
    })

  it('executes each real claimed token once and returns statuses without retaining a payload or silently upgrading a version', async () => {
    ports.rpc.mockResolvedValueOnce({ data: [{ jobId: job, leaseToken: token }], error: null })
      .mockResolvedValueOnce({ data: { jobId: job, status: 'blocked' }, error: null })
    const response = await processModule.POST(run())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claimed: 1, completed: 0, blocked: 1 })
    expect(ports.rpc.mock.calls).toEqual([
      ['ediel_claim_beneficiary_exports_v1', { p_beneficiary_company_id: company, p_actor_user_id: actor, p_limit: 10 }],
      ['ediel_execute_beneficiary_export_v1', { p_beneficiary_company_id: company, p_actor_user_id: actor, p_job_id: job, p_lease_token: token }],
    ])
  })

  it('does not execute stale data returned together with a failed claim', async () => {
    ports.rpc.mockResolvedValueOnce({ data: [{ jobId: job, leaseToken: token }], error: new Error('private grant') })
    const response = await processModule.POST(run())
    expect(response.status).toBe(503); expect(ports.rpc).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ error: 'Exportjobben kunde inte köras.' })
  })

  it('stops on an execution error without retrying or marking the job completed', async () => {
    ports.rpc.mockResolvedValueOnce({ data: [{ jobId: job, leaseToken: token }], error: null })
      .mockResolvedValueOnce({ data: { jobId: job, status: 'completed' }, error: new Error('lease expired') })
    const response = await processModule.POST(run())
    expect(response.status).toBe(503); expect(ports.rpc).toHaveBeenCalledTimes(2)
    expect(await response.json()).toEqual({ error: 'Exportjobben kunde inte köras.' })
  })

  it('authenticates every result read and rejects an old result alongside a current RPC denial', async () => {
    ports.rpc.mockResolvedValueOnce({ data: { jobId: job, status: 'queued', page: null }, error: null })
      .mockResolvedValueOnce({ data: { jobId: job, status: 'completed', page: { rows: [{ quantity: '17.250' }] } }, error: new Error('ediel_grant_not_current') })
    expect((await readModule.GET(read(), { params: Promise.resolve({ jobId: job }) })).status).toBe(200)
    const response = await readModule.GET(read(), { params: Promise.resolve({ jobId: job }) })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Exporten kunde inte auktoriseras eller läsas.' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(ports.auth).toHaveBeenCalledTimes(2)
    for (const call of ports.rpc.mock.calls) expect(call).toEqual(['ediel_read_beneficiary_export_v1', {
      p_beneficiary_company_id: company, p_actor_user_id: actor, p_job_id: job,
    }])
  })

  it('uses the newly selected tenant/user for the next result read', async () => {
    ports.auth.mockResolvedValueOnce({ guard: { companyId: uuid(20), userId: uuid(21) } })
    ports.rpc.mockResolvedValue({ data: null, error: new Error('forbidden') })
    const response = await readModule.GET(read(), { params: Promise.resolve({ jobId: job }) })
    expect(response.status).toBe(403)
    expect(ports.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_beneficiary_export_v1', {
      p_beneficiary_company_id: uuid(20), p_actor_user_id: uuid(21), p_job_id: job,
    })
  })

  it('never claims jobs without a selected authorized company', async () => {
    ports.auth.mockResolvedValueOnce({ guard: { companyId: null, userId: actor } })
    expect((await processModule.POST(run())).status).toBe(403)
    expect(ports.rpc).not.toHaveBeenCalled()
  })
})
