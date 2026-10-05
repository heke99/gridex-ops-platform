// DB-05 (partial, F-DB-05-01 only; not an approval of DB-05): native PostgreSQL proof of the hard-delete guard after
// canonical clean replay. Every production trigger stays enabled; all writes roll back.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'

const psql = (sql: string) => execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8', timeout: 120000,
}).trim()

it('refuses service_role hard deletes of a live company or customer and keeps the cascading history', () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const live = randomUUID(), disposable = randomUUID(), customer = randomUUID()
  const out = psql(`BEGIN;
    INSERT INTO public.companies(id,name,status) VALUES ('${live}','Synthetic guard live','active'),('${disposable}','Synthetic guard disposable','active');
    INSERT INTO public.customers(id,company_id) VALUES ('${customer}','${live}');
    INSERT INTO public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,idempotency_key) VALUES ('${live}','x','y','${live}','g1');
    CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN EXECUTE q; RETURN 'deleted'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $f$;
    GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO service_role;
    SET LOCAL ROLE service_role;
    SELECT json_build_object(
      'company', pg_temp.try('DELETE FROM public.companies WHERE id=''${live}'''),
      'customer', pg_temp.try('DELETE FROM public.customers WHERE id=''${customer}'''));
    RESET ROLE;
    SELECT json_build_object('companies',(SELECT count(*) FROM public.companies WHERE id='${live}'),
      'customers',(SELECT count(*) FROM public.customers WHERE id='${customer}'),
      'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id='${live}'),
      'guards',(SELECT json_agg(tgname ORDER BY tgname) FROM pg_trigger WHERE tgname IN ('gridex_companies_hard_delete_guard','gridex_customers_hard_delete_guard') AND tgenabled='O'));
    ROLLBACK;`)
  const [attempts, state] = out.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  console.log(JSON.stringify({ kind: 'db05_hard_delete_guard_native', disposable, attempts, state }))
  expect(attempts.company).toMatch(/^23001:company_hard_delete_blocked/)
  expect(attempts.customer).toMatch(/^23001:customer_hard_delete_blocked/)
  expect(state).toEqual({ companies: 1, customers: 1, audit: 1, guards: ['gridex_companies_hard_delete_guard', 'gridex_customers_hard_delete_guard'] })
}, 120000)
