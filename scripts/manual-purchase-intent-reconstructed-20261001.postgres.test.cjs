const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createFixture}=require('./manual-purchase-intent-reconstructed-20261001-core.cjs')
test('actual SQL commits a permanent first barrier, never reclaims it, and replays without provider permission',async()=>{
 const f=await createFixture()
 try{
  const first=await f.claim();assert.equal(first.shouldPost,true);assert.equal(first.status,'dispatch_started')
  const before=await f.snapshot()
  const second=await f.claim();assert.equal(second.shouldPost,false);assert.equal(second.intentId,first.intentId)
  assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
test('completed replay keeps one observation/event/audit and preserves original financing, financial and request fields',async()=>{
 const f=await createFixture()
 try{
  const original=await f.snapshot();const first=await f.claim();const done=await f.finish(first)
  assert.equal(done.status,'response_observed');assert.deepEqual(done.response,{accepted:true})
  const before=await f.snapshot();const replay=await f.claim()
  assert.equal(replay.shouldPost,false);assert.deepEqual(replay,done)
  assert.deepEqual(await f.finish(first),done);assert.deepEqual(await f.snapshot(),before)
  assert.equal(before.invoice_purchase_events.length,1);assert.equal(before.domain_events.length,1)
  const item=before.invoice_export_items[0],old=original.invoice_export_items[0]
  for(const field of Object.keys(old).filter(k=>!['purchase_status','updated_at'].includes(k)))assert.deepEqual(item[field],old[field],field)
  assert.deepEqual(before.customer_invoices,original.customer_invoices)
  assert.equal(before.invoice_purchase_events[0].payload.requested_financing_mode,'factoring_without_recourse')
  assert.equal(before.invoice_purchase_events[0].finance_status,null)
 }finally{await f.db.close()}
})
for(const table of ['invoice_purchase_events','invoice_export_items','domain_events','invoice_manual_purchase_intents'])test('real late '+table+' failure rolls back the entire completion but retains the pre-POST barrier',async()=>{
 const f=await createFixture()
 try{
  const receipt=await f.claim(),before=await f.snapshot(),barrier=await f.rows('public.invoice_manual_purchase_intents')
  await f.db.exec(`reset role;create function private.late_failure()returns trigger language plpgsql as $$begin raise exception 'synthetic_late_boundary' using errcode='XX000';end;$$;
   create trigger synthetic_late_failure before ${['invoice_export_items','invoice_manual_purchase_intents'].includes(table)?'update':'insert'} on public.${table} for each row execute function private.late_failure();set role service_role;`)
  await assert.rejects(f.finish(receipt),e=>e.code==='XX000')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),barrier)
  assert.equal((await f.claim()).shouldPost,false)
 }finally{await f.db.close()}
})
test('uncertain and rejected outcomes consume the item forever and never alter issued rows',async()=>{
 for(const outcome of ['uncertain','rejected']){
  const f=await createFixture()
  try{
   const before=await f.snapshot(),receipt=await f.claim()
   const done=await f.finish(receipt,{outcome,observation:{errorCode:'provider_conflict',httpStatus:409}})
   assert.equal(done.status,outcome);assert.equal((await f.claim()).shouldPost,false)
   const after=await f.snapshot();assert.deepEqual(after.invoice_export_items,before.invoice_export_items);assert.deepEqual(after.customer_invoices,before.customer_invoices)
   assert.equal(after.invoice_purchase_events.length,1)
  }finally{await f.db.close()}
 }
})
test('a later canonical paid/purchased event is never downshifted by fulfilled completion',async()=>{
 const f=await createFixture()
 try{
  const receipt=await f.claim()
  await f.db.exec("update public.invoice_export_items set provider_status='paid',purchase_status='purchased_without_recourse';update public.customer_invoices set status='paid',paid_at=clock_timestamp()")
  const before=await f.snapshot();assert.equal((await f.finish(receipt)).status,'response_observed')
  const after=await f.snapshot();assert.deepEqual(after.invoice_export_items,before.invoice_export_items);assert.deepEqual(after.customer_invoices,before.customer_invoices)
  assert.equal((await f.claim()).shouldPost,false)
 }finally{await f.db.close()}
})
test('changed request payload or actor/session tuple conflicts without a new attempt',async()=>{
 const f=await createFixture()
 try{
  await f.claim();const before=await f.snapshot()
  await assert.rejects(f.claim({payload:{...f.command.payload,note:'changed'}}),e=>e.code==='23505')
  await assert.rejects(f.claim({sessionId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),e=>e.code==='42501')
  assert.deepEqual(await f.snapshot(),before);assert.equal((await f.rows('public.invoice_manual_purchase_intents')).length,1)
 }finally{await f.db.close()}
})
test('current immutable item binding is compared before durable reservation',async()=>{
 const f=await createFixture()
 try{
  const before=await f.snapshot()
  await assert.rejects(f.claim({itemBinding:{...f.command.itemBinding,provider_invoice_guid:'another-guid'}}),e=>e.code==='40001')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),[])
 }finally{await f.db.close()}
})
test('dispatch requires actual sent eligibility, approved provenance, locked price, ready underlay and enabled connection',async()=>{
 for(const sql of ["update public.invoice_export_items set status='failed_retryable'","update public.invoice_export_items set metadata='{}'",
  "update public.pricing_runs set status='success'","update public.billing_underlays set readiness_status='blocked'","update public.billing_provider_connections set status='paused'"]){
  const f=await createFixture()
  try{await f.db.exec(sql);const before=await f.snapshot();await assert.rejects(f.claim(),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),[])}finally{await f.db.close()}
 }
})
test('role_permission denial is not an allow and current outbound freeze holds dispatch without rewriting history',async()=>{
 for(const sql of ["update public.role_permissions set effect='deny'","update public.companies set outbound_frozen=true"]){
  const f=await createFixture()
  try{await f.db.exec(sql);const before=await f.snapshot();await assert.rejects(f.claim(),e=>['42501','55000'].includes(e.code));assert.deepEqual(await f.snapshot(),before)}finally{await f.db.close()}
 }
})
for(const phase of ['claim','finish'])test('controlled live business clock expiry after the last '+phase+' receipt write rolls back every effect',async()=>{
 const f=await createFixture()
 try{
  const receipt=phase==='finish'?await f.claim():null,before=await f.snapshot(),barrier=await f.rows('public.invoice_manual_purchase_intents')
  await f.db.exec(`reset role;create function private.expire_after_write()returns trigger language plpgsql as $$begin update private.business_actor set valid_until=clock_timestamp()-interval'1 second';return new;end;$$;
   create trigger synthetic_expire_after_write after ${phase==='claim'?'insert':'update'} on public.invoice_manual_purchase_intents for each row execute function private.expire_after_write();set role service_role;`)
  await assert.rejects(phase==='claim'?f.claim():f.finish(receipt),e=>e.code==='42501')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),barrier)
 }finally{await f.db.close()}
})
test('simultaneously queued actual SQL claims return exactly one POST grant and one durable item intent',async()=>{
 const f=await createFixture()
 try{
  const receipts=await Promise.all(Array.from({length:8},()=>f.claim()))
  assert.equal(receipts.filter(r=>r.shouldPost).length,1);assert.equal(new Set(receipts.map(r=>r.intentId)).size,1)
  assert.equal((await f.rows('public.invoice_manual_purchase_intents')).length,1)
 }finally{await f.db.close()}
})
for(const [name,sql] of [['readiness',"update public.billing_underlays set readiness_status=null"],['price-area',"update public.billing_underlays set price_area=null;update public.customer_invoices set price_area_code=null"]])test('nullable required '+name+' cannot fall through SQL three-valued eligibility',async()=>{
  const f=await createFixture()
  try{await f.db.exec(sql);const before=await f.snapshot();await assert.rejects(f.claim(),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),[])}finally{await f.db.close()}
})
test('changed current locked source during provider I/O prevents a stale local settlement',async()=>{
 const f=await createFixture()
 try{
  const receipt=await f.claim();await f.db.exec("update public.billing_underlays set missing_values_count=1")
  const before=await f.snapshot(),barrier=await f.rows('public.invoice_manual_purchase_intents')
  await assert.rejects(f.finish(receipt),e=>e.code==='40001')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),barrier)
 }finally{await f.db.close()}
})
test('identical opaque approval strings without the actual current review hash do not authorize dispatch',async()=>{
 const f=await createFixture()
 try{
  await f.db.exec(`update public.invoice_export_items set metadata=jsonb_set(metadata,'{approval,review_hash}',to_jsonb(repeat('c',64)));update public.customer_invoices set metadata=jsonb_set(metadata,'{approval,review_hash}',to_jsonb(repeat('c',64)))`)
  const before=await f.snapshot();await assert.rejects(f.claim(),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
for(const shape of ['invoice-date','due-date','null-rounding','currency'])test('canonical capture qualification holds malformed '+shape+' instead of inventing valid request evidence',async()=>{
 const f=await createFixture()
 try{
  const payload=structuredClone(f.command.itemBinding.request_payload)
  if(shape==='invoice-date'){payload.invoiceDate='not-a-date';payload.debts[0].invoiceDate='not-a-date'}
  if(shape==='due-date')payload.debts[0].dueDate='not-a-date'
  if(shape==='null-rounding')payload.debts[0].rounding=null
  if(shape==='currency')payload.debts[0].currencyCode='EUR'
  await f.db.query('update public.invoice_export_items set request_payload=$1',[JSON.stringify(payload)])
  const before=await f.snapshot();await assert.rejects(f.claim({itemBinding:{...f.command.itemBinding,request_payload:payload}}),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
test('a nonempty arbitrary original payload is not qualified as a current captured invoice request',async()=>{
 const f=await createFixture()
 try{
  await f.db.exec(`update public.invoice_export_items set request_payload='{"originalFinancialPayload":true}'`)
  const item=(await f.rows('public.invoice_export_items'))[0]
  const before=await f.snapshot();await assert.rejects(f.claim({itemBinding:{...f.command.itemBinding,request_payload:item.request_payload}}),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
test('a global billing role cannot replace the current canonical active company-specific role prerequisite',async()=>{
 const f=await createFixture()
 try{
  await f.db.exec(`update public.user_roles set status='disabled',is_active=false;insert into public.user_roles(user_id,company_id,role_id,is_active,status)values('${f.ids.actor}',null,'${f.ids.role}',true,'active')`)
  const before=await f.snapshot();await assert.rejects(f.claim(),e=>e.code==='42501');assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
test('missing sent/confirmed evidence is held rather than manufactured from status alone',async()=>{
 const f=await createFixture()
 try{
  await f.db.exec('update public.invoice_export_items set sent_at=null,provider_confirmed_at=null')
  const before=await f.snapshot();await assert.rejects(f.claim({itemBinding:{...f.command.itemBinding,sent_at:null,provider_confirmed_at:null}}),e=>e.code==='55000');assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
test('a changed canonical provider configuration before reservation holds dispatch without a partial intent',async()=>{
 const f=await createFixture()
 try{
  await f.db.exec(`update public.billing_provider_connections set settings='{"baseUrl":"https://changed-provider.invalid"}'`)
  const before=await f.snapshot(),connections=await f.rows('public.billing_provider_connections')
  await assert.rejects(f.claim(),e=>e.code==='40001')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.billing_provider_connections'),connections)
  assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),[])
 }finally{await f.db.close()}
})
test('settlement records the originally captured configuration after reconfiguration and rejects a substituted configuration receipt',async()=>{
 const f=await createFixture()
 try{
  const receipt=await f.claim()
  await f.db.exec(`update public.billing_provider_connections set settings='{"baseUrl":"https://changed-provider.invalid"}'`)
  const before=await f.snapshot(),barrier=await f.rows('public.invoice_manual_purchase_intents')
  const replacement=JSON.stringify({...JSON.parse(f.command.connectionJson),settings:{baseUrl:'https://changed-provider.invalid'}})
  await assert.rejects(f.finish(receipt,{connectionJson:replacement}),e=>e.code==='23505')
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await f.rows('public.invoice_manual_purchase_intents'),barrier)
  const done=await f.finish(receipt)
  assert.equal(done.status,'response_observed');assert.equal(done.connectionHash,receipt.connectionHash)
  assert.deepEqual((await f.snapshot()).customer_invoices,before.customer_invoices)
  assert.equal((await f.rows('public.invoice_purchase_events')).length,1)
  await assert.rejects(f.claim(),e=>e.code==='40001')
  assert.equal((await f.rows('public.invoice_manual_purchase_intents')).length,1)
 }finally{await f.db.close()}
})
test('omitted canonical capture rounding retains the established zero default',async()=>{
 const f=await createFixture()
 try{
  const payload=structuredClone(f.command.itemBinding.request_payload);delete payload.debts[0].rounding
  await f.db.query('update public.invoice_export_items set request_payload=$1',[JSON.stringify(payload)])
  const before=await f.snapshot(),receipt=await f.claim({itemBinding:{...f.command.itemBinding,request_payload:payload}})
  assert.equal(receipt.shouldPost,true);assert.deepEqual(await f.snapshot(),before)
 }finally{await f.db.close()}
})
