// masterplan: SC-071
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it } from 'vitest'
import { projectEdielSeriesToBeneficiary } from '@/lib/ediel/services/projection'
import { nativeLockProcess, nativeLockProcessEnv } from './helpers/native-lock-process'
import {
  NATIVE_ESCO_DB, nativeEscoExternal, nativeEscoLiteral as lit,
  nativeEscoSql as sql, resetNativeEscoFixture,
  seedNativeEscoFixture, qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

// Actual received E66/archive/review/current grant/projection owners. Reuses
// the existing native fixture and lock helper. External issuer and SMTP facts
// remain finite synthetic ports. No queued/leased export job is manufactured.
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
  return { f, request, read, state, revoke }
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
