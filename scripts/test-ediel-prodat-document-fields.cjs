// P26.A r3 section2.6 p42, unchanged original field register:202/203/204/313.
// Synthetic independent fixtures, not TGT originals or live-market acceptance.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule, SyntheticModule } = require('node:vm')
const { test } = require('node:test')
const root=path.resolve(__dirname,'..')
async function runtime(){
 const modules=new Map()
 const service=new SyntheticModule(['supabaseService'],function(){this.setExport('supabaseService',{from(){throw new Error('Unexpected DB call in document read test')},rpc(){throw new Error('Unexpected RPC')}})})
 const blocked=new Map([
 ['@/lib/customers/canonicalOnboarding',['canonicalIdempotencyKey','onboardCustomerGraph']],
 ['@/lib/tenant/context',['createTenantContext']],
    ['@/lib/supabase/tenantDb', ['tenantDb']],
 ].map(([name,keys])=>[name,new SyntheticModule(keys,function(){for(const key of keys)this.setExport(key,()=>{throw new Error('Unexpected mutation')})})]))
 const crypto=new SyntheticModule(['randomUUID','createHash'],function(){this.setExport('randomUUID',require('node:crypto').randomUUID);this.setExport('createHash',require('node:crypto').createHash)})
 const entry=new SourceTextModule(`
 export { PRODAT_26A_FIELD_MATRIX, canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
 export { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix';
 export { parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst';
 export { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments';
 export { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage';
 export { parseEdifact } from '@/lib/ediel/core/edifactParser';
 export { parseProdatMessage } from '@/lib/ediel/prodat/parser';
 export { parseProdat } from '@/lib/ediel/prodat/parseProdat';
 export { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser';
 export { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
 export { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat';
 export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
 export { renderAperakEdiel } from '@/lib/ediel/aperakEngine';
 export { inferEdielFamilyAndCodeFromRawPayload } from '@/lib/ediel/classify';
 export { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
 export { profileForMessage } from '@/lib/ediel/core/messageBuilder/segmentSchema';
 export { validateProdatPermissionMessage } from '@/lib/ediel/testing/prodatPermissionEngine';
 export { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases';
 `,{identifier:path.join(root,'lib/ediel/document-test.ts')})
 await entry.link((name,parent)=>{
  if(name==='@/lib/supabase/service') return service
  if(blocked.has(name))return blocked.get(name)
  if(name==='crypto'||name==='node:crypto')return crypto
  assert(name.startsWith('@/lib/ediel/')||name.startsWith('.'),`Unexpected dependency:${name}`)
  const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(parent.identifier),name)
  const file=['.ts','/index.ts'].map(ext=>base+ext).find(fs.existsSync)
  assert(file&&file.startsWith(path.join(root,'lib/ediel/')),'Only actual Ediel source is loaded')
  if(!modules.has(file))modules.set(file,new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'strip',sourceUrl:file}),{identifier:file}))
  return modules.get(file)
 })
 await entry.evaluate();return entry.namespace
}
const api=runtime()
const source=JSON.parse(fs.readFileSync(path.join(root,'docs/ediel/masterplan-v2/registers/prodat_fields.json'),'utf8'))
const alphabet={component:':',element:'+',decimal:'.',release:'?',reserved:' ',terminator:"'"}
function encode(s,a=alphabet){return [...s].map(c=>[a.component,a.element,a.release,a.terminator].includes(c)?a.release+c:c).join('')}
// Independent serializer: structural arrays are never built by the application renderer.
function wire(header,body=[['LIN','1','',['OBJECT','','','9']]],a=alphabet){
 const rows=[['UNH','UNH-DISTINCT',['PRODAT','D','97A','UN','E2SE6A']],...header,...body]
 rows.push(['UNT',String(rows.length+1),'UNH-DISTINCT'])
 return `UNA${a.component}${a.element}${a.decimal}${a.release}${a.reserved}${a.terminator}`+
 [['UNB',['UNOC','3'],['12345','14'],['54321','14'],['260917','1200'],'INTERCHANGE','','23-DDQ-PRODAT'],...rows,['UNZ','1','INTERCHANGE']]
 .map(row=>row.map(v=>Array.isArray(v)?v.map(x=>encode(x,a)).join(a.component):encode(v,a)).join(a.element)).join(a.terminator)+a.terminator
}
function evaluation(a,raw,field,code='Z03'){
 const tokens=a.tokenizeEdifact(raw)
 const rule=a.canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber===field)
 const input={family:'PRODAT',code,rawSegments:tokens.segments.map(s=>s.raw),una:tokens.una,mode:'parse',applicationReference:'23-DDQ-PRODAT'}
 return {rule,input,present:a.fieldRulePresent(rule,input),issues:a.validateFieldMatrixPayload(input,[rule])}
}
for(const field of ['202','203','204','313'])test(`descriptor ${field} retains original locator and all13 usages`,async()=>{
 const a=await api,r=a.PRODAT_26A_FIELD_MATRIX.find(r=>r.fieldNumber===field),s=source.find(r=>r.field===field)
 assert.equal(r.segmentPath,s.locator)
 assert.deepEqual([...r.requirements],Object.values(s.usage))
})
for(const [field,row] of [['202',['BGM','','DOCUMENT','9','AB']],['203',['BGM','Z03','','9','AB']],['204',['BGM','Z03','DOCUMENT','','AB']],['313',['BGM','Z03','DOCUMENT','9','']]])test(`empty ${field} is not supplied by adjacent BGM fields or UNH`,async()=>{
 const a=await api, e=evaluation(a,wire([row]),field)
 assert.equal(e.present,false)
 assert.equal(e.issues.some(x=>x.severity==='error'),field!=='204')
})
for(const field of ['202','203','204','313'])test(`BGM ${field} after LIN cannot supply a header field`,async()=>{
 const a=await api,e=evaluation(a,wire([],[['LIN','1','',['OBJECT','','','9']],['BGM','Z03','WRONG','9','AB']]),field)
 assert.equal(e.present,false)
})
for(const [field,row] of [
 ['202',['BGM',['','Z03'],'DOCUMENT','9','AB']],
 ['202',['BGM',['Z03','SVK','260'],'DOCUMENT','9','AB']],
 ['203',['BGM','Z03',['DOCUMENT','OTHER'],'9','AB']],
 ['204',['BGM','Z03','DOCUMENT',['9','5'],'AB']],
 ['313',['BGM','Z03','DOCUMENT','9',['AB','NA']]],
])test(`malformed composite does not pass ${field}`,async()=>{
 const a=await api,e=evaluation(a,wire([row]),field)
 assert(e.issues.some(x=>x.severity==='error'),'Malformed field must be rejected, not filled or skipped')
})
for(const code of ['Z01','Z03'])for(const ack of [null,'AB','NA','INVALID'])test(`acknowledgement ${String(ack)} on ${code} respects its own R/O class`,async()=>{
 const a=await api,e=evaluation(a,wire([['BGM',code,'DOCUMENT','9',ack??'']]),'313',code)
 assert.equal(e.issues.some(x=>x.severity==='error'),ack==='INVALID'||(!ack&&code!=='Z01'))
})
for(const f of [null,'9','5','34','9:DECOY'])test(`optional function ${String(f)} is checked when supplied`,async()=>{
 const a=await api,e=evaluation(a,wire([['BGM','Z03','DOCUMENT',f??'','AB']]),'204')
 assert.equal(e.issues.some(x=>x.severity==='error'),f==='34'||f==='9:DECOY')
})
const readers={
 ast:(a,raw)=>a.parseCanonicalEdifactAst(raw).messages[0].documentReference,
 facts:(a,raw)=>a.parseEdifactMessageFacts(raw).documentReference,
 canonical:(a,raw)=>a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:'edifact'}).documentReference,
 rulebook:(a,raw)=>a.parseRulebookMessage(raw).messageReference,
 prodat:(a,raw)=>a.parseProdatMessage(raw).messageReference,
 facade:(a,raw)=>a.parseProdat(raw).bgmReference,
}
for(const [name,read]of Object.entries(readers)){
 for(const value of ['000aBc','DOC:1','DOC+1',"DOC'1",'DOC?'])test(`${name} preserves flat document id ${JSON.stringify(value)}`,async()=>{
  const a=await api;assert.equal(read(a,wire([['BGM','Z03',value,'9','AB']])),value)
 })
 test(`${name} never replaces missing BGM1004 with UNH or later object/message`,async()=>{
  const a=await api;assert.equal(read(a,wire([['BGM','Z03','','9','AB']],[['LIN','1','',['OBJECT','','','9']],['BGM','Z03','OTHER','9','AB']])),null)
 })
 test(`${name} never treats unescaped subcomponents as flat document identity`,async()=>{
  const a=await api;assert.equal(read(a,wire([['BGM','Z03',['DOCUMENT','OTHER'],'9','AB']])),null)
 })
}
for(const [name,read]of Object.entries(readers))test(`${name} retains document identity with nondefault UNA`,async()=>{
 const a=await api,alt={component:'*',element:';',decimal:'.',release:'!',reserved:' ',terminator:'~'}
 assert.equal(read(a,wire([['BGM','Z03','DOC;*!~','9','AB']],undefined,alt)),'DOC;*!~')
})
for(const [name,read]of Object.entries({ast:(a,r)=>a.parseCanonicalEdifactAst(r).messages[0].messageCode,edifact:(a,r)=>a.parseEdifact(r).businessCode,canonical:(a,r)=>a.parseCanonicalEdielPayload({rawPayload:r,standardHint:'edifact'}).messageCode,rulebook:(a,r)=>a.parseRulebookMessage(r).code}))test(`${name} does not invent Z03 from escaped code punctuation`,async()=>{
 const a=await api;assert.equal(read(a,wire([['BGM','Z03:DECOY','DOCUMENT','9','AB']])),'Z03:DECOY')
})
test('parser does not replace missing wire code with persisted metadata',async()=>{
 const a=await api,row={message_family:'PRODAT',message_code:'Z03',raw_payload:wire([['BGM','','','9','AB']]),parsed_payload:{},external_reference:'STALE',environment:'test'}
 const result=a.parseProdatMessage(row)
 assert.equal(result.messageCode,''); assert.equal(result.messageReference,null)
})
for(const [code,stored,production]of [['','Z04',false],['Z04','Z03',true]])test(`staging uses wire BGM ${code||'missing'} rather than stored ${stored} for production classification`,async()=>{
 const a=await api,row={message_family:'PRODAT',message_code:stored,raw_payload:wire([['BGM',code,'DOCUMENT','9','AB']],[['LIN','1','',['OBJECT','','','9']],['CCI','','Z14'],['CAV',['','','','L641Q']]]),parsed_payload:{},environment:'test'}
 const result=a.parseInboundProdatBusinessData(row)
 assert.equal(result.production.isMicroProduction,production)
 assert.equal(result.site.siteType,production?'production':'consumption')
})
test('canonical does not mistake implicit UNA semicolon syntax for a CSV list',async()=>{
 const a=await api,alt={component:'*',element:';',decimal:'.',release:'!',reserved:' ',terminator:'~'}
 const result=a.parseCanonicalEdielPayload({rawPayload:wire([['BGM','Z03','DOC;*!~','9','AB']],undefined,alt)})
 assert.equal(result.messageStandard,'edifact');assert.equal(result.documentReference,'DOC;*!~')
})
test('canonical retains genuine AI-list detection',async()=>{
 const a=await api,result=a.parseCanonicalEdielPayload({rawPayload:'AI;Ver20140401;DATA'})
 assert.equal(result.messageStandard,'ai_list')
})
const context=(id)=>({code:'Z01',bgmReference:id,transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'OBJECT',customerName:'Example',startDate:'2026-09-17',reasonForTransaction:'Z22'})
for(const id of ['000aBc','DOC:1','DOC+1',"DOC'1",'DOC?','D'.repeat(35)])test(`profile renderer preserves exact BGM reference ${JSON.stringify(id)}`,async()=>{
 const a=await api,result=a.buildProfiledProdatSegments({context:context(id),generatedAt:new Date('2026-09-17T12:00:00Z'),mode:'test'})
 assert.equal(result.segments[0],`BGM+Z01+${encode(id)}+9+AB`)
 assert.equal(result.diagnostics.bgmReference,id)
})
for(const id of ['', 'D'.repeat(36)])test(`profile renderer rejects invalid BGM reference length ${id.length} instead of truncating`,async()=>{
 const a=await api;assert.throws(()=>a.buildProfiledProdatSegments({context:context(id),generatedAt:new Date('2026-09-17T12:00:00Z'),mode:'test'}))
})
// Independently declared equal postal selections permit the existing optional
// omission. These fixed facts do not come from BGM or rendered NAD values.
const invoiceeAddress={lines:['','',''],postalCode:'',city:'',country:'SE',representation:{convention:'fixed positional synthetic source',reference:'document fixture selection',mode:1}}
const invoiceeIdentity={id:'CUSTOMER',qualifier:'',agency:'89'}
const invoiceeFacts=[{meteringPointId:'OBJECT',identityAgency:'9',endUser:{identity:invoiceeIdentity,address:invoiceeAddress},invoicee:{identity:invoiceeIdentity,nameLines:['Invoicee'],address:invoiceeAddress,availability:'unavailable'},event:{state:'none',reference:'synthetic no change'},source:{kind:'caller_selection',companyId:'test',reference:'synthetic-document-ack-fixture'}}]
for(const requestAck of [undefined,false,true])test(`compatibility builder emits source-valid BGM and explicit requested ACK (${String(requestAck)})`,async()=>{
 // Fixed synthetic source: this CUSTOMER has no selected address. This fact is
 // independent of the BGM/ACK output exercised below.
 const a=await api,result=a.buildProdatMessage({dependentConditionFacts:{invoiceeObjects:invoiceeFacts,endUserAddressObjects:[{meteringPointId:'OBJECT',identityAgency:'9',endUser:{id:'CUSTOMER',qualifier:'',agency:'89'},availability:'unavailable',addressLines:[],source:{kind:'caller_selection',companyId:'test',reference:'synthetic-document-ack-fixture'}}]},companyId:'test',role:'supplier',businessCode:'Z03',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'OBJECT'},customer:{id:'CUSTOMER',idAgency:'89',name:'Customer'},dates:{createdAt:'2026-09-17T12:00:00Z',startDate:'2026-10-01'},codedAttributes:{Z13:'Z22'},references:{documentReference:'DOC+1',LI:'CASE'},requestAck,environment:'test'})
 const bgm=a.tokenizeEdifact(result.rawEdifact).segments.find(s=>s.tag==='BGM')
 assert.equal(bgm.raw,`BGM+Z03+DOC?+1+9+${requestAck===false?'NA':'AB'}`)
})

for(const [label,id] of [['literal colon','DOC:1'],['literal plus','DOC+1'],['literal terminator',"DOC'1"],['literal release','DOC?'],['case and zeroes','000aBc'],['max length','D'.repeat(35)]])test(`real APERAK renderer references actual BGM, not stale ids (${label})`,async()=>{
 const a=await api,raw=wire([['BGM','Z03',id,'9','AB']])
 const result=a.renderAperakEdiel({source:{id:'LOCAL-UUID',messageFamily:'PRODAT',messageCode:'Z03',rawPayload:raw,externalReference:'STALE'},refs:{documentReference:'WRONG',messageReference:'UNH-DISTINCT',interchangeReference:'INTERCHANGE'},externalReference:'ACK',transactionReference:'CASE',outcome:'positive'})
 assert.equal(result.diagnostics.previousMessageReference,id)
 assert(result.segments.includes(`RFF+ACW:${encode(id)}`))
})
for(const id of ['', ['DOC','OTHER'], 'D'.repeat(36)])test(`real APERAK renderer blocks absent/malformed/oversized source BGM ${JSON.stringify(id)}`,async()=>{
 const a=await api,raw=wire([['BGM','Z03',id,'9','AB']])
 assert.throws(()=>a.renderAperakEdiel({source:{id:'LOCAL-UUID',messageFamily:'PRODAT',rawPayload:raw,externalReference:'STALE'},refs:{documentReference:'WRONG',messageReference:'UNH-DISTINCT'},externalReference:'ACK',transactionReference:'CASE',outcome:'negative'}),/aperak_prodat_document_reference_required/)
})
test('APERAK source selection preserves structured-only legacy input',async()=>{
 const a=await api,result=a.renderAperakEdiel({source:{id:'legacy',messageFamily:'PRODAT'},refs:{documentReference:'LEGACY'},externalReference:'ACK',transactionReference:'CASE',outcome:'positive'})
 assert(result.segments.includes('RFF+ACW:LEGACY'))
})
for(const code of ['','Z03:DECOY','Z04'])test(`profile selection uses actual BGM ${JSON.stringify(code)} instead of stale Z03`,async()=>{
 const a=await api,tokens=a.tokenizeEdifact(wire([['BGM',code,'DOCUMENT','9','AB']]))
 const result=a.profileForMessage({family:'PRODAT',code:'Z03',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',rawSegments:tokens.segments.map(s=>s.raw)})
 assert.equal(result?.key??null,code==='Z04'?'PRODAT_26A':null)
})
test('permission validation cannot infer Z14 from a stale stored BGM code',async()=>{
 const a=await api,message={message_family:'PRODAT',message_code:'Z14',direction:'inbound',raw_payload:wire([['BGM','','DOCUMENT','9','AB']]),parsed_payload:{}}
 assert.equal(a.validateProdatPermissionMessage({message}).handled,false)
})
test('classification does not read an EDIEL token inside UNA BGM as AI-list metadata',async()=>{
 const a=await api,alt={component:'*',element:';',decimal:'.',release:'!',reserved:' ',terminator:'~'}
 const result=a.inferEdielFamilyAndCodeFromRawPayload(wire([['BGM','Z03','EDIEL;DOC','9','AB']],undefined,alt))
 assert.equal(result.messageFamily,'PRODAT');assert.equal(result.messageCode,'Z03')
})
for(const code of ['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'])test(`all four source BGM fields retain positive usage for ${code}`,async()=>{
 const a=await api,raw=wire([['BGM',code,'DOCUMENT','9','AB']])
 for(const field of ['202','203','204','313']){
  const e=evaluation(a,raw,field,code);assert.equal(e.present,true,field);assert.deepEqual(e.issues,[],field)
 }
})

for(const id of ['D'.repeat(35),'D'.repeat(36),'D'.repeat(32)+'?X?X'])test(`canonical field validation counts document id length ${id.length} once`,async()=>{
 const a=await api,e=evaluation(a,wire([['BGM','Z03',id,'9','AB']]),'203')
 assert.equal(e.issues.some(x=>x.severity==='error'),id.length>35)
})

// Independent P-APERAK wires carry the source BGM identity in ACW. This tests
// the real downstream canonical/preflight readers, not only the ACK renderer.
function acknowledgementWire(id, a=alphabet) {
 const rows=[['UNH','ACK',['APERAK','D','96A','UN','E2SE6A']], ['BGM','','','34'],
  ['DTM',['137','202609171200','203']], ['RFF',['ACW',id]],
  ['NAD','FR',['54321','160','SVK']], ['NAD','DO',['12345','160','SVK']],
  ['ERC',['100','SVK','260']], ['FTX','AAO','','','OK'], ['UNT','9','ACK']]
 return `UNA${a.component}${a.element}${a.decimal}${a.release}${a.reserved}${a.terminator}`+
 [['UNB',['UNOC','3'],['54321','14'],['12345','14'],['260917','1200'],'INTERCHANGE','','23-DDQ-PRODAT'],...rows,['UNZ','1','INTERCHANGE']]
 .map(row=>row.map(v=>Array.isArray(v)?v.map(x=>encode(x,a)).join(a.component):encode(v,a)).join(a.element)).join(a.terminator)+a.terminator
}
for (const id of ['DOC:1','DOC+1',"DOC'1",'DOC?','000aBc','D'.repeat(35)]) {
 for (const a of [alphabet]) {
  test(`canonical P-APERAK ACW preserves ${JSON.stringify(id)} with separator ${a.element}`,async()=>{
   const r=(await api).parseCanonicalEdielPayload({rawPayload:acknowledgementWire(id,a),standardHint:'edifact'})
   assert.equal(r.family,'APERAK')
   assert.equal(r.references.find(ref=>ref.qualifier==='ACW')?.value,id)
  })
 }
 test(`actual P-APERAK preflight counts escaped document ${JSON.stringify(id)} as one segment`,async()=>{
  const r=(await api).preflightEdielPayload({rawPayload:acknowledgementWire(id),messageStandard:'edifact',mode:'send'})
  assert.equal(r.family,'APERAK')
  assert.equal(r.segmentCount,11)
  assert.equal(r.declaredUntCount,9)
  assert.equal(r.issues.some(issue=>issue.code==='UNT_COUNT_MISMATCH'),false)
 })
}

for (const raw of ["UNB+UNOC:3+S+R+260917:1200+I'", "LIN+1'", "RFF+ACW:OTHER'", "UNRELATED"]) {
 test(`APERAK cannot treat nonempty source without a BGM as structured-only legacy: ${raw}`,async()=>{
  const a=await api
  assert.throws(()=>a.renderAperakEdiel({source:{id:'LOCAL-UUID',messageFamily:'PRODAT',rawPayload:raw,externalReference:'STALE'},refs:{documentReference:'STALE'},externalReference:'ACK',transactionReference:'CASE',outcome:'positive'}),/aperak_prodat_document_reference_required/)
 })
}
