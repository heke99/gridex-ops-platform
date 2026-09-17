// P 26.A r3 §2.6 pp55–74, independently tabulated wire-component expectations.
// These are synthetic behavioral cases, not original TGT files/certificates.
// Run: node --experimental-vm-modules --test scripts/test-ediel-prodat-characteristic-fields.cjs
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
  const service = new SyntheticModule(['supabaseService'], function () {
    this.setExport('supabaseService', new Proxy({}, { get() { throw new Error('Unexpected database access in source-only test') } }))
  })
  const entry = new SourceTextModule(`
    export { canonicalProdat26AFieldRules, PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
    export { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix';
    export { parseProdatMessage } from '@/lib/ediel/prodat/parser';
    export { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments';
    export { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage';
    export { canonicalMessageFacts } from '@/lib/ediel/core/canonicalEdifactAst';
    export { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser';
    export { compareInboundPayloadToTgtTestData } from '@/lib/ediel/testing/tgtAutoMatcher';
    export { validateProdatPermissionMessage } from '@/lib/ediel/testing/prodatPermissionEngine';
    export { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
    export { prodatCharacteristicValue, prodatCharacteristicValues, misplacedProdatEnergyProducts } from '@/lib/ediel/prodat/prodatCharacteristicFields';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
    export { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
  `, { identifier: path.join(root, 'lib/ediel/characteristic-test.ts') })
  await entry.link((specifier, parent) => {
    if (specifier === '@/lib/supabase/service') return service
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency ${specifier}`)
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), 'Load only real Ediel sources')
    if (!modules.has(file)) modules.set(file, new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip', sourceUrl: file }), { identifier: file }))
    return modules.get(file)
  })
  await entry.evaluate()
  return entry.namespace
}
const api = runtime()
// field, CCI qualifier, zero-based C889 component, independent example value.
const golden = [
  ['214','Z02',3,'10'], ['215','Z03',3,'20'], ['217','Z04',0,'QH'],
  ['218','Z05',3,'8'], ['219','Z06',3,'6'], ['306','Z07',0,'E23'],
  ['307','Z08',0,'E01'], ['220','Z09',0,'E01'], ['222','Z12',3,'D'],
  ['223','Z13',0,'S17'], ['259','Z16',3,'E01'], ['254','Z15',0,'E01'],
  ['242','Z14',3,'L917'], ['506','Z14',4,'8716867000030'], ['310','Z17',0,'A04'],
  ['513','Z22',0,'E17'], ['322','Z23',0,'A74'], ['323','Z24',0,'B71'], ['324','Z25',0,'B79'],
]
const source = JSON.parse(fs.readFileSync(path.join(root, 'docs/ediel/masterplan-v2/registers/prodat_fields.json'), 'utf8'))
function cav(index, value) { const parts = Array(5).fill(''); parts[index] = value; return `CAV+${parts.join(':')}` }
function fieldRule(a, field, requirement = 'required') { return { ...a.canonicalProdat26AFieldRules('Z04').find(r => r.fieldNumber === field), requirement } }
const input = rawSegments => ({ family:'PRODAT', code:'Z04', rawSegments })
function wire(code, body, headers = []) {
  const middle = [`UNH+M+PRODAT:D:97A:UN:E2SE6A`, `BGM+${code}+MESSAGE+9+AB`, 'DTM+137:202609171200:203', ...headers, ...body]
  return ["UNA:+.? ", 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT', ...middle, `UNT+${middle.length + 1}+M`, 'UNZ+1+I'].join("'")+"'"
}
const line = 'LIN+1++735999999999999999:::9'
for (const [field, cci, index, value] of golden) {
  test(`field ${field}: original locator and all13 requirement classes remain authoritative`, async () => {
    const a = await api, original = source.find(r => r.field === field), row = a.PRODAT_26A_FIELD_MATRIX.find(r => r.fieldNumber === field)
    const component = index === 0 ? '7111' : `7110[${index - 2}]`
    assert.equal(original.locator, `SG14/CCI[C502/6313=${cci}] → CAV/C889/${component}`)
    assert.equal(row.segmentPath, `CCI++${cci}/CAV`)
    for (const [code, usage] of Object.entries(original.usage)) {
      assert.equal(a.canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber===field).requirement, {R:'required',D:'dependent',O:'optional','-':'forbidden'}[usage])
    }
  })
  test(`field ${field}: only its exact C889 component supplies its value`, async () => {
    const a = await api, rule = fieldRule(a, field)
    assert.equal(a.fieldRulePresent(rule,input([`CCI++${cci}`,cav(index,value)])),true)
    for (let wrong = 0; wrong < 5; wrong++) {
      if (wrong === index) continue
      assert.equal(a.fieldRulePresent(rule,input([`CCI++${cci}`,cav(wrong,value)])),false,`wrong component${wrong}`)
    }
    assert.equal(a.fieldRulePresent(rule,input([`CCI++${cci}0`,cav(index,value)])),false,'qualifier prefix is not identity')
    const changed = [...golden].find(row=>row[1]!==cci)
    assert.equal(a.fieldRulePresent(rule,input([`CCI++${changed[1]}`,cav(index,value)])),false,'foreign qualifier')
  })
  test(`field ${field}: empty values and cross-group CAV never satisfy a required field`, async () => {
    const a = await api, rule = fieldRule(a,field)
    for (const body of [[],[`CCI++${cci}`],[`CCI++${cci}`,'CAV+::::'],[`CCI++${cci}`,cav(index,'   ')], ...['LIN+2++OTHER:::9','UNH+OTHER+PRODAT:D:97A:UN:E2SE6A','NAD+UD+OTHER','DTM+137:20260917:102'].map(boundary=>[`CCI++${cci}`,boundary,cav(index,value)])]) {
      assert.equal(a.fieldRulePresent(rule,input(body)),false,JSON.stringify(body))
      assert(a.validateFieldMatrixPayload(input(body),[rule]).some(i=>i.blocking))
    }
  })
  test(`field ${field}: allowed-value checks inspect the selected slot, not metadata or sibling fields`, async () => {
    const a = await api, rule = {...fieldRule(a,field),allowedValues:[value]}
    const values = Array(5).fill('DECOY'); values[index] = value
    const correct = [`CCI++${cci}`,`CAV+${values.join(':')}`]
    assert.deepEqual(a.validateFieldMatrixPayload(input(correct),[rule]),[])
    values[index]='INVALID'; values[(index+1)%5]=value
    assert(a.validateFieldMatrixPayload(input([`CCI++${cci}`,`CAV+${values.join(':')}`]),[rule]).some(i=>i.blocking))
  })
  test(`field ${field}: populated forbidden field remains blocked`, async () => {
    const a=await api
    assert(a.validateFieldMatrixPayload(input([`CCI++${cci}`,cav(index,value)]),[fieldRule(a,field,'forbidden')]).some(i=>i.blocking))
  })
}
test('product242 and energy506 are independent despite a shared CCI qualifier',async()=>{
  const a=await api
  for(const [required,forbidden,raw] of [['242','506','CAV+:::L917'],['506','242','CAV+::::8716867000030']]) {
    const rules=[fieldRule(a,required),fieldRule(a,forbidden,'forbidden')]
    assert.deepEqual(a.validateFieldMatrixPayload(input(['CCI++Z14',raw]),rules),[])
    assert(a.validateFieldMatrixPayload(input(['CCI++Z14','CAV+:::L917:8716867000030']),rules).some(i=>i.blocking))
  }
})
test('observation length508 is DTM354; an old meter constant is never its value',async()=>{
  const a=await api, rule=fieldRule(a,'508')
  assert.equal(a.PRODAT_26A_FIELD_MATRIX.find(r=>r.fieldNumber==='508').segmentPath,'DTM+354')
  assert.equal(a.fieldRulePresent(rule,input(['DTM+354:15:806'])),true)
  for(const raw of [['CCI++Z03','CAV+:::20'],['DTM+354:000015:610'],['DTM+354::610'],['DTM+354:   :610']]) assert.equal(a.fieldRulePresent(rule,input(raw)),false)
})
const parsedFields = { '217':'measuringMethod','222':'reportingFrequency','223':'reasonForTransaction','242':'timeSeriesProduct','506':'energyProductId','513':'installationDirection','322':'permissionStatus','323':'permissionPurpose','324':'permissionEndReason' }
for(const [field,property] of Object.entries(parsedFields)) {
  const [,cci,index,value]=golden.find(row=>row[0]===field)
  test(`line parser ${property}: reads exact field${field}, including released separators`,async()=>{
    const a=await api
    const values=Array(5).fill('DECOY'); values[index]=value
    const raw=wire('Z14',[line,`CCI++${cci}`,`CAV+${values.join(':')}`])
    assert.equal(a.parseProdatMessage(raw).lineItems[0][property],value)
    for(const text of ['X?:Y','X?+Y','X??','X?\'Y']) {
      const rawValue=text.replace(/\?(.)/g,'$1')
      const payload=wire('Z14',[line,`CCI++${cci}`,cav(index,text)])
      assert.equal(a.parseProdatMessage(payload).lineItems[0][property],rawValue)
    }
    const bad=wire('Z14',[line,`CCI++${cci}`,cav((index+1)%5,value)])
    assert.equal(a.parseProdatMessage(bad).lineItems[0][property],null)
  })
}
test('per-line facts do not confuse constants, digits and register time frames',async()=>{
  const a=await api
  const raw=wire('Z10',[line,'CCI++Z02','CAV+:::10','CCI++Z05','CAV+:::8','LIN+2++735999999999999998:::9','CCI++Z16','CAV+:::E01'])
  const facts=a.parseEdifactMessageFacts(raw).lineItems
  const parsed=a.parseProdatMessage(raw).lineItems
  for(const lines of [facts,parsed]) { assert.equal(lines[0].hasConstant,true);assert.equal(lines[0].hasDigitCount,true);assert.equal(lines[1].hasConstant,false);assert.equal(lines[1].hasDigitCount,false) }
})
test('CAV cannot be borrowed across a line boundary in canonical scalar facts',async()=>{
  const a=await api
  const result=a.canonicalMessageFacts(wire('Z14',[line,'CCI++Z23','LIN+2++735999999999999998:::9','CAV+A74']))
  assert.deepEqual(result.cciCavCodes.Z23??[],[])
})
test('canonical and rulebook subtypes use only field223, never measurement or agency',async()=>{
  const a=await api
  for(const raw of [wire('Z13',[line,'CCI++Z04','CAV+QH','CCI++Z13','CAV+S17::AGENCY']),wire('Z13',[line,'CCI++Z13','CAV+S17?:S18'])]) {
    const expected=raw.includes('S17?:S18')?'S17:S18':'S17'
    assert.equal(a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:'edifact'}).subtype,expected)
    assert.equal(a.parseRulebookMessage(raw).subtype,expected)
  }
  for(const body of [[line,'CCI++Z04','CAV+S18'],[line,'CCI++Z13','CAV+::S18']]) {
    const raw=wire('Z13',body)
    assert.equal(a.parseCanonicalEdielPayload({rawPayload:raw,standardHint:'edifact'}).subtype,null)
    assert.equal(a.parseRulebookMessage(raw).subtype,null)
  }
})
for(const [field,cci,index,value,code] of [['214','Z02',3,'10','Z10'],['217','Z04',0,'QH','Z06'],['218','Z05',3,'8','Z10'],['222','Z12',3,'D','Z06'],['223','Z13',0,'S17','Z06']]) {
  test(`TGT comparison field${field} uses the same source component without rewriting expected testdata`,async()=>{
    const a=await api, testData={groups:[{columns:[{name:'A',index:0}],fields:[{fieldCode:field,values:{A:value}}]}]}
    const before=JSON.stringify(testData)
    const message={message_family:'PRODAT',message_code:code,raw_payload:wire(code,[line,`CCI++${cci}`,cav(index,value)])}
    assert.deepEqual(a.compareInboundPayloadToTgtTestData({message,testData}),[])
    const wrong={...message,raw_payload:wire(code,[line,`CCI++${cci}`,cav((index+1)%5,value)])}
    assert(a.compareInboundPayloadToTgtTestData({message:wrong,testData}).some(i=>i.fieldCode===field))
    assert.equal(JSON.stringify(testData),before)
  })
}
test('permission validation reads status322/end reason324, not trailing metadata',async()=>{
  const a=await api
  const message={message_family:'PRODAT',message_code:'Z15',direction:'inbound',raw_payload:wire('Z15',[line,'CCI++Z23','CAV+A75::AGENCY','CCI++Z25','CAV+B79::AGENCY'])}
  assert.deepEqual(a.validateProdatPermissionMessage({message}).issues,[])
  const invalid={...message,raw_payload:wire('Z15',[line,'CCI++Z23','CAV+INVALID::A75','CCI++Z25','CAV+INVALID::B79'])}
  assert.equal(a.validateProdatPermissionMessage({message:invalid}).issues.length,2)
})
test('Z04 product242 is not incorrectly subjected to the Z13/Z14 energy506 preflight rule',async()=>{
  const a=await api
  const result=a.preflightEdielPayload({rawPayload:wire('Z04',[line,'CCI++Z13','CAV+Z22','CCI++Z14','CAV+:::L917']),messageStandard:'edifact',mode:'send'})
  assert(!result.issues.some(i=>i.code==='PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH'))
})

for (const alphabet of [":+.? '", "*;.! ~", "^|.! %"]) {
  test(`all19 characteristic slots preserve released values under UNA ${alphabet}`, async () => {
    const a=await api, [component,data,decimal,release,repetition,terminator]=alphabet
    const escaped = value => [...value].map(c=>[component,data,release,terminator].includes(c)?release+c:c).join('')
    const segment = (tag, elements) => [tag,...elements.map(parts=>parts.map(escaped).join(component))].join(data)
    for (const [field,qualifier,index] of golden) {
      for (const value of ['VALUE', '0', `A${component}B${data}C${release}${terminator}D`]) {
        const parts=Array(5).fill(''); parts[index]=value
        const raw=[`UNA${alphabet}`,segment('UNH',[['M'],['PRODAT','D','97A','UN','E2SE6A']]),segment('BGM',[['Z14'],['M']]),segment('LIN',[['1'],[],['OBJECT','','','9']]),segment('CCI',[[],[qualifier]]),segment('CAV',[parts]),segment('UNT',[['6'],['M']])].join(terminator)+terminator
        const tokens=a.tokenizeEdifact(raw)
        assert.equal(a.prodatCharacteristicValue(field,tokens.segments,tokens.una),value)
        assert(a.fieldRulePresent(fieldRule(a,field),{...input(tokens.segments.map(s=>s.raw)),una:tokens.una}))
        if(parsedFields[field]) assert.equal(a.parseProdatMessage(raw).lineItems[0][parsedFields[field]],value)
      }
    }
  })
}
test('a valid first characteristic cannot hide a later invalid value from allowed-value validation',async()=>{
  const a=await api, rule={...fieldRule(a,'322'),allowedValues:['A74']}
  assert(a.validateFieldMatrixPayload(input(['CCI++Z23','CAV+A74','CCI++Z23','CAV+INVALID']),[rule]).some(i=>i.blocking))
  assert.deepEqual(a.prodatCharacteristicValues('322',['CCI++Z23','CAV+A74','CCI++Z23','CAV+INVALID']),['A74','INVALID'])
})
test('empty or misplaced forbidden CCI/CAV cannot evade exclusion',async()=>{
  const a=await api
  for(const [field,cci,index] of golden) {
    for(const raw of [[`CCI++${cci}`],[`CCI++${cci}`,'CAV+::::']]) {
      assert(a.validateFieldMatrixPayload(input(raw),[fieldRule(a,field,'forbidden')]).some(i=>i.blocking))
    }
    if(cci!=='Z14') assert(a.validateFieldMatrixPayload(input([`CCI++${cci}`,cav((index+1)%5,'DECOY')]),[fieldRule(a,field,'forbidden')]).some(i=>i.blocking))
  }
})
test('real permission renderer emits independently specified fourth/fifth and coded components',async()=>{
  const a=await api
  const context={code:'Z14',bgmReference:'MESSAGE',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',customerName:'TEST',customerId:'5560000000',customerIdCodeListQualifier:'SE1',meterPointId:'735999999999999999',gridAreaId:'ABC',siteAddress:'TEST',permissionId:'PERMISSION',startDate:'202609171200',reportingFrequency:'D',energyProductId:'8716867000030',installationDirection:'E17',permissionStatus:'A74',permissionPurpose:'B71'}
  const result=a.buildProfiledProdatSegments({context,variant:'V',mode:'test',generatedAt:new Date('2026-09-17T12:00:00Z')})
  for(const [cci,cav] of [['Z12','CAV+:::D'],['Z14','CAV+::::8716867000030'],['Z22','CAV+E17'],['Z23','CAV+A74'],['Z24','CAV+B71']]) {
    const index=result.segments.indexOf(`CCI++${cci}`)
    assert(index>=0)
    assert.equal(result.segments[index+1],cav)
  }
  const parsed=a.parseProdatMessage(wire('Z14',result.segments.slice(1))).lineItems[0]
  assert.equal(parsed.reportingFrequency,'D');assert.equal(parsed.energyProductId,'8716867000030');assert.equal(parsed.timeSeriesProduct,null)
})
test('permission end reason is field324/Z25, never an unregistered Z26 fallback',async()=>{
  const a=await api
  const message={message_family:'PRODAT',message_code:'Z15',direction:'inbound',raw_payload:wire('Z15',[line,'CCI++Z23','CAV+A75','CCI++Z26','CAV+B79'])}
  assert(a.validateProdatPermissionMessage({message}).issues.length>0)
})
test('required Z15 status/end reason cannot be satisfied only by wrong-slot metadata',async()=>{
  const a=await api
  const message={message_family:'PRODAT',message_code:'Z15',direction:'inbound',raw_payload:wire('Z15',[line,'CCI++Z23','CAV+::A75','CCI++Z25','CAV+::B79'])}
  assert.deepEqual(a.validateProdatPermissionMessage({message}).applicationErrors.map(e=>[e.fieldCode,e.ercCode]),[['322','41'],['324','41']])
})
