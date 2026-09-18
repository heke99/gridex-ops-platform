// P 26.A r3 §2.6 pp46,76–79: independent RFF/C506/1154 expectations.
// These are synthetic behavioral cases, not original TGT files/certificates.
// Run: node --experimental-vm-modules --test scripts/test-ediel-prodat-reference-fields.cjs
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
  const crypto = new SyntheticModule(['randomUUID','createHash'], function(){
    for (const name of ['randomUUID','createHash']) this.setExport(name,require('node:crypto')[name])
  })
  let fixture = null
  const saved = []
  const calls = []
  const service = new SyntheticModule(['supabaseService'], function () {
    this.setExport('supabaseService', { from(table) {
      if (!fixture) throw new Error('Unexpected database access in source-only test')
      calls.push(table)
      if(table==='ediel_business_references') return { async upsert(rows) { saved.push(...rows); return {error:null} } }
      assert(['ediel_messages','ediel_message_events'].includes(table), 'Only declared test boundary is reachable')
      const query={insert(){return query},select(){return query},eq(){return query},
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
    export { validateProdatPermissionMessage } from '@/lib/ediel/testing/prodatPermissionEngine';
    export { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
    export { prodatCharacteristicValue, prodatCharacteristicValues, misplacedProdatEnergyProducts } from '@/lib/ediel/prodat/prodatCharacteristicFields';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
    export { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases';
    export { createEdielMessage } from '@/lib/ediel/db';
    export { deriveProdatAperakValidationIssues } from '@/lib/ediel/testing/aperakErrorRuleRegistry';
    export { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
  `, { identifier: path.join(root, 'lib/ediel/reference-test.ts') })
  const unreachable = new Map([
    ['@/lib/customers/canonicalOnboarding', ['canonicalIdempotencyKey','onboardCustomerGraph']],
    ['@/lib/tenant/context', ['createTenantContext']],
    ['@/lib/supabase/tenantDb', ['tenantDb']],
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
const refs = [
  ['315','XA','sender_organisation_no'], ['224','MG','meter_number'],
  ['225','Z02','old_meter_number'], ['308','VC','supplier_contract_no'],
  ['260','Z05','net_area'], ['320','Z08','calorific_value_area'],
  ['240','Z06','serial_id'], ['319','Z07','reference_to_metering_point'],
  ['261','ANJ','agreement_reference'], ['226','LI','line_reference'],
  ['325','Z09','permission_id'],
]
const fieldRule=(a,id,requirement='required')=>({...a.canonicalProdat26AFieldRules('Z04').find(r=>r.fieldNumber===id),requirement})
const input=rawSegments=>({family:'PRODAT',code:'Z04',rawSegments})
const lin='LIN+1++735999999999999999:::9'
function wire(code,body,header=[]) {
  const middle=['UNH+MSG+PRODAT:D:97A:UN:E2SE6A',`BGM+${code}+DOCUMENT+9+AB`,'DTM+137:202609171200:203',...header,...body]
  return ["UNA:+.? ",'UNB+UNOC:3+12345:14+54321:14+260917:1200+INT++23-DDQ-PRODAT',...middle,`UNT+${middle.length+1}+MSG`,'UNZ+1+INT'].join("'")+"'"
}
for(const [id,q,key] of refs) {
  test(`reference ${id}: source qualifier and13 usage classes are exact`,async()=>{
    const a=await api,original=source.find(r=>r.field===id),row=a.PRODAT_26A_FIELD_MATRIX.find(r=>r.fieldNumber===id)
    assert.match(original.locator,new RegExp(`RFF\\[1153=${q}\\]/C506/1154`))
    assert.equal(row.segmentPath,`RFF+${q}`)
    assert.equal(row.fieldKey,key)
    for(const [code,usage] of Object.entries(original.usage)) assert.equal(a.canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber===id).requirement,{R:'required',D:'dependent',O:'optional','-':'forbidden'}[usage])
  })
  test(`reference ${id}: qualifier, later metadata and empty C506 are not a reference number`,async()=>{
    const a=await api,rule=fieldRule(a,id)
    assert.equal(a.fieldRulePresent(rule,input([`RFF+${q}:VALUE`])),true)
    for(const raw of [`RFF+${q}`,`RFF+${q}:`,`RFF+${q}:   `,`RFF+${q}::LINE:VERSION`,`RFF+${q}X:VALUE`,`RFF+${q}?:VALUE`]) {
      assert.equal(a.fieldRulePresent(rule,input([raw])),false,raw)
      assert(a.validateFieldMatrixPayload(input([raw]),[rule]).some(x=>x.blocking),raw)
    }
  })
  test(`reference ${id}: exact1154 is checked for allowed values and every repeated occurrence`,async()=>{
    const a=await api,rule={...fieldRule(a,id),allowedValues:['GOOD:REF']}
    assert.deepEqual(a.validateFieldMatrixPayload(input([`RFF+${q}:GOOD?:REF:LINE:VERSION`]),[rule]),[])
    assert(a.validateFieldMatrixPayload(input([`RFF+${q}:BAD:GOOD?:REF`]),[rule]).some(i=>i.blocking))
    assert(a.validateFieldMatrixPayload(input([`RFF+${q}:GOOD?:REF`,`RFF+${q}:BAD`]),[rule]).some(i=>i.blocking))
  })
  test(`reference ${id}: empty forbidden reference does not evade exclusion`,async()=>{
    const a=await api,rule=fieldRule(a,id,'forbidden')
    for(const raw of [`RFF+${q}`,`RFF+${q}:`,`RFF+${q}::LINE:VERSION`,`RFF+${q}:VALUE`]) assert(a.validateFieldMatrixPayload(input([raw]),[rule]).some(i=>i.blocking),raw)
  })
}
for(const [id,good,bad] of [['225','Z02','MG'],['308','VC','CT'],['320','Z08','Z10'],['240','Z06','SI'],['315','XA','FR']]) {
  test(`reference ${id}: legacy alias ${bad} never supplies ${good}`,async()=>{
    const a=await api,rule=fieldRule(a,id)
    assert.equal(a.fieldRulePresent(rule,input([bad==='FR'?'NAD+FR+5566778899:SE1:260':`RFF+${bad}:VALUE`])),false)
  })
}
test('sender organisation315 is the XA reference of the header sender, not another NAD or line',async()=>{
  const a=await api,rule=fieldRule(a,'315')
  const header=['UNH+MSG+PRODAT:D:97A:UN:E2SE6A','BGM+Z03+DOC+9+AB','NAD+FR+12345:160:SVK']
  assert.equal(a.fieldRulePresent(rule,input([...header,'RFF+XA:5566778899','NAD+DO+54321:160:SVK',lin])),true)
  assert.equal(a.fieldRulePresent(rule,input([...header,'NAD+DO+54321:160:SVK','RFF+XA:OTHER',lin])),false)
  assert.equal(a.fieldRulePresent(rule,input([...header,lin,'RFF+XA:OTHER'])),false)
})
for(const [id,q] of refs.filter(r=>r[0]!=='315')) {
  test(`reference ${id}: header or later message cannot supply missing object field`,async()=>{
    const a=await api,rule=fieldRule(a,id)
    const body=['UNH+MSG+PRODAT:D:97A:UN:E2SE6A',`RFF+${q}:HEADER`,lin,'UNT+4+MSG']
    assert.equal(a.fieldRulePresent(rule,input(body)),false)
    assert.equal(a.fieldRulePresent(rule,input([...body,'UNH+OTHER+PRODAT:D:97A:UN:E2SE6A',lin,`RFF+${q}:OTHER`])),false)
  })
}
for(const [q,prop] of [['LI','lineItemReference'],['Z05','gridAreaId'],['ANJ','agreementReference'],['Z09','permissionId'],['MG','meterNumber']]) {
  test(`line parser ${prop}: released content stays literal and metadata is not concatenated`,async()=>{
    const a=await api
    for(const [value,encoded] of [['A:B', 'A?:B'],['A+B','A?+B'],['A?','A??'],["A'B","A?'B"],['000123','000123']]) {
      const parsed=a.parseProdatMessage(wire('Z14',[lin,`RFF+${q}:${encoded}:LINE:VERSION`]))
      assert.equal(parsed.lineItems[0][prop],value)
    }
    const empty=a.parseProdatMessage(wire('Z14',[lin,`RFF+${q}::LINE:VERSION`,'LIN+2++OTHER:::9',`RFF+${q}:SECOND`]))
    assert.equal(empty.lineItems[0][prop],null)
    assert.equal(empty.lineItems[1][prop],'SECOND')
  })
}
test('canonical AST references use C506/1154 only; line/version metadata cannot fabricate a business identity',async()=>{
  const a=await api
  for(const [value,expected] of [['VALUE:77:REV','VALUE'],[':77:REV',null],['A?:B:77:REV','A:B'],['A??:77:REV','A?']]) {
    const raw=wire('Z14',[lin,`RFF+LI:${value}`])
    assert.equal(a.parseEdifactMessageFacts(raw).lineItems[0].rffLi,expected)
    const canonical=a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:"edifact"})
    assert.equal(canonical.businessReference,expected)
    assert.equal(a.parseRulebookMessage(raw).transactionReference,expected)
  }
})
test('canonical and rulebook permission identity comes only from Z09, not object Z07 or AHL',async()=>{
  const a=await api
  for(const [body,expected] of [[['RFF+Z07:OBJECT','RFF+AHL:DECOY'],null],[['RFF+Z07:OBJECT','RFF+Z09:PERM?:1'],'PERM:1']]) {
    const raw=wire('Z15',[lin,...body])
    assert.equal(a.parseProdatMessage(raw).lineItems[0].permissionId,expected)
    assert.equal(a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:"edifact"}).permissionId,expected)
    assert.equal(a.parseRulebookMessage(raw).permissionId,expected)
  }
})
test('TGT field261 checks ANJ, never substitutes the LI case reference',async()=>{
  const a=await api
  const body=[lin,'RFF+LI:CASE','RFF+ANJ:AUTH']
  const message={message_family:'PRODAT',message_code:'Z03',raw_payload:wire('Z03',body)}
  const testData={groups:[{columns:[{name:'A',index:0}],fields:[{fieldCode:'261',values:{A:'AUTH'}}]}]}
  const result=a.compareInboundPayloadToTgtTestData({message,testData})
  assert(!result.some(i=>i.fieldCode==='261'),JSON.stringify(result))
  const wrong={...message,raw_payload:wire('Z03',[lin,'RFF+LI:AUTH','RFF+ANJ:WRONG'])}
  assert(a.compareInboundPayloadToTgtTestData({message:wrong,testData}).some(i=>i.fieldCode==='261'))
})

for (const [label, body, expected] of [
  ['matching MG/Z02', ['RFF+MG:NEW?:1:7:REV','RFF+Z02:NEW?:1:9:OTHER'], '2.4.1'],
  ['different new/old', ['RFF+MG:NEW?:1','RFF+Z02:OLD?:1'], '2.3.1'],
  ['duplicate new is not old', ['RFF+MG:NEW','RFF+MG:NEW'], '2.3.1'],
  ['missing old', ['RFF+MG:NEW','RFF+Z02::7:REV'], '2.3.1'],
  ['matching prefix but different full numbers', ['RFF+MG:A?:NEW','RFF+Z02:A?:OLD'], '2.3.1'],
  ['no cross-line borrowing', ['RFF+MG:A','RFF+Z02:B','LIN+2++OTHER:::9','CCI++Z02','CAV+:::1','RFF+MG:B','RFF+Z02:A'], '2.3.1'],
]) {
  test(`TGT Z10 classification: ${label}`,async()=>{
    const a=await api
    const message={message_family:'PRODAT',message_code:'Z10',raw_payload:wire('Z10',[lin,'CCI++Z02','CAV+:::1',...body])}
    assert.equal(a.inferTgtTestCaseCodeForInboundTestData({message,rawText:''}),expected)
  })
}
for(const [id,q] of refs.filter(r=>r[0]!=='315')) {
  test(`TGT comparison retains exact field ${id} identity`,async()=>{
    const a=await api
    const message={message_family:'PRODAT',message_code:'Z10',raw_payload:wire('Z10',[lin,`RFF+${q}:RIGHT:LINE:REV`])}
    const testData={groups:[{columns:[{name:'A',index:0}],fields:[{fieldCode:id,values:{A:'RIGHT'}}]}]}
    const original=JSON.stringify(testData)
    assert(!a.compareInboundPayloadToTgtTestData({message,testData}).some(i=>i.fieldCode===id))
    const wrong={...message,raw_payload:wire('Z10',[lin,`RFF+${q}:WRONG:RIGHT`])}
    assert(a.compareInboundPayloadToTgtTestData({message:wrong,testData}).some(i=>i.fieldCode===id))
    assert.equal(JSON.stringify(testData),original,'Expected source data stays unchanged')
  })
}
for(const [expected,actual] of [['A:B','AB'],['A-B','AB'],['0012','12'],['A(1)','A'],['A  B','A B'],['Ab','AB']]) {
  test(`reference comparison does not rewrite identity ${JSON.stringify(expected)}`,async()=>{
    const a=await api
    const testData={groups:[{columns:[{name:'A',index:0}],fields:[{fieldCode:'261',values:{A:expected}}]}]}
    const message={message_family:'PRODAT',message_code:'Z03',raw_payload:wire('Z03',[lin,`RFF+ANJ:${actual}`])}
    const result=a.compareInboundPayloadToTgtTestData({message,testData})
    assert(result.some(i=>i.fieldCode==='261'),JSON.stringify(result))
  })
}

for(const [label, refs, invalid] of [
 ['same decoded new/old', ['RFF+MG:A?:1:LINE','RFF+Z02:A?:1:REV'],true],
 ['different decoded suffixes', ['RFF+MG:A?:NEW','RFF+Z02:A?:OLD'],false],
 ['duplicate new only', ['RFF+MG:A','RFF+MG:A'],false],
 ['metadata-only old', ['RFF+MG:A','RFF+Z02::A'],false],
]) {
 test(`real ACK reference path: ${label}`,async()=>{
  const a=await api
  const message={message_family:'PRODAT',message_code:'Z10',raw_payload:wire('Z10',[lin,'CCI++Z02','CAV+:::1',...refs])}
  const issues=a.deriveProdatAperakValidationIssues({message,testData:{testCaseCode:'AUTO',groups:[]}})
  assert.equal(issues.some(i=>i.ruleKey==='meter_number_invalid'),invalid,JSON.stringify(issues))
 })
}

for(const variant of ['present','absent','undecodable']) {
 test(`actual DB projection boundary: ${variant} references`,async()=>{
  const a=await api, hasRefs=variant==='present'
  const raw=wire('Z15',[lin,...(hasRefs?['RFF+LI:CASE?:1:LINE:REV','RFF+Z09:PERM?:1:LINE:REV','RFF+Z07:OBJECT?:1']:['RFF+LI::LINE:REV','RFF+Z07:OBJECT?:1'])])+(variant==='undecodable'?'?':'')
  const row={id:'message-id',company_id:'tenant-A',message_family:'PRODAT',message_code:'Z15',message_standard:'edifact',direction:'inbound',environment:'test',raw_payload:raw,
   parsed_payload:{references:[{qualifier:'LI',value:'STALE'}],permissionId:'STALE_PERMISSION',transactionReference:'STALE_IDE'},external_reference:'DOCUMENT',transaction_reference:'CASE',grid_owner_data_request_id:'request-id'}
  const original=JSON.stringify(row)
  a.boundary.set(row)
  try {
   await a.createEdielMessage({direction:'inbound',messageFamily:'PRODAT',messageCode:'Z15',messageStandard:'edifact',environment:'test',rawPayload:raw})
   const ref=type=>a.boundary.saved.find(r=>r.reference_type===type)?.reference_value
   assert.equal(ref('BGM_REF'),variant==='undecodable'?undefined:'DOCUMENT')
   assert.equal(ref('RFF_LI'),hasRefs?'CASE:1':undefined)
   assert.equal(ref('PERMISSION_ID'),hasRefs?'PERM:1':undefined)
   assert.equal(ref('RFF_Z07'),variant==='undecodable'?undefined:'OBJECT:1')
   assert.equal(ref('RFF_TN'),undefined)
   assert.equal(ref('IDE'),undefined)
   assert(a.boundary.saved.every(r=>r.company_id==='tenant-A' && r.source_message_id==='message-id' && r.business_object_id==='request-id'))
   assert.equal(JSON.stringify(row),original)
  } finally { a.boundary.clear() }
 })
}

for(const [value,encoded] of [['A:B','A?:B'],['A+B','A?+B'],["A'B","A?'B"],['A?','A??'],['00001','00001']]) {
 test(`customer staging reference preserves ${JSON.stringify(value)}`,async()=>{
  const a=await api
  const raw=wire('Z04',[lin,...['MG','Z07','ANJ','Z05'].map(q=>`RFF+${q}:${encoded}:LINE:VERSION`)])
  const row={raw_payload:raw,parsed_payload:{meterNumber:'STALE',referenceToMeteringPoint:'STALE',agreementReference:'STALE',gridAreaCode:'STALE'},message_family:'PRODAT',message_code:'Z04'}
  const result=a.parseInboundProdatBusinessData(row)
  assert.equal(result.meteringPoint.meterNumber,value)
  assert.equal(result.meteringPoint.referenceToMeteringPoint,value)
  assert.equal(result.production.referenceToMeteringPoint,value)
  assert.equal(result.contract.agreementReference,value)
  assert.equal(result.contract.gridAreaCode,value)
  assert.equal(result.site.gridAreaCode,value)
 })
}
test('customer staging absent references cannot borrow header, other object or cached projection',async()=>{
 const a=await api
 const raw=wire('Z04',[lin,'RFF+MG::LINE','RFF+ACW:DECOY','LIN+2++OTHER:::9','RFF+MG:SECOND','RFF+Z05:SECOND','RFF+Z07:SECOND','RFF+ANJ:SECOND'],['RFF+MG:HEADER'])
 const row={raw_payload:raw,parsed_payload:{meterNumber:'STALE',referenceToMeteringPoint:'STALE',agreementReference:'STALE',gridAreaCode:'STALE',customerName:'Retained'},message_family:'PRODAT',message_code:'Z04'}
 const result=a.parseInboundProdatBusinessData(row)
 assert.equal(result.meteringPoint.meterNumber,null)
 assert.equal(result.meteringPoint.referenceToMeteringPoint,null)
 assert.equal(result.contract.agreementReference,null)
 assert.equal(result.site.gridAreaCode,null)
 // F3-F: absent wire NAD228 cannot be manufactured from a cached name.
 assert.equal(result.customer.fullName,null)
})
test('customer staging structured-only legacy reference fallback remains',async()=>{
 const a=await api
 const result=a.parseInboundProdatBusinessData({raw_payload:null,parsed_payload:{meterNumber:'OLD',referenceToMeteringPoint:'LINK',agreementReference:'AUTH',gridAreaCode:'AREA'},message_code:'Z04'})
 assert.equal(result.meteringPoint.meterNumber,'OLD');assert.equal(result.meteringPoint.referenceToMeteringPoint,'LINK');assert.equal(result.contract.agreementReference,'AUTH');assert.equal(result.site.gridAreaCode,'AREA')
})

test('a PRODAT field request cannot borrow an RFF value from a different wire family',async()=>{
 const a=await api,rule=fieldRule(a,'224')
 assert.equal(a.fieldRulePresent(rule,input(['UNH+MSG+UTILTS:D:02B:UN:E5SE5A',lin,'RFF+MG:FOREIGN'])),false)
})
