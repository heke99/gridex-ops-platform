import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { quote, session, sql, until } from './partner-queue-continuation-20260930-native'

type Claim = { id: string; company_id: string; priority: number; status: string; lock_token: string; attempts: number }
function claim(limit: number) {
  return `SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) FROM public.gridex_claim_customer_operation_jobs('synthetic-fair-worker',${limit}) j;`
}
function fixture() {
  // Wire before other fixtures leave eligible customer jobs. Never clear or
  // rewrite another fixture's queue to make this precondition pass.
  expect(sql<number>(`SELECT count(*)::int FROM public.customer_operation_jobs j JOIN public.companies c ON c.id=j.company_id
    WHERE c.status IN ('active','onboarding') AND NOT coalesce(j.lifecycle_blocked_by_tenant,false)
      AND j.status IN ('queued','running') AND j.run_after<=clock_timestamp();`)).toBe(0)
  const noisy = randomUUID(), quiet = randomUUID(), customerA = randomUUID(), customerB = randomUUID()
  const companies = [noisy,quiet].map(quote).join(',')
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(noisy)},'Synthetic customer queue noisy','active'),
      (${quote(quiet)},'Synthetic customer queue quiet','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
      (${quote(customerA)},${quote(noisy)},${quote(customerA)},'Synthetic queue A','private'),
      (${quote(customerB)},${quote(quiet)},${quote(customerB)},'Synthetic queue B','private');
    INSERT INTO public.customer_operation_jobs(company_id,customer_id,job_type,idempotency_key,run_after,created_at)
      SELECT ${quote(noisy)},${quote(customerA)},'request_customer_data',gen_random_uuid()::text,
        clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours' FROM generate_series(1,250);
    INSERT INTO public.customer_operation_jobs(company_id,customer_id,job_type,idempotency_key,run_after,created_at)
      VALUES(${quote(quiet)},${quote(customerB)},'request_customer_data',gen_random_uuid()::text,
        clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour'); SELECT to_jsonb(true);`)
  return { noisy,quiet,companies,
    snapshot: () => sql(`SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM public.customer_operation_jobs j
      WHERE company_id IN (${companies})),'turns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY company_id)
      FROM private.customer_operation_tenant_turns t WHERE company_id IN (${companies})));`),
    cleanup: () => sql(`DELETE FROM public.customer_operation_jobs WHERE company_id IN (${companies});
      DELETE FROM private.customer_operation_tenant_turns WHERE company_id IN (${companies}); SELECT to_jsonb(true);`),
  }
}

describe.sequential('native customer queue tenant isolation', () => {
  it('old global oldest batch starves quiet tenant; fair atomic batch serves it with capped noisy work', () => {
    const f = fixture()
    try {
      expect(sql<string[]>(`SELECT jsonb_agg(company_id) FROM(SELECT company_id FROM public.customer_operation_jobs
        WHERE company_id IN (${f.companies}) ORDER BY priority,run_after,created_at LIMIT 20) old_batch;`)).toEqual(Array(20).fill(f.noisy))
      const rows = sql<Claim[]>(`SET ROLE service_role; ${claim(20)}`)
      expect(rows.filter(row => row.company_id === f.noisy)).toHaveLength(5)
      expect(rows.filter(row => row.company_id === f.quiet)).toHaveLength(1)
      expect(rows.every(row => row.status === 'running' && row.attempts === 1 && row.lock_token)).toBe(true)
    } finally { f.cleanup() }
  })
  it('limit-one invocations rotate stored turns', () => {
    const f = fixture()
    try {
      expect(sql<Claim[]>(`SET ROLE service_role; ${claim(1)}`)[0].company_id).toBe(f.noisy)
      expect(sql<Claim[]>(`SET ROLE service_role; ${claim(1)}`)[0].company_id).toBe(f.quiet)
    } finally { f.cleanup() }
  })
  it('low roles and a late private turn failure cannot mutate claims', () => {
    const f = fixture(), fault = 'synthetic_customer_turn_' + randomUUID().replaceAll('-', '')
    try {
      const before = f.snapshot()
      for (const role of ['anon','authenticated']) expect(() => sql(`SET ROLE ${role}; ${claim(20)}`))
        .toThrow(/permission denied for function gridex_claim_customer_operation_jobs/)
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id IN (${f.companies}) THEN RAISE EXCEPTION 'synthetic_customer_turn_fault'; END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT OR UPDATE ON private.customer_operation_tenant_turns
          FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      expect(() => sql(`SET ROLE service_role; ${claim(20)}`)).toThrow(/synthetic_customer_turn_fault/)
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON private.customer_operation_tenant_turns;
        DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
  it('two real transactions claim disjoint rows using SKIP LOCKED', async () => {
    const f = fixture(), first = session('customer_fair_first_' + randomUUID()), name = 'customer_fair_second_' + randomUUID(), second = session(name)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${claim(1)}\n\\echo CUSTOMER_FAIR_FIRST_HELD\n`)
      await until(() => first.output().stdout.includes('CUSTOMER_FAIR_FIRST_HELD'), 'customer_first_not_held')
      const a = JSON.parse(first.output().stdout.split('\n').find(line => line.startsWith('['))!) as Claim[]
      second.child.stdin.end(`SET ROLE service_role; ${claim(1)}`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)}
        AND wait_event_type='Lock'));`), 'customer_turn_second_not_waiting')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited).toBe(0); expect(await second.exited).toBe(0)
      const b = JSON.parse(second.output().stdout.split('\n').find(line => line.startsWith('['))!) as Claim[]
      expect(a).toHaveLength(1); expect(b).toHaveLength(1); expect(b[0].id).not.toBe(a[0].id)
    } finally {
      for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
      await Promise.allSettled([first.exited,second.exited]); f.cleanup()
    }
  })
})
