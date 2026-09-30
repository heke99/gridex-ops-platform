const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createCoreFixture}=require('./provider-order-continuation-20260930-core.cjs')
test('current locked provider rank prevents delayed old status and completed duplicate from changing item or portal',async()=>{
  const f=await createCoreFixture()
  try{
    const immutable=await f.rows('customer_invoices')
    assert.equal((await f.apply(f.newer,'paid')).outcome,'processed')
    assert.equal((await f.apply(f.older,'overdue')).reason,'stale_provider_state_ignored')
    const before=await f.snapshot()
    assert.equal((await f.apply(f.newer,'paid')).reason,'provider_event_already_processed')
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.rows('invoice_export_items'))[0].provider_status,'paid')
    const invoice=(await f.rows('customer_invoices'))[0]
    assert.equal(invoice.status,'paid')
    for(const key of ['customer_id','customer_contract_id','contract_id','amount_ex_vat','vat_amount','amount_inc_vat','total_kwh','calculation_snapshot','calculation_snapshot_sha256','raw_payload'])
      assert.deepEqual(invoice[key],immutable[0][key])
    assert.equal(before.domain_events.length,2);assert.equal(before.event_outbox.length,2)
    assert.deepEqual(before.customers.map(row=>row.metadata),[{profile:'unchanged'},{profile:'unchanged'}])
  }finally{await f.db.close()}
})
test('a missing canonical mirror is reviewable without inventing an incomplete invoice or updating the item',async()=>{
  const f=await createCoreFixture()
  try{
    await f.db.query('delete from public.customer_invoices where id=$1',[f.invoiceA])
    const items=await f.rows('invoice_export_items')
    const result=await f.apply(f.newer,'paid')
    assert.equal(result.outcome,'needs_review');assert.equal(result.reason,'provider_invoice_canonical_snapshot_missing')
    assert.deepEqual(await f.rows('invoice_export_items'),items)
    assert.equal((await f.rows('customer_invoices')).length,1)
    assert.equal((await f.rows('domain_events')).length,0)
    assert.equal((await f.rows('event_outbox')).length,0)
  }finally{await f.db.close()}
})
test('delayed overdue cannot regress an already paid canonical invoice when the export status projection drifted',async()=>{
  for(const projection of ['unpaid',null]){
    const f=await createCoreFixture()
    try{
      await f.db.query('update public.invoice_export_items set provider_status=$1 where id=$2',[projection,f.itemA])
      await f.db.query("update public.customer_invoices set status='paid',paid_at='2026-09-29T10:00:00Z' where id=$1",[f.invoiceA])
      const before=await f.snapshot()
      const result=await f.apply(f.older,'overdue')
      assert.equal((await f.rows('customer_invoices'))[0].status,'paid')
      assert.equal(result.reason,'stale_canonical_invoice_state_ignored')
      for(const table of ['invoice_export_items','customer_invoices','customers','domain_events','event_outbox'])
        assert.deepEqual(await f.rows(table),before[table])
    }finally{await f.db.close()}
  }
})
test('low database roles cannot invoke provider status application',async()=>{
  const f=await createCoreFixture()
  try{
    const before=await f.snapshot()
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role;set role '+role)
      await assert.rejects(f.apply(f.newer,'paid'),error=>error.code==='42501')
    }
    await f.db.exec('reset role;set role service_role')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('wrong tenant, stale claim and altered claimed payload have no persistence effect',async()=>{
  const f=await createCoreFixture()
  try{
    const before=await f.snapshot()
    await assert.rejects(f.apply(f.newer,'paid',f.companyB),error=>error.code==='42501')
    await assert.rejects(f.apply(f.newer,'paid',f.companyA,'ea630000-0000-4000-8000-000000000099'),error=>error.code==='42501')
    await assert.rejects(f.apply(f.newer,'paid',f.companyA,f.token,{...f.payload,amount_inc_vat:999}),error=>error.code==='40001')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('late durable-intent failure rolls item, portal, event completion and domain event back together',async()=>{
  const f=await createCoreFixture()
  try{
    await f.db.exec(`reset role;create function private.synthetic_provider_outbox_failure()returns trigger language plpgsql as $$begin raise exception 'synthetic_late_outbox_failure';end;$$;
      create trigger synthetic_provider_outbox_failure before insert on public.event_outbox for each row execute function private.synthetic_provider_outbox_failure();set role service_role;`)
    const before=await f.snapshot()
    await assert.rejects(f.apply(f.newer,'paid'),error=>error.code==='P0001')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('amount mismatch records review without changing invoice or profiles and does not block a second tenant',async()=>{
  const f=await createCoreFixture()
  try{
    const payload={...f.payload,amount_inc_vat:999}
    await f.db.query('update public.invoice_provider_events set payload=$1::jsonb where id=$2',[JSON.stringify(payload),f.newer])
    const result=await f.apply(f.newer,'paid',f.companyA,f.token,payload)
    assert.equal(result.outcome,'needs_review');assert.equal(result.reason,'provider_amount_or_currency_mismatch')
    assert.equal((await f.rows('invoice_export_items'))[0].provider_status,'unpaid')
    assert.equal((await f.rows('customer_invoices'))[0].status,'sent')
    assert.equal((await f.apply(f.quiet,'paid',f.companyB)).outcome,'processed')
    assert.equal((await f.rows('customer_invoices'))[1].status,'paid')
  }finally{await f.db.close()}
})
