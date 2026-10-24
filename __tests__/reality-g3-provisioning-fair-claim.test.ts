// reality-defects: G-3
// FINDINGS G-3 (live-chain-20261015): 'ediel_readiness_revalidate' provisioning jobs are enqueued once per configuration
// snapshot and were never merged, and canonical_claim_company_provisioning_jobs took the oldest 20 across all tenants,
// so one tenant's snapshot churn (world: 1814 pending jobs of 292 tenants) starved a new tenant's jobs.
// PGlite, synthetic rows; the shipped claim body from 20260810193450, then 20261024110000.
// GRIDEX_G3_CLAIM_SOURCE=old runs the post-migration assertions on the shipped body (they fail: the defect).
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const shipped = readFileSync('supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261024110000_g3_provisioning_revalidate_coalesce_fair_claim.sql', 'utf8')
const claimBody = shipped.slice(
  shipped.indexOf('create or replace function public.canonical_claim_company_provisioning_jobs('),
  shipped.indexOf('create or replace function public.canonical_complete_company_provisioning_job('),
)
const old = process.env.GRIDEX_G3_CLAIM_SOURCE === 'old'
const busy = '11111111-1111-4111-8111-111111111111'
const fresh = '22222222-2222-4222-8222-222222222222'
const blocked = '33333333-3333-4333-8333-333333333333'

let db: PGlite
const forward = async () => { if (!old) await db.exec(migration) }
const claim = async (limit = 20) => (await db.query<{ id: string; company_id: string; job_key: string; idempotency_key: string }>(
  `select * from public.canonical_claim_company_provisioning_jobs('w', $1, 300)`, [limit])).rows
const enqueue = async (company: string, key: string, minutesAgo: number, jobKey = 'ediel_readiness_revalidate', extra = '') =>
  db.query(`insert into public.company_provisioning_jobs(company_id, job_key, idempotency_key, available_at, created_at${extra ? ', status, attempt_count' : ''})
    values ($1, $2, $3, now() - make_interval(mins => $4), now() - make_interval(mins => $4)${extra ? `, ${extra}` : ''})`, [company, jobKey, key, minutesAgo])
const job = async (key: string) => (await db.query<Record<string, unknown>>(
  'select status, last_error_code, last_error_details, completed_at from public.company_provisioning_jobs where idempotency_key = $1', [key])).rows[0]

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.companies(id uuid primary key, status text not null);
    create table public.company_provisioning_jobs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), job_key text not null,
      status text not null default 'pending', idempotency_key text not null, attempt_count integer not null default 0,
      last_error_code text, last_error_details jsonb not null default '{}', available_at timestamptz not null default now(),
      claimed_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      max_attempts integer not null default 5, started_at timestamptz, locked_at timestamptz, locked_by text, lease_token uuid,
      last_error_message text, dead_letter_at timestamptz, unique (company_id, job_key, idempotency_key));
    create function public.canonical_tenant_operation_decision(p_company_id uuid, p_operation text)
    returns table(allowed boolean) language sql as $$ select p_company_id <> '${blocked}'::uuid $$;
    insert into public.companies values ('${busy}', 'active'), ('${fresh}', 'onboarding'), ('${blocked}', 'active');`)
  await db.exec(claimBody)
})

describe('provisioning claim: coalesced revalidation and per-tenant fairness (G-3)', () => {
  it('a new tenant is claimed in the first run even behind another tenant\'s older backlog', async () => {
    for (let i = 0; i < 40; i += 1) await enqueue(busy, `busy-${i}`, 1000 - i, 'auth_invite')
    await enqueue(fresh, 'fresh-1', 1)
    await forward()
    const claimed = await claim(20)
    expect(claimed).toHaveLength(20)
    expect(claimed.map(row => row.company_id)).toContain(fresh)
    // Round-robin by per-company rank and still work-conserving: the busy tenant fills the rest, oldest first.
    expect(claimed.filter(row => row.company_id === busy).map(row => row.idempotency_key))
      .toEqual(Array.from({ length: 19 }, (_, i) => `busy-${i}`))
  })

  it('older pending revalidations of a company are superseded by its newest one, which alone is claimed', async () => {
    for (let i = 0; i < 30; i += 1) await enqueue(busy, `snap-${i}`, 1000 - i)
    await enqueue(fresh, 'fresh-snap', 1)
    await forward()
    const claimed = await claim(20)
    expect(claimed.map(row => row.idempotency_key).sort()).toEqual(['fresh-snap', 'snap-29'])
    const stale = await job('snap-0')
    expect(stale).toMatchObject({ status: 'completed', last_error_code: 'superseded_by_newer_revalidation' })
    expect(stale.completed_at).not.toBeNull()
    expect((stale.last_error_details as Record<string, unknown>).superseded_by_idempotency_key).toBe('snap-29')
    const counts = (await db.query<{ status: string; n: number }>(
      `select status, count(*)::int n from public.company_provisioning_jobs where company_id = '${busy}' group by 1 order by 1`)).rows
    expect(counts).toEqual([{ status: 'completed', n: 29 }, { status: 'processing', n: 1 }]) // rows kept (audit trail)
  })

  it('never supersedes across tenants, other job kinds, a processing lease, or behind an exhausted newer job', async () => {
    await enqueue(busy, 'b-old', 50)
    await enqueue(fresh, 'f-new', 10) // a newer job of ANOTHER tenant
    await enqueue(busy, 'invite-old', 60, 'auth_invite')
    await enqueue(busy, 'b-new', 5)
    await enqueue(fresh, 'f-lease', 40, 'ediel_readiness_revalidate', `'processing', 1`)
    await enqueue(fresh, 'f-newest', 2, 'ediel_readiness_revalidate', `'retry', 5`) // exhausted: not claimable
    await forward()
    await claim(20)
    expect((await job('b-old')).last_error_code).toBe(old ? null : 'superseded_by_newer_revalidation')
    expect((await job('invite-old')).status).toBe('processing')
    expect((await job('f-lease')).status).toBe('processing')
    expect((await job('f-new')).status).toBe('processing') // newest claimable of its tenant
    expect((await job('f-newest')).status).toBe('retry')
  })

  it('keeps tenant eligibility: blocked or suspended tenants are neither claimed nor counted', async () => {
    await enqueue(blocked, 'x-1', 10, 'auth_invite')
    await db.exec(`insert into public.companies values ('44444444-4444-4444-8444-444444444444', 'suspended')`)
    await enqueue('44444444-4444-4444-8444-444444444444', 's-1', 10, 'auth_invite')
    await enqueue(fresh, 'ok-1', 5, 'auth_invite')
    await forward()
    expect((await claim(20)).map(row => row.idempotency_key)).toEqual(['ok-1'])
    expect(await claim(20)).toEqual([]) // claimed leases are not re-claimed
  })

  it.skipIf(old)('refuses to rewrite a changed or already rewritten body', async () => {
    await forward()
    await expect(db.exec(migration.replaceAll('g3_rewrite', 'g3_rewrite_again'))).rejects.toThrow(/g3_provisioning_claim_rule_source_changed/)
  })
})
