import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {readClosureSourceWire} from '@/lib/ediel/sources/closureSourceWire'

const literal=(value:unknown)=>"'"+String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")+"'"
function sql<T>(query:string):T{
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
  return JSON.parse(execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],
    {input:query,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()) as T
}
const project=(raw:string,object:unknown)=>sql(`SELECT coalesce(gridex_received_sources.closure_wire_projection_v1(${literal(raw)},${literal(object)}::jsonb),'null'::jsonb)`)
const matches=(raw:string,object:unknown,wire:unknown)=>sql(`SELECT to_jsonb(gridex_received_sources.closure_wire_matches_v1(${literal(raw)},${literal(object)}::jsonb,${literal(wire)}::jsonb))`)

it('SQL holds malformed raw Z08 before an outbound attempt despite stale row code',()=>{
  const company=randomUUID(),message=randomUUID(),actor=randomUUID()
  const malformed=closureFixture({reason:'Z25'}).wire.replace('BGM+Z05','BGM+Z08').slice(0,-1)
  expect(sql(`SELECT to_jsonb(gridex_received_sources.closure_wire_tokens_v1(${literal(malformed)}) IS NULL)`)).toBe(true)
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Synthetic outbound wire hold','active');
    BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload)
    VALUES(${literal(message)},${literal(company)},'test','outbound','edifact','PRODAT','Z01','queued',${literal(malformed)},'{}');
    COMMIT;
    SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(message)};`)
  // The absent actor is the next gate only when SQL classifies this wire as scoped.
  // Before the forward migration the same call returned scoped:false instead.
  const identity={companyId:company,environment:'test',messageId:message,actorUserId:actor,attemptId:randomUUID(),action:'prepare'}
  expect(()=>sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.gridex_outbound_dispatch_v1(${literal(identity)}::jsonb); COMMIT;`))
    .toThrow('outbound_dispatch_actor_unavailable')
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_outbound_dispatch.originals WHERE message_id=${literal(message)}`)).toBe(0)
})

it('SQL names the canonical LK exemption without relaxing the malformed-wire hold',()=>{
  const company=randomUUID(),message=randomUUID(),actor=randomUUID()
  const wire=closureFixture({reason:'Z23'}).wire.replace('BGM+Z05','BGM+Z08')
  expect(sql(`SELECT to_jsonb(gridex_received_sources.closure_wire_tokens_v1(${literal(wire)}) IS NOT NULL)`)).toBe(true)
  expect(sql(`BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,rule_profile_key)
    VALUES(${literal(message)},${literal(company)},'test','outbound','edifact','PRODAT','Z08','queued',${literal(wire)},'{}','PRODAT:Z08:LK:26.A:r3');
    COMMIT; SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(message)};`)).toBe(1)
  const identity={companyId:company,environment:'test',messageId:message,actorUserId:actor,attemptId:randomUUID(),action:'prepare'}
  expect(sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.gridex_outbound_dispatch_v1(${literal(identity)}::jsonb); COMMIT;`))
    .toEqual({scoped:false,unscopedReason:'canonical_lk_exemption'})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_outbound_dispatch.originals WHERE message_id=${literal(message)}`)).toBe(0)
})

it('SQL does not exempt a Z08 LK row whose physical BGM is not Z08',()=>{
  const company=randomUUID(),message=randomUUID(),actor=randomUUID()
  const wire=closureFixture({reason:'Z23'}).wire // valid Z05 wire with a stale Z08 LK row
  expect(sql(`SELECT to_jsonb(gridex_received_sources.closure_wire_tokens_v1(${literal(wire)}) IS NOT NULL)`)).toBe(true)
  expect(sql(`BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,rule_profile_key)
    VALUES(${literal(message)},${literal(company)},'test','outbound','edifact','PRODAT','Z08','queued',${literal(wire)},'{}','PRODAT:Z08:LK:26.A:r3');
    COMMIT; SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(message)};`)).toBe(1)
  const identity={companyId:company,environment:'test',messageId:message,actorUserId:actor,attemptId:randomUUID(),action:'prepare'}
  expect(()=>sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.gridex_outbound_dispatch_v1(${literal(identity)}::jsonb); COMMIT;`))
    .toThrow('outbound_dispatch_actor_unavailable')
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_outbound_dispatch.originals WHERE message_id=${literal(message)}`)).toBe(0)
})

it.each([{},{reason:'Z23'},{minute:'202610150000'},{alphabet:['*',';','!','~']},{alphabet:['^','|','!','%']},
  {document:"D?:+'",li:"CASE?:+'UNH+FAKE'DTM+93:202610151235:203"},
  {alphabet:['*',';','!','~'],document:'D!*;~',li:'CASE!*;~UNH;FAKE~DTM;93*202610151235*203'},
  {count:2}])('SQL derives closure fields independently from original %j',options=>{
  const {wire,scope}=closureFixture(options),derived=project(wire,scope)
  expect(derived).toEqual(readClosureSourceWire(wire,scope))
  expect(derived).toMatchObject({caseReference:options.li??'CLOSE-CASE',documentReference:options.document??'CLOSE-DOC',
    effectiveTo:{fieldNumber:'211',marketMinute:options.minute??'202610151234',utc:options.minute?'2026-10-14T23:00:00.000Z':'2026-10-15T11:34:00.000Z'},
    object:{registers:[{segmentIndex:7,lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1}]}})
  expect(matches(wire,scope,derived)).toBe(true)
})
it('SQL keeps multiple physical objects and CRLF indices distinct',()=>{
  const {wire,scope}=closureFixture({count:2})
  const second={...scope,objectId:'735123456789012341',registers:[{lineIndex:1,lineNumber:'2',registerIndex:null,registerPosition:1,segmentIndex:16}]}
  expect(project(wire.replaceAll("'","'\r\n"),second)).toEqual(readClosureSourceWire(wire,second))
  expect(project(wire,second)).toMatchObject({object:second})
  expect(project(wire,{...scope,registers:second.registers})).toBeNull()
  const borrowed=wire.replace('DTM+93:202610151234:203','DTM+92:202610151234:203')
  expect(project(borrowed,scope)).toBeNull()
  expect(project(wire.replace('LI:CLOSE-CASE','XX:CLOSE-CASE'),scope)).toBeNull()
})
it('SQL default UNA, empty function, escaped release and trailing empty components are literal',()=>{
  const {wire,scope}=closureFixture({li:'CASE??'})
  expect(project(wire.slice(9).replace('+CLOSE-DOC+9+AB','+CLOSE-DOC++AB'),scope)).toMatchObject({functionCode:null,caseReference:'CASE??'})
  expect(sql(`SELECT gridex_received_sources.closure_wire_tokens_v1('FTX+ABC?:DEF??G?+H?''I::++''')`)).toEqual([
    {index:0,tag:'FTX',elements:[['FTX'],["ABC:DEF?G+H'I",'',''],[''],['']]},
  ])
})
it.each([
  ['same-date minute with matching forged UTC',(value:Record<string,unknown>)=>({...value,effectiveTo:{fieldNumber:'211',marketMinute:'202610151235',utc:'2026-10-15T11:35:00.000Z'}})],
  ['LI',(value:Record<string,unknown>)=>({...value,caseReference:'OTHER'})],
  ['document',(value:Record<string,unknown>)=>({...value,documentReference:'OTHER'})],
  ['reason',(value:Record<string,unknown>)=>({...value,reason:'Z23',subtype:'LK'})],
  ['function',(value:Record<string,unknown>)=>({...value,functionCode:'5'})],
  ['legal party',(value:Record<string,unknown>)=>({...value,legalSender:'99999'})],
  ['transport',(value:Record<string,unknown>)=>({...value,transportReceiver:'99999'})],
  ['transport qualifier',(value:Record<string,unknown>)=>({...value,transportSenderQualifier:'ZZ'})],
  ['extra authority',(value:Record<string,unknown>)=>({...value,approved:true})],
] as const)('SQL binding rejects forged %s',(_name,change)=>{
  const {wire,scope}=closureFixture(),real=readClosureSourceWire(wire,scope)!
  expect(real).not.toBeNull();expect(matches(wire,scope,change(real))).toBe(false)
})
it.each([
  (s:string)=>s.replace('93:202610151234:203','93:202602291234:203'),
  (s:string)=>s.replace('93:202610151234:203','93:202610152400:203'),
  (s:string)=>s.replace('DTM+93:','DTM+92:'),
  (s:string)=>s.replace('UNZ+1+I','UNZ+2+I'),
  (s:string)=>s.replace('UNT+16+M','UNT+15+M'),
  (s:string)=>s.replace('ZZZ:1:805','ZZZ:2:805'),
  (s:string)=>s.replace('12345:14+','12345:14:SUB+'),
  (s:string)=>s.replace('UNA:+','UNA::'),
  (s:string)=>s.replace('LIN+1++','LIN+01++'),
  (s:string)=>s.replace("UNA:+.? '","UNA:+.?*'"),
  (s:string)=>s+'?',(s:string)=>s.slice(0,-1),(s:string)=>s+' '.repeat(262144),
  (s:string)=>s.replace('CLOSE-CASE','X'.repeat(4097)),
])('SQL malformed/unsupported original never becomes closure %#',change=>{
  const {wire,scope}=closureFixture();expect(project(change(wire),scope)).toBeNull()
})
it('SQL original byte/segment/object/component limits are enforced before authority',()=>{
  const {scope}=closureFixture()
  expect(project(closureFixture({count:17}).wire,scope)).toBeNull()
  expect(sql(`SELECT coalesce(gridex_received_sources.closure_wire_tokens_v1(repeat('FTX+A''',4097)),'null'::jsonb)`)).toBeNull()
  expect(sql(`SELECT jsonb_array_length(gridex_received_sources.closure_wire_tokens_v1(repeat('FTX+A''',4096)))`)).toBe(4096)
  expect(sql(`SELECT to_jsonb(gridex_received_sources.closure_wire_tokens_v1('FTX+'||repeat('A',4096)||'''')->0->'elements'->1->>0)`)).toBe('A'.repeat(4096))
})
it('private parser/projection/matcher grant no direct API-role execution',()=>{
  for(const role of ['anon','authenticated','service_role'])for(const signature of ['closure_wire_tokens_v1(text)','closure_wire_projection_v1(text,jsonb)','closure_wire_matches_v1(text,jsonb,jsonb)','z05_wire_structure_v1(text,jsonb)','correction_wire_exact_v1(text,jsonb)','correction_wire_observation_v1(text)']){
    expect(sql(`SELECT to_jsonb(has_function_privilege(${literal(role)},${literal('gridex_received_sources.'+signature)},'EXECUTE'))`)).toBe(false)
  }
})
it('SQL rejects forged object identity, agency and exact physical geometry',()=>{
  const {wire,scope}=closureFixture(),real=readClosureSourceWire(wire,scope)!
  for(const object of [{...scope,objectId:'735123456789012346'},{...scope,identityAgency:'89'},
    {...scope,messageReference:'FOREIGN'},{...scope,messageIndex:1},
    {...scope,registers:[{...scope.registers[0],segmentIndex:8}]}]){
    expect(matches(wire,object,{...real,object})).toBe(false)
  }
  expect(project(wire.replace('LIN+1++','LIN+01++'),{...scope,registers:[{...scope.registers[0],lineNumber:'01'}]})).toBeNull()
})
it('SQL cannot borrow an apparent released DTM when actual field211 is absent',()=>{
  const {wire,scope}=closureFixture({li:"CASE'UNH+X'DTM+93:202610151235:203"})
  expect(project(wire,scope)).toMatchObject({effectiveTo:{marketMinute:'202610151234'}})
  expect(project(wire.replace('DTM+93:202610151234:203','DTM+92:202610151234:203'),scope)).toBeNull()
})

// I2: one neutral structural decoder does not merge the authority policies.
it.each(['Z22','Z23','Z24'])('shared decoder keeps closure/correction reason %s gates separate',reason=>{
 const {wire,scope}=closureFixture({reason})
 const correction=sql(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(wire)})`)
 if(reason==='Z24'){
  expect(project(wire,scope)).toBeNull()
  expect(correction).toMatchObject({objectId:scope.objectId,oldStop:{kind:'unknown'},proposedStop:{kind:'not_asserted'}})
 }else{
  expect(project(wire,scope)).toEqual(readClosureSourceWire(wire,scope))
  expect(project(wire,scope)).not.toBeNull()
  expect(correction).toMatchObject({objectId:null,oldStop:{kind:'unknown'},proposedStop:{kind:'unknown'}})
 }
})
it('shared structure keeps mandatory closure LI separate from optional C LI',()=>{
 for(const reason of ['Z22','Z24']){
  const {wire,scope}=closureFixture({reason})
  const noLi=wire.replace("RFF+LI:CLOSE-CASE'",'').replace('UNT+16+M','UNT+15+M')
  expect(project(noLi,scope)).toBeNull()
  const correction=sql(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(noLi)})`)
  expect(correction).toMatchObject({objectId:reason==='Z24'?scope.objectId:null,caseReference:null,candidateTarget:null})
 }
})
it('shared structure preserves multi-object closure reads but never narrows multi-object C',()=>{
 for(const reason of ['Z22','Z24']){
  const {wire,scope}=closureFixture({reason,count:2})
  expect(project(wire,scope)).toEqual(readClosureSourceWire(wire,scope))
  if(reason==='Z22')expect(project(wire,scope)).not.toBeNull()
  expect(sql(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(wire)})`)).toMatchObject({objectId:null,oldStop:{kind:'unknown'}})
 }
})
it('shared structure preserves closure transport observation without treating delegated C as direct',()=>{
 for(const reason of ['Z22','Z24']){
  const {wire,scope}=closureFixture({reason})
  const delegated=wire.replace('+54321:14+','+99999:14+')
  expect(project(delegated,scope)).toEqual(readClosureSourceWire(delegated,scope))
  if(reason==='Z22')expect(project(delegated,scope)).not.toBeNull()
  expect(sql(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(delegated)})`)).toMatchObject({objectId:null,oldStop:{kind:'unknown'}})
 }
})
