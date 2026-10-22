// PERF005 (issue #840): terminal 429 keeps the provider Retry-After deadline and
// the real claim function refuses a new provider attempt before it expires.
// Real adapter (spotImportJobs.ts) + real table/function from the migrations in PGlite.
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ db: null as unknown as import('@electric-sql/pglite').PGlite }))

const JOB_COLUMNS = new Set(['status', 'completed_at', 'next_attempt_at', 'last_error_code', 'last_error_message', 'updated_at', 'source_checksum', 'result_summary'])

// Thin PostgREST-shaped port: every call executes against the real PGlite schema.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'gridex_claim_spot_price_import_job') throw new Error(`unexpected RPC: ${name}`)
    try {
      const { rows } = await io.db.query(
        'select * from public.gridex_claim_spot_price_import_job(p_provider=>$1,p_price_area=>$2,p_calendar_date=>$3::date,p_company_id=>$4::uuid,p_force=>$5)',
        [args.p_provider, args.p_price_area, args.p_calendar_date, args.p_company_id, args.p_force])
      return { data: rows, error: null }
    } catch (error) { return { data: null, error } }
  },
  from: (table: string) => {
    if (table !== 'spot_price_import_jobs') throw new Error(`unexpected table: ${table}`)
    return { update: (patch: Record<string, unknown>) => ({ eq: async (key: string, value: unknown) => {
      if (key !== 'id') throw new Error('unexpected update scope')
      const keys = Object.keys(patch)
      if (keys.some(k => !JOB_COLUMNS.has(k))) throw new Error('unexpected column')
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(',')
      try {
        await io.db.query(`update public.spot_price_import_jobs set ${sets} where id=$1`, [value, ...keys.map(k => patch[k])])
        return { error: null }
      } catch (error) { return { error } }
    } }) }
  },
} }))

import { claimSpotImportJob, failSpotImportJob } from '@/lib/pricing/spot/spotImportJobs'

const BASE = 'supabase/migrations/20260724120000_canonical_market_resolution_quote_billing_flow.sql'
const MIGRATION = 'supabase/migrations/20261022090000_spot_claim_rate_limited_failed_deadline.sql'
const ORIGINAL_BODY_SHA = '1f97134c4edc7e480965e26120495bb49fd4d7f7dfd6643e014c77774bb72ab6'
const NEW_BODY_SHA = 'f630ff2ff8e419eda3e314e789993b786c912150b87872c74dc9a17502787e26'
const SIG = `'public.gridex_claim_spot_price_import_job(text,text,date,uuid,interval,boolean)'::regprocedure`
const DAY = '2026-10-20'
const claimArgs = (force: boolean) => ({ provider: 'elprisetjustnu', priceArea: 'SE3' as const, calendarDate: DAY, force })

async function bootstrap(installMigration: boolean) {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.companies(id uuid primary key);`)
  // Exact table + function + grants from the canonical base migration.
  const sql = fs.readFileSync(BASE, 'utf8')
  const start = sql.indexOf('create table if not exists public.spot_price_import_jobs')
  const grant = sql.indexOf('grant execute on function public.gridex_claim_spot_price_import_job', start)
  await db.exec(sql.slice(start, sql.indexOf(';', grant) + 1))
  if (installMigration) await db.exec(fs.readFileSync(MIGRATION, 'utf8'))
  return db
}

const bodySha = async (db: PGlite) => (await db.query<{ h: string }>(
  `select encode(sha256(convert_to(prosrc,'UTF8')),'hex') h from pg_proc where oid=${SIG}`)).rows[0].h
const job = async () => (await io.db.query<Record<string, unknown>>(
  `select status,attempt_count,next_attempt_at,completed_at,last_error_code,next_attempt_at='infinity'::timestamptz as is_infinity
   from public.spot_price_import_jobs where provider='elprisetjustnu' and price_area='SE3' and calendar_date=$1`, [DAY])).rows[0]
const expireDeadline = () => io.db.exec(`update public.spot_price_import_jobs set next_attempt_at=now()-interval '1 second'`)

// Drive the real claim -> 429 failure loop until the 5th (terminal) failure.
async function failFiveTimesWith429(retryAfterMs: number) {
  const statuses: string[] = []
  for (let n = 1; n <= 5; n += 1) {
    const claim = await claimSpotImportJob(claimArgs(false))
    expect(claim).toMatchObject({ claimed: true, attemptCount: n, status: 'running' })
    statuses.push(await failSpotImportJob({ jobId: claim.id, errorCode: 'provider_rate_limited', message: '429',
      retryable: true, attemptCount: claim.attemptCount, retryAfterMs }))
    if (n < 5) await expireDeadline()
  }
  return statuses
}

afterEach(async () => { await io.db?.close() })

describe('with migration 20261022090000 installed', () => {
  beforeEach(async () => { io.db = await bootstrap(true) })

  it('installs the exact adopted body and preserves OID, owner, ACL and header', async () => {
    const before = await bootstrap(false)
    const meta = `select oid::text, proowner::regrole::text owner, proacl::text acl, prosecdef, proconfig::text cfg,
      pg_get_function_arguments(oid) args, pg_get_function_result(oid) res from pg_proc where oid=${SIG}`
    const pre = (await before.query(meta)).rows[0] as Record<string, unknown>
    expect(await bodySha(before)).toBe(ORIGINAL_BODY_SHA)
    await before.exec(fs.readFileSync(MIGRATION, 'utf8'))
    expect(await bodySha(before)).toBe(NEW_BODY_SHA)
    expect((await before.query(meta)).rows[0]).toEqual(pre)
    expect(String(pre.acl)).toContain('service_role=X')
    expect(String(pre.acl)).not.toMatch(/(^|[{,])(anon|authenticated)?=X/)
    // Re-running on the already-adopted body is a no-op success.
    await before.exec(fs.readFileSync(MIGRATION, 'utf8'))
    expect(await bodySha(before)).toBe(NEW_BODY_SHA)
    await before.close()
  })

  it('fails closed on an unknown body without changing the function', async () => {
    await io.db.exec(`create or replace function public.gridex_claim_spot_price_import_job(p_provider text, p_price_area text, p_calendar_date date, p_company_id uuid default null, p_stale_after interval default interval '15 minutes', p_force boolean default false)
      returns table(id uuid, claimed boolean, status text, attempt_count integer, correlation_id uuid)
      language plpgsql security definer set search_path=public,pg_temp as $$ begin return; end; $$;`)
    const drifted = await bodySha(io.db)
    await expect(io.db.exec(fs.readFileSync(MIGRATION, 'utf8'))).rejects.toThrow(/spot_claim_install_unknown_body/)
    expect(await bodySha(io.db)).toBe(drifted)
  })

  it('a 5th 429 failure keeps next_attempt_at and the claim refuses before the deadline (force false and true)', async () => {
    expect(await failFiveTimesWith429(3_600_000)).toEqual(['retry_wait', 'retry_wait', 'retry_wait', 'retry_wait', 'failed'])
    const terminal = await job()
    expect(terminal).toMatchObject({ status: 'failed', attempt_count: 5, last_error_code: 'provider_rate_limited' })
    expect(terminal.completed_at).not.toBeNull()
    const deadline = (terminal.next_attempt_at as Date).getTime()
    expect(deadline).toBeGreaterThan(Date.now() + 3_500_000)
    expect(deadline).toBeLessThanOrEqual(Date.now() + 3_600_000)

    for (const force of [false, true]) {
      await expect(claimSpotImportJob(claimArgs(force))).resolves.toMatchObject({ claimed: false, status: 'failed', attemptCount: 5 })
    }
    // Refusal does not mutate the row.
    expect(await job()).toEqual(terminal)

    // After the explicit finite deadline the failed job is eligible again (unchanged original policy).
    await expireDeadline()
    await expect(claimSpotImportJob(claimArgs(false))).resolves.toMatchObject({ claimed: true, status: 'running', attemptCount: 6 })
    expect(await job()).toMatchObject({ status: 'running', next_attempt_at: null, last_error_code: null })
  })

  it('an infinite 429 deadline on a failed job never expires, even with force', async () => {
    const claim = await claimSpotImportJob(claimArgs(false))
    await failSpotImportJob({ jobId: claim.id, errorCode: 'provider_rate_limited', message: '429', retryable: true, attemptCount: 5, retryAfterMs: Number.POSITIVE_INFINITY })
    expect(await job()).toMatchObject({ status: 'failed', is_infinity: true })
    await expect(claimSpotImportJob(claimArgs(true))).resolves.toMatchObject({ claimed: false, status: 'failed' })
  })

  it('a terminal non-rate-limit failure remains immediately re-claimable (no new deadline)', async () => {
    const claim = await claimSpotImportJob(claimArgs(false))
    await failSpotImportJob({ jobId: claim.id, errorCode: 'provider_unavailable', message: '503', retryable: true, attemptCount: 5, retryAfterMs: 3_600_000 })
    expect(await job()).toMatchObject({ status: 'failed', next_attempt_at: null })
    await expect(claimSpotImportJob(claimArgs(false))).resolves.toMatchObject({ claimed: true, attemptCount: 2 })
  })

  it('a failed row with a stale foreign error code and a future deadline is not gated', async () => {
    const claim = await claimSpotImportJob(claimArgs(false))
    await failSpotImportJob({ jobId: claim.id, errorCode: 'provider_unavailable', message: '503', retryable: false, attemptCount: 1 })
    await io.db.exec(`update public.spot_price_import_jobs set next_attempt_at=now()+interval '1 hour'`)
    await expect(claimSpotImportJob(claimArgs(false))).resolves.toMatchObject({ claimed: true })
  })
})

describe('refutation: original claim function (PR #870 adapter + unchanged SQL)', () => {
  beforeEach(async () => { io.db = await bootstrap(false) })

  it('re-claims a terminally rate-limited job before its deadline (the PERF005 defect)', async () => {
    expect(await bodySha(io.db)).toBe(ORIGINAL_BODY_SHA)
    await failFiveTimesWith429(3_600_000)
    expect((await job()).next_attempt_at).not.toBeNull()
    await expect(claimSpotImportJob(claimArgs(false))).resolves.toMatchObject({ claimed: true, attemptCount: 6 })
  })
})
