import { beforeEach, expect, it, vi } from 'vitest'

// Actual worker/claim adapter, controlled query and outer transport only.
// Fair SQL and canonical tenant policy run separately in the core suite.
type Row = Record<string, unknown>
const f = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as string[], transport: 0,
  receiptRows: [] as Row[], unavailable: false, mutateOnRecheck: false, lostFinish: false,
  accepted: false, sentPersistenceFails: false, emptyReceipt: false, blockedPolicy: false, rechecks: 0, changeBeforeTransport: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ isEdielReservedSender: async (value: string) => value === 'ediel@example.invalid' }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({ sendEmail: async () => {
  f.transport++
  if (!f.accepted) throw new Error('controlled_transport_not_dispatched')
  return { providerMessageId: f.emptyReceipt ? '' : 'controlled-outer-boundary-receipt', status: 'sent' }
} }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const predicates: Array<(row: Row) => boolean> = [], sorts: Array<[string, boolean]> = []
    let patch: Row | null = null, max = Infinity
    const resolve = () => {
      const rows = (table === 'manual_email_outbox' ? f.rows : []).filter(row => predicates.every(fn => fn(row)))
        .sort((a,b) => { for (const [key,asc] of sorts) { const diff = String(a[key]).localeCompare(String(b[key])); if(diff) return diff*(asc?1:-1) } return 0 }).slice(0,max)
      if(patch) for(const row of rows) Object.assign(row,patch)
      return { data: structuredClone(rows), error: null }
    }
    const query = { select: () => query, update: (value: Row) => { patch=value;return query },
      eq: (key: string,value: unknown) => { predicates.push(row=>row[key]===value);return query },
      lt: (key: string,value: string) => { predicates.push(row=>typeof row[key]==='string'&&String(row[key])<value);return query },
      lte: (key: string,value: string) => { predicates.push(row=>typeof row[key]==='string'&&String(row[key])<=value);return query },
      in: (key: string,value: unknown[]) => { predicates.push(row=>value.includes(row[key]));return query },
      order: (key: string, options: {ascending:boolean}) => { sorts.push([key,options.ascending]);return query },
      limit: (value:number) => { max=value;return query },
      maybeSingle: async () => { const r=resolve();return {...r,data:r.data[0]??null} },
      then: (yes:(value:unknown)=>unknown,no:(error:unknown)=>unknown) => Promise.resolve(resolve()).then(yes,no) }
    return query
  },
  async rpc(name:string,args:Row) {
    f.calls.push(name)
    if(name==='canonical_tenant_operation_decision')return {data:[{allowed:!f.blockedPolicy,reason_code:f.blockedPolicy?'tenant_paused':'allowed',company_status:f.blockedPolicy?'paused':'active',state_version:1}],error:null}
    if(f.unavailable)return {data:null,error:{code:'PGRST202',message:'controlled_schema_unavailable'}}
    if(name==='gridex_recover_stale_manual_email_outbox_v1')return {data:[],error:null}
    if(name==='gridex_claim_manual_email_outbox_fair_v1') {
      const rows=f.receiptRows.map(row=>{Object.assign(row,{status:'sending',locked_by:args.p_worker_id,locked_at:new Date().toISOString()});return {...row,claim_token:args.p_claim_token}})
      return {data:structuredClone(rows),error:null}
    }
    const row=f.rows.find(row=>row.id===args.p_item_id&&row.company_id===args.p_company_id)
    if(name==='gridex_recheck_manual_email_claim_v1') {
      f.rechecks++;if(f.mutateOnRecheck||(f.changeBeforeTransport&&f.rechecks%2===0))return {data:[],error:null}
      return {data:row?[structuredClone(row)]:[],error:null}
    }
    if(name==='gridex_finish_manual_email_claim_v1') {
      if(f.lostFinish)return {data:false,error:null}
      const patch=args.p_patch as Row
      if(f.sentPersistenceFails&&patch.status==='sent')return {data:null,error:{code:'P0001',message:'controlled_late_status_failure'}}
      if(row)Object.assign(row,patch)
      return {data:Boolean(row),error:null}
    }
    throw new Error('unexpected_controlled_rpc:'+name)
  },
} }))

import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'
const a='e6100000-0000-4000-8000-000000000001',b='e6100000-0000-4000-8000-000000000002'
const row=(company:string,n:number):Row=>({id:`e6100000-0000-4000-8000-${String(n).padStart(12,'0')}`,company_id:company,
  request_id:null,status:'queued',external_delivery:true,queued_at:company===a?'2026-09-01':'2026-09-02',next_attempt_at:'2026-09-01',
  locked_by:null,locked_at:null,to_email:'recipient@example.invalid',actual_recipient_email:'recipient@example.invalid',from_email:'sender@example.invalid',
  reply_to:null,subject:'Synthetic unsent',body_html:'<p>Synthetic</p>',body_text:null,attachments:[],attempts:0,provider:'resend',
  recipient_resolution:{mode:'controlled'},idempotency_key:'synthetic-'+n,provider_idempotency_key:'provider-'+n})
beforeEach(()=>{vi.clearAllMocks();f.rows=Array.from({length:250},(_,n)=>row(a,n+100));f.rows.push(row(b,500))
  f.receiptRows=[f.rows[0],f.rows.at(-1)!];f.calls=[];f.transport=0;f.unavailable=false;f.mutateOnRecheck=false;f.lostFinish=false;f.accepted=false;f.sentPersistenceFails=false;f.emptyReceipt=false;f.blockedPolicy=false;f.rechecks=0;f.changeBeforeTransport=false})
it('actual worker reaches a later quiet tenant from its bounded claim receipt and never invents provider success',async()=>{
  const result=await processManualEmailOutbox({limit:25})
  expect(f.rows.at(-1)).toMatchObject({company_id:b,attempts:1,status:'queued'})
  expect(result).toMatchObject({claimed:2,sent:0,failed:2});expect(f.transport).toBe(2)
})
it('missing fair schema fails before inventory effects or controlled transport instead of falling back globally',async()=>{
  f.unavailable=true;const before=structuredClone(f.rows)
  await expect(processManualEmailOutbox({limit:25})).rejects.toMatchObject({code:'PGRST202'})
  expect(f.rows).toEqual(before);expect(f.transport).toBe(0)
})
it('a live immutable-payload recheck failure prevents dispatch and completion writes',async()=>{
  f.mutateOnRecheck=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result.sent).toBe(0);expect(f.transport).toBe(0)
  expect(f.rows.at(-1)).toMatchObject({status:'sending',attempts:0})
})
it('confirmed outer acceptance followed by status failure becomes uncertain and is never automatically queued',async()=>{
  f.accepted=true;f.sentPersistenceFails=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result).toMatchObject({sent:0,deliveryUncertain:2})
  expect(f.rows.at(-1)).toMatchObject({status:'delivery_uncertain',next_attempt_at:null,attempts:1})
})
it('a lost live completion does not report a saved send or overwrite the row',async()=>{
  f.accepted=true;f.lostFinish=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result.sent).toBe(0);expect(f.rows.at(-1)).toMatchObject({status:'sending',attempts:0})
})
it('the reserved Ediel sender remains blocked before controlled transport',async()=>{
  f.rows=f.receiptRows
  f.receiptRows.forEach(row=>{row.from_email='ediel@example.invalid'})
  const result=await processManualEmailOutbox({limit:25})
  expect(result.sent).toBe(0);expect(f.transport).toBe(0)
  expect(f.rows.at(-1)).toMatchObject({status:'failed',attempts:1})
})
it('an unverified actual recipient remains blocked before controlled transport',async()=>{
  f.rows=f.receiptRows
  f.receiptRows.forEach(row=>{row.actual_recipient_email='other@example.invalid'})
  const result=await processManualEmailOutbox({limit:25})
  expect(result.sent).toBe(0);expect(f.transport).toBe(0)
  expect(f.rows.at(-1)).toMatchObject({status:'failed',attempts:1})
})

it('a fulfilled outer transport with no receipt remains uncertain and cannot be automatically retried',async()=>{
  f.accepted=true;f.emptyReceipt=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result).toMatchObject({sent:0,deliveryUncertain:2,failed:0})
  expect(f.rows.at(-1)).toMatchObject({status:'delivery_uncertain',next_attempt_at:null,attempts:1})
})
it('current canonical policy revocation after claim records a block without transport or a false send',async()=>{
  f.blockedPolicy=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result).toMatchObject({claimed:2,sent:0,skipped:2,failed:0});expect(f.transport).toBe(0)
  expect(f.rows.at(-1)).toMatchObject({status:'blocked_tenant_state',attempts:0})
})
it('the immutable lease is rechecked again after asynchronous policy and sender reads',async()=>{
  f.changeBeforeTransport=true
  const result=await processManualEmailOutbox({limit:25})
  expect(result.sent).toBe(0);expect(f.transport).toBe(0)
  expect(f.rows.at(-1)).toMatchObject({status:'sending',attempts:0})
})
