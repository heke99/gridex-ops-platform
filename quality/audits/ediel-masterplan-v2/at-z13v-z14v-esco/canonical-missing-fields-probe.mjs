// Run from the repository root with Node22 --input-type=module < this file.
// Reuses the existing permission fixture and actual canonical owner; no DB ports.
import { createServer } from 'vite'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
const output=process.env.AT_Z14V_PROBE_OUTPUT??path.resolve('quality/audits/ediel-masterplan-v2/at-z13v-z14v-esco/canonical-observation')
fs.mkdirSync(output,{recursive:true})
process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-no-network-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-no-network-service'
globalThis.fetch=async()=>{throw new Error('read-only-probe-network-forbidden')}
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:'/tmp/ediel-z14-readonly-vite',resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},logLevel:'error'})
try {
 const fixture=await server.ssrLoadModule('/__tests__/fixtures/prodat-permission-ack.ts')
 const runtime=await server.ssrLoadModule('/lib/ediel/core/runtimeDecision.ts')
 const base=fixture.permissionAckObject('Z14','S17','A74',null)
 const variants=[['baseline',base],['missing326',base.filter(p=>!(p[0]==='DTM'&&p[1]?.[0]==='693'))],['missing222',base.filter((p,i)=>!(p[0]==='CCI'&&p[2]==='Z12')&&!(i>0&&base[i-1][0]==='CCI'&&base[i-1][2]==='Z12'))]]
 const observations=[]
 for (const [name,body] of variants) {
  const source=fixture.permissionAckMessage('Z14','S17','A74',null,undefined,body)
  const decision=runtime.resolveCanonicalRuntimeDecision(source)
  const observation={name,syntaxDecision:decision.syntaxDecision,applicationDecision:decision.applicationDecision,functionalDecision:decision.functionalDecision,issues:decision.issues,responsePlan:decision.responsePlan,prodatApplicationValidation:decision.prodatApplicationValidation,prodatRegisterValidation:decision.prodatRegisterValidation,prodatProcessingDisposition:decision.prodatProcessingDisposition,policy:{code:decision.policy?.code,subtype:decision.policy?.subtype,applicationReference:decision.policy?.applicationReference,mode:decision.policy?.mode}}
  fs.writeFileSync(path.join(output,name+'.edi'),source.raw_payload)
  observations.push(observation)
  console.log(JSON.stringify(observation))
 }
 fs.writeFileSync(path.join(output,'observations.json'),JSON.stringify({owner:'existing full canonical runtime / current fixture',sourceBase:'cf72b8958f2fdc7016752de0da7d7f08dd365c55',boundaries:['no registry admission','no private/native/source receipt','no permission mutation','fetch prevented'],observations},null,2)+'\n')
 if(process.env.AT_Z14V_ASSERT_FIELDS==='1'){
  assert.equal(observations[0].applicationDecision,'accepted','complete positive control')
  for(const item of observations.slice(1))assert.notEqual(item.applicationDecision,'accepted',item.name+': known applicable field absence must not certify complete application acceptance')
 }
} finally {await server.close()}
