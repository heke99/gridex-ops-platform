import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const original = readFileSync('supabase/migrations/20260809180628_gridex_ops_external_api_performance_foundation.sql','utf8')
const optimized = readFileSync('supabase/migrations/20261122135200_index_portal_document_page_winners.sql','utf8')
const baseline = original.slice(original.indexOf('create index if not exists customer_documents_portal_keyset_idx'),original.indexOf('\ndo $$',original.indexOf('create or replace function public.portal_customer_documents_page_v1')))
const fields = `id uuid primary key, company_id uuid, customer_id uuid, document_type text,status text,title text,file_name text,
mime_type text,file_size_bytes bigint,public_url text,source_system text,source text,power_of_attorney_id uuid,document_version text,
uploaded_at timestamptz,created_at timestamptz`
await db.exec(`create role anon; create role authenticated; create role service_role;
create table customer_documents(${fields}); create table customer_authorization_documents(${fields});`)
const company = '11111111-1111-4111-8111-111111111111'
const customer = '22222222-2222-4222-8222-222222222222'
for (const [table, source] of [['customer_documents', 'doc'], ['customer_authorization_documents', 'auth']]) {
  await db.exec(`insert into ${table} (id,company_id,customer_id,created_at,status,power_of_attorney_id,title)
    select md5('${source}'||n)::uuid, '${company}', '${customer}', '2026-08-01T00:00:00Z'::timestamptz + (n/3)*interval '1 minute',
    case when n % 41 = 0 then 'archived' else 'active' end,
    case when n % 4 = 0 then md5('poa'||(n/8))::uuid else null end, '${source}'||n
    from generate_series(1,4000) n;
  insert into ${table} (id,company_id,customer_id,created_at,status,power_of_attorney_id)
    values (md5('${source}-other')::uuid,'${company}',md5('foreign')::uuid,now(),'active',md5('poa500')::uuid);
  analyze ${table};`)
}
await db.exec(baseline)
await db.exec(baseline.replaceAll('portal_customer_documents_page_v1','portal_customer_documents_page_baseline'))
await db.exec(optimized)
const first = [company, customer, null, null, null, 21]
const sql = name => `select * from ${name}($1::uuid,$2::uuid,$3::timestamptz,$4::integer,$5::uuid,$6::integer)`
let args = first
for (let index = 0; index < 20; index++) {
  const oldRows = (await db.query(sql('portal_customer_documents_page_baseline'), args)).rows
  const newRows = (await db.query(sql('portal_customer_documents_page_v1'), args)).rows
  assert.deepEqual(newRows, oldRows)
  assert.equal(newRows.length, 21)
  if (index === 0 || index === 10) {
    for (const [label, src] of [['baseline', baseline], ['optimized', optimized]]) {
      const body = src.split('as $$')[1].split('$$;')[0].trim().replace(/;$/, '')
      const params = ['company_id','customer_id','cursor_created_at','cursor_source_rank','cursor_id','limit']
      const types = ['uuid','uuid','timestamptz','integer','uuid','integer']
      const prepared = body.replace(/\bp_(\w+)\b/g, (_match, name) => {
        const index = params.indexOf(name)
        return `$${index + 1}::${types[index]}`
      })
      const plan = await db.query('explain (analyze, costs off, buffers) ' + prepared, args)
      const summary = plan.rows.map(row => row['QUERY PLAN']).filter(line =>
        /WindowAgg|Execution Time|Index Scan|Append|Scan on/.test(line))
      console.log(index + 1, label, summary.join('\n'))
      if (label === 'optimized') {
        assert.ok(summary.some(line => line.includes('Merge Append')))
        assert.ok(!summary.some(line => line.includes('WindowAgg')))
      }
    }
  }
  const cursor = newRows[19]
  args = [company, customer, cursor.created_at.toISOString(), cursor.source_rank, cursor.id, 21]
}
await db.close()
