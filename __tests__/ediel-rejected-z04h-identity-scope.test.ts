import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {ownerSource} from '@/__tests__/helpers/sourceOwnerFixtures'
import {tokenizeEdifact,segmentUntrimmedRaw} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {isProdatRejectedIdentityScope} from '@/lib/ediel/prodat/prodatRejectedIdentityScope'
import {validateReceivedZ04RequiredStartStructure} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
const raw=ownerSource().raw_payload!.replace('735123456789012345','').replace('CAV+Z22','CAV+Z25')
const schema=readFileSync('supabase/schema.sql','utf8')
const migration=readFileSync('supabase/migrations/20261010102411_ediel_rejected_z04h_identity_scope.sql','utf8')
const appendName='gridex_received_sources.append_validation_before_reference_profile_v1'
const appendSignature=appendName+'(uuid,text,uuid,text,text)'
const preimage='f487a3c60c8c0bdfe0be3786d50662ea7d3abb6df8214be573f9d76a176ca6bf'
const postimage='dba263aae82c1c4f54147d3f35d32518092a25e3ffc9e454657f1cb7f897481d'
const oldPredicate="(obj->>'disposition'='rejected' AND gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE)"
const newPredicate="(obj->>'disposition'='rejected' AND (gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE OR gridex_received_sources.rejected_z04h_identity_scope_v1(src.raw_payload,obj) IS TRUE))"
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
type AppendSnapshot={body:string;definition:string;metadata:Record<string,unknown>}
async function appendSnapshot(database:PGlite):Promise<AppendSnapshot>{
 const {rows}=await database.query<AppendSnapshot>(`SELECT p.prosrc AS body,pg_get_functiondef(p.oid) AS definition,
  to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p WHERE p.oid=$1::regprocedure`,[appendSignature])
 if(rows.length!==1)throw Error('ACTUAL_CAPTURED_APPEND_REQUIRED')
 return rows[0]
}
function capturedAppendState(body:string):'pre'|'post'{
 const checksum=hash(body)
 if(checksum===preimage&&body.split(oldPredicate).length===2&&!body.includes(newPredicate))return 'pre'
 if(checksum===postimage&&body.split(newPredicate).length===2&&!body.includes(oldPredicate)
  &&hash(body.replace(newPredicate,oldPredicate))===preimage)return 'post'
 throw Error('ACTUAL_CAPTURED_APPEND_PRE_OR_POSTIMAGE_REQUIRED')
}
function captured(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'('),rest=schema.slice(start),tag=/\bAS (\$[a-zA-Z0-9_]*\$)/.exec(rest)
 if(start<0||!tag)throw Error('ACTUAL_CAPTURED_FUNCTION_REQUIRED:'+name)
 const end=rest.indexOf(tag[1]+';',tag.index+tag[0].length)
 if(end<0)throw Error('ACTUAL_CAPTURED_FUNCTION_END_REQUIRED:'+name)
 return rest.slice(0,end+tag[1].length+1)
}
function actual(rawPayload=raw){const wire=tokenizeEdifact(rawPayload),groups=prodatRegisterGroups(wire.segments,wire.una,'Z04'),
 structural=validateReceivedZ04RequiredStartStructure({rawSegments:wire.segments.map(t=>t.raw),una:wire.una})
 return {wire,groups,structural,scope:structural.evidence.objects[0]}}
let db:PGlite
let capturedAppend:AppendSnapshot,predecessorAppend:AppendSnapshot
beforeAll(async()=>{
 db=new PGlite()
 // Empty compile-only relations support the actual append function declaration.
 // No original, accepted ledger, actor, receipt or business authority is seeded.
 await db.exec(`CREATE SCHEMA gridex_received_sources;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid);CREATE TABLE public.ediel_rule_packs(id uuid);
 CREATE TABLE public.ediel_message_profiles(id uuid);CREATE TABLE public.ediel_messages(id uuid);`)
 await db.exec(captured('gridex_received_sources.wire_tokens_bounded_v1'))
 await db.exec(captured('gridex_received_sources.closure_wire_tokens_v2'))
 await db.exec(captured(appendName))
 const acl=schema.split('\n').filter(line=>/^(?:REVOKE|GRANT) .+ ON FUNCTION gridex_received_sources\.append_validation_before_reference_profile_v1\(/.test(line))
 if(acl.length===0)throw Error('ACTUAL_CAPTURED_APPEND_ACL_REQUIRED')
 await db.exec(acl.join('\n'))
 capturedAppend=await appendSnapshot(db)
 // Authentic GEN may capture the installed postimage. Restore only its complete,
 // checksum-proven inverse through the current full declaration; execute the
 // unchanged predecessor-guarded forward in both capture states.
 if(capturedAppendState(capturedAppend.body)==='post'){
  await db.exec(capturedAppend.definition.replace(newPredicate,oldPredicate))
 }
 predecessorAppend=await appendSnapshot(db)
 expect(hash(predecessorAppend.body)).toBe(preimage)
 expect(predecessorAppend.body).toBe(capturedAppend.body.replace(newPredicate,oldPredicate))
 expect(predecessorAppend.definition).toBe(capturedAppend.definition.replace(newPredicate,oldPredicate))
 expect(predecessorAppend.metadata).toEqual(capturedAppend.metadata)
 await db.exec(migration)
},30000)
afterAll(async()=>{await db?.close()})
const accepted=async(rawPayload:string,scope:unknown)=>(await db.query<{accepted:boolean}>(
 'SELECT gridex_received_sources.rejected_z04h_identity_scope_v1($1,$2::jsonb) AS accepted',[rawPayload,JSON.stringify(scope)])).rows[0].accepted
it('actual structural owner preserves null209 and the actual failed composite as a rejected-only scope',async()=>{
 const own=actual(),error=projectProdatDiagnostics(own.structural.issues).applicationErrors.find(e=>e.fieldCode==='209')
 expect(own.scope).toMatchObject({objectId:null,identityAgency:'9',disposition:'rejected'})
 expect(error).toMatchObject({ercCode:'42',text:'Felaktigt Anläggnings-id :::9',referenceNumber:null,
  prodatFieldDiagnostic:{kind:'field',fieldNumber:'209',errorKind:'invalid',failureEvidence:[{content:':::9'}]}})
 expect(isProdatRejectedIdentityScope({code:'Z04',group:own.groups.groups[0],rawSegments:own.wire.segments.map(segmentUntrimmedRaw),una:own.wire.una})).toBe(true)
 expect(await accepted(raw,own.scope)).toBe(true)
})
it.each([
 ['accepted disposition',(s:ReturnType<typeof actual>['scope'])=>{s.disposition='accepted';s.reasons=[]}],
 ['unavailable disposition',(s:ReturnType<typeof actual>['scope'])=>{s.disposition='unavailable'}],
 ['forged object',(s:ReturnType<typeof actual>['scope'])=>{s.objectId='735123456789012345'}],
 ['foreign agency',(s:ReturnType<typeof actual>['scope'])=>{s.identityAgency='89'}],
 ['foreign message',(s:ReturnType<typeof actual>['scope'])=>{s.messageReference='FOREIGN'}],
 ['foreign line',(s:ReturnType<typeof actual>['scope'])=>{s.registers[0].lineIndex=1}],
 ['foreign physical segment',(s:ReturnType<typeof actual>['scope'])=>{s.registers[0].segmentIndex++}],
 ['invented register index',(s:ReturnType<typeof actual>['scope'])=>{s.registers[0].registerIndex='1'}],
 ['invented line number',(s:ReturnType<typeof actual>['scope'])=>{s.registers[0].lineNumber='2'}],
 ['duplicate register',(s:ReturnType<typeof actual>['scope'])=>{s.registers.push(structuredClone(s.registers[0]))}],
] as const)('new pure SQL refuses %s without accepted scope',async(_name,change)=>{const s=actual().scope;change(s);expect(await accepted(raw,s)).toBe(false)})
it.each([
 ['healthy identity',(s:string)=>s.replace('LIN+1++:::9','LIN+1++735123456789012345:::9')],
 ['invalid first sequence',(s:string)=>s.replace('LIN+1++','LIN+2++')],
 ['missing sequence as well',(s:string)=>s.replace('LIN+1++','LIN+++')],
 ['wrong identity agency',(s:string)=>s.replace(':::9',':::XX')],
 ['extra identity component',(s:string)=>s.replace(':::9',':::9:EXTRA')],
 ['register metadata',(s:string)=>s.replace(":::9'",":::9+1:1'")],
 ['foreign process',(s:string)=>s.replace('CAV+Z25','CAV+Z22')],
 ['missing reason',(s:string)=>s.replace("CCI++Z13'CAV+Z25'",'')],
 ['padded selector',(s:string)=>s.replace('CCI++Z13',' CCI++Z13')],
 ['released selector spelling',(s:string)=>s.replace('CCI++Z13','CCI++Z1?3')],
 ['padded reason',(s:string)=>s.replace('CAV+Z25',' CAV+Z25')],
 ['released reason spelling',(s:string)=>s.replace('CAV+Z25','CAV+Z2?5')],
 ['missing APP',(s:string)=>s.replace('23-DDQ-PRODAT','')],
 ['permission APP',(s:string)=>s.replace('23-DDQ-PRODAT','23-DGI-PRODAT')],
 ['other code',(s:string)=>s.replace('BGM+Z04','BGM+Z05')],
 ['missing LI',(s:string)=>s.replace("RFF+LI:CASE-1'",'')],
] as const)('TS and new pure SQL reject %s',async(_name,change)=>{
 const changed=change(raw);expect(changed).not.toBe(raw)
 const own=actual(changed)
 expect(isProdatRejectedIdentityScope({code:'Z04',group:own.groups.groups[0],rawSegments:own.wire.segments.map(segmentUntrimmedRaw),una:own.wire.una})).toBe(false)
 expect(await accepted(changed,own.scope)).toBe(false)
})
it('actual forward changes only rejected-only H scope and revokes every direct role',async()=>{
 const final=await appendSnapshot(db)
 expect(hash(final.body)).toBe(postimage)
 expect(final.body.replace(newPredicate,oldPredicate)).toBe(predecessorAppend.body)
 expect(final.definition.replace(newPredicate,oldPredicate)).toBe(predecessorAppend.definition)
 expect(final.metadata).toEqual(capturedAppend.metadata)
 if(capturedAppendState(capturedAppend.body)==='post')expect(final.definition).toBe(capturedAppend.definition)
 const {rows:privileges}=await db.query<{name:string;allowed:boolean}>(`SELECT role AS name,has_function_privilege(role,
  fn,'EXECUTE') AS allowed FROM unnest(ARRAY['anon','authenticated','service_role'])role CROSS JOIN unnest(ARRAY[
  'gridex_received_sources.rejected_z04h_identity_scope_v1(text,jsonb)',
  'gridex_received_sources.rejected_z04h_raw_segment_v1(text,integer)'])fn`)
 expect(privileges.every(p=>p.allowed===false)).toBe(true)
 const {rows:publicPrivileges}=await db.query<{allowed:boolean}>(`SELECT EXISTS(SELECT FROM pg_proc p,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner)))acl WHERE p.oid IN(
  'gridex_received_sources.rejected_z04h_identity_scope_v1(text,jsonb)'::regprocedure,
  'gridex_received_sources.rejected_z04h_raw_segment_v1(text,integer)'::regprocedure) AND acl.grantee=0) AS allowed`)
 expect(publicPrivileges[0].allowed).toBe(false)
})
it('the unchanged forward rejects an unknown complete predecessor and rolls back its helper creation',async()=>{
 const guarded=new PGlite()
 try{
  await guarded.exec(`CREATE SCHEMA gridex_received_sources;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE gridex_received_sources.sources(source_message_id uuid);CREATE TABLE public.ediel_rule_packs(id uuid);
   CREATE TABLE public.ediel_message_profiles(id uuid);CREATE TABLE public.ediel_messages(id uuid);`)
  // Deliberately change only the exact full fixture predecessor. The production
  // migration must detect this before replacing the append function.
  await guarded.exec(predecessorAppend.definition.replace(oldPredicate,oldPredicate+'\n'))
  await expect(guarded.exec(migration)).rejects.toThrow('rejected_z04h_identity_append_owner_changed')
  await guarded.exec('ROLLBACK')
  expect(hash((await appendSnapshot(guarded)).body)).not.toBe(preimage)
  const {rows}=await guarded.query<{helper:string|null}>("SELECT to_regprocedure('gridex_received_sources.rejected_z04h_identity_scope_v1(text,jsonb)')::text AS helper")
  expect(rows[0].helper).toBeNull()
 }finally{await guarded.close()}
},30000)
