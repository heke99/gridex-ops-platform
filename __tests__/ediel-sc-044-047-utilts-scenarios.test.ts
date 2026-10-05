// masterplan: SC-044, SC-047
// SC-044: IDE1 correct, IDE2 guide error (plus a later functional fault),
// IDE3 only functional. Each keeps its own layer; IDE2 is never reclassified
// as functional by a global result.
import {expect,it,vi} from 'vitest'
import {resolveUtiltsTransactionDispositions,runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {matchMeteringPointIdByIdentifier} from '@/lib/ediel/matching'

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
const db=vi.hoisted(()=>({calls:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{db.calls.push('from:'+table);const q={select:()=>q,eq:(c:string,v:string)=>{db.calls.push(`eq:${c}=${v}`);return q},
 in:(c:string)=>{db.calls.push('in:'+c);return q},or:()=>q,limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:null}),
 insert:()=>{db.calls.push('insert:'+table);return q},upsert:()=>{db.calls.push('upsert:'+table);return q}};return q}}}))

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
