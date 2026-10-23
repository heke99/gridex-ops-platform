// reality-defects: F104
// FINDINGS F104 (reality world 2026-10-23, scenario F run 26). The inbound mail engine runs once per lane, but a
// test-lane run (inbound-mail-engine-2026-10-23T10:05:53.057Z) claimed six production inbound_processing_jobs.
// The caller now passes its lane; 20261023190000_inbound_processing_claim_lane.sql hardens the claim: the job's
// lane is its mail's environment, else its mailbox's, and an unknown lane is refused. NULL stays the explicit
// all-lanes claim. Lease/locking (FOR UPDATE OF j SKIP LOCKED, stale reclaim, attempts_count) is unchanged.
// Proved natively on the owned local stack. The migration is NOT applied to the shared world: every case applies
// it inside a REPEATABLE READ transaction that is always rolled back, together with its synthetic tenant, mailboxes,
// mails and jobs. A guard refuses to claim while any non-synthetic job is claimable, so no world row is touched.
// F104_NATIVE_OLD_CLAIM=1 runs the same cases against the installed (old) function to show they fail there.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json npx vitest run -c scripts/inbound-processing-claim-lane-native.config.ts
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { literal as lit, sql } from './helpers/live-chain-fixture'

const MIGRATION = resolve(__dirname, '../supabase/migrations/20261023190000_inbound_processing_claim_lane.sql')
const migrationBody = () => {
  const text = readFileSync(MIGRATION, 'utf8')
  const statements = text.replace(/^\s*begin;\s*$/m, '').replace(/^\s*commit;\s*$/m, '')
  if (/^\s*(begin|commit);\s*$/im.test(statements)) throw Error('f104_migration_transaction_markers')
  return statements
}
const applyMigration = process.env.F104_NATIVE_OLD_CLAIM === '1' ? '' : migrationBody()

type Claimed = { id: string; company_id: string | null; status: string; step: string; locked_by: string; attempts_count: number; error_message: string | null }
type Fixture = ReturnType<typeof fixture>

function fixture() {
  const company = randomUUID()
  const mailbox = { production: randomUUID(), test: randomUUID() }
  const mail = { production: randomUUID(), test: randomUUID(), nullInProductionMailbox: randomUUID(), nullWithoutMailbox: randomUUID(),
    staleTest: randomUUID(), staleProduction: randomUUID() }
  const job = { nullInProductionMailbox: randomUUID(), nullWithJobProductionMailbox: randomUUID(), production: randomUUID(), test: randomUUID(),
    staleTest: randomUUID(), staleProduction: randomUUID() }
  return { company, mailbox, mail, job, ids: Object.values(job) }
}

function seed(f: Fixture): string {
  const mailRow = (id: string, environment: string | null, mailboxId: string | null) =>
    `(${lit(id)},${lit(f.company)},${lit(mailboxId)},${lit(environment)})`
  const jobRow = (id: string, mailId: string, jobMailboxId: string | null, status: string, second: number, staleLock = false) =>
    `(${lit(id)},${lit(f.company)},${lit(jobMailboxId)},${lit(mailId)},${lit(status)},${staleLock ? "now() - interval '20 minutes'" : 'NULL'},
      ${staleLock ? "'f104-killed-worker'" : 'NULL'},${staleLock ? 2 : 0},${lit(`2000-01-01T00:00:0${second}Z`)}::timestamptz)`
  return `
    INSERT INTO public.companies(id,name,status) VALUES(${lit(f.company)},'F104 synthetic tenant','active');
    INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,environment,is_active) VALUES
      (${lit(f.mailbox.production)},${lit(f.company)},'F104 synthetic production mailbox','production',false),
      (${lit(f.mailbox.test)},${lit(f.company)},'F104 synthetic test mailbox','test',false);
    INSERT INTO public.inbound_email_messages(id,company_id,mailbox_id,environment) VALUES
      ${mailRow(f.mail.production, 'production', f.mailbox.production)},
      ${mailRow(f.mail.test, 'test', f.mailbox.test)},
      ${mailRow(f.mail.nullInProductionMailbox, null, f.mailbox.production)},
      ${mailRow(f.mail.nullWithoutMailbox, null, null)},
      ${mailRow(f.mail.staleTest, 'test', f.mailbox.test)},
      ${mailRow(f.mail.staleProduction, 'production', f.mailbox.production)};
    -- Synthetic jobs sort before every world job (created_at 2000).
    INSERT INTO public.inbound_processing_jobs(id,company_id,mailbox_id,inbound_email_message_id,status,locked_at,locked_by,attempts_count,created_at) VALUES
      ${jobRow(f.job.nullInProductionMailbox, f.mail.nullInProductionMailbox, f.mailbox.production, 'queued', 1)},
      ${jobRow(f.job.nullWithJobProductionMailbox, f.mail.nullWithoutMailbox, f.mailbox.production, 'retry', 2)},
      ${jobRow(f.job.production, f.mail.production, f.mailbox.production, 'queued', 3)},
      ${jobRow(f.job.test, f.mail.test, f.mailbox.test, 'queued', 4)},
      ${jobRow(f.job.staleTest, f.mail.staleTest, f.mailbox.test, 'processing', 5, true)},
      ${jobRow(f.job.staleProduction, f.mail.staleProduction, f.mailbox.production, 'processing', 6, true)};
    -- Read-only guard: nothing outside this fixture may be claimable in this snapshot.
    DO $guard$ BEGIN
      IF EXISTS (SELECT FROM public.inbound_processing_jobs j WHERE j.id <> ALL(ARRAY[${f.ids.map(lit).join(',')}]::uuid[])
        AND j.status IN ('queued','retry','received','processing') AND (j.locked_at IS NULL OR j.locked_at < now() - interval '10 minutes')) THEN
        RAISE EXCEPTION 'f104_world_has_claimable_jobs_retry_later';
      END IF;
    END $guard$;
    CREATE TEMP TABLE f104_claims(step int, lane text, row jsonb) ON COMMIT DROP;`
}

const claim = (step: number, lane: string | null, limit: number) =>
  `INSERT INTO f104_claims SELECT ${step}, ${lit(lane ?? 'all')}, to_jsonb(c) FROM public.claim_inbound_processing_jobs(${lit(lane)}, ${limit}, ${lit(`f104-${lane ?? 'all'}-worker`)}, interval '10 minutes') c;`

/** Seeds, applies the migration, claims and reads inside one transaction that is always rolled back. */
function run<T>(f: Fixture, body: string, read: string): T {
  return sql<T>(`BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
${applyMigration}
${seed(f)}
${body}
${read}
ROLLBACK;`)
}

const claimedBy = (rows: Array<{ step: number; row: Claimed }>, step: number) => rows.filter(r => r.step === step).map(r => r.row)
const readClaims = `SELECT coalesce(jsonb_agg(jsonb_build_object('step', step, 'row', row) ORDER BY step, row->>'created_at'), '[]') FROM f104_claims;`

describe('claim_inbound_processing_jobs claims only the run lane (F104)', () => {
  it('a test-lane run never claims a production job, and a production-lane run never claims a test job', () => {
    const f = fixture()
    const rows = run<Array<{ step: number; row: Claimed }>>(f, `
      ${claim(1, 'test', 2)}
      ${claim(2, 'test', 2)}
      ${claim(3, 'production', 4)}
      ${claim(4, 'production', 4)}`, readClaims)
    const test = claimedBy(rows, 1), production = claimedBy(rows, 3)
    // Only the two test-lane jobs, never one whose mail or mailbox is production.
    expect(test.map(j => j.id)).toEqual([f.job.test, f.job.staleTest])
    // A mail without environment belongs to its mailbox lane (its own mailbox, else the job's).
    expect(production.map(j => j.id)).toEqual([f.job.nullInProductionMailbox, f.job.nullWithJobProductionMailbox, f.job.production, f.job.staleProduction])
    // The lease is unchanged: claimed jobs are not claimed again by a second run of the same lane.
    expect(claimedBy(rows, 2)).toEqual([])
    expect(claimedBy(rows, 4)).toEqual([])
    for (const job of [...test, ...production]) {
      expect(job).toMatchObject({ company_id: f.company, status: 'processing', step: 'processor_claimed' })
    }
    expect(test.map(j => j.locked_by)).toEqual(['f104-test-worker', 'f104-test-worker'])
    expect(new Set(production.map(j => j.locked_by))).toEqual(new Set(['f104-production-worker']))
    // A stale lock of the own lane is reclaimed and counted; a fresh job counts its first claim.
    expect(test.find(j => j.id === f.job.staleTest)).toMatchObject({ attempts_count: 3, error_message: 'stale_inbound_lock_reclaimed' })
    expect(test.find(j => j.id === f.job.test)).toMatchObject({ attempts_count: 1, error_message: null })
    expect(production.find(j => j.id === f.job.staleProduction)).toMatchObject({ attempts_count: 3, error_message: 'stale_inbound_lock_reclaimed' })
  })

  it('a production-lane run claimed first leaves the test job to the test lane', () => {
    const f = fixture()
    const rows = run<Array<{ step: number; row: Claimed }>>(f, `
      ${claim(1, 'production', 6)}
      ${claim(2, 'test', 6)}`, readClaims)
    expect(claimedBy(rows, 1).map(j => j.id)).toEqual([f.job.nullInProductionMailbox, f.job.nullWithJobProductionMailbox, f.job.production, f.job.staleProduction])
    expect(claimedBy(rows, 2).map(j => j.id)).toEqual([f.job.test, f.job.staleTest])
  })

  it('NULL stays the explicit all-lanes claim (platform admin queue action)', () => {
    const f = fixture()
    const rows = run<Array<{ step: number; row: Claimed }>>(f, claim(1, null, 6), readClaims)
    expect(claimedBy(rows, 1).map(j => j.id)).toEqual(f.ids)
  })

  it('an unknown lane is refused instead of claiming nothing silently', () => {
    const f = fixture()
    const result = run<{ state: string; claimed: number }>(f, `
      CREATE TEMP TABLE f104_error(state text) ON COMMIT DROP;
      DO $bad$ BEGIN
        PERFORM public.claim_inbound_processing_jobs('prod', 6, 'f104-bad-worker', interval '10 minutes');
        INSERT INTO f104_error VALUES ('no_error');
      EXCEPTION WHEN others THEN INSERT INTO f104_error VALUES (SQLSTATE || ':' || SQLERRM);
      END $bad$;`,
    `SELECT jsonb_build_object('state', (SELECT state FROM f104_error),
      'claimed', (SELECT count(*) FROM public.inbound_processing_jobs WHERE id = ANY(ARRAY[${f.ids.map(lit).join(',')}]::uuid[]) AND status = 'processing' AND locked_by = 'f104-bad-worker'));`)
    expect(result).toEqual({ state: '22023:inbound_processing_claim_environment_invalid:prod', claimed: 0 })
  })

  it('keeps owner, ACL, SECURITY INVOKER and search_path of the installed function', () => {
    const f = fixture()
    const meta = `(SELECT jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'acl', p.proacl::text, 'definer', p.prosecdef,
      'config', p.proconfig, 'volatile', p.provolatile, 'returns', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid))
      FROM pg_proc p WHERE p.oid = 'public.claim_inbound_processing_jobs(text,integer,text,interval)'::regprocedure)`
    const before = sql<Record<string, unknown>>(`SELECT ${meta};`)
    const after = run<Record<string, unknown>>(f, '', `SELECT ${meta};`)
    expect(after).toEqual(before)
    expect(after).toMatchObject({ owner: 'postgres', definer: false, config: ['search_path=public, pg_temp'] })
  })
})
