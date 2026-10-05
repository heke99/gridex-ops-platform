import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-no-network-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-no-network-service'
globalThis.fetch=async()=>{throw new Error('read-only-probe-network-forbidden')}
// Same retained read-only Vite source-probe adapter as the merged ESCO packet.
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:'/tmp/ediel-p01-readonly-vite',resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},logLevel:'error'})
try {
 const fixture=await server.ssrLoadModule('/__tests__/fixtures/prodat-permission-ack.ts')
 const requestFixture=await server.ssrLoadModule('/__tests__/fixtures/prodat-reporting-permission.ts')
 const compiler=await server.ssrLoadModule('/lib/ediel/rulebook/canonicalEdielPolicy.ts')
 const validator=await server.ssrLoadModule('/lib/ediel/rulebook/canonicalPolicyFieldValidator.ts')
 const projection=await server.ssrLoadModule('/lib/ediel/prodat/prodatDiagnosticProjection.ts')
 const wireInput=await server.ssrLoadModule('/__tests__/fixtures/prodat-register.ts')
 const request=requestFixture.reportingZ14Selection('S17'), object=request.objects[0]
 const customer={id:'001',qualifier:'',agency:'89'}, installation={id:'735123456789012345',agency:'9'}
 object.li='CASE:A+B?C';object.customer=customer;object.installation=installation
 object.purpose={...requestFixture.reportingObject().purpose,customer}
 object.requestAssociation={...object.requestAssociation,li:'CASE:A+B?C',customer,allowedInstallations:[installation],purpose:{kind:'present',code:'B72'}}
 const policy=compiler.resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:'V',direction:'outbound',applicationReference:'23-DGI-PRODAT',referenceDate:'2026-09-19',mode:'catalog_evidence',prodatDependentFacts:{reportingPermission:request}})
 const original=fixture.permissionAckObject('Z14','S17','A74',null)
 const position=original.findIndex(p=>p[0]==='CCI'&&p[2]==='Z04')
 assert.ok(position>=0)
 const changed=original.map((p,i)=>i===position+1?['CAV','BAD']:p)
 const observations=[]
 for(const [name,body] of [['valid-control',original],['only-invalid217',changed]]) {
  const payload=fixture.permissionAckMessage('Z14','S17','A74',null,undefined,body).raw_payload
  const issues=validator.validateCanonicalPolicyFields({policy,...wireInput.input(payload,'Z14'),rawPayload:payload})
  const projected=projection.projectProdatDiagnostics(issues)
  observations.push({name,issues,applicationErrors:projected.applicationErrors,disposition:projected.disposition})
 }
 assert.deepEqual(observations[0].issues,[],'complete positive canonical control')
 const changedResult=observations[1]
 assert.equal(changedResult.issues.length,1,'exact changed-field result')
 const guard=changedResult.issues[0]
 assert.equal(guard.code,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID')
 assert.equal(guard.blocking,true)
 assert.ok(guard.description.startsWith('Z14:217,'))
 assert.equal(guard.fieldPath,'CCI++Z04/CAV')
 assert.equal(guard.prodatDiagnostic,undefined,'observed typed metadata gap, not manufactured metadata')
 assert.equal(changedResult.disposition.kind,'internal_review','consumer fails closed')
 assert.deepEqual(changedResult.applicationErrors,[],'no invented external ERC/fieldnumber')
 const report={kind:'READ_ONLY_DIAGNOSTIC_PROBE_NOT_APPROVAL',sourceBase:'fff486f822001d35970f163507b10e17c3692f58',boundary:'Actual existing canonical field validator and actual diagnostic consumer; finite independently declared synthetic request; network forbidden; no persistence/native/ACK delivery claim; not a new masterplan implementation/test harness/renderer.',observations}
 fs.writeFileSync(path.resolve('quality/audits/ediel-masterplan-v2/at-p04-parent-applicability/next-preflight/p01-217-canonical-observation.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({validControlIssues:0,mutatedIssues:changedResult.issues.length,actualCode:guard.code,typedDiagnosticPresent:false,actualDisposition:changedResult.disposition.kind,externalErrors:0}))
} finally {await server.close()}
