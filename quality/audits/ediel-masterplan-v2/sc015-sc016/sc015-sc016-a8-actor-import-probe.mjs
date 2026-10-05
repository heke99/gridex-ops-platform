import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const main = 'a8c991c1672d97cb03486a15ca34a16d1b2814e3'
const old = 'f2081c55c86061ec3feb1cff0f93789da89f84cc'
const sourceInputs = JSON.parse(readFileSync(new URL('./sc015-sc016-a8-actor-import-probe-inputs.json',import.meta.url),'utf8'))
const read = (ref,path) => sourceInputs[`${ref}:${path}`]
const classModule = {exports:{}}
new Function('exports',ts.transpileModule(read(main,'lib/ediel/core/failureDisposition.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(classModule.exports)
const sdk = {
  from(){const query={select(){return query},eq(){return query},not(){return query},async maybeSingle(){return {data:null,error:null}}};return query},
  async rpc(){return {data:false,error:null}}
}
function actor(ref,addClass){
  const source=read(ref,'lib/ediel/services/authorization.ts')
  const ast=ts.createSourceFile('authorization.ts',source,ts.ScriptTarget.Latest,true)
  const body=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='assertEdielTenantActor')
  assert.equal(body.length,1)
  const code=body[0].getText(ast).replace(/^export /,'')
  const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const bindings={supabaseService:sdk,...(addClass?{EdielExecutionFailure:classModule.exports.EdielExecutionFailure}:{})}
  const fn=new Function(...Object.keys(bindings),`${js};return assertEdielTenantActor`)(...Object.values(bindings))
  return {fn,bodySha256:createHash('sha256').update(code).digest('hex')}
}
async function invoke(ref,addClass){const {fn,bodySha256}=actor(ref,addClass);try{await fn({companyId:'10000000-0000-4000-8000-000000000001',actorUserId:'10000000-0000-4000-8000-000000000098',permission:'metering.write'});throw Error('unexpected admission')}catch(error){return {ref,addClass,bodySha256,errorName:error.name,message:error.message,disposition:error.disposition??null,expectedForeignActorRegex:/ediel_tenant_actor_forbidden/.test(error.message)}}}
;(async()=>{
  const before=await invoke(old,false),after=await invoke(main,false),qualified=await invoke(main,true)
  assert.equal(before.expectedForeignActorRegex,true)
  assert.equal(after.errorName,'ReferenceError')
  assert.equal(after.message,'EdielExecutionFailure is not defined')
  assert.equal(after.expectedForeignActorRegex,false)
  assert.equal(qualified.expectedForeignActorRegex,true)
  assert.deepEqual(qualified.disposition,{kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'})
  console.log(JSON.stringify({scope:'Exact current production actor function under existing SC016 functionConsumers binding; finite denied SDK input; no SQL/native rerun',before,after,qualified},null,2))
})().catch(error=>{console.error(error);process.exitCode=1})
