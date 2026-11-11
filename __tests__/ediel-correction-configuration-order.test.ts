import {readFileSync} from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {describe,it,expect,vi} from 'vitest'

// Source-bound finite ports only; no database/authority or original-case proof.
const root=process.cwd()
const normalRoot=process.env.GRIDEX_CORRECTION_NORMAL_SOURCE_ROOT??root
const literal=(v:unknown)=>`'${String(v).replaceAll("'","''")}'`
function sourceFunction(file:string,name:string){
 const text=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
 let found:ts.FunctionDeclaration|undefined
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name&&node.body)found=node;ts.forEachChild(node,visit)}
 visit(ast);if(!found)throw Error(`existing_source_function_missing:${name}`)
 return ts.createPrinter().printNode(ts.EmitHint.Unspecified,found,ast)
}
function load(code:string,name:string,ports:Record<string,unknown>){
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 return new Function(...Object.keys(ports),`${js};return ${name};`)(...Object.values(ports))
}
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222'
const oldRoute='33333333-3333-4333-8333-333333333333',newRoute='44444444-4444-4444-8444-444444444444'
const correction={routeId:newRoute,profileId:'55555555-5555-4555-8555-555555555555',sourceRouteId:oldRoute,sourceProfileId:'66666666-6666-4666-8666-666666666666'}
const setup={actorRole:'supplier',environmentType:'tgt_test',messageFamily:'PRODAT',testSuiteType:'TGT',value:'tgt_ddq_prodat_utilts'}
describe('first correction prospective Z08 configuration phase',()=>{
 for(const mode of ['correction','default','save-denied','missing-source'] as const)it(`${mode}: configuration precedes normal reconciliation without replacing Z03`,async()=>{
  const events:string[]=[],codes=new Map([[oldRoute,'Z03']]);let admission=false
  const sql=(q:string)=>{
   if(q.includes('SELECT to_jsonb(a)'))return{id:'supplier',company_id:company,actor_ediel_id:'97001',environment:'test',is_active:true}
   if(q.includes('Synthetic prospective correction')){if(mode==='missing-source')return{routeCount:0,profileCount:0};events.push('configure-Z08');codes.set(newRoute,'Z08');admission=false;return{routeCount:1,profileCount:1}}
   if(q.includes('canonical_tenant_operation_decision'))return{allowed:admission}
  }
  const save=vi.fn(async(p:{actorUserId:string})=>{expect(p.actorUserId).toBe(actor);events.push('normal-save');if(mode==='save-denied')throw Error('normal_save_denied');admission=true})
  const fn=load(sourceFunction(path.join(normalRoot,'scripts/helpers/ediel-normal-switch-native-fixture.ts'),'qualifyNormalSwitchNativeTestConfiguration'),'qualifyNormalSwitchNativeTestConfiguration',{sql,literal,randomUUID:()=>newRoute,getEdielSystemTestPackage:()=>setup,saveEdielSystemTestSettings:save,expect})
  if(mode==='missing-source')await expect(fn(company,actor,'97001','99876',correction)).rejects.toThrow('native_correction_route_source_required')
  else if(mode==='save-denied')await expect(fn(company,actor,'97001','99876',correction)).rejects.toThrow('normal_save_denied')
  else await fn(company,actor,'97001','99876',mode==='correction'?correction:undefined)
  expect(codes.get(oldRoute)).toBe('Z03')
  if(mode==='correction'){expect(codes.get(newRoute)).toBe('Z08');expect(events).toEqual(['configure-Z08','normal-save']);expect(admission).toBe(true)}
  if(mode==='default')expect(codes.has(newRoute)).toBe(false)
  if(mode==='save-denied'||mode==='missing-source')expect(admission).toBe(false)
  if(mode==='missing-source')expect(save).not.toHaveBeenCalled()
 })


 it('normal stage carries opt-in IDs through qualification before owner removal; defaults unchanged',async()=>{
  const file=path.join(normalRoot,'scripts/helpers/ediel-normal-switch-native-fixture.ts'),text=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
  const declaration=ast.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='seedNormalSwitchNativeFixture'&&!!n.body)
  if(!declaration?.body)throw Error('existing_seed_body_missing')
  const statements=declaration.body.statements,index=statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='invoiceeSnapshot'))
  if(index<0)throw Error('existing_invoicee_boundary_missing')
  const code=statements.slice(index+1).map(n=>ts.createPrinter().printNode(ts.EmitHint.Unspecified,n,ast)).join('\n')
  for(const enabled of [false,true]){
   const events:string[]=[],qualification=vi.fn(async(...args:unknown[])=>{events.push('qualify');return args[4]?newRoute:undefined})
   const ports={companyId:company,actorUserId:actor,customerId:'customer',siteId:'site',pointId:'point',contractId:'contract',switchId:'switch',external:'external',sender:'97001',receiver:'97002',gridId:'grid',routeId:oldRoute,routeProfileId:'profile',marketActor:'market',customerIdentity:'identity',requestedStartDate:'2099-01-01',brpEdielId:'99876',documentSha256:'sha',authorizationDocumentId:'auth',poa:{id:'poa'},invoiceeSnapshot:{}}
   const boundary=load(`async function boundary(input){${code}}`,'boundary',{...ports,qualifyNormalSwitchNativeTestConfiguration:qualification,randomUUID:()=>newRoute,sql:(q:string)=>{if(q.includes('DELETE FROM public.admin_users')){expect(events).toEqual(['qualify']);events.push('owner-release')};if(q.includes("'messages'"))return{messages:0,originals:0,periods:0};return true},literal,expect})
   const result=await boundary({deferOriginal:true,prospectiveCorrectionDispatch:enabled})
   expect(events).toEqual(['qualify','owner-release']);expect(result.routeId).toBe(oldRoute)
   expect(result.correctionRouteId).toBe(enabled?newRoute:undefined)
   expect(qualification.mock.calls[0][4]).toEqual(enabled?{routeId:newRoute,profileId:newRoute,sourceRouteId:oldRoute,sourceProfileId:'profile'}:undefined)
  }
 })
 it('missing prospective route is denied before producer entry, never falls back',async()=>{
  const prepare=vi.fn()
  const fn=load(sourceFunction(path.join(root,'scripts/helpers/nationalRescissionNative.ts'),'nationalRescissionOperation'),'nationalRescissionOperation',{deps:{prospectiveCorrectionDispatch:true},nationalRescissionArtifact:async()=>({companyId:company,actorUserId:actor,reviewer:'reviewer',artifactId:'artifact',routeId:oldRoute}),reviewSupplyRescission:async()=>({status:'authorized',mandateId:'mandate'}),prepareAndQueueSupplyRescissionZ08:prepare,expect})
  await expect(fn()).rejects.toThrow('native_correction_route_required');expect(prepare).not.toHaveBeenCalled()
 })
 it('national stage carries the explicit configuration opt-in without any new actor',async()=>{
  const seed=vi.fn(async(input:Record<string,unknown>)=>({companyId:company,actorUserId:actor,input}))
  const fn=load(sourceFunction(path.join(root,'scripts/helpers/nationalRescissionNative.ts'),'stage'),'stage',{deps:{prospectiveCorrectionDispatch:true},seedNormalSwitchNativeFixture:seed,sql:()=>undefined,literal})
  await fn();expect(seed.mock.calls[0][0]).toMatchObject({prospectiveCorrectionDispatch:true,deferOriginal:true,initialSubtype:'H'})
 })
 it('correction entry explicitly opts into prospective configuration',()=>{
  const file=path.join(root,'scripts/ediel-correction-context-native.test.ts'),text=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
  let initializer:ts.Expression|undefined
  for(const n of ast.statements)if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(d.name.getText(ast)==='rescission')initializer=d.initializer
  if(!initializer)throw Error('existing_rescission_entry_missing')
  const factory=vi.fn((input:Record<string,unknown>)=>input)
  new Function('nationalRescissionNativeChain','provider','sourceSession',`return ${initializer.getText(ast)}`)(factory,{},{});
  expect(factory.mock.calls[0][0]).toMatchObject({prospectiveCorrectionDispatch:true})
 })
 it('national producer explicitly selects prospective Z08 while default retains Z03',async()=>{
  for(const enabled of [false,true]){
   const prepare=vi.fn(async(input:Record<string,unknown>)=>({status:'queued',message:{id:String(input.mandateId)}}))
   const fn=load(sourceFunction(path.join(root,'scripts/helpers/nationalRescissionNative.ts'),'nationalRescissionOperation'),'nationalRescissionOperation',{
    deps:{prospectiveCorrectionDispatch:enabled},nationalRescissionArtifact:async()=>({companyId:company,actorUserId:actor,reviewer:'reviewer',artifactId:'artifact',routeId:oldRoute,correctionRouteId:newRoute,periodId:'period'}),reviewSupplyRescission:async()=>({status:'authorized',mandateId:'mandate'}),nationalNativeOperator:()=>{throw Error('unexpected_new_actor')},prepareAndQueueSupplyRescissionZ08:prepare,sql:(q:string)=>q.includes('draft_wire')?{objects:[{li:'Hmandate',reason:'Z25'}]}:true,literal,expect})
   await fn();expect(prepare.mock.calls[0][0]).toMatchObject({actorUserId:actor,preferredRouteId:enabled?newRoute:oldRoute})
  }
 })
 it('outbound seed uses actual produced route and does not invalidate after qualification',async()=>{
  const produced={id:'message',communication_route_id:newRoute,raw_payload:'wire'}
  const fn=load(sourceFunction(path.join(root,'scripts/ediel-correction-context-native.test.ts'),'outboundSeed'),'outboundSeed',{seedCorrectionSource:async()=>({companyId:company,actorUserId:actor}),raw:()=> 'wire',randomUUID:()=> 'point',rescission:{nationalRescissionOperation:async()=>({companyId:company,routeId:oldRoute,original:produced,marketActorId:'market',receiver:'97002',sender:'97001'})},literal,expect,sql:(q:string)=>{if(q.includes('UPDATE public.ediel_route_profiles'))throw Error('late_configuration_invalidates');if(q.includes('count(*)'))return 1;if(q.includes('can_use_for_prodat'))return true;if(q.includes('SELECT to_jsonb(id)'))return'77777777-7777-4777-8777-777777777777';return'market'},sourceSession:{client:null},provider:{mockReset:()=>{}}})
  const f=await fn();expect(f.routeId).toBe(newRoute)
 })
})
