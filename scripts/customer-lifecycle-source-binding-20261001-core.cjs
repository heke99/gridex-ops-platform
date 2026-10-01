/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node --test CommonJS harness; no production module or browser bundle. */
// Business PostgreSQL core: actual current case/decision DDL and actual exported
// producer. Parent resource tables are deliberately narrow row scaffolding;
// this does not qualify Auth, PostgREST, the full schema, or legacy graph atomicity.
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const root = resolve(__dirname, '..')
const migration = '20261001042748_customer_lifecycle_case_source_binding.sql'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
// Exact decision CREATE TABLE from the actual generated 57534afc baseline.
// Pin this old shape so later genuine schema adoption does not erase the
// upgrade regression or pretend the missing columns always existed.
const decisionBaseline = `CREATE TABLE public.customer_lifecycle_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    customer_id uuid NOT NULL,
    decision_type text NOT NULL,
    scope_type text DEFAULT 'customer'::text NOT NULL,
    scope_id uuid,
    reason text NOT NULL,
    billing_blocked boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_lifecycle_decisions_decision_type_check CHECK ((decision_type = ANY (ARRAY['withdrawal'::text, 'rejected'::text]))),
    CONSTRAINT customer_lifecycle_decisions_scope_type_check CHECK ((scope_type = ANY (ARRAY['customer'::text, 'contract'::text, 'site'::text, 'metering_point'::text])))
);`
const originalColumns = 'id,company_id,customer_id,decision_type,scope_type,scope_id,reason,billing_blocked,created_by,created_at'
function actualTable(name) {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl, `missing actual table: ${name}`)
  return ddl
}
function producer() {
  const source = readFileSync(resolve(root, 'lib/operations/switchLifecycleBlocks.ts'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', output)(exports)
  return exports.createLifecycleDecisionFromCase
}
function client(db) {
  const errors = [], queries = []
  const api = {
    from(table) {
      assert.equal(table, 'customer_lifecycle_decisions')
      const filters = [], values = []
      let inserted
      const chain = {
        select() { return chain },
        eq(column, value) { filters.push(`"${column}" = $${values.push(value)}`); return chain },
        is(column, value) { assert.equal(value, null); filters.push(`"${column}" is null`); return chain },
        limit(value) { assert.equal(value, 1); return chain },
        insert(value) { inserted = value; return chain },
        async maybeSingle() {
          const sql = `select id from public.${table}${filters.length ? ' where ' + filters.join(' and ') : ''} limit 1`
          queries.push(sql)
          try {
            const result = await db.query(sql, values)
            return { data: result.rows[0] ?? null, error: null }
          } catch (error) { errors.push(error.code); return { data: null, error } }
        },
        async single() {
          const columns = Object.keys(inserted)
          const sql = `insert into public.${table}(${columns.map(name => `"${name}"`).join(',')}) values(${columns.map((_, i) => '$' + (i + 1)).join(',')}) returning id`
          queries.push(sql)
          try { return { data: (await db.query(sql, Object.values(inserted))).rows[0], error: null } }
          catch (error) { errors.push(error.code); return { data: null, error } }
        },
      }
      return chain
    },
  }
  return { api, errors, queries }
}
async function fixture(options = {}) {
  const db = new PGlite()
  try {
    await db.exec(`create schema private;
      create table public.customers(id uuid primary key,company_id uuid not null,unique(id,company_id));
      create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid);
      create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid);
      create table public.customer_contracts(id uuid primary key,company_id uuid not null,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid);
      ${actualTable('customer_cases')}
      ${decisionBaseline}
      alter table public.customer_cases add primary key(id);
      alter table public.customer_lifecycle_decisions add primary key(id);
      alter table public.customer_cases add constraint customer_cases_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete cascade;
      alter table public.customer_lifecycle_decisions add constraint customer_lifecycle_decisions_customer_company_fk foreign key(customer_id,company_id) references public.customers(id,company_id) on update cascade on delete set null;
      insert into public.customers(id,company_id) values('${id(2)}','${id(1)}'),('${id(12)}','${id(11)}');
      insert into public.customer_sites(id,company_id,customer_id) values('${id(3)}','${id(1)}','${id(2)}'),('${id(13)}','${id(11)}','${id(12)}');
      insert into public.metering_points(id,company_id,customer_id,site_id) values('${id(4)}','${id(1)}','${id(2)}','${id(3)}'),('${id(14)}','${id(11)}','${id(12)}','${id(13)}');
      insert into public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id) values('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}');
      insert into public.customer_cases(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,case_type,title,billing_blocked,withdrawal_requested_at,metadata)
      values('${id(6)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}','withdrawal','Owned withdrawal',true,'2026-09-29T10:00:00Z','{"receivedChannel":"phone","notes":"Owned staff note"}');`)
    const forward = options.baseline ? null : options.migrationPath ?? resolve(root, 'supabase/migrations', migration)
    if (forward && existsSync(forward)) await db.exec(readFileSync(forward, 'utf8'))
    const caseRow = (await db.query('select * from public.customer_cases where id=$1', [id(6)])).rows[0]
    const transport = client(db)
    return {
      db, id, caseRow, transport,
      execute: (row = caseRow, actor = id(7)) => producer()(transport.api, row, actor),
      originalSnapshot: () => db.query(`select row_to_json(t)::text as bytes from (select ${originalColumns} from public.customer_lifecycle_decisions order by id) t`),
      close: () => db.close(),
    }
  } catch (error) { await db.close(); throw error }
}
module.exports = { fixture, id, root, originalColumns, producer, client, migration }
