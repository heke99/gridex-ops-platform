// masterplan: ESCO-07, SC-023
// Finite source-mechanics proof; no native/source admission substitution.
const {spawnSync}=require('node:child_process')
const path=require('node:path')
const root=path.join(__dirname,'..')
if(process.env.EDIEL_SC023_TS_ONLY!=='1'){
const run=spawnSync(process.execPath,[path.join(__dirname,'ediel-partial-permission-source-sql-regression.mjs')],{
 cwd:root,encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite'),EDIEL_PERMISSION_PROBE_MODULE:path.join(__dirname,'ediel-sc-023-vh-history-sql-regression.mjs')}
})
if(run.status!==0){console.error(JSON.stringify({status:run.status,signal:run.signal,error:run.error?.message}));console.error(run.stdout);console.error(run.stderr);process.exit(1)}
console.log(run.stdout)
}

// Real own TS facade with a typed RPC IO port; the SQL suite above checks the
// actual authorization/writer. This does not wire or simulate generated types.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const moduleCache=new Map()
function ownModule(file){
 if(moduleCache.has(file))return moduleCache.get(file)
 const output=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText
 const module={exports:{}};moduleCache.set(file,module.exports)
 const ownRequire=name=>{if(name==='../services/vhHistoryDelivery')return ownModule('lib/ediel/services/vhHistoryDelivery.ts');throw Error('unexpected_SC023_IO:'+name)}
 vm.runInNewContext(output,{module,exports:module.exports,require:ownRequire},{filename:file})
 return module.exports
}
async function typedProof(){
 const service=ownModule('lib/ediel/services/vhHistoryDelivery.ts'),flow=ownModule('lib/ediel/flows/vhHistoryRequest.ts')
 const company='00000000-0000-0000-0000-000000000001',permission='00000000-0000-0000-0000-000000900110',actor='00000000-0000-0000-0000-000000000002',site='00000000-0000-0000-0000-000000970010',request='00000000-0000-0000-0000-000000975002',message='00000000-0000-0000-0000-000000975001'
 const input={companyId:company,permissionId:permission,actorUserId:actor},link={...input,siteId:site,requestId:request,messageId:message,transactionId:'SC023-VH-REQUEST'}
 const own={siteId:site,point:'735123456789099990',product:'8716867000030',approvedStart:'2025-12-31T23:00:00Z',approvedEnd:'2026-01-01T23:00:00Z',basisHash:'a'.repeat(64),closure:null,closureHistory:[],requests:[]}
 const value={companyId:company,permissionId:permission,environment:'test',state:'approved_or_receiving',openingSourceMessageId:'00000000-0000-0000-0000-000000900130',objects:[own],dataAccessGranted:false,transportAuthorityGranted:false}
 let result=value,calls=[]
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='ediel_vh_history_delivery_audit_v1')return{error:null,data:result};if(result.state==='historical_delivery_closed')return{data:null,error:new Error('vh_history_request_delivery_closed')};return{error:null,data:{requestId:request,state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 assert.equal((await service.readVhHistoryDeliveryAudit(client,input)).permissionId,permission)
 assert.equal(calls[0].args.p_actor_user_id,actor)
 result={...value,companyId:'00000000-0000-0000-0000-000000000099'}
 await assert.rejects(service.readVhHistoryDeliveryAudit(client,input),/vh_history_audit_scope_invalid/)
 result={...value,state:'historical_delivery_closed'};calls=[]
 await assert.rejects(flow.linkExistingVhHistoryRequest(client,link),/vh_history_request_delivery_closed/)
 assert.equal(calls.length,1,'closed history is rejected by authoritative SQL link, without a read, enqueue or retry call')
 assert.equal(calls[0].name,'ediel_link_vh_history_request_v1')
 result=value;calls=[]
 const linked=await flow.linkExistingVhHistoryRequest(client,link)
 assert.equal(linked.state,'awaiting');assert.equal(calls.length,1);assert.equal(calls[0].args.p_request_id,request);assert.equal(calls[0].args.p_actor_user_id,actor)
 const writeOnlyCalls=[]
 const writeOnly={rpc:async(name,args)=>{writeOnlyCalls.push({name,args});return name==='ediel_vh_history_delivery_audit_v1'?{data:null,error:new Error('42501: metering.read denied for legitimate link writer')}:{error:null,data:{requestId:request,state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 assert.equal((await flow.linkExistingVhHistoryRequest(writeOnly,link)).state,'awaiting','typed link must retain the SQL write operation authority without adding metering.read')
 assert.equal(writeOnlyCalls.length,1);assert.equal(writeOnlyCalls[0].name,'ediel_link_vh_history_request_v1')
 calls=[];await assert.rejects(flow.linkExistingVhHistoryRequest(client,{...link,siteId:'not-an-id'}),/vh_history_request_scope_unqualified/);assert.equal(calls.length,0,'invalid scope is rejected before IO')
 const replay={rpc:async name=>{assert.equal(name,'ediel_link_vh_history_request_v1');return{error:null,data:{requestId:request,state:'manual_review',idempotent:true,transportAuthorityGranted:false}}}}
 assert.deepEqual(JSON.parse(JSON.stringify(await flow.linkExistingVhHistoryRequest(replay,link))),{requestId:request,state:'manual_review',idempotent:true,transportAuthorityGranted:false},'authoritative exact replay retains manual review without new read or transport authority')
 const upper={...link,companyId:'A0000000-0000-0000-0000-000000000001',permissionId:'B0000000-0000-0000-0000-000000900110',actorUserId:'F0000000-0000-0000-0000-000000000002',siteId:'D0000000-0000-0000-0000-000000970010',requestId:'C0000000-0000-0000-0000-000000975002',messageId:'E0000000-0000-0000-0000-000000975001'}
 const canonicalCalls=[],canonical={rpc:async(name,args)=>{canonicalCalls.push({name,args});return{error:null,data:name==='ediel_vh_history_delivery_audit_v1'?{...value,companyId:upper.companyId.toLowerCase(),permissionId:upper.permissionId.toLowerCase()}:{requestId:upper.requestId.toLowerCase(),state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 const upperResults=await Promise.allSettled([service.readVhHistoryDeliveryAudit(canonical,upper),flow.linkExistingVhHistoryRequest(canonical,upper)])
 if(upperResults.some(r=>r.status==='rejected'))console.error(upperResults.map(r=>r.status==='rejected'?String(r.reason):r.status))
 assert.deepEqual(upperResults.map(r=>r.status),['fulfilled','fulfilled'],'accepted uppercase UUIDs must agree with PostgreSQL canonical lowercase results')
 assert.equal(upperResults[0].value.companyId,upper.companyId.toLowerCase());assert.equal(upperResults[1].value.requestId,upper.requestId.toLowerCase())
 for(const call of canonicalCalls)for(const [key,value]of Object.entries(call.args))if(key!=='p_transaction_id')assert.equal(value,value.toLowerCase(),'canonicalize UUID before IO')
 console.log('SC-023 actual typed audit/link facade: 9 cases PASS; injected RPC IO only, generated/native consumer NOT_VERIFIED.')
}
typedProof().catch(error=>{console.error(error);process.exitCode=1})
