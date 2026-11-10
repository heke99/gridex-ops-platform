// local160: existing normal UI -> same-ID shared-mailbox transport save.
// EDIEL01.01/.04/.05 prerequisite only; finite SDK, no DB/IMAP/SMTP/browser.
import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode } from 'react'
type Row = Record<string, unknown>
const fx = vi.hoisted(() => ({ rows: [] as Row[], denied: false, readError: false, zeroWrite: false, moveEnvironment: false, auditError: false, reads: [] as string[], writes: [] as Array<{op:string;payload:Row}>, audit: vi.fn(), revalidate: vi.fn(), engine: vi.fn() }))
const own='fa116f5c-d615-441d-ab06-993400dee09c'
const old='16000000-0000-4000-8000-000000000002'
vi.mock('next/cache',()=>({revalidatePath:fx.revalidate}))
vi.mock('next/link',()=>({default:()=>null}))
vi.mock('@/components/admin/AdminHeader',()=>({default:()=>null}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminAccess:async()=>{if(fx.denied)throw Error('platform_admin_required');return {userId:own,email:'synthetic@example.invalid'}},requirePlatformAdminActionAccess:async()=>{if(fx.denied)throw Error('platform_admin_required');return {userId:own}}}))
vi.mock('@/lib/audit/actionLogger',()=>({logAdminActionAndUsage:async(input:Row)=>{fx.audit(input);if(fx.auditError)throw Error('audit_failed')}}))
vi.mock('@/lib/inbound-mail/edielInboundProcessor',()=>({processInboundEmailMessage:fx.engine}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:fx.engine,processQueuedInboundProcessingJobs:fx.engine,syncActiveInboundProcessingJobForMessage:fx.engine}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 let op='select',payload:Row={},cols='*',limit=Infinity
 const filters:Array<[string,unknown]>=[]
 const run=async(mode:'many'|'maybe'|'single'='many')=>{
  if(table!=='ediel_mailboxes')return {data:[],error:null,count:0}
  if(op==='select'){fx.reads.push(table);if(fx.readError)return {data:null,error:{code:'42703',message:'projection unavailable'}}}
  else {
   fx.writes.push({op,payload:structuredClone(payload)})
   if(fx.moveEnvironment){fx.rows.find(r=>r.id===own)!.environment='production'}
  }
  let rows=fx.rows.filter(r=>filters.every(([k,v])=>r[k]===v)).slice(0,limit)
  if(op==='update'){if(fx.zeroWrite)rows=[];rows.forEach(r=>Object.assign(r,structuredClone(payload)))}
  if(op==='insert'){const row={id:'16000000-0000-4000-8000-000000000099',...structuredClone(payload)};fx.rows.push(row);rows=[row]}
  const data=rows.map(r=>cols==='*'?structuredClone(r):Object.fromEntries(cols.split(',').map(k=>[k.trim(),structuredClone(r[k.trim()])])) )
  if(mode!=='many'&&(data.length>1||(mode==='single'&&data.length!==1)))return {data:null,error:{code:'PGRST116',message:'cardinality'}}
  return {data:mode==='many'?data:data[0]??null,error:null,count:rows.length}
 }
 const q={select:(c='*')=>{cols=c;return q},eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},is:(k:string,v:null)=>{filters.push([k,v]);return q},order:()=>q,limit:(n:number)=>{limit=n;return q},or:()=>q,update:(v:Row)=>{op='update';payload=v;return q},insert:(v:Row)=>{op='insert';payload=v;return q},single:()=>run('single'),maybeSingle:()=>run('maybe'),then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>run().then(resolve,reject)}
 return q
}}}))
import Page from '@/app/admin/inbound-mail/page'
import {saveSharedMailboxProfileAction} from '@/app/admin/inbound-mail/actions'
import {resolveImapTls} from '@/lib/inbound-mail/imapTls'
type Element = {type:unknown;props:Record<string,unknown>}
function elements(node:ReactNode):Element[]{
 const result:Element[]=[]
 Children.forEach(node,child=>{if(isValidElement<Record<string,unknown>>(child)){result.push(child);result.push(...elements(child.props.children as ReactNode))}})
 return result
}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(isValidElement<Record<string,unknown>>(node))return text(node.props.children as ReactNode);if(Array.isArray(node))return node.map(text).join('');return ''}
async function ownForm(){
 const all=elements(await Page());const forms=all.filter(e=>e.type==='form'&&e.props.action===saveSharedMailboxProfileAction)
 const found=forms.filter(f=>elements(f.props.children as ReactNode).some(e=>e.type==='input'&&e.props.name==='mailbox_id'&&e.props.value===own))
 expect(found).toHaveLength(1);return found[0]
}
function dataFrom(form:Element, secure?:string){
 const data=new FormData()
 for(const e of elements(form.props.children as ReactNode)){
  const name=e.props.name;if(typeof name!=='string')continue
  if(e.type==='input'){
   if(e.props.type==='checkbox'&&!e.props.defaultChecked)continue
   data.append(name,String(e.props.value??e.props.defaultValue??(e.props.type==='checkbox'?'on':'')))
  }else if(e.type==='select')data.append(name,String(e.props.defaultValue??''))
 }
 if(secure==='true'){data.set('imap_secure','on');data.set('smtp_secure','on')}else if(secure==='false'){data.delete('imap_secure');data.delete('smtp_secure')}
 return data
}
function values(id=own){const d=new FormData();for(const [k,v] of Object.entries({mailbox_id:id,mailbox_name:'Generic',email_address:'synthetic@example.invalid',environment:'test',imap_host:'127.0.0.1',imap_port:'55993',imap_folder:'INBOX',imap_secure:'true',username:'synthetic@example.invalid',secret_reference:'env:GRIDEX_LOCAL_EDIEL01_IMAP_PASS',smtp_host:'127.0.0.1',smtp_port:'55465',smtp_secure:'true',smtp_from:'synthetic@example.invalid',smtp_username:'synthetic@example.invalid',smtp_secret_reference:'env:EDIEL_SMTP_PASS'}))d.set(k,v);return d}
beforeEach(()=>{
 fx.rows=[{id:old,company_id:null,environment:'test',mailbox_name:'Generic',email_address:'other@example.invalid',username:'other@example.invalid',is_active:true,metadata:{retained:'old'}},{id:own,company_id:null,environment:'test',mailbox_name:'Generic',email_address:'synthetic@example.invalid',username:'synthetic@example.invalid',imap_host:'127.0.0.1',imap_port:55993,smtp_host:'127.0.0.1',smtp_port:55465,smtp_from:'synthetic@example.invalid',smtp_to:'recipient@example.invalid',secret_reference:'env:GRIDEX_LOCAL_EDIEL01_IMAP_PASS',is_active:false,metadata:{retained:{key:'value'}}}]
 fx.denied=false;fx.readError=false;fx.zeroWrite=false;fx.moveEnvironment=false;fx.auditError=false;fx.reads=[];fx.writes=[];fx.audit.mockReset();fx.revalidate.mockReset();fx.engine.mockReset()
})
it('actual existing-row form has visible labeled TLS controls and visibly identifies stable mailbox despite duplicate names',async()=>{
 const form=await ownForm();const nodes=elements(form.props.children as ReactNode)
 for(const name of ['imap_secure','smtp_secure']){
  const fields=nodes.filter(e=>e.props.name===name);expect(fields).toHaveLength(1);expect(fields[0].type).toBe('input');expect(fields[0].props.type).toBe('checkbox')
  expect(nodes.some(e=>e.type==='label'&&elements(e.props.children as ReactNode).some(x=>x.props.name===name)&&text(e.props.children as ReactNode).includes('TLS'))).toBe(true)
 }
 const all=elements(await Page());const byID=new Map(all.filter(e=>typeof e.props.id==='string').map(e=>[e.props.id,e]))
 for(const field of nodes.filter(e=>['imap_secure','smtp_secure'].includes(String(e.props.name))||e.type==='button')){
  const labels=String(field.props['aria-labelledby']??'').split(' ');expect(labels.length).toBeGreaterThanOrEqual(2)
  const accessible=labels.map(id=>text(byID.get(id)?.props.children as ReactNode)).join(' ')
  expect(accessible).toContain(own);expect(accessible).toContain('synthetic@example.invalid')
 }
 const content=text((await Page()).props.children as ReactNode);expect(content).toContain(own);expect(content).toContain('synthetic@example.invalid')
})
it('normal form submitted with explicit true restores TLS on nonstandard ports with same ID, target and unrelated data retained',async()=>{
 const before=structuredClone(fx.rows[0]);const form=await ownForm();const data=dataFrom(form,'true')
 expect(data.get('mailbox_id')).toBe(own);await saveSharedMailboxProfileAction(data)
 expect(fx.rows).toHaveLength(2);expect(fx.rows[0]).toEqual(before)
 expect(fx.rows[1]).toMatchObject({id:own,company_id:null,environment:'test',is_active:true,imap_host:'127.0.0.1',imap_port:55993,smtp_host:'127.0.0.1',smtp_port:55465,smtp_to:'recipient@example.invalid',secret_reference:'env:GRIDEX_LOCAL_EDIEL01_IMAP_PASS',metadata:{retained:{key:'value'},scope:'platform_shared',imap_secure:true,smtp_secure:true}})
 expect(fx.writes.map(w=>w.op)).toEqual(['update']);expect(fx.audit).toHaveBeenCalledWith(expect.objectContaining({entityId:own}));expect(fx.engine).not.toHaveBeenCalled()
})
it('explicit false is a supported TLS mode and retains certificate verification, never a cleartext switch',async()=>{
 await saveSharedMailboxProfileAction(dataFrom(await ownForm(),'false'))
 expect(fx.rows[1].metadata).toMatchObject({imap_secure:false,smtp_secure:false})
 expect(resolveImapTls({host:'127.0.0.1',port:55993,secure:false,environment:'test',env:{}})).toEqual({secure:false,doSTARTTLS:true,tls:{rejectUnauthorized:true}})
})
it.each(['production','unknown'])('different or invalid submitted environment %s fails without writes/audit',async environment=>{
 const d=values();d.set('environment',environment);await expect(saveSharedMailboxProfileAction(d)).rejects.toBeDefined();expect(fx.writes).toEqual([]);expect(fx.audit).not.toHaveBeenCalled()
})
it('tenant mailbox cannot be converted to shared',async()=>{fx.rows[1].company_id='16000000-0000-4000-8000-000000000003';await expect(saveSharedMailboxProfileAction(values())).rejects.toThrow();expect(fx.writes).toEqual([])})
it('missing explicit target cannot insert a replacement',async()=>{await expect(saveSharedMailboxProfileAction(values('16000000-0000-4000-8000-000000000004'))).rejects.toThrow();expect(fx.writes).toEqual([]);expect(fx.audit).not.toHaveBeenCalled()})
it.each([{metadata:[]},{metadata:['invalid']},{metadata:'invalid'},{metadata:42},{metadata:false}])('unsupported metadata $metadata rejects before update',async ({metadata})=>{fx.rows[1].metadata=metadata;await expect(saveSharedMailboxProfileAction(values())).rejects.toThrow();expect(fx.writes).toEqual([]);expect(fx.audit).not.toHaveBeenCalled()})
it('unavailable mailbox read does not fall back to replacement',async()=>{fx.readError=true;await expect(saveSharedMailboxProfileAction(values())).rejects.toMatchObject({code:'42703'});expect(fx.writes).toEqual([])})
it('platform denial precedes every SDK effect',async()=>{fx.denied=true;await expect(saveSharedMailboxProfileAction(values())).rejects.toThrow('platform_admin_required');expect(fx.reads).toEqual([]);expect(fx.writes).toEqual([])})
it('cardinality ambiguity fails closed before update',async()=>{fx.rows.push(structuredClone(fx.rows[1]));await expect(saveSharedMailboxProfileAction(values())).rejects.toMatchObject({code:'PGRST116'});expect(fx.writes).toEqual([])})
it('concurrent environment change cannot be overwritten as test or audited successful',async()=>{fx.moveEnvironment=true;await expect(saveSharedMailboxProfileAction(values())).rejects.toBeDefined();expect(fx.rows[1].environment).toBe('production');expect(fx.audit).not.toHaveBeenCalled()})
it('zero-row update preserves donor failclosed audit semantics',async()=>{fx.zeroWrite=true;await expect(saveSharedMailboxProfileAction(values())).rejects.toBeDefined();expect(fx.audit).not.toHaveBeenCalled();expect(fx.revalidate).not.toHaveBeenCalled()})
it('audit failure denies success without claiming the preceding mailbox update rolled back',async()=>{fx.auditError=true;await expect(saveSharedMailboxProfileAction(values())).rejects.toThrow('audit_failed');expect(fx.rows[1].metadata).toMatchObject({imap_secure:true});expect(fx.revalidate).not.toHaveBeenCalled()})
it('cleartext/certificate-disable form switches remain forbidden',async()=>{const d=values();d.set('imap_tls_reject_unauthorized','false');await expect(saveSharedMailboxProfileAction(d)).rejects.toThrow();expect(fx.writes).toEqual([])})

// EDIEL03.01 prerequisite: the normal platform-shared writer must persist the
// canonical native scope, not only the legacy metadata display/poller label.
it('normal same-ID shared save sets canonical shared flag while preserving scope, TLS and metadata', async () => {
  fx.rows[1].is_shared_platform_mailbox = false
  const untouched = structuredClone(fx.rows[0])
  const data = dataFrom(await ownForm(), 'true')
  await saveSharedMailboxProfileAction(data)
  expect(fx.rows[0]).toEqual(untouched)
  expect(fx.rows[1]).toMatchObject({
    id: own, company_id: null, environment: 'test', is_shared_platform_mailbox: true,
    metadata: { retained: { key: 'value' }, scope: 'platform_shared', imap_secure: true, smtp_secure: true },
  })
  expect(fx.writes).toHaveLength(1)
  expect(fx.writes[0]).toMatchObject({ op: 'update', payload: { company_id: null, is_shared_platform_mailbox: true } })
  expect(fx.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: own }))
  expect(fx.engine).not.toHaveBeenCalled()
})

it('normal new shared save explicitly sets canonical shared flag without a client flag or changing existing rows', async () => {
  const untouched = structuredClone(fx.rows)
  const data = values()
  data.delete('mailbox_id')
  data.set('mailbox_name', 'New platform shared profile')
  expect(data.has('is_shared_platform_mailbox')).toBe(false)
  await saveSharedMailboxProfileAction(data)
  expect(fx.rows.slice(0, 2)).toEqual(untouched)
  expect(fx.rows).toHaveLength(3)
  expect(fx.rows[2]).toMatchObject({
    company_id: null, environment: 'test', is_shared_platform_mailbox: true,
    metadata: { scope: 'platform_shared', imap_secure: true, smtp_secure: true },
  })
  expect(fx.writes).toHaveLength(1)
  expect(fx.writes[0]).toMatchObject({ op: 'insert', payload: { company_id: null, is_shared_platform_mailbox: true } })
  expect(fx.engine).not.toHaveBeenCalled()
})
