import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('webhook_fair_claim_disposable_stack_required')
  }
  return JSON.parse(execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000,
  }).trim()) as T
}
type Claim = { id: string; company_id: string; status: string; attempts: number; locked_by: string; locked_at: string }
function claim(limit: number, token = randomUUID()) {
  return `SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'company_id',d.company_id,'status',d.status,
    'attempts',d.attempts,'locked_by',d.locked_by,'locked_at',d.locked_at)), '[]'::jsonb)
    FROM public.gridex_claim_webhook_deliveries_fair_v1(${limit},${quote(token)}) d;`
}
function fixture() {
  // This suite must be wired before any other fixture that leaves due webhook
  // deliveries. Never reset somebody else's queue to obtain a passing result.
  expect(sql<number>(`SELECT count(*)::int FROM public.webhook_deliveries WHERE status IN ('queued','failed') AND next_attempt_at<=clock_timestamp();`)).toBe(0)
  const noisy = randomUUID(), quiet = randomUUID(), subA = randomUUID(), subB = randomUUID()
  const companyList = [noisy, quiet].map(quote).join(',')
  sql(`INSERT INTO public.companies(id,name,status) VALUES (${quote(noisy)},'Synthetic webhook noisy','active'),(${quote(quiet)},'Synthetic webhook quiet','active');
    INSERT INTO public.webhook_subscriptions(id,company_id,name,endpoint_url,event_types) VALUES
      (${quote(subA)},${quote(noisy)},'Synthetic noisy','https://partner.example.invalid/hook',ARRAY['webhook.test']),
      (${quote(subB)},${quote(quiet)},'Synthetic quiet','https://partner.example.invalid/hook',ARRAY['webhook.test']);
    WITH events AS (
      INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,payload)
      SELECT ${quote(noisy)},'webhook.test','synthetic',i::text,'{}'::jsonb FROM generate_series(1,150) i RETURNING id,aggregate_id
    ) INSERT INTO public.webhook_deliveries(company_id,webhook_subscription_id,domain_event_id,event_type,idempotency_key,next_attempt_at,payload)
      SELECT ${quote(noisy)},${quote(subA)},e.id,'webhook.test',e.id::text,'0001-01-01'::timestamptz,'{}' FROM events e;
    WITH events AS (
      INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,payload)
      SELECT ${quote(quiet)},'webhook.test','synthetic',i::text,'{}'::jsonb FROM generate_series(1,3) i RETURNING id
    ) INSERT INTO public.webhook_deliveries(company_id,webhook_subscription_id,domain_event_id,event_type,idempotency_key,next_attempt_at,payload)
      SELECT ${quote(quiet)},${quote(subB)},e.id,'webhook.test',e.id::text,'0002-01-01'::timestamptz,'{}' FROM events e;
    SELECT to_jsonb(true);`)
  return {
    noisy, quiet, companyList,
    snapshot: () => sql(`SELECT jsonb_build_object(
      'deliveries',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.webhook_deliveries d WHERE company_id IN (${companyList})),
      'turns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.company_id) FROM private.webhook_dispatch_tenant_turns t WHERE company_id IN (${companyList})));`),
    // Company insertion also creates published immutable legal versions.
    // Retain that synthetic company/history until disposable stack teardown;
    // never cascade-delete or unpublish it merely to clean a queue fixture.
    cleanup: () => sql(`DELETE FROM public.webhook_deliveries WHERE company_id IN (${companyList})
        AND webhook_subscription_id IN (${quote(subA)},${quote(subB)});
      DELETE FROM public.event_outbox o USING public.domain_events e WHERE o.domain_event_id=e.id
        AND e.company_id IN (${companyList}) AND e.event_type='webhook.test' AND e.aggregate_type='synthetic';
      DELETE FROM public.domain_events WHERE company_id IN (${companyList})
        AND event_type='webhook.test' AND aggregate_type='synthetic';
      DELETE FROM public.webhook_subscriptions WHERE company_id IN (${companyList}) AND id IN (${quote(subA)},${quote(subB)});
      DELETE FROM private.webhook_dispatch_tenant_turns WHERE company_id IN (${companyList});
      SELECT to_jsonb(true);`),
  }
}
function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? -1)) })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, failure: string) {
  const deadline = Date.now() + 12_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(failure)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
function outputClaim(output: string): Claim[] {
  const lines = output.split('\n').filter(line => line.startsWith('['))
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0]) as Claim[]
}

describe.sequential('real PostgreSQL webhook tenant-fair atomic claim', () => {
  it('reproduces old tenant starvation, then caps and balances the atomic claim', () => {
    const f = fixture(), token = randomUUID()
    try {
      expect(sql<string[]>(`SELECT jsonb_agg(company_id) FROM (SELECT company_id FROM public.webhook_deliveries
        WHERE status IN ('queued','failed') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at LIMIT 25) old_query;`))
        .toEqual(Array(25).fill(f.noisy))
      const rows = sql<Claim[]>(`SET ROLE service_role; ${claim(25, token)}`)
      expect(rows.filter(row => row.company_id === f.noisy)).toHaveLength(5)
      expect(rows.filter(row => row.company_id === f.quiet)).toHaveLength(3)
      expect(rows.map(row => row.company_id)).toEqual([f.noisy,f.quiet,f.noisy,f.quiet,f.noisy,f.quiet,f.noisy,f.noisy])
      expect(rows.every(row => row.status === 'processing' && row.attempts === 0 && row.locked_by === token && row.locked_at)).toBe(true)
      expect(sql<number>(`SELECT count(*)::int FROM private.webhook_dispatch_tenant_turns WHERE company_id IN (${f.companyList});`)).toBe(2)
      console.log('WEBHOOK_FAIR_NATIVE_PASS old_limit25_noisy25=true quiet3=true noisy_cap5=true claim_turn_atomic=true')
    } finally { f.cleanup() }
  })

  it('limit-one dispatches rotate persisted tenant turns instead of choosing the same old backlog', () => {
    const f = fixture()
    try {
      const first = sql<Claim[]>(`SET ROLE service_role; ${claim(1)}`)
      const second = sql<Claim[]>(`SET ROLE service_role; ${claim(1)}`)
      expect(first.map(row => row.company_id)).toEqual([f.noisy])
      expect(second.map(row => row.company_id)).toEqual([f.quiet])
      console.log('WEBHOOK_FAIR_ROTATION_NATIVE_PASS limit1=true persisted_turn=true quiet_second=true')
    } finally { f.cleanup() }
  })

  it('does not re-claim processing rows, future retries or exhausted attempts', () => {
    const f = fixture()
    try {
      sql(`UPDATE public.webhook_deliveries SET next_attempt_at=clock_timestamp()+interval '1 day' WHERE company_id=${quote(f.quiet)};
        UPDATE public.webhook_deliveries SET attempts=max_attempts WHERE company_id=${quote(f.noisy)};
        SELECT to_jsonb(true);`)
      const before = f.snapshot()
      expect(sql<Claim[]>(`SET ROLE service_role; ${claim(100)}`)).toEqual([])
      expect(f.snapshot()).toEqual(before)
      console.log('WEBHOOK_FAIR_ELIGIBILITY_NATIVE_PASS future_exhausted_denied=true no_effect=true')
    } finally { f.cleanup() }
  })

  it('low database roles cannot call the queue claim or alter its private turn state', () => {
    const f = fixture()
    try {
      const before = f.snapshot()
      for (const role of ['anon', 'authenticated']) {
        expect(sql(`SELECT jsonb_build_object('execute',has_function_privilege(${quote(role)},
          'public.gridex_claim_webhook_deliveries_fair_v1(integer,text)','EXECUTE'),
          'write',has_table_privilege(${quote(role)},'private.webhook_dispatch_tenant_turns','INSERT,UPDATE,DELETE'));`))
          .toEqual({ execute: false, write: false })
        expect(() => sql(`SET ROLE ${role}; ${claim(25)}`)).toThrow()
      }
      expect(f.snapshot()).toEqual(before)
      console.log('WEBHOOK_FAIR_ACL_NATIVE_PASS anon_authenticated_denied=true private_turn_acl=true no_effect=true')
    } finally { f.cleanup() }
  })

  it('invalid input and a late turn-write failure leave delivery claims unchanged', () => {
    const f = fixture(), fault = `synthetic_webhook_turn_fault_${randomUUID().replaceAll('-', '')}`
    try {
      const before = f.snapshot()
      for (const limit of [0, 101]) expect(() => sql(`SET ROLE service_role; ${claim(limit)}`)).toThrow()
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id IN (${f.companyList}) THEN RAISE EXCEPTION 'synthetic_webhook_turn_late_fault'; END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT OR UPDATE ON private.webhook_dispatch_tenant_turns
          FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      expect(() => sql(`SET ROLE service_role; ${claim(25)}`)).toThrow()
      expect(f.snapshot()).toEqual(before)
      console.log('WEBHOOK_FAIR_ROLLBACK_NATIVE_PASS late_turn_fault=true delivery_turn_unchanged=true')
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON private.webhook_dispatch_tenant_turns;
        DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })

  it('two real workers cannot claim the same delivery while a transaction holds the first claim', async () => {
    const f = fixture(), first = session(`webhook_first_${randomUUID()}`), second = session(`webhook_second_${randomUUID()}`)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${claim(1)}\n\\echo WEBHOOK_FIRST_CLAIM_HELD\n`)
      await until(() => first.output().stdout.includes('WEBHOOK_FIRST_CLAIM_HELD'), 'first_webhook_claim_not_held')
      const firstRows = outputClaim(first.output().stdout)
      const secondExit = second.exited
      second.child.stdin.end(`SET ROLE service_role; ${claim(1)}\n`)
      // The row claim uses SKIP LOCKED; updating the same tenant's turn may
      // correctly wait for the first atomic transaction before committing.
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name LIKE 'webhook_second_%' AND wait_event_type='Lock'));`), 'second_webhook_turn_did_not_wait')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited).toBe(0); expect(await secondExit).toBe(0)
      const secondRows = outputClaim(second.output().stdout)
      expect(firstRows).toHaveLength(1); expect(secondRows).toHaveLength(1)
      expect(secondRows[0].id).not.toBe(firstRows[0].id)
      expect(sql<number>(`SELECT count(*)::int FROM public.webhook_deliveries WHERE company_id IN (${f.companyList}) AND status='processing';`)).toBe(2)
      console.log('WEBHOOK_FAIR_CONCURRENCY_NATIVE_PASS sessions2=true skip_locked_disjoint=true committed_claims2=true')
    } finally {
      for (const item of [first, second]) if (item.child.exitCode === null) item.child.kill('SIGTERM')
      await Promise.allSettled([first.exited, second.exited])
      f.cleanup()
    }
  })
})
