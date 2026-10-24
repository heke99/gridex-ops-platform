// F-15: actual tenantDb and production functions; database, authorization and SMTP configuration are finite ports.
import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, queries: [] as Array<{table:string;op:string;filters:Array<[string,string,unknown]>;payload:Row|Row[];orders:string[];range:number[]|null}>,
  events: [] as Row[], seq: 0, rpc: vi.fn(), download: vi.fn(), materialize: vi.fn(), auth: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({supabaseService:{
  from:(table:string)=>{
    let op='select',payload:Row|Row[]={},maximum=Infinity,range:number[]|null=null
    const filters:Array<[string,string,unknown]>=[],orders:string[]=[]
    const field=(row:Row,column:string):unknown=>{const [outer,inner]=column.split('->>');return inner?(row[outer] as Row|undefined)?.[inner]:row[column]}
    const run=()=>{
      io.queries.push({table,op,filters:[...filters],payload:structuredClone(payload),orders:[...orders],range})
      const rows=io.tables[table]??=[]
      if(op==='insert') {const list=(Array.isArray(payload)?payload:[payload]).map(v=>({id:`${table}-${++io.seq}`,...structuredClone(v)}));rows.push(...list);return {data:list,error:null}}
      let hit=rows.filter(row=>filters.every(([kind,key,value])=>kind==='in'?(value as unknown[]).includes(field(row,key)):kind==='not'?field(row,key)!=null:kind==='is'?(field(row,key)??null)===value:field(row,key)===value))
      if(range)hit=hit.slice(range[0],range[1]+1)
      hit=hit.slice(0,maximum)
      if(op==='update')hit.forEach(row=>Object.assign(row,structuredClone(payload)))
      return {data:structuredClone(hit),error:null}
    }
    const q={
      select:()=>q, eq:(key:string,value:unknown)=>{if(key==='company_id'&&(table.startsWith('platform_')||table==='companies'))throw Error('catalog_has_no_company_id');filters.push(['eq',key,value]);return q},
      in:(key:string,value:unknown[])=>{filters.push(['in',key,value]);return q},is:(key:string,value:unknown)=>{filters.push(['is',key,value]);return q},
      not:(key:string,kind:string,value:unknown)=>{if(kind!=='is'||value!==null)throw Error('unexpected not');filters.push(['not',key,value]);return q},
      order:(key:string)=>{orders.push(key);return q},limit:(n:number)=>{maximum=n;return q},range:(from:number,to:number)=>{range=[from,to];return q},
      update:(values:Row)=>{op='update';payload=values;return q},insert:(values:Row|Row[])=>{op='insert';payload=values;return q},
      maybeSingle:async()=>{const r=run();return {data:r.data[0]??null,error:null}},single:async()=>{const r=run();return {data:r.data[0]??null,error:null}},
      then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve(run()).then(resolve,reject),
    };return q
  },rpc:io.rpc,storage:{from:()=>({download:io.download})},
}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'supplier@example.invalid',host:'smtp.example.invalid',port:587})}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async(v:Row)=>{io.events.push(v)}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>({outcome:'business_rejection',updated:[]})}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:io.auth}))
vi.mock('@/lib/actor-registry/registryMarketSource',()=>({verifyElRegistryActor:vi.fn()}))
vi.mock('@/lib/ediel/routeMaterializer',()=>({materializePlatformActorRoute:io.materialize,materializeCompanyGridOwnerRoute:io.materialize}))
vi.mock('@/lib/ediel/productionSendApproval',()=>({approveFirstProductionSend:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('next/navigation',()=>({redirect:()=>{throw Error('fixture_redirect')},unstable_rethrow:()=>undefined}))
import { ensureGridOwnerTechnicalAckRoutes } from '@/lib/ediel/technicalAckRouteMaterializer'
import { followUpAckRejection } from '@/lib/ediel/flows/ackRejectionFollowUp'
import { deriveContractRequestedMethodFromSignedAgreement } from '@/lib/ediel/production/contractRequestedMethodSource'
import { bulkMaterializeOperationalRoutesAction } from '@/app/admin/ediel/route-readiness/actions'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const T=id(1), OTHER=id(2), A=id(3), C=id(4), G=id(5), CONTRACT=id(6),ACK=id(7)
const companyFilters=(table:string)=>io.queries.filter(q=>q.table===table).map(q=>q.filters.filter(([,key])=>key==='company_id'))
const tech=()=>({actorUserId:A,companyId:T,route:{id:id(10),actor_id:id(11),environment:'test',subaddress:'GRID',communication_address:'grid@example.invalid',interchange_party_id:'16700'},gridOwner:{id:G,name:'Synthetic grid'},senderSettings:{company_id:T,ediel_id:'21660'} as never,ownSubaddress:'DDQ',messageFamily:'PRODAT'})
const rejection=()=>({actorUserId:A,ackMessage:{id:ACK,company_id:T,customer_id:C,message_family:'CONTRL'} as never,switchRequestId:null,gridOwnerDataRequestId:null,failureReason:'fixture syntax failure'})
const scope=()=>({companyId:T,contractId:CONTRACT,actorUserId:A,environment:'production' as const})
beforeEach(()=>{io.tables={};io.queries=[];io.events=[];io.seq=0;io.rpc.mockReset().mockResolvedValue({data:{status:'derived'},error:null});io.download.mockReset().mockResolvedValue({data:new Blob(['SYNTHETIC-SIGNED-PDF']),error:null});io.materialize.mockReset();io.auth.mockReset().mockResolvedValue({userId:A})})
it('materializes technical ACK routes and profiles only in the requested company, with one company predicate per read',async()=>{
  const result=await ensureGridOwnerTechnicalAckRoutes(tech())
  expect(result.status).toBe('materialized');expect(result.routes.length).toBeGreaterThan(0)
  expect(io.tables.communication_routes.every(r=>r.company_id===T)).toBe(true)
  expect(io.tables.ediel_route_profiles.every(r=>r.company_id===T)).toBe(true)
  expect(companyFilters('communication_routes')[0]).toEqual([['eq','company_id',T]])
  io.queries=[]
  const repeated=await ensureGridOwnerTechnicalAckRoutes(tech())
  expect(repeated.routes.map(r=>[r.action,r.communicationRouteId,r.edielRouteProfileId])).toEqual(result.routes.map(r=>['updated',r.communicationRouteId,r.edielRouteProfileId]))
  expect(io.tables.communication_routes).toHaveLength(result.routes.length)
  expect(io.tables.ediel_route_profiles).toHaveLength(result.routes.length)
  expect(io.queries.filter(q=>q.op==='update').every(q=>q.filters.filter(([,key])=>key==='company_id').length===1)).toBe(true)
})
it('does not read or write technical routes when sender settings belong to another company',async()=>{
  expect(await ensureGridOwnerTechnicalAckRoutes({...tech(),senderSettings:{company_id:OTHER,ediel_id:'21660'} as never})).toMatchObject({status:'skipped',reasonCode:'technical_ack_sender_tenant_mismatch'})
  expect(io.queries).toHaveLength(0)
})
it('does not modify another company technical route while creating its own',async()=>{
  const foreign={id:id(20),company_id:OTHER,is_active:true,route_scope:'ediel_ack',environment_type:'bilateral_test',target_email:'foreign@example.invalid',auth_config:{}}
  io.tables.communication_routes=[structuredClone(foreign)]
  expect((await ensureGridOwnerTechnicalAckRoutes(tech())).status).toBe('materialized')
  expect(io.tables.communication_routes.find(r=>r.id===foreign.id)).toEqual(foreign)
  expect(companyFilters('communication_routes')[0]).toEqual([['eq','company_id',T]])
})
it('deduplicates a negative CONTRL operator case only within its own company',async()=>{
  io.tables.customer_cases=[{id:id(30),company_id:OTHER,case_type:'technical_rejection',metadata:{source_ediel_message_id:ACK}}]
  expect(await followUpAckRejection(rejection())).toMatchObject({status:'technical_rejection_case',existing:false})
  const own=io.tables.customer_cases.find(r=>r.company_id===T)
  expect(own?.metadata).toMatchObject({customer_notified:false,source_ediel_message_id:ACK})
  expect(await followUpAckRejection(rejection())).toMatchObject({existing:true,caseId:own?.id})
  expect(io.tables.customer_cases.filter(r=>r.company_id===T)).toHaveLength(1)
  expect(companyFilters('customer_cases').filter(filters=>filters.length).every(filters=>filters.length===1&&filters[0][2]===T)).toBe(true)
})
it('retains the existing no-company ACK manual note without a tenant query',async()=>{
  expect(await followUpAckRejection({...rejection(),ackMessage:{id:ACK,company_id:null,customer_id:C,message_family:'CONTRL'} as never})).toEqual({status:'skipped',reason:'no_customer_link'})
  expect(io.queries).toHaveLength(0);expect(io.events).toHaveLength(1)
})
const signed=()=>{const hash=createHash('sha256').update('SYNTHETIC-SIGNED-PDF').digest('hex');io.tables.customer_contracts=[{id:CONTRACT,company_id:T,document_sha256:hash}];io.tables.customer_contract_documents=[{id:id(40),company_id:T,customer_contract_id:CONTRACT,document_type:'signed_contract_pdf',document_sha256:hash,storage_bucket:'fixture',storage_path:'signed.pdf',verified_at:'2026-10-01T00:00:00Z'}]}
it('derives the requested method from a same-company verified and hash-matching signed PDF',async()=>{
  signed();expect(await deriveContractRequestedMethodFromSignedAgreement(scope())).toBe(true)
  expect(io.download).toHaveBeenCalledOnce();expect(io.rpc).toHaveBeenCalledWith('ediel_derive_contract_requested_method_v1',expect.objectContaining({p_company_id:T,p_contract_id:CONTRACT}))
  expect(companyFilters('customer_contracts')).toEqual([[['eq','company_id',T]]]);expect(companyFilters('customer_contract_documents')).toEqual([[['eq','company_id',T]]])
})
it('refuses another company signed PDF before download or derivation',async()=>{
  signed();io.tables.customer_contract_documents[0].company_id=OTHER
  expect(await deriveContractRequestedMethodFromSignedAgreement(scope())).toBe(false)
  expect(io.download).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()
})
it('retains the actual signed-original hash refusal',async()=>{
  signed();io.download.mockResolvedValueOnce({data:new Blob(['changed']),error:null})
  expect(await deriveContractRequestedMethodFromSignedAgreement(scope())).toBe(false);expect(io.rpc).not.toHaveBeenCalled()
})
it('requires company scope before reading a contract for method derivation',async()=>{
  signed();await expect(deriveContractRequestedMethodFromSignedAgreement({...scope(),companyId:''})).rejects.toThrow('Bolag krävs')
  expect(io.queries).toHaveLength(0);expect(io.download).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()
})
it('bulk dry-run reads only the requested company and retains paging and source order',async()=>{
  const base={grid_owner_id:G,grid_owner_name:'Synthetic',grid_owner_ediel_id:'16700',platform_actor_route_id:id(50),message_family:'PRODAT',message_code:'Z03',environment:'test',sender_settings_id:id(51),blocker_code:'platform_route_exists_but_not_materialized'}
  io.tables.gridex_company_route_readiness_v=[{...base,company_id:OTHER},{...base,company_id:T}]
  const form=new FormData();form.set('companyId',T);form.set('environment','test');form.set('messageFamily','PRODAT')
  await expect(bulkMaterializeOperationalRoutesAction(form)).rejects.toThrow('fixture_redirect')
  const read=io.queries.find(q=>q.table==='gridex_company_route_readiness_v')!
  expect(read.filters.filter(([,key])=>key==='company_id')).toEqual([['eq','company_id',T]])
  expect(read.orders).toEqual(['platform_actor_route_id','grid_owner_id','message_code','sender_settings_id']);expect(read.range).toEqual([0,999])
  expect((io.tables.audit_logs[0].metadata as Row).rowCount).toBe(1);expect(io.materialize).not.toHaveBeenCalled()
})
it('keeps the platform authorization gate before any bulk route query',async()=>{
  io.auth.mockRejectedValueOnce(Error('platform_access_denied'))
  const form=new FormData();form.set('companyId',T)
  await expect(bulkMaterializeOperationalRoutesAction(form)).rejects.toThrow('platform_access_denied')
  expect(io.queries).toHaveLength(0)
})
