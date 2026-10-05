// masterplan: SC-071
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { queueBeneficiaryExport, runBeneficiaryExports, readBeneficiaryExport } from '@/lib/ediel/services/beneficiaryExport'
import { projectEdielSeriesToBeneficiary } from '@/lib/ediel/services/projection'
import { nativeLockProcess, nativeLockProcessEnv } from './helpers/native-lock-process'
import {
  NATIVE_ESCO_DB, nativeEscoExternal, nativeEscoLiteral as lit,
  nativeEscoSql as sql, resetNativeEscoFixture,
  seedNativeEscoFixture, qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

// Actual received E66/archive/review/current grant/projection owners. Reuses
// the existing native fixture and lock helper. External issuer and SMTP facts
// remain finite synthetic ports. Queued/leased exports below reuse the sole SC010 production consumer.
beforeEach(resetNativeEscoFixture)

async function receivedProjection() {
  const f = await seedNativeEscoFixture(), authority = await qualifyNativeEscoFixture(f)
  const incoming = await f.utilts('accepted', 'SC071-' + randomUUID().slice(0, 8))
  await incoming.persist()
  const series = sql<{ id: string; start: string; end: string }>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
  const request = {
    beneficiaryCompanyId: f.ids.beneficiary, actorUserId: f.ids.actor,
    grantId: authority.grantId, expectedGrantVersion: sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),
    purpose: f.fields.purpose, seriesId: series.id, fields: ['quantity', 'quality'] as const,
    startInclusive: series.start, endExclusive: series.end,
  }
  const read = () => projectEdielSeriesToBeneficiary(request)
  const state = () => ({
    effects: f.effects(),
    original: sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(incoming.source.id)}`),
    series: sql(`SELECT to_jsonb(s) FROM public.meter_reading_series s WHERE id=${lit(series.id)}`),
    values: sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY reading_at,id) FROM public.meter_reading_values v WHERE series_id=${lit(series.id)}`),
    receipts: sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM gridex_ediel_services.projection_receipts r WHERE company_id=${lit(f.ids.company)}`),
    providerCalls: nativeEscoExternal.send.mock.calls.length,
  })
  const revoke = {
    action: 'revoke_grant', commandId: randomUUID(), assignmentId: f.assignment,
    expectedVersion: f.current().version, grantId: authority.grantId,
    expectedGrantVersion: request.expectedGrantVersion,
  }
  return { f, incoming, request, read, state, revoke }
}

async function waitForNativeLock(functionName: string, applicationName?: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const waiting = sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.wait_event_type='Lock' AND NOT l.granted AND a.query LIKE ${lit('%' + functionName + '%')} ${applicationName ? 'AND a.application_name=' + lit(applicationName) : ''} AND a.pid<>pg_backend_pid()))`)
    if (waiting) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('sc071_expected_actual_native_lock_not_observed:' + functionName)
}

it.each(['COMMIT', 'ROLLBACK'] as const)('writer-first real grant revocation %s serializes before projection, including a retained page', async finish => {
  const p = await receivedProjection(), cached = await p.read(), before = p.state()
  expect(cached.rows.length).toBeGreaterThan(0)
  expect(cached.grantVersion).toBe(p.request.expectedGrantVersion)
  const application = 'SC071-writer-' + randomUUID()
  const child = spawn('psql', [NATIVE_ESCO_DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv() })
  const lock = nativeLockProcess(child, { marker: application, markerError: 'sc071_writer_lock_timeout' })
  let pending: Promise<{ data: Awaited<ReturnType<typeof p.read>> | null; error: unknown }> | undefined
  try {
    // Same current production revoke RPC and explicit service role. Keep its
    // real transaction open; no direct grant UPDATE or fake version mutation.
    child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ediel_service_administration_command_v1(${lit(p.f.ids.company)},${lit(p.f.ids.actor)},${lit(p.revoke)}::jsonb);SELECT ${lit(application)};\n`)
    await lock.ready
    pending = p.read().then(data => ({ data, error: null }), error => ({ data: null, error }))
    try { await waitForNativeLock('ediel_beneficiary_series_page_v1') }
    finally { await lock.release(finish) }
    const result = await pending
    if (finish === 'COMMIT') {
      expect(result.data).toBeNull()
      expect(result.error).toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
      const current = sql<{ version: number; status: string; revoked: boolean }>(`SELECT jsonb_build_object('version',version,'status',status,'revoked',revoked_at IS NOT NULL) FROM public.ediel_data_access_grants WHERE id=${lit(p.request.grantId)}`)
      expect(current).toEqual({ version: p.request.expectedGrantVersion + 1, status: 'revoked', revoked: true })
      await expect(p.read()).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
      await expect(projectEdielSeriesToBeneficiary({ ...p.request, expectedGrantVersion: current.version })).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
    } else {
      expect(result.error).toBeNull()
      expect(result.data).toEqual(cached)
      expect(await p.read()).toEqual(cached)
      expect(sql(`SELECT jsonb_build_object('version',version,'status',status,'revoked',revoked_at IS NOT NULL) FROM public.ediel_data_access_grants WHERE id=${lit(p.request.grantId)}`)).toEqual({ version: p.request.expectedGrantVersion, status: 'active', revoked: false })
    }
    // Existing E66 originals and receipt remain; no rejected-reader receipt,
    // owner storage/ACK/outbox mutation or additional SMTP provider call.
    expect(p.state()).toEqual(before)
  } finally {
    await lock.dispose()
    // Also drain the actual HTTP request if any assertion failed before its
    // normal await; disposing the transaction releases its server-side lock.
    await pending
  }
})

it('reader-first transaction blocks the actual revoke command, then subsequent reads refuse both versions', async () => {
  const p = await receivedProjection(), cached = await p.read(), before = p.state()
  const application = 'SC071-reader-' + randomUUID()
  const child = spawn('psql', [NATIVE_ESCO_DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv() })
  const lock = nativeLockProcess(child, { marker: application, markerError: 'sc071_reader_lock_timeout' })
  let pending: Promise<{ data: Record<string, unknown> | null; error: unknown }> | undefined
  try {
    child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ediel_beneficiary_series_page_v1(${lit(p.request.beneficiaryCompanyId)},${lit(p.request.actorUserId)},${lit(p.request.grantId)},${p.request.expectedGrantVersion},${lit(p.request.purpose)},${lit(p.request.seriesId)},ARRAY['quantity','quality'],${lit(p.request.startInclusive)}::timestamptz,${lit(p.request.endExclusive)}::timestamptz);SELECT ${lit(application)};\n`)
    await lock.ready
    pending = p.f.command(p.revoke).then(data => ({ data, error: null }), error => ({ data: null, error }))
    try { await waitForNativeLock('ediel_service_administration_command_v1') }
    finally { await lock.release('COMMIT') }
    const result = await pending
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ status: 'revoked' })
    await expect(p.read()).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
    await expect(projectEdielSeriesToBeneficiary({ ...p.request, expectedGrantVersion: cached.grantVersion + 1 })).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
    expect(p.state()).toEqual(before)
  } finally {
    await lock.dispose()
    await pending
  }
})

// Actual production job/lease/internal destination from SC010824e5f53. Queue
// and reads use its real adapters; transaction-order controls call the same
// actual claim/execute RPCs. No grant, lease, result or allow flag is seeded.
async function queuedNativeExport(p: Awaited<ReturnType<typeof receivedProjection>>) {
  const cached = await p.read(), key = randomUUID()
  expect(cached.rows.length).toBeGreaterThan(0)
  expect(cached.provenance).toMatchObject({ sourceMessageId: p.incoming.source.id,
    sourceRole: 'DGI', sourceApplicationReference: '23-DGI-E66-T', purpose: p.request.purpose,
    fields: [...p.request.fields] })
  const queued = await queueBeneficiaryExport(p.request, key)
  expect(queued).toEqual({ jobId: expect.any(String), status: 'queued' })
  const actor = { beneficiaryCompanyId: p.request.beneficiaryCompanyId, actorUserId: p.request.actorUserId }
  const args = { p_beneficiary_company_id: actor.beneficiaryCompanyId, p_actor_user_id: actor.actorUserId }
  const results = () => sql<{ job_id: string; page: typeof cached }[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY job_id),'[]') FROM gridex_ediel_exports.results r WHERE beneficiary_company_id=${lit(actor.beneficiaryCompanyId)}`)
  const scope = () => sql(`SELECT to_jsonb(j)-ARRAY['status','lease_token','lease_expires_at','completed_at','result_expires_at'] FROM gridex_ediel_exports.jobs j WHERE id=${lit(queued.jobId)}`)
  const job = () => sql<{ status: string; leaseToken: string | null; completed: boolean }>(`SELECT jsonb_build_object('status',status,'leaseToken',lease_token,'completed',completed_at IS NOT NULL) FROM gridex_ediel_exports.jobs WHERE id=${lit(queued.jobId)}`)
  const captured = scope()
  expect(captured).toMatchObject({ beneficiary_company_id: actor.beneficiaryCompanyId,
    actor_user_id: actor.actorUserId, grant_id: p.request.grantId,
    expected_grant_version: p.request.expectedGrantVersion, series_id: p.request.seriesId,
    purpose: p.request.purpose, fields: [...p.request.fields], start_at: p.request.startInclusive,
    end_at: p.request.endExclusive })
  expect(results()).toEqual([])
  const claim = await supabaseService.rpc('ediel_claim_beneficiary_exports_v1', { ...args, p_limit: 1 })
  expect(claim.error).toBeNull(); expect(claim.data).toHaveLength(1)
  const lease = claim.data[0] as { jobId: string; leaseToken: string }
  expect(lease).toEqual({ jobId: queued.jobId, leaseToken: expect.any(String) })
  expect(job()).toEqual({ status: 'leased', leaseToken: lease.leaseToken, completed: false })
  expect(scope()).toEqual(captured)
  const execute = () => Promise.resolve(supabaseService.rpc('ediel_execute_beneficiary_export_v1', { ...args, p_job_id: queued.jobId, p_lease_token: lease.leaseToken }))
  const read = () => readBeneficiaryExport({ ...actor, jobId: queued.jobId })
  return { actor, queued, key, lease, cached, results, scope, captured, job, execute, read }
}

it.each(['COMMIT', 'ROLLBACK'] as const)('SC071 actual leased export waits for grant writer %s before its internal result commit', async finish => {
  const p = await receivedProjection(), e = await queuedNativeExport(p), before = p.state()
  const application = 'SC071-export-writer-' + randomUUID()
  const child = spawn('psql', [NATIVE_ESCO_DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv() })
  const lock = nativeLockProcess(child, { marker: application, markerError: 'sc071_export_writer_lock_timeout' })
  let pending: ReturnType<typeof e.execute> | undefined
  try {
    child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ediel_service_administration_command_v1(${lit(p.f.ids.company)},${lit(p.f.ids.actor)},${lit(p.revoke)}::jsonb);SELECT ${lit(application)};\n`)
    await lock.ready
    pending = e.execute()
    try { await waitForNativeLock('ediel_execute_beneficiary_export_v1') }
    finally { await lock.release(finish) }
    const result = await pending
    expect(result.error).toBeNull()
    if (finish === 'COMMIT') {
      expect(result.data).toEqual({ jobId: e.queued.jobId, status: 'blocked' })
      expect(e.job()).toEqual({ status: 'blocked', leaseToken: null, completed: false })
      expect(e.results()).toEqual([])
      expect(sql(`SELECT jsonb_build_object('version',version,'status',status) FROM public.ediel_data_access_grants WHERE id=${lit(p.request.grantId)}`)).toEqual({ version: p.request.expectedGrantVersion + 1, status: 'revoked' })
      await expect(e.read()).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
      await expect(queueBeneficiaryExport(p.request, randomUUID())).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
      await expect(queueBeneficiaryExport({ ...p.request, expectedGrantVersion: p.request.expectedGrantVersion + 1 }, randomUUID())).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
      expect(e.results()).toEqual([])
    } else {
      expect(result.data).toEqual({ jobId: e.queued.jobId, status: 'completed' })
      expect(e.job()).toEqual({ status: 'completed', leaseToken: null, completed: true })
      expect(e.results()).toHaveLength(1)
      expect(e.results()[0]).toMatchObject({ job_id: e.queued.jobId, page: e.cached })
      expect(await e.read()).toEqual({ jobId: e.queued.jobId, status: 'completed', page: e.cached })
      await expect(readBeneficiaryExport({ beneficiaryCompanyId: p.f.ids.company, actorUserId: p.f.ids.actor, jobId: e.queued.jobId })).rejects.toMatchObject({ message: expect.stringContaining('ediel_export_not_found') })
      expect(await queueBeneficiaryExport(p.request, e.key)).toEqual({ jobId: e.queued.jobId, status: 'completed' })
      expect(await runBeneficiaryExports(e.actor)).toEqual({ claimed: 0, completed: 0, blocked: 0 })
      expect(e.results()).toHaveLength(1)
      expect(sql(`SELECT jsonb_build_object('version',version,'status',status) FROM public.ediel_data_access_grants WHERE id=${lit(p.request.grantId)}`)).toEqual({ version: p.request.expectedGrantVersion, status: 'active' })
    }
    expect(e.scope()).toEqual(e.captured)
    expect(p.state()).toEqual(before)
  } finally {
    await lock.dispose()
    await pending
  }
})

it('SC071 actual export result transaction commits before waiting revoke; later reads cannot disclose its retained page', async () => {
  const p = await receivedProjection(), e = await queuedNativeExport(p), before = p.state()
  const application = 'SC071-export-first-' + randomUUID()
  const child = spawn('psql', [NATIVE_ESCO_DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], env: nativeLockProcessEnv() })
  const lock = nativeLockProcess(child, { marker: application, markerError: 'sc071_export_first_lock_timeout' })
  let pending: Promise<{ data: Record<string, unknown> | null; error: unknown }> | undefined
  try {
    child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ediel_execute_beneficiary_export_v1(${lit(e.actor.beneficiaryCompanyId)},${lit(e.actor.actorUserId)},${lit(e.queued.jobId)},${lit(e.lease.leaseToken)});SELECT ${lit(application)};\n`)
    await lock.ready
    // The real private result is still uncommitted and invisible to another
    // transaction; its old durable lease remains visible through MVCC.
    expect(e.results()).toEqual([])
    expect(e.job()).toEqual({ status: 'leased', leaseToken: e.lease.leaseToken, completed: false })
    pending = p.f.command(p.revoke).then(data => ({ data, error: null }), error => ({ data: null, error }))
    try { await waitForNativeLock('ediel_service_administration_command_v1') }
    finally { await lock.release('COMMIT') }
    const result = await pending
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ status: 'revoked' })
    expect(e.job()).toEqual({ status: 'completed', leaseToken: null, completed: true })
    const retained = e.results()
    expect(retained).toHaveLength(1); expect(retained[0]).toMatchObject({ job_id: e.queued.jobId, page: e.cached })
    expect(sql(`SELECT jsonb_build_object('version',version,'status',status) FROM public.ediel_data_access_grants WHERE id=${lit(p.request.grantId)}`)).toEqual({ version: p.request.expectedGrantVersion + 1, status: 'revoked' })
    await expect(e.read()).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
    await expect(queueBeneficiaryExport(p.request, randomUUID())).rejects.toMatchObject({ message: expect.stringContaining('ediel_grant_not_current') })
    expect(await runBeneficiaryExports(e.actor)).toEqual({ claimed: 0, completed: 0, blocked: 0 })
    expect(e.results()).toEqual(retained); expect(e.scope()).toEqual(e.captured)
    expect(p.state()).toEqual(before)
  } finally {
    await lock.dispose()
    await pending
  }
})
