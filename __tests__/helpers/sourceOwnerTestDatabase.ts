import {createHash} from 'node:crypto'
export type SourceOwnerTestIO = {rows:Record<string,Record<string,unknown>[]>;calls:{name:string;args:Record<string,unknown>}[];badReceipt:string;badCount:boolean;failTable:string;hideSupply:boolean}
/** Only the external database boundary is replaced; all decision producers are real. */
export function sourceOwnerTestDatabase(io:SourceOwnerTestIO) { return {from:(table:string)=>{
 const filters:Record<string,unknown>={};let columns='',values:Record<string,unknown>|null=null,single=false
 const result=()=>{
   const rows=(io.rows[table]??[]).filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v))
   if(values&&table!==io.failTable)rows.forEach(r=>Object.assign(r,values))
   const data=rows.map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]])))
   return {data:single?(table==='customer_supply_periods'&&io.hideSupply?null:data[0]??null):data,error:io.failTable===table?new Error('injected database failure'):null,count:io.badCount?null:data.length}
 }
 const q={select:(c:string)=>{columns=c;return q},eq:(k:string,v:unknown)=>{filters[k]=v;return q},lte:()=>q,or:()=>q,limit:()=>q,abortSignal:()=>q,
 update:(v:Record<string,unknown>)=>{values=v;return q},maybeSingle:()=>{single=true;return q},
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q
},rpc:(name:string,args:Record<string,unknown>)=>{
 io.calls.push({name,args});const hash=createHash('sha256').update(String(args.p_facts_text??'')).digest('hex')
 let data:Record<string,unknown>=name==='gridex_witness_source_objects_v1'?{version:1,witnessId:'00000000-0000-4000-8000-000000000032',assessmentId:args.p_assessment_id,companyId:args.p_company_id,environment:args.p_environment,factsHash:args.p_facts_hash,availableAt:new Date().toISOString()}:
 {version:1,assessmentId:name==='gridex_record_source_validation_v1'?'00000000-0000-4000-8000-000000000030':'00000000-0000-4000-8000-000000000031',companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,factsHash:hash,sourceDisposition:'not_established'}
 if(io.badReceipt===name)data={...data,companyId:'00000000-0000-4000-8000-000000000999'}
 const q={abortSignal:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q
}} }
