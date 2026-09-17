// P26.A r3 §2.6 pp45–46,79–83: independently specified NAD fields.
// These are synthetic behavioral cases, not original TGT files/certificates.
// Run: node --experimental-vm-modules --test scripts/test-ediel-prodat-party-fields.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule, SyntheticModule } = require('node:vm')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
async function runtime() {
  const modules = new Map()
  const crypto = new SyntheticModule(['randomUUID'], function(){this.setExport('randomUUID', require('node:crypto').randomUUID)})
  let fixture = null
  const saved = []
  const calls = []
  const service = new SyntheticModule(['supabaseService'], function () {
    this.setExport('supabaseService', { from(table) {
      if (!fixture) throw new Error('Unexpected database access in source-only test')
      calls.push(table)
      if(table==='ediel_business_references') return { async upsert(rows) { saved.push(...rows); return {error:null} } }
      assert(['ediel_messages','ediel_message_events'].includes(table), 'Only declared test boundary is reachable')
      const query={insert(){return query},select(){return query},eq(...args){calls.push(['eq',...args]);return query},not(){return query},order(){return query},limit(){return query},then(resolve,reject){return Promise.resolve({data:fixture,error:null}).then(resolve,reject)},
        async single(){return {data:table==='ediel_messages'?fixture:{id:'event'},error:null}},
        async maybeSingle(){return {data:fixture,error:null}}}
      return query
    } })
  })
  const entry = new SourceTextModule(`
    export { canonicalProdat26AFieldRules, PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
    export { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix';
    export { parseProdatMessage } from '@/lib/ediel/prodat/parser';
    export { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments';
    export { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage';
    export { canonicalMessageFacts } from '@/lib/ediel/core/canonicalEdifactAst';
    export { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser';
    export { compareInboundPayloadToTgtTestData, inferTgtTestCaseCodeForInboundTestData } from '@/lib/ediel/testing/tgtAutoMatcher';
    export { validateProdatPermissionMessage, resolveProdatPermissionAperakValidationIssues } from '@/lib/ediel/testing/prodatPermissionEngine';
    export { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
    export { prodatCharacteristicValue, prodatCharacteristicValues, misplacedProdatEnergyProducts } from '@/lib/ediel/prodat/prodatCharacteristicFields';
    export { prodatPartySegment, prodatCustomerNadSegment, prodatInstallationNadSegment } from '@/lib/ediel/prodat/render/segments';
    export { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
    export { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases';
    export { createEdielMessage } from '@/lib/ediel/db';
    export { deriveProdatAperakValidationIssues } from '@/lib/ediel/testing/aperakErrorRuleRegistry';
    export { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
  `, { identifier: path.join(root, 'lib/ediel/party-test.ts') })
  const unreachable = new Map([
    ['@/lib/customers/canonicalOnboarding', ['canonicalIdempotencyKey','onboardCustomerGraph']],
    ['@/lib/tenant/context', ['createTenantContext']],
  ].map(([specifier,names])=>[specifier,new SyntheticModule(names,function(){
    for(const name of names) this.setExport(name,()=>{throw new Error(`Unexpected mutation/context call: ${specifier}/${name}`)})
  })]))
  await entry.link((specifier, parent) => {
    if (specifier === 'crypto' || specifier === 'node:crypto') return crypto
    if (specifier === '@/lib/supabase/service') return service
    if (unreachable.has(specifier)) return unreachable.get(specifier)
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency ${specifier}`)
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), 'Load only real Ediel sources')
    if (!modules.has(file)) modules.set(file, new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip', sourceUrl: file }), { identifier: file }))
    return modules.get(file)
  })
  await entry.evaluate()
  return {...entry.namespace, boundary: {set(row){fixture=row;saved.length=0;calls.length=0}, clear(){fixture=null}, saved, calls}}
}

const api = runtime()
const source = JSON.parse(fs.readFileSync(path.join(root, 'docs/ediel/masterplan-v2/registers/prodat_fields.json'), 'utf8'))
// Numeric field, party role, outer element, capacity, component max length.
// Expectations transcribed independently from P pp45–46,79–83, not the implementation.
const fields = [
  ['207','FR',2,1,35],['208','DO',2,1,35],['227','UD',2,1,35],['228','UD',4,2,35],
  ['229','UD',5,3,35],['231','UD',8,1,9],['232','UD',6,1,35],['316','UD',9,1,3],
  ['233','IT',2,1,25],['234','IT',5,3,35],['235','IT',8,1,9],['236','IT',6,1,35],['237','IT',9,1,3],
  ['250','IV',2,1,35],['251','IV',4,2,35],['252','IV',5,3,35],['253','IV',8,1,9],['317','IV',6,1,35],['318','IV',9,1,3],['262','Z02',2,1,35],
]
const alphabets = [':+.? ', '*;.!~', '^|.! %'].map((text,i)=> i===0? [':','+','?',"'"] : i===1?['*',';','!','~']:['^','|','!','%'])
const standard = alphabets[0]
function encode(value, syntax=standard) { const [c,e,r,t]=syntax; return String(value).split('').map(ch=>[c,e,r,t].includes(ch)?r+ch:ch).join('') }
function segment(parts,syntax=standard) { return parts.map(p=>Array.isArray(p)?p.map(v=>encode(v,syntax)).join(syntax[0]):encode(p,syntax)).join(syntax[1]) }
function nad(role, overrides={},syntax=standard) {
  const header=['FR','DO'].includes(role),brp=role==='Z02',it=role==='IT'
  const parts=['NAD',role, header||brp?['000123','160','SVK']:it?['735999999999999999','','9']:['000abc','SE1','260'],'',header||brp||it?'':['First','Second'],header||brp?'':['Street','Box','Floor'],header||brp?'':'City','',header||brp?'':'001 23',brp?'':'SE']
  for(const [k,v] of Object.entries(overrides)) parts[Number(k)]=v
  return segment(parts,syntax)
}
function wire(body, headers=[], syntax=standard,code='Z04') {
  const lin=segment(['LIN','1','',['735999999999999999','','','9']],syntax)
  const mid=[segment(['UNH','TECH-MESSAGE',['PRODAT','D','97A','UN','E2SE6A']],syntax),segment(['BGM',code,'DOC','9','AB'],syntax),...headers,lin,...body]
  return `UNA${syntax[0]}${syntax[1]}.${syntax[2]} ${syntax[3]}`+[
    segment(['UNB',['UNOC','3'],['TECH-SENDER','14'],['TECH-RECEIVER','14'],['260917','1200'],'INT','','23-DDQ-PRODAT'],syntax),
    ...mid,segment(['UNT',String(mid.length+1),'TECH-MESSAGE'],syntax),segment(['UNZ','1','INT'],syntax)].join(syntax[3])+syntax[3]
}
const rule=(a,id,requirement='required')=>({...a.canonicalProdat26AFieldRules('Z04').find(r=>r.fieldNumber===id),requirement})
const input=(a,raw,code='Z04')=>{const x=a.tokenizeEdifact(raw);return {family:'PRODAT',code,rawSegments:x.segments.map(s=>s.raw),una:x.una}}
const at=(role,n)=> ['FR','DO'].includes(role)?wire([], [n]):wire([n])
for(const [id,role,index,count,max] of fields) {
  test(`NAD${id}: source role, component and all13 requirements`,async()=>{
    const a=await api,r=a.PRODAT_26A_FIELD_MATRIX.find(x=>x.fieldNumber===id),s=source.find(x=>x.field===id)
    assert.match(s.locator,new RegExp(`3035=${role}`))
    assert.equal(r.partyQualifier,role);assert.equal(r.partyElement,index)
    for(const [code,usage] of Object.entries(s.usage))assert.equal(a.canonicalProdat26AFieldRules(code).find(x=>x.fieldNumber===id).requirement,{R:'required',D:'dependent',O:'optional','-':'forbidden'}[usage])
  })
  test(`NAD${id}: actual value, never role or neighbouring metadata`,async()=>{
    const a=await api,r=rule(a,id)
    assert.equal(a.fieldRulePresent(r,input(a,at(role,nad(role)))),true)
    const empty=index===2?['',role==='IT'?'':'SE1',role==='IT'?'9':'260']:(id==='229'?['','','','DECOY']:['','DECOY'])
    assert.equal(a.fieldRulePresent(r,input(a,at(role,nad(role,{[index]:empty})))),false)
    assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{[index]:empty}))),[r]).some(x=>x.blocking))
  })
  test(`NAD${id}: no header, wrong role or later object substitution`,async()=>{
    const a=await api,r=rule(a,id),good=nad(role),wrong=nad(role==='UD'?'IV':'UD')
    assert.equal(a.fieldRulePresent(r,input(a,at(role,wrong))),false)
    const misplaced=['FR','DO'].includes(role)?wire([good]):wire([], [good])
    assert.equal(a.fieldRulePresent(r,input(a,misplaced)),false)
    const later=wire([segment(['LIN','2','',['OTHER','','','9']]),good])
    assert.equal(a.fieldRulePresent(r,input(a,later)),false)
    const two=wire([])+wire(['FR','DO'].includes(role)?[]:[good],['FR','DO'].includes(role)?[good]:[]).slice(9)
    assert.equal(a.fieldRulePresent(r,input(a,two)),false)
  })
  test(`NAD${id}: first occurrence owns empty field and cannot be repaired by a duplicate`,async()=>{
    const a=await api,empty=nad(role,{[index]:''}),good=nad(role),rows=['FR','DO'].includes(role)?wire([],[empty,good]):wire([empty,good])
    assert.equal(a.fieldRulePresent(rule(a,id),input(a,rows)),false)
  })
  test(`NAD${id}: scalar/composite capacity and per-component length`,async()=>{
    const a=await api,r=rule(a,id,'optional'),base=nad(role),before=input(a,at(role,base))
    assert.deepEqual(a.validateFieldMatrixPayload(before,[r]),[])
    const badParts=index===2?['X'.repeat(max+1),role==='IT'?'':(['FR','DO','Z02'].includes(role)?'160':'SE1'),role==='IT'?'9':(['FR','DO','Z02'].includes(role)?'SVK':'260')]:Array(count).fill('X'.repeat(max+1))
    assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{[index]:badParts}))),[r]).some(x=>x.blocking),'supplied optional length must be checked')
    if(index!==2)assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{[index]:Array(count+1).fill('X')}))),[r]).some(x=>x.blocking),'extra nonempty component must be checked')
  })
  test(`NAD${id}: populated forbidden component cannot evade its own exclusion`,async()=>{
    const a=await api,r=rule(a,id,'forbidden')
    assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role))),[r]).some(x=>x.blocking))
    const empty=index===2?['','SE1','260']:Array(count+1).fill('')
    if(index!==2) assert.deepEqual(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{[index]:empty}))),[r]),[])
    else assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{[index]:empty}))),[r]).some(x=>x.blocking))
  })
}
for(const [role,prop] of [['UD','endUser'],['IT','installation'],['IV','invoicee']]) {
  for(const syntax of alphabets) for(const value of ['000aBc','A:B',"A'B",'A+B','A?','A  B']) {
    test(`${prop}: literal identity and components survive ${syntax.join('')} ${JSON.stringify(value)}`,async()=>{
      const a=await api,parts=role==='IT'?[value,'','89']:[value,'','89'],raw=wire([nad(role,{2:parts,4:role==='IT'?'':[value,'Other'],5:[value,'Other','Last'],8:'001 23'},syntax)],[],syntax)
      const p=a.parseProdatMessage(raw).lineItems[0]
      assert.equal(p[`${prop}Id`],value)
      if(role!=='IT')assert.equal(p[`${prop}Name`],`${value}\nOther`)
      assert.equal(p[`${prop}Address`],`${value}\nOther\nLast`)
      assert.equal(p[`${prop}Postcode`],'001 23')
      if(role==='IV')assert.equal(p.customerId,null)
    })
  }
}
test('header parties207/208 do not overwrite technical UNB route identifiers',async()=>{
 const a=await api,raw=wire([nad('UD')],[nad('FR',{2:['LEGAL-FR','160','SVK']}),nad('DO',{2:['LEGAL-DO','160','SVK']})])
 const p=a.parseProdatMessage(raw),c=a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:'edifact'})
 assert.equal(p.legalSenderId,'LEGAL-FR');assert.equal(p.legalReceiverId,'LEGAL-DO')
 assert.equal(c.sender,'TECH-SENDER');assert.equal(c.receiver,'TECH-RECEIVER')
})
for(const role of ['UD','IV','FR','DO','Z02','IT'])test(`${role}: wrong code-list metadata is rejected even for an optional field`,async()=>{
 const a=await api,id=fields.find(x=>x[1]===role&&x[2]===2)[0],r=rule(a,id,'optional')
 for(const parts of [['ACTUAL','SE1','ZZZ'],['ACTUAL','160','260'],['ACTUAL','SE1','260','EXTRA']])assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{2:parts}))),[r]).some(x=>x.blocking))
})
for(const role of ['FR','DO'])test(`${role}: country is part of207/208 and cannot come from UNB`,async()=>{
 const a=await api,r=rule(a,role==='FR'?'207':'208')
 for(const country of ['', 'SWE', ['SE','DK']])assert(a.validateFieldMatrixPayload(input(a,at(role,nad(role,{9:country}))),[r]).some(x=>x.blocking))
})
for(const value of ['A:B','A+B',"A'B",'A?','000aBc']) test(`party renderer preserves ${JSON.stringify(value)} and source code list260`,async()=>{
 const a=await api,n=a.prodatCustomerNadSegment({customerId:value,customerIdCodeListQualifier:'SE1',customerName:value,address:value,city:value,postalCode:'001 23',country:'SE'})
 assert(n.includes(`+${encode(value)}:SE1:260+`));const p=a.parseProdatMessage(wire([n])).lineItems[0]
 assert.equal(p.endUserId,value);assert.equal(p.endUserName,value);assert.equal(p.endUserAddress,value);assert.equal(p.endUserPostcode,'001 23')
})
for(const property of ['customerName','address','city','postalCode'])test(`party renderer rejects ${property} overflow rather than truncating`,async()=>{
 const a=await api;assert.throws(()=>a.prodatCustomerNadSegment({customerId:'0001',customerIdCodeListQualifier:'SE1',customerName:'Name',country:'SE',[property]:'X'.repeat(property==='postalCode'?10:36)}))
})
test('party name/address arrays preserve empty positions and each component independently',async()=>{
 const a=await api,n=a.prodatCustomerNadSegment({customerId:'001',customerIdCodeListQualifier:'SE1',customerName:'First',nameLines:['First','Second'],addressLines:['Street','','Box'],country:'SE'})
 const p=a.parseProdatMessage(wire([n])).lineItems[0];assert.equal(p.endUserName,'First\nSecond');assert.equal(p.endUserAddress,'Street\n\nBox')
})

function comparison(a, raw, id, expected) {
  const testData={groups:[{columns:[{name:'A',index:0}],fields:[{fieldCode:id,values:{A:expected}}]}]}
  const original=JSON.stringify(testData)
  const result=a.compareInboundPayloadToTgtTestData({message:{message_family:'PRODAT',message_code:'Z04',raw_payload:raw},testData})
  assert.equal(JSON.stringify(testData),original,'Expected TGT source must remain immutable')
  return result.filter(issue=>issue.fieldCode===id)
}
for(const [id,role,index,count] of fields)test(`TGT NAD${id}: exact source field rather than another party or adjacent component`,async()=>{
  const a=await api,expected=index===2?(role==='IT'?'735999999999999999':'000abc'):index===9?'SE':index===8?'001 23':Array.from({length:count},(_,i)=>`Value ${i+1}`).join('\n')
  const value=index===2?[expected,role==='IT'?'':(['FR','DO','Z02'].includes(role)?'160':'SE1'),role==='IT'?'9':(['FR','DO','Z02'].includes(role)?'SVK':'260')]:expected.split('\n')
  assert.deepEqual(comparison(a,at(role,nad(role,{[index]:value})),id,expected),[])
  const wrong=index===2?['DIFFERENT',value[1],value[2]]:index===9?'DK':index===8?'002 34':'Different'
  assert(comparison(a,at(role,nad(role,{[index]:wrong})),id,expected).length)
  assert(comparison(a,at(role,nad(role==='UD'?'IV':role==='FR'?'DO':'UD',{[index]:value})),id,expected).length)
})
for(const [id,role,index,number] of [['228-2','UD',4,2],['229-3','UD',5,3],['251-2','IV',4,2],['252-3','IV',5,3],['234-2','IT',5,2]])test(`TGT component ${id} keeps its own position, not joined text`,async()=>{
 const a=await api,values=Array.from({length:number},(_,i)=>i===number-1?'Exact (1):  B?':`Other${i}`)
 assert.deepEqual(comparison(a,at(role,nad(role,{[index]:values})),id,values[number-1]),[])
 assert(comparison(a,at(role,nad(role,{[index]:values.slice(0,number-1)})),id,values[number-1]).length)
})
for(const [expected,actual] of [['0012','12'],['A:B','AB'],['A(1)','A'],['A  B','A B'],['aBc','ABC']])test(`TGT NAD name does not normalize away ${JSON.stringify(expected)}`,async()=>{
 const a=await api;assert(comparison(a,wire([nad('UD',{4:actual})]),'228',expected).length)
})
function sourceMessage(raw,extra={}) {return {message_family:'PRODAT',message_code:'Z04',raw_payload:raw,company_id:'tenant-A',
 parsed_payload:{customerId:'STALE',customerName:'Stale customer',customerAddress:'Stale UD',customerPostalCode:'99999',customerCity:'Stale UD City',customerCountry:'ZZ',siteAddress:'Stale IT',sitePostalCode:'88888',siteCity:'Stale IT City',siteCountry:'ZZ',balanceResponsibleId:'STALE-BRP'},...extra}}
for(const syntax of alphabets)test(`staging ${syntax.join('')} keeps UD, IT, IV and BRP evidence separate`,async()=>{
 const a=await api,raw=wire([
 nad('UD',{2:['556677-8899','SE1','260'],4:['Ultimate  A','Second'],5:['User street','','Box'],6:'User town',8:'001 23',9:'DK'},syntax),
 nad('IT',{5:['Site street','Floor','Door'],6:'Site town',8:'005 67',9:'SE'},syntax),
 nad('IV',{2:['OTHER','','89'],4:'Invoice name',5:'Invoice street',6:'Invoice town',8:'006 78',9:'NO'},syntax),
 nad('Z02',{2:['000Brp?:A','160','SVK']},syntax)],[],syntax)
 const row=sourceMessage(raw),before=JSON.stringify(row),p=a.parseInboundProdatBusinessData(row)
 assert.equal(p.customer.customerId,'556677-8899');assert.equal(p.customer.orgNumber,'5566778899')
 assert.equal(p.customer.fullName,'Ultimate  A\nSecond');assert.equal(p.customer.address,'User street\n\nBox');assert.equal(p.customer.country,'DK')
 assert.equal(p.site.street,'Site street\nFloor\nDoor');assert.equal(p.site.city,'Site town');assert.equal(p.site.postalCode,'005 67');assert.equal(p.site.country,'SE')
 assert.equal(p.contract.balanceResponsibleId,'000Brp?:A');assert.equal(JSON.stringify(row),before)
})
for(const variant of ['absent','empty','header','later','undecodable'])test(`staging ${variant} wire party never becomes cached/other-party data`,async()=>{
 const a=await api
 let body=[nad('IV')],header=[]
 if(variant==='empty')body=[nad('UD',{2:'',4:'',5:'',6:'',8:'',9:''}),nad('IT',{2:'',5:'',6:'',8:'',9:''}),nad('Z02',{2:''}),...body]
 if(variant==='header')header=[nad('UD'),nad('IT'),nad('Z02')]
 if(variant==='later')body.push('LIN+2++OTHER:::9',nad('UD'),nad('IT'),nad('Z02'))
 if(variant==='undecodable') {assert.throws(()=>a.parseInboundProdatBusinessData(sourceMessage(wire(body,header)+'?')),/edifact_dangling_release_character/);return}
 const p=a.parseInboundProdatBusinessData(sourceMessage(wire(body,header)))
 for(const key of ['customerId','fullName','address','postalCode','city','country','orgNumber','personalNumber'])assert.equal(p.customer[key],null,`${variant}/${key}`)
 for(const key of ['street','city','postalCode','country'])assert.equal(p.site[key],null,`${variant}/${key}`)
 assert.equal(p.contract.balanceResponsibleId,null)
})
test('staging preserves genuine structured-only legacy party values without inferring their ID type',async()=>{
 const a=await api,p=a.parseInboundProdatBusinessData(sourceMessage(null))
 assert.equal(p.customer.fullName,'Stale customer');assert.equal(p.site.street,'Stale IT');assert.equal(p.customer.orgNumber,null);assert.equal(p.customer.customerType,null)
})
for(const [qual,agency] of [['SE1','ZZZ'],['','89'],['1','260']])test(`staging ${qual}/${agency} cannot manufacture a Swedish organisation number`,async()=>{
 const a=await api,p=a.parseInboundProdatBusinessData(sourceMessage(wire([nad('UD',{2:['5566778899',qual,agency]})])))
 assert.equal(p.customer.orgNumber,null);assert.equal(p.customer.personalNumber,null)
})
const context=(code='Z04')=>({code,bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'TECH-SENDER',receiverEdielId:'TECH-RECEIVER',customerId:'000Customer',customerIdCodeListQualifier:'SE1',customerName:'User',customerAddress:'UD Street',customerCity:'UD Town',customerPostalCode:'001 23',customerCountry:'DK',meterPointId:'735999999999999999',siteAddress:'IT Street',siteCity:'IT Town',sitePostalCode:'004 56',siteCountry:'SE',balanceResponsibleId:'000BRP',reasonForTransaction:({Z06:'E64',Z08:'Z25',Z09:'Z27',Z10:'E58',Z13:'S17',Z14:'S17',Z15:'S17',Z18:'S17'}[code]??'Z22')})
for(const code of ['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'])test(`profile ${code}: NAD parent and child exclusions use unchanged source usages`,async()=>{
 const a=await api,x=a.buildProfiledProdatSegments({context:context(code),generatedAt:new Date('2026-09-17T12:00:00Z'),mode:'test'})
 const rules=a.canonicalProdat26AFieldRules(code),inp=input(a,x.segments.join("'")+"'",code)
 for(const id of ['END_USER_GROUP','INSTALLATION_GROUP','229','232','231','262']) {
   const r=rules.find(r=>r.fieldNumber===id)
   assert(r,`mapped rule ${code}/${id}`)
   assert.equal(a.fieldRulePresent(r,inp),r.requirement!=='forbidden',`${code}/${id}`)
 }
 // Independently check actual wire ordering: all object NADs follow a LIN.
 const first=x.segments.findIndex(s=>s.startsWith('LIN+'))
 for(const role of ['UD','IT','IV','Z02'])assert(!x.segments.some((s,i)=>s.startsWith(`NAD+${role}+`)&&i<first))
})
test('real profile builder carries explicit multicomponent customer/site/invoicee and legal header actors',async()=>{
 const a=await api,c={...context(),legalSenderId:'000LegalFr',legalReceiverId:'000LegalDo',legalSenderCountry:'DK',customerNameLines:['User  (1)',"Second?'"],customerAddressLines:['U:1','','U+3'],siteAddressLines:['S:1','S+2','S?3'],invoicee:{id:'Invoice:1',idAgency:'89',name:'Invoice',nameLines:['Invoice','Other'],addressLines:['I+1','','I:3'],city:'ITown',postalCode:'001 23',country:'NO'}}
 const x=a.buildProfiledProdatSegments({context:c,generatedAt:new Date('2026-09-17T12:00:00Z')}),p=a.parseProdatMessage(x.segments.join("'")+"'").lineItems[0]
 assert(x.segments.includes('NAD+FR+000LegalFr:160:SVK+++++++DK'))
 assert.equal(p.endUserName,"User  (1)\nSecond?'");assert.equal(p.endUserAddress,'U:1\n\nU+3');assert.equal(p.installationAddress,'S:1\nS+2\nS?3')
 assert.equal(p.invoiceeId,'Invoice:1');assert.equal(p.invoiceeName,'Invoice\nOther');assert.equal(p.invoiceeAddress,'I+1\n\nI:3');assert.equal(p.invoiceeCountry,'NO')
 assert(!x.issues.some(i=>i.code.startsWith('FIELD_MATRIX_FIELD_')),JSON.stringify(x.issues))
})
test('explicit empty portal party values do not borrow otherwise-valid context values',async()=>{
 const a=await api,x=a.buildProfiledProdatSegments({context:context(),portalSnapshot:{customerId:'',customerName:'',customerAddress:'',customerCity:'',customerPostalCode:'',customerCountry:'',siteAddress:'',invoicee:null},generatedAt:new Date('2026-09-17T12:00:00Z')})
 const p=a.parseProdatMessage(x.segments.join("'")+"'").lineItems[0]
 assert.equal(p.customerId,null);assert.equal(p.endUserName,null);assert.equal(p.endUserAddress,null);assert.equal(p.endUserCountry,null);assert.equal(p.installationAddress,null)
 assert(x.issues.some(i=>i.severity==='error'))
})
for(const value of [[],42,{id:'Invoice'},'invalid'])test(`portal invoicee validates type/required components (${JSON.stringify(value)})`,async()=>{
 const a=await api
 if(value&&typeof value==='object'&&!Array.isArray(value)) {
 const x=a.buildProfiledProdatSegments({context:context(),portalSnapshot:{invoicee:value},generatedAt:new Date('2026-09-17T12:00:00Z')});assert(x.issues.some(i=>i.severity==='error'))
 }else assert.throws(()=>a.buildProfiledProdatSegments({context:context(),portalSnapshot:{invoicee:value}}),/prodat_party_snapshot_invalid/)
})
test('Z13 date-of-birth qualifier is rejected; Z14N cannot manufacture forbidden UD/IT parents',async()=>{
 const a=await api,x=a.buildProfiledProdatSegments({context:{...context('Z13'),customerIdCodeListQualifier:'1',customerId:'20000101',reasonForTransaction:'S17'},generatedAt:new Date('2026-09-17T12:00:00Z')})
 assert(x.issues.some(i=>i.code==='FIELD_MATRIX_FIELD_FORMAT_INVALID'))
 const n=a.buildProfiledProdatSegments({context:{...context('Z14'),reasonForTransaction:'N'},variant:'N',generatedAt:new Date('2026-09-17T12:00:00Z')})
 assert(!n.segments.some(s=>s.startsWith('NAD+UD+')||s.startsWith('NAD+IT+')))
})

function permissionRow(code,udBody,extra={}) {return {...sourceMessage(wire(['RFF+LI:CASE',...udBody],[],standard,code)),id:code+'-message',direction:code==='Z13'?'outbound':'inbound',environment:'test',sender_ediel_id:code==='Z13'?'SUPPLIER':'NETWORK',receiver_ediel_id:code==='Z13'?'NETWORK':'SUPPLIER',...extra}}
for(const [label,inbound,expected,matching] of [
 ['exact distributor identity',nad('UD',{2:['00a:B','','89']}),nad('UD',{2:['00a:B','','89']}),true],
 ['case differs',nad('UD',{2:['00A:B','','89']}),nad('UD',{2:['00a:B','','89']}),false],
 ['invoicee is not ultimate customer',nad('IV',{2:['00a:B','','89']}),nad('UD',{2:['00a:B','','89']}),false],
 ['malformed candidate must not wildcard',nad('UD',{2:['00a:B','','89']}),nad('UD',{2:['00a:B','SE1','ZZZ']}),false],
 ['empty candidate must not wildcard',nad('UD',{2:['00a:B','','89']}),nad('UD',{2:['','SE1','260']}),false],
 ['missing candidate party must not wildcard',nad('UD',{2:['00a:B','','89']}),nad('IV',{2:['00a:B','','89']}),false],
])test(`permission request matching: ${label}`,async()=>{
 const a=await api,candidate=permissionRow('Z13',[expected]),message=permissionRow('Z14',[inbound]),original=JSON.stringify([candidate,message])
 a.boundary.set([candidate]);try {
 const result=await a.resolveProdatPermissionAperakValidationIssues({message})
 assert.equal(result.length===0,matching,JSON.stringify(result));assert.equal(JSON.stringify([candidate,message]),original)
 }finally{a.boundary.clear()}
})
test('permission candidate query is scoped to the source company and rejects unexpected returned tenants',async()=>{
 const a=await api,message=permissionRow('Z14',[nad('UD')]),candidate=permissionRow('Z13',[nad('UD')],{company_id:'tenant-B'})
 a.boundary.set([candidate]);try {
 const result=await a.resolveProdatPermissionAperakValidationIssues({message})
 assert(a.boundary.calls.some(c=>Array.isArray(c)&&c[0]==='eq'&&c[1]==='company_id'&&c[2]==='tenant-A'))
 assert(result.some(i=>i.fieldPath==='PRODAT/PERMISSION/REQUEST_MATCH'))
 }finally{a.boundary.clear()}
})
test('permission matching requires company scope before any database query',async()=>{
 const a=await api;a.boundary.clear()
 await assert.rejects(()=>a.resolveProdatPermissionAperakValidationIssues({message:permissionRow('Z14',[nad('UD')],{company_id:null})}),/prodat_permission_company_scope_required/)
})
test('a nonempty headerless candidate cannot borrow stored customer id as permission evidence',async()=>{
 const a=await api,message=permissionRow('Z14',[nad('UD')]),candidate=permissionRow('Z13',[],{raw_payload:'NO-EDIFACT',customer_id:'000abc',metering_point_id:'735999999999999999',transaction_reference:'CASE'})
 a.boundary.set([candidate]);try{assert((await a.resolveProdatPermissionAperakValidationIssues({message})).length>0)}finally{a.boundary.clear()}
})
