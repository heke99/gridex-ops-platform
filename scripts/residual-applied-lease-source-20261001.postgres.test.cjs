const assert=require('node:assert/strict')
const {test}=require('node:test')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {createQueueCore}=require('./residual-tenant-queues-20260930-core.cjs')
test('native fixture reads the actual installed lease fragment and preserves current-row/exact-cutoff CAS',async()=>{
  const native=readFileSync(resolve(__dirname,'residual-tenant-queues-20260930-native.test.ts'),'utf8')
  const getter=native.match(/const source = sql<string>\(`([^`]+)`\)/)?.[1]
  assert.ok(getter,'native fixture must read applied SQL instead of a relocated migration file')
  const f=await createQueueCore()
  try{
    const source=(await f.db.query(getter)).rows[0].to_jsonb
    assert.ok(source.includes('CREATE OR REPLACE FUNCTION private.gridex_claim_partner_queue_fair_v1'))
    const fragment=source.match(/v_lease:=\$fragment\$, leases as \(([\s\S]*?)\n    \)\$fragment\$/)?.[1]
    assert.ok(fragment,'actual installed production UPSERT fragment is required')
    await f.seed('approved_invoice_retry',1,0)
    const item=(await f.db.query('select id from public.invoice_export_items')).rows[0].id
    const competitor='ea650000-0000-4000-8000-000000000098',caller='ea650000-0000-4000-8000-000000000099'
    await f.db.query('insert into private.approved_invoice_retry_leases(company_id,item_id,claim_token,claimed_at)values($1,$2,$3,clock_timestamp())',[f.tenantA,item,competitor])
    const run=async clock=>{
      const write=fragment.replaceAll('$7',`'${caller}'::uuid`).replaceAll('$4',clock)
      return(await f.db.query(`with applied as(select * from invoice_export_items where id='${item}'),leases as(${write})select count(*)::int as n from leases`)).rows[0].n
    }
    assert.equal(await run('clock_timestamp()'),0)
    assert.equal((await f.db.query('select claim_token from private.approved_invoice_retry_leases')).rows[0].claim_token,competitor)
    await f.db.exec("update private.approved_invoice_retry_leases set claimed_at='2026-09-30T10:00:00Z'")
    assert.equal(await run("'2026-09-30T12:00:00Z'::timestamptz"),0)
    assert.equal((await f.db.query('select claim_token from private.approved_invoice_retry_leases')).rows[0].claim_token,competitor)
  }finally{await f.db.close()}
})
