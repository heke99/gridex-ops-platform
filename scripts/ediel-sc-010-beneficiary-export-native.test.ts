// masterplan: SC-010
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as queueRoute } from '@/app/api/ediel/beneficiary/series/[seriesId]/exports/route'
import { POST as workerRoute } from '@/app/api/ediel/beneficiary/exports/process/route'
import { GET as resultRoute } from '@/app/api/ediel/beneficiary/exports/[jobId]/route'
import { supabaseService } from '@/lib/supabase/service'
import { nativeLockProcess, nativeLockProcessEnv } from './helpers/native-lock-process'
import {
  nativeEscoLiteral as lit, nativeEscoSql as sql, nativeEscoExternal as external,
  resetNativeEscoFixture, seedNativeEscoFixture, qualifyNativeEscoFixture, NATIVE_ESCO_DB,
} from './fixtures/ediel-service-evidence-native'

// Canonical real PostgreSQL/PostgREST plus actual archive/source/grant/accepted
// storage/projection owners. Shared synthetic legal/actor inputs and SMTP port
// retain their existing limits. Route session-selection is a finite port;
// the real SQL rechecks that actor's native tenant membership and permission.
const access = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: access.auth }))
beforeEach(resetNativeEscoFixture)

async function acceptedScope() {
  const f = await seedNativeEscoFixture(), authority = await qualifyNativeEscoFixture(f)
  const incoming = await f.utilts('accepted', 'SC010-EXPORT-' + randomUUID().slice(0, 8))
  await incoming.persist(); const ack = await incoming.ack(); await incoming.finalize(ack)
  const actor = randomUUID()
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${lit(actor)},'authenticated','authenticated',${lit(actor + '@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(actor)},${lit(actor + '@example.invalid')},'Synthetic export reader','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
  const series = sql<{ id: string; start: string; end: string }>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
  const version = sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`)
  access.auth.mockResolvedValue({ guard: { companyId: f.ids.beneficiary, userId: actor } })
  const values = new URLSearchParams({ grantId: authority.grantId, grantVersion: String(version), purpose: f.fields.purpose,
    fields: 'reading_at,quantity', start: series.start, end: series.end, limit: '100' })
  const enqueue = (key = randomUUID()) => queueRoute(new NextRequest(`https://example.test/api/ediel/beneficiary/series/${series.id}/exports?${values}`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey: key }),
  }), { params: Promise.resolve({ seriesId: series.id }) })
  const run = () => workerRoute(new NextRequest('https://example.test/api/ediel/beneficiary/exports/process', { method: 'POST' }))
  const read = (jobId: string) => resultRoute(new NextRequest(`https://example.test/api/ediel/beneficiary/exports/${jobId}`), { params: Promise.resolve({ jobId }) })
  const privateRows = (table: string) => sql<unknown[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r WHERE beneficiary_company_id=${lit(f.ids.beneficiary)}`)
  const originals = () => sql(`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m WHERE company_id=${lit(f.ids.company)}),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.meter_reading_series s WHERE company_id=${lit(f.ids.company)}),
    'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM public.meter_reading_values v WHERE company_id=${lit(f.ids.company)}),
    'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY to_jsonb(h)::text),'[]') FROM public.ediel_service_history h WHERE company_id=${lit(f.ids.company)}),
    'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY to_jsonb(c)::text),'[]') FROM gridex_utilts_binding.contracts c WHERE company_id=${lit(f.ids.company)}))`)
  const receipts = () => privateRows('gridex_ediel_services.projection_receipts')
  const results = () => privateRows('gridex_ediel_exports.results')
  const revoke = () => f.command({ action: 'revoke_grant', commandId: randomUUID(), assignmentId: f.assignment,
    expectedVersion: f.current().version, grantId: authority.grantId, expectedGrantVersion: version })
  return { f, authority, incoming, actor, series, version, values, enqueue, run, read, originals, receipts, results, revoke }
}

it('SC010 real enqueue → real grant revoke → lease → blocked internal export preserves originals, receipts, history and zero result payload', async () => {
  const s = await acceptedScope(), beforeQueue = s.originals(), beforeReceipts = s.receipts(), key = randomUUID()
  const response = await s.enqueue(key)
  expect(response.status).toBe(202)
  const queued = await response.json()
  expect(queued).toMatchObject({ status: 'queued', jobId: expect.any(String) })
  expect(await (await s.enqueue(key)).json()).toEqual(queued)
  expect(s.receipts()).toEqual(beforeReceipts); expect(s.results()).toEqual([]); expect(s.originals()).toEqual(beforeQueue)
  expect(await s.revoke()).toMatchObject({ status: 'revoked' })
  const afterRevoke = s.originals(), receipts = s.receipts(), effects = s.f.effects(), sends = external.send.mock.calls.length
  expect(afterRevoke).not.toEqual(beforeQueue)
  const worker = await s.run()
  expect(worker.status).toBe(200)
  expect(await worker.json()).toEqual({ claimed: 1, completed: 0, blocked: 1 })
  const job = sql<{ status: string; lease_token: string | null; completed_at: string | null }>(`SELECT jsonb_build_object('status',status,'lease_token',lease_token,'completed_at',completed_at) FROM gridex_ediel_exports.jobs WHERE id=${lit(queued.jobId)} AND beneficiary_company_id=${lit(s.f.ids.beneficiary)}`)
  expect(job).toEqual({ status: 'blocked', lease_token: null, completed_at: null })
  expect(s.results()).toEqual([]); expect(s.receipts()).toEqual(receipts)
  expect(s.originals()).toEqual(afterRevoke); expect(s.f.effects()).toEqual(effects); expect(external.send).toHaveBeenCalledTimes(sends)
  expect((await s.enqueue()).status).toBe(403)
  s.values.set('grantVersion', String(s.version + 1))
  expect((await s.enqueue()).status).toBe(403)
  const denied = await s.read(queued.jobId)
  expect(denied.status).toBe(403); expect(denied.headers.get('cache-control')).toBe('private, no-store')
  expect(await denied.json()).toEqual({ error: 'Exporten kunde inte auktoriseras eller läsas.' })
  expect(s.results()).toEqual([]); expect(s.receipts()).toEqual(receipts); expect(s.originals()).toEqual(afterRevoke)
})

it('SC010 authorized internal result retains actual DGI provenance; later revocation prevents reading its cached values', async () => {
  const s = await acceptedScope(), originals = s.originals(), key = randomUUID()
  const queued = await (await s.enqueue(key)).json()
  const worker = await s.run()
  expect(worker.status).toBe(200); expect(await worker.json()).toEqual({ claimed: 1, completed: 1, blocked: 0 })
  const response = await s.read(queued.jobId)
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
  const exported = await response.json()
  const stored = sql<unknown[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('reading_at',reading_at,'quantity',quantity::text) ORDER BY reading_at,id),'[]') FROM public.meter_reading_values WHERE company_id=${lit(s.f.ids.company)} AND series_id=${lit(s.series.id)}`)
  expect(exported.page.rows).toEqual(stored); expect(stored.length).toBeGreaterThan(0)
  expect(exported.page.provenance).toMatchObject({ sourceMessageId: s.incoming.source.id, sourceRole: 'DGI', sourceApplicationReference: '23-DGI-E66-T', purpose: s.f.fields.purpose, fields: ['reading_at', 'quantity'] })
  expect(exported.page.next).toBeNull(); expect(s.results()).toHaveLength(1); expect(s.receipts()).toHaveLength(1)
  expect(s.originals()).toEqual(originals)
  expect(await (await s.run()).json()).toEqual({ claimed: 0, completed: 0, blocked: 0 })
  expect(await (await s.enqueue(key)).json()).toEqual({ jobId: queued.jobId, status: 'completed' })
  expect(await s.revoke()).toMatchObject({ status: 'revoked' })
  const afterRevoke = s.originals(), receipts = s.receipts(), results = s.results(), sends = external.send.mock.calls.length
  const denied = await s.read(queued.jobId)
  expect(denied.status).toBe(403); expect(await denied.json()).toEqual({ error: 'Exporten kunde inte auktoriseras eller läsas.' })
  expect(s.results()).toEqual(results); expect(s.receipts()).toEqual(receipts); expect(s.originals()).toEqual(afterRevoke); expect(external.send).toHaveBeenCalledTimes(sends)
})

it.each([{ table: 'results', mode: 'SHARE ROW EXCLUSIVE' }, { table: 'jobs', mode: 'SHARE' }])(
  'SC010 lease expires during a real $table write lock wait and rolls back result, completion and receipt together', async ({ table, mode }) => {
  const s = await acceptedScope(), queued = await (await s.enqueue()).json()
  const args = { p_beneficiary_company_id: s.f.ids.beneficiary, p_actor_user_id: s.actor }
  const claimed = await supabaseService.rpc('ediel_claim_beneficiary_exports_v1', { ...args, p_limit: 1 })
  expect(claimed.error).toBeNull(); expect(claimed.data).toHaveLength(1)
  const lease = claimed.data[0] as { jobId: string; leaseToken: string }
  expect(lease.jobId).toBe(queued.jobId)
  // Set before taking the jobs SHARE lock, which would itself block UPDATE.
  // The generous margin leaves time to establish and observe the real wait.
  sql(`UPDATE gridex_ediel_exports.jobs SET lease_expires_at=clock_timestamp()+interval '15 seconds' WHERE id=${lit(queued.jobId)} AND lease_token=${lit(lease.leaseToken)}`)
  const blocker = spawn('psql', [NATIVE_ESCO_DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv() })
  const lock = nativeLockProcess(blocker, { marker: 'export-result-locked', markerError: 'native_export_result_lock_timeout' })
  let running: Promise<Awaited<ReturnType<typeof supabaseService.rpc>>> | undefined
  const originals = s.originals(), receipts = s.receipts(), results = s.results()
  try {
    blocker.stdin.write(`BEGIN;LOCK TABLE gridex_ediel_exports.${table} IN ${mode} MODE;SELECT 'export-result-locked';\n`)
    await lock.ready
    // No authority, output or receipt is seeded; actual expiry is observed.
    // Convert the PostgREST thenable once, so cleanup cannot issue a retry.
    running = Promise.resolve(supabaseService.rpc('ediel_execute_beneficiary_export_v1', { ...args, p_job_id: queued.jobId, p_lease_token: lease.leaseToken }))
    let observed = false
    for (let n = 0; n < 100; n++) {
      observed = sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.wait_event_type='Lock' AND a.query LIKE '%ediel_execute_beneficiary_export_v1%' AND l.relation='gridex_ediel_exports.${table}'::regclass AND l.mode='RowExclusiveLock' AND NOT l.granted AND a.pid<>pg_backend_pid()))`)
      if (observed) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(observed, 'real RPC must reach its destination before lease expires').toBe(true)
    let expired = false
    for (let n = 0; n < 800; n++) {
      expired = sql<boolean>(`SELECT to_jsonb(lease_expires_at<=clock_timestamp()) FROM gridex_ediel_exports.jobs WHERE id=${lit(queued.jobId)}`)
      if (expired) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(expired, 'database wall clock must pass the real lease deadline').toBe(true)
    await lock.release('COMMIT')
    const outcome = await running
    expect(outcome.data).toBeNull(); expect(outcome.error).toMatchObject({ message: expect.stringContaining('ediel_export_lease_not_current') })
  } finally {
    await lock.dispose()
    if (running) await running
  }
  expect(s.results()).toEqual(results); expect(s.receipts()).toEqual(receipts); expect(s.originals()).toEqual(originals)
  expect(sql(`SELECT jsonb_build_object('status',status,'leaseToken',lease_token) FROM gridex_ediel_exports.jobs WHERE id=${lit(queued.jobId)}`)).toEqual({ status: 'leased', leaseToken: lease.leaseToken })
})
