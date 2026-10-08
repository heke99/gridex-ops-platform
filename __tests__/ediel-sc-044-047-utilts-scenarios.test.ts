// masterplan: SC-044, SC-047
// SC-044: IDE1 correct, IDE2 guide error (plus a later functional fault),
// IDE3 only functional. Each keeps its own layer; IDE2 is never reclassified
// as functional by a global result.
import {expect,it,vi} from 'vitest'
import {resolveUtiltsTransactionDispositions,runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {matchMeteringPointForEdielMessage,matchMeteringPointIdByIdentifier} from '@/lib/ediel/matching'
import {inboundLegalReceiverEdielId,resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import type {EdielMessageRow} from '@/lib/ediel/types'

const issue=(kind:'application'|'functional',tx:string)=>({severity:'error' as const,kind,code:kind==='application'?'FIELD_REQUIRED':'UNKNOWN_OBJECT',
 title:'t',description:'d',referenceNumber:tx,lineItemReference:tx,...(kind==='application'?{aperakFieldCode:'245'}:{utiltsErrCode:'E10'})})

it('IDE1 positive, IDE2 negative APERAK despite its own later functional fault, IDE3 UTILTS-ERR',()=>{
 const result=resolveUtiltsTransactionDispositions({syntaxOk:true,transactions:[{transactionId:'IDE1'},{transactionId:'IDE2'},{transactionId:'IDE3'}],
  issues:[issue('application','IDE2'),issue('functional','IDE2'),issue('functional','IDE3')]})
 expect(result.map(r=>[r.transactionId,r.disposition,r.responseType])).toEqual([
  ['IDE1','accepted','positive_aperak'],['IDE2','guide_rejected','negative_aperak'],['IDE3','processability_rejected','utilts_err']])
})

// SC-047: correct receiver and role, but the object is unknown in this
// tenant's own data -> E10. The lookup is company-scoped and read-only: no
// new customer object, no search in other tenants.
const db=vi.hoisted(()=>({calls:[] as string[],tables:{} as Record<string,Record<string,unknown>[]>}))
// Table-backed read model: real filters (eq/or/limit) over seeded rows, every
// filter and any write recorded. Unseeded tables are empty.
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{db.calls.push('from:'+table)
 const preds:((r:Record<string,unknown>)=>boolean)[]=[];let max=Infinity
 const rows=()=>(db.tables[table]??[]).filter(r=>preds.every(p=>p(r))).slice(0,max)
 const result=()=>{const data=rows();return{data,error:null,count:data.length}}
 const q:Record<string,unknown>={select:()=>q,abortSignal:()=>q,
  eq:(c:string,v:unknown)=>{db.calls.push(`eq:${c}=${v}`);preds.push(r=>r[c]===v);return q},
  in:(c:string,v:unknown[])=>{db.calls.push('in:'+c);preds.push(r=>v.includes(r[c]));return q},
  or:(f:string)=>{db.calls.push('or:'+f);const alts=f.split(',').map(t=>t.split('.eq.'));preds.push(r=>alts.some(([c,v])=>String(r[c])===v));return q},
  limit:(n:number)=>{max=n;return q},maybeSingle:async()=>({data:rows()[0]??null,error:null}),
  then:(ok:(v:unknown)=>unknown,ko?:(e:unknown)=>unknown)=>Promise.resolve(result()).then(ok,ko),
  insert:()=>{db.calls.push('insert:'+table);return q},upsert:()=>{db.calls.push('upsert:'+table);return q},
  update:()=>{db.calls.push('update:'+table);return q},delete:()=>{db.calls.push('delete:'+table);return q}};return q}}}))

it('an unknown object in the own tenant gives E10 while a resolved one does not',()=>{
 const source=energyHandoffMessage('2026-10-01')
 const withMatch=(meteringPointId:string|null)=>runUtiltsRuntimeForMessage({...source,parsed_payload:{utiltsTransactionMatches:[{transactionReference:'GRIDEX2607E66001',
  externalMeteringPointId:'735999260731000007',externalGridAreaId:'TES',meteringPointId,gridOwnerId:'grid',matchStatus:meteringPointId?'matched':'missing'}]}},{referenceDate:'2026-10-01'})
 expect(withMatch(null).ackPlan.utiltsErrCodes).toEqual(['E10'])
 expect(withMatch('point-1').ackPlan.utiltsErrCodes).toEqual([])
})
it('the object lookup reads only the own company and never creates an object',async()=>{
 db.calls=[]
 await expect(matchMeteringPointIdByIdentifier({companyId:'tenant-a',identifiers:['735999260731000007']})).resolves.toBeNull()
 expect(db.calls).toContain('eq:company_id=tenant-a')
 expect(db.calls.some(c=>c.startsWith('insert:')||c.startsWith('upsert:'))).toBe(false)
})

// SC-047 joined: the legal receiver NAD+MR and role are established through the
// real tenant admission, the object is then looked up only in that tenant, is
// unknown there (it exists only in another tenant) and the runtime gives E10.
it('joined: admitted receiver and role, unknown own object, E10 without creating or cross-tenant lookup',async()=>{
 const from='2020-01-01T00:00:00Z'
 const tenant=(company:string,actor:string,edielId:string)=>({
  tenant_ediel_profiles:[{id:`p-${company}`,company_id:company,environment:'test',market:'electricity',is_enabled:true,valid_from:from,valid_to:null}],
  tenant_actor_identifiers:[{id:`i-${company}`,company_id:company,environment:'test',actor_id:actor,identifier_type:'EdielId',identifier_value:edielId,valid_from:from,valid_to:null}],
  tenant_actor_roles:[{id:`r-${company}`,company_id:company,environment:'test',actor_id:actor,role_code:'electricity_supplier',valid_from:from,valid_to:null}],
 })
 const a=tenant('tenant-a','actor-a','21660'),b=tenant('tenant-b','actor-b','99999')
 db.tables={tenant_ediel_profiles:[...a.tenant_ediel_profiles,...b.tenant_ediel_profiles],
  tenant_actor_identifiers:[...a.tenant_actor_identifiers,...b.tenant_actor_identifiers],
  tenant_actor_roles:[...a.tenant_actor_roles,...b.tenant_actor_roles],
  metering_points:[{id:'foreign-point',company_id:'tenant-b',meter_point_id:'735999260731000007',metering_point_id:'735999260731000007',ediel_reference:null}]}
 db.calls=[]
 const source={...energyHandoffMessage('2026-10-01'),company_id:null,metering_point_id:null} as EdielMessageRow
 const legal=inboundLegalReceiverEdielId(source.raw_payload,'21660')
 expect(legal).toBe('21660')
 const admitted=await resolveInboundTenantFromIdentifiers({environment:'test',messageFamily:'UTILTS',messageCode:'E66',receiverEdielId:'21660',marketActorEdielId:legal})
 expect(admitted).toMatchObject({status:'resolved',companyId:'tenant-a'})
 const own={...source,company_id:admitted.companyId,parsed_payload:{meteringPointId:'735999260731000007'}} as EdielMessageRow
 const matched=await matchMeteringPointForEdielMessage(own)
 expect(matched).toBeNull()
 const run=runUtiltsRuntimeForMessage({...own,metering_point_id:matched,parsed_payload:{utiltsTransactionMatches:[{transactionReference:'GRIDEX2607E66001',
  externalMeteringPointId:'735999260731000007',externalGridAreaId:'TES',meteringPointId:matched,gridOwnerId:'grid',matchStatus:'missing'}]}},{referenceDate:'2026-10-01'})
 expect(run.ackPlan.utiltsErrCodes).toEqual(['E10'])
 const objectReads=db.calls.slice(db.calls.lastIndexOf('from:metering_points'))
 expect(objectReads).toContain('eq:company_id=tenant-a')
 expect(db.calls).not.toContain('eq:company_id=tenant-b')
 expect(db.calls.some(c=>/^(insert|upsert|update|delete):/.test(c))).toBe(false)
 // Contrast: the same admitted pipeline with an own-tenant object is not E10.
 db.tables.metering_points.push({id:'own-point',company_id:'tenant-a',meter_point_id:'735999260731000007',metering_point_id:null,ediel_reference:null})
 const ownMatch=await matchMeteringPointForEdielMessage(own)
 expect(ownMatch).toBe('own-point')
 expect(runUtiltsRuntimeForMessage({...own,metering_point_id:ownMatch,parsed_payload:{utiltsTransactionMatches:[{transactionReference:'GRIDEX2607E66001',
  externalMeteringPointId:'735999260731000007',externalGridAreaId:'TES',meteringPointId:ownMatch,gridOwnerId:'grid',matchStatus:'matched'}]}},{referenceDate:'2026-10-01'}).ackPlan.utiltsErrCodes).toEqual([])
 db.tables={}
})
