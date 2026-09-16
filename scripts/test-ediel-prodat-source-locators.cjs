// Independent PRODAT P §2.6 (pp49,52,78) golden locators. No database or network.
// Run: node --experimental-vm-modules --test scripts/test-ediel-prodat-source-locators.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule } = require('node:vm')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')

async function runtime() {
  const modules = new Map()
  const entry = new SourceTextModule(`
    export { canonicalProdat26AFieldRules, PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
    export { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix';
    export { parseProdatMessage } from '@/lib/ediel/prodat/parser';
    export { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer';
  `, { identifier: path.join(root, 'lib/ediel/source-locator-test.ts') })
  await entry.link((specifier, parent) => {
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
const golden = [
  { field: '302', path: 'DTM+90', wrong: ['DTM+163', 'DTM+92', 'DTM+900'], code: 'Z13', value: '202609010015:203', locator: 'SG8/DTM[2005=90]/C507/2380' },
  { field: '321', path: 'DTM+91', wrong: ['DTM+164', 'DTM+93', 'DTM+910'], code: 'Z13', value: '202609300030:203', locator: 'SG8/DTM[2005=91]/C507/2380' },
  { field: '326', path: 'DTM+693', wrong: ['DTM+171', 'DTM+265', 'DTM+597'], code: 'Z14', value: '202609151345:203', locator: 'SG8/DTM[2005=693]/C507/2380' },
  { field: '327', path: 'DTM+164', wrong: ['DTM+273', 'DTM+91', 'DTM+1640'], code: 'Z18', value: '202610311430:203', locator: 'SG8/DTM[2005=164]/C507/2380' },
  { field: '325', path: 'RFF+Z09', wrong: ['RFF+ZPI', 'RFF+Z07', 'RFF+Z090'], code: 'Z18', value: 'PERMISSION-A', locator: 'SG16/RFF[1153=Z09]/C506/1154' },
]
const source = JSON.parse(fs.readFileSync(path.join(root, 'docs/ediel/masterplan-v2/registers/prodat_fields.json'), 'utf8'))
for (const item of golden) {
  test(`field ${item.field}: source-backed locator and unchanged R/D/O profile`, async () => {
    const a = await api
    const row = a.PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === item.field)
    const original = source.find(row => row.field === item.field)
    assert.equal(original.locator, item.locator)
    assert.equal(row.segmentPath, item.path)
    for (const [code, requirement] of Object.entries(original.usage)) {
      const actual = a.canonicalProdat26AFieldRules(code).find(r => r.fieldNumber === item.field)
      assert.equal(actual.requirement, { R: 'required', D: 'dependent', O: 'optional', '-': 'forbidden' }[requirement])
    }
  })
  test(`field ${item.field}: canonical value passes and other qualifiers never satisfy it`, async () => {
    const a = await api
    const rule = { ...a.canonicalProdat26AFieldRules(item.code).find(r => r.fieldNumber === item.field), requirement: 'required' }
    assert.equal(a.fieldRulePresent(rule, { rawSegments: [`${item.path}:${item.value}`] }), true)
    assert.equal(a.validateFieldMatrixPayload({family:'PRODAT',code:item.code,rawSegments:[`${item.path}:${item.value}`]},[rule]).length, 0)
    for (const wrong of item.wrong) {
      assert.equal(a.fieldRulePresent(rule, {rawSegments:[`${wrong}:${item.value}`]}),false,wrong)
      assert(a.validateFieldMatrixPayload({family:'PRODAT',code:item.code,rawSegments:[`${wrong}:${item.value}`]},[rule]).some(i=>i.blocking),wrong)
    }
  })
  test(`field ${item.field}: empty value cannot pass required or evade forbidden check`, async () => {
    const a = await api
    const rule = { ...a.canonicalProdat26AFieldRules(item.code).find(r => r.fieldNumber === item.field), requirement: 'required' }
    for (const suffix of ['', ':', '::203', ':   :203']) {
      const input={family:'PRODAT',code:item.code,rawSegments:[item.path+suffix]}
      assert(a.validateFieldMatrixPayload(input,[rule]).some(i=>i.blocking),`empty required ${suffix}`)
      assert(a.validateFieldMatrixPayload(input,[{...rule,requirement:'forbidden'}]).some(i=>i.blocking),`empty forbidden ${suffix}`)
    }
  })
}
const context = {
  bgmReference:'MESSAGE',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',
  customerName:'TEST',customerId:'5560000000',customerIdCodeListQualifier:'SE1',meterPointId:'735999999999999999',
  gridAreaId:'ABC',siteAddress:'TEST',permissionId:'PERMISSION-A',permissionTimestamp:'202609151345',
  permissionEndDate:'202610311430',permissionEndReason:'Z01',startDate:'202609010015',
}
function wire(segments) { return ["UNB+UNOC:3+12345:14+54321:14+260916:1200+I",'UNH+M+PRODAT:D:96A:UN:E2SE6A',...segments,'UNT+1+M','UNZ+1+I'].join("'")+"'" }
for (const [code, variant] of [['Z18','V'],['Z15','V'],['Z14','V']]) {
  test(`${code}${variant}: real renderer and parser agree on permission identity and timestamps`, async () => {
    const a = await api
    const result = a.buildProfiledProdatSegments({ context:{...context,code},variant,mode:'test',generatedAt:new Date('2026-09-16T12:00:00Z') })
    assert(result.segments.includes('RFF+Z09:PERMISSION-A'))
    assert(result.segments.includes('DTM+693:202609151345:203'))
    const parsed = a.parseProdatMessage(wire(result.segments)).lineItems[0]
    assert.equal(parsed.permissionId,'PERMISSION-A')
    assert.equal(parsed.permissionTimestamp,'202609151345')
    if (code !== 'Z14') {
      assert(result.segments.includes('DTM+164:202610311430:203'))
      assert.equal(parsed.permissionEndTimestamp,'202610311430')
      assert.equal(parsed.reportEndDate,null,'DTM164 is not the DTM91 reporting end')
    }
  })
}
test('Z14N does not manufacture permission identity or creation-time from populated context', async () => {
  const a=await api
  const result=a.buildProfiledProdatSegments({context:{...context,code:'Z14'},variant:'N',mode:'test',generatedAt:new Date('2026-09-16T12:00:00Z')})
  assert(!result.segments.some(s=>s.startsWith('RFF+Z09:')||s.startsWith('DTM+693:')))
})
test('Z18 never relabels agreement/fullmakt reference as a permission identity', async () => {
  const a=await api
  const result=a.buildProfiledProdatSegments({context:{...context,code:'Z18',permissionId:null,powerOfAttorneyReference:'AGREEMENT-ONLY'},variant:'V',mode:'test',generatedAt:new Date('2026-09-16T12:00:00Z')})
  assert(!result.segments.some(s=>s.startsWith('RFF+Z09:')))
})
test('parser keeps independent reporting, permission and agreement dates', async () => {
  const a=await api
  const parsed=a.parseProdatMessage(wire(['BGM+Z18+MESSAGE+9+AB','LIN+1++OBJECT:::9','DTM+90:202609010015:203','DTM+91:202609300030:203','DTM+693:202609151345:203','DTM+164:202610311430:203','DTM+92:202608010000:203','DTM+93:202611010000:203','RFF+Z09:PERMISSION-A'])).lineItems[0]
  assert.equal(parsed.reportStartDate,'202609010015');assert.equal(parsed.reportEndDate,'202609300030')
  assert.equal(parsed.permissionTimestamp,'202609151345');assert.equal(parsed.permissionEndTimestamp,'202610311430')
  assert.equal(parsed.contractStartDate,'202608010000');assert.equal(parsed.contractEndDate,'202611010000')
})
for (const wrong of ['RFF+Z07:OBJECT-REFERENCE','RFF+ZPI:NOT-PERMISSION','DTM+265:202609151345:203','DTM+597:202609151345:203']) {
  test(`parser does not promote ${wrong.split(':')[0]} into permission evidence`, async()=>{
    const a=await api
    const line=a.parseProdatMessage(wire(['BGM+Z15+MESSAGE+9+AB','LIN+1++OBJECT:::9',wrong])).lineItems[0]
    assert.equal(line.permissionId,null);assert.equal(line.permissionTimestamp,null)
  })
}
for (const code of ['Z13','Z14']) {
  test(`${code} preserves report minute precision and finite reporting end`, async()=>{
    const a=await api
    const result=a.buildProfiledProdatSegments({context:{...context,code},variant:'V',mode:'test',portalSnapshot:{reportStartDateTime:'202609010015',reportEndDateTime:'202609300030'},generatedAt:new Date('2026-09-16T12:00:00Z')})
    assert(result.segments.includes('DTM+90:202609010015:203'))
    assert(result.segments.includes('DTM+91:202609300030:203'))
  })
}
test('Z14N suppresses reporting dates even with populated portal data', async()=>{
  const a=await api
  const result=a.buildProfiledProdatSegments({context:{...context,code:'Z14'},variant:'N',mode:'test',portalSnapshot:{reportStartDateTime:'202609010015',reportEndDateTime:'202609300030'},generatedAt:new Date('2026-09-16T12:00:00Z')})
  assert(!result.segments.some(s=>s.startsWith('DTM+90:')||s.startsWith('DTM+91:')))
})
