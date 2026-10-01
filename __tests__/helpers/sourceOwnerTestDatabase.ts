import {ownerSource,ownerRulePackEvidence,OWNER,ownerId} from './sourceOwnerFixtures'
import {createHash} from 'node:crypto'
export type SourceOwnerTestIO = {rows:Record<string,Record<string,unknown>[]>;calls:{name:string;args:Record<string,unknown>}[];badReceipt:string;badCount:boolean;failTable:string;hideSupply:boolean;message?:ReturnType<typeof ownerSource>;nativeUnavailable?:boolean}
/** Only the external database boundary is replaced; all decision producers are real. */
export function sourceOwnerTestDatabase(io:SourceOwnerTestIO) { return {from:(table:string)=>{
 const filters:Record<string,unknown>={};let columns='',values:Record<string,unknown>|null=null,single=false
 const result=()=>{
   const rows=(io.rows[table]??[]).filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v))
   if(values&&table!==io.failTable)rows.forEach(r=>Object.assign(r,values))
   const data=rows.map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]])))
   return {data:single?(table==='customer_supply_periods'&&io.hideSupply?null:data[0]??null):data,error:io.failTable===table?new Error('injected database failure'):null,count:io.badCount?null:data.length}
 }
 const q={select:(c:string)=>{columns=c;return q},eq:(k:string,v:unknown)=>{filters[k]=v;return q},lte:()=>q,or:()=>q,not:()=>q,limit:()=>q,abortSignal:()=>q,
 update:(v:Record<string,unknown>)=>{values=v;return q},maybeSingle:()=>{single=true;return q},
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q
},rpc:(name:string,args:Record<string,unknown>)=>{
 io.calls.push({name,args});const hash=createHash('sha256').update(String(args.p_facts_text??'')).digest('hex')
 const source=io.message??ownerSource(),registry=ownerRulePackEvidence(),basis={rulePackId:registry.rulePackId,messageProfileId:registry.messageProfileId,profileKey:registry.databaseProfileKey,version:registry.originalVersion,sourceHash:registry.sourceHash,snapshot:{profileKey:registry.databaseProfileKey,profileVersionId:registry.messageProfileId,version:registry.originalVersion,checksum:registry.sourceHash,...registry.originalSnapshot}}
 // Actual native capture/read/permission are declared fixture IO only; their
 // tenant/raw/named witness contracts remain active in the real TS consumers.
 if(name==='ediel_probe_source_rule_pack_capture_v1'){
  const captured=io.calls.some(c=>c.name==='gridex_record_prodat_source_validation_v4'&&c.args.p_company_id===args.p_company_id&&c.args.p_source_message_id===args.p_message_id)
  return Promise.resolve({data:captured&&args.p_company_id===source.company_id&&args.p_message_id===source.id?{status:'captured',evidence:basis}:null,error:null})
 }
 if(name==='ediel_apply_customer_life_event_source_v1'&&source.message_code==='Z04')return Promise.resolve({data:{applied:false,reason:'not_customer_life_event'},error:null})
 if(name==='gridex_actor_has_company_permission')return Promise.resolve({data:args.p_company_id===OWNER.company&&args.p_actor_user_id===ownerId(50)&&['communication.write','ediel_testing.write'].includes(String(args.p_permission)),error:null})
 if(name==='gridex_read_outbound_acks_for_source_v1')return Promise.resolve({data:{version:1,sourceMessageId:source.id,sourcePayloadHash:createHash('sha256').update(source.raw_payload!).digest('hex'),companyId:source.company_id,environment:source.environment,originals:[]},error:null})
 if(name==='ediel_read_source_rule_pack_basis_v1')return Promise.resolve({data:{version:1,sourceMessage:structuredClone(source),sourceRulePackEvidence:basis},error:null})
 if(name==='ediel_apply_supply_source_v1') {
  // Declared native fixture boundary. SQL source/atomicity authorization is
  // exercised independently by ediel-normal-switch-source-sql-regression.
  let nativeError:Error|null=null
  if(io.failTable==='customer_supply_periods')nativeError=new Error('injected database failure')
  const switches=io.rows.supplier_switch_requests.filter(row=>row.company_id===args.p_company_id&&row.inbound_z04_message_id===args.p_source_message_id)
  const commits=switches.map(sw=>{
   const period=io.rows.customer_supply_periods.find(p=>p.company_id===sw.company_id&&p.customer_id===sw.customer_id&&p.metering_point_id===sw.metering_point_id)
   if(!period)return null
   if(!nativeError&&!io.nativeUnavailable){sw.status='accepted';sw.confirmed_start_date=period.start_date;period.status='confirmed_by_grid_owner'}
   return {switchRequestId:sw.id,supplyPeriodId:period.id,customerId:sw.customer_id,meteringPointId:sw.metering_point_id,siteId:sw.site_id}
  }).filter(Boolean)
  return Promise.resolve({data:{applied:!nativeError&&!io.nativeUnavailable,reason:io.nativeUnavailable?'normal_z04_exact_sent_original_required':null,commits:!nativeError&&!io.nativeUnavailable?commits:[],periods:[]},error:nativeError})
 }
 let data:Record<string,unknown>=name==='gridex_witness_source_objects_v1'?{version:1,witnessId:'00000000-0000-4000-8000-000000000032',assessmentId:args.p_assessment_id,companyId:args.p_company_id,environment:args.p_environment,factsHash:args.p_facts_hash,availableAt:new Date().toISOString()}:
 {version:name==='gridex_record_prodat_source_validation_v4'?4:1,assessmentId:name==='gridex_record_prodat_source_validation_v4'?'00000000-0000-4000-8000-000000000030':'00000000-0000-4000-8000-000000000031',companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,factsHash:hash,sourceDisposition:'not_established'}
 if(name==='gridex_record_prodat_source_validation_v4'){for(const [key,arg] of [['ignoredFieldsHash','p_ignored_fields_text'],['responseFactsHash','p_response_facts_text'],['applicationFactsHash','p_application_facts_text']] as const)data[key]=args[arg]===null||args[arg]===undefined?null:createHash('sha256').update(String(args[arg])).digest('hex')}
 if(io.badReceipt===name)data={...data,companyId:'00000000-0000-4000-8000-000000000999'}
 const q={abortSignal:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q
}} }
