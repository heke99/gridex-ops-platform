// Independent oracle: frozen P26.A r3 projections, §2.2 p21; §2.6 p78.
// A new bounded cell, NOT certification of all remaining D requirements.
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
    export { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine';
    export { PRODAT_SOURCE_SUBTYPE_REQUIREMENTS } from '@/lib/ediel/prodat/prodatSubtypeRequirement';
    export { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
    export { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy';
    export { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
    export { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
  `, { identifier: path.join(root, 'lib/ediel/d-z04-source-test.ts') })
  await entry.link((specifier, parent) => {
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency ${specifier}`)
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), 'Only actual Ediel modules')
    if (!modules.has(file)) modules.set(file, new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip', sourceUrl: file }), { identifier: file }))
    return modules.get(file)
  })
  await entry.evaluate()
  return entry.namespace
}
const api = runtime()
const alphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']]
const line = (seq='1', id='A', register, agency='89') => ['LIN',seq,'',[id,'','',agency],...(register ? [['1',register]] : [])]
const reason = (code='Z70') => [['CCI','','Z13'],['CAV',code]]
const reference = (id='000-CONSUMPTION') => ['RFF',['Z07',id]]
function input(a, body, alphabet) {
  const [component, element, release, end] = alphabet
  const encode = value => [...value].map(c => alphabet.includes(c) ? release+c : c).join('')
  const render = parts => parts.map(v => Array.isArray(v) ? v.map(encode).join(component) : encode(v)).join(element)
  const payload = `UNA${component}${element}.${release} ${end}` + [
    ['UNB',['UNOC','3'],'S','R',['260918','1200'],'I'],
    ['UNH','M',['PRODAT','D','97A','UN','E2SE6A']], ['BGM','Z04','M','9','AB'],
    ...body, ['UNT',String(body.length+3),'M'], ['UNZ','1','I'],
  ].map(render).join(end)+end
  const parsed=a.tokenizeEdifact(payload)
  return {family:'PRODAT',code:'Z04',rawSegments:parsed.segments.map(s=>s.raw),una:parsed.una,mode:'parse'}
}
async function check(body, alphabet=alphabets[0], scope='payload') {
  const a=await api; const wire=input(a,body,alphabet)
  if (scope==='payload') return a.validateProdatSubtypePayload(wire)
  const resolved=a.resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:'L',direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence'})
  const policy={...resolved,fieldRules:a.canonicalProdat26AFieldRules('Z04').filter(r=>r.fieldNumber==='319'),
    prodatDependentConditions:resolved.prodatDependentConditions.map(c=>({...c,status:'not_required'}))}
  return a.validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una,scope})
}
const target = issues => issues.filter(i=>i.fieldPath==='RFF+Z07' && i.blocking && i.scope==='prodat_dependent')
test('independent source projection retains D, exact locator and explicit false branch', async()=>{
  const fields=JSON.parse(fs.readFileSync(path.join(root,'docs/ediel/masterplan-v2/registers/prodat_fields.json'),'utf8'))
  const cells=JSON.parse(fs.readFileSync(path.join(root,'docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json'),'utf8'))
  const original=fields.find(r=>r.field==='319'), cell=cells.find(r=>r.id==='PC-319-Z04')
  assert.equal(original.usage.Z04,'D'); assert.equal(original.locator,'SG16/RFF[1153=Z07]/C506/1154')
  assert.equal(cell.when,'subtype == D'); assert.equal(cell.when_true,'R'); assert.equal(cell.when_false,'X')
  assert(original.segment_table_evidence.some(r=>r.row.join(' ').includes('Högst 25 tecken')))
  const a=await api; assert.equal(a.canonicalProdat26AFieldRules('Z04').find(r=>r.fieldNumber==='319').requirement,'dependent')
})
for (const [subtype,wireReason] of [['D','Z70'],['L','Z22'],['LK','Z23'],['C','Z24'],['H','Z25'],['A','Z26']]) {
  test(`${subtype}/${wireReason}: explicit source outcome, no byCell override`,async()=>{
    const a=await api
    for(const flag of [true,false,null]) {
      const result=a.resolveProdatDependentCondition({messageCode:'Z04',fieldNumber:'319',facts:{canonicalSubtype:subtype,byCell:{'Z04:319':flag}}})
      assert.equal(result.requirement,subtype==='D'?'required':'forbidden')
      assert.match(result.source.section,/s\.21/)
    }
  })
}
for (const bad of [null,'','UNKNOWN','Z70','E','F','N',false,1]) test(`invalid canonical fact ${String(bad)} remains unknown`,async()=>{
  const a=await api
  assert.equal(a.resolveProdatDependentCondition({messageCode:'Z04',fieldNumber:'319',facts:{canonicalSubtype:bad,byCell:{'Z04:319':false}}}).requirement,'undetermined')
})
for (const alphabet of alphabets) for (const scope of ['payload','all','dependent_only']) {
  const suffix=`${alphabet.join('')} ${scope}`
  test(`positive/required/forbidden matrix ${suffix}`,async()=>{
    assert.deepEqual(target(await check([line(),...reason(),reference()],alphabet,scope)),[])
    assert(target(await check([line(),...reason()],alphabet,scope)).length)
    for (const code of ['Z22','Z23','Z24','Z25','Z26']) {
      assert.deepEqual(target(await check([line(),...reason(code)],alphabet,scope)),[])
      assert(target(await check([line(),...reason(code),reference()],alphabet,scope)).length,code)
    }
  })
  test(`missing/alias/duplicate/wrong-code field223 ${suffix}`,async()=>{
    for (const reasons of [[],reason('D'),reason('E64'),[...reason(),...reason()]]) {
      const issues=target(await check([line(),...reasons,reference()],alphabet,scope))
      assert(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'))
    }
  })
  test(`C506/1154 only, length and disallowed extra components ${suffix}`,async()=>{
    assert.deepEqual(target(await check([line(),...reason(),reference('0'.repeat(21)+":+?'" )],alphabet,scope)),[])
    for (const value of ['', '  ', 'x'.repeat(26)]) assert(target(await check([line(),...reason(),reference(value)],alphabet,scope)).length)
    for(const parts of [['Z07','','NOT1154'],['Z07','OK','FORBIDDEN1156'],['Z07','OK','','FORBIDDEN4000'],['Z09','OTHER']])
      assert(target(await check([line(),...reason(),['RFF',parts]],alphabet,scope)).length)
  })
  test(`objects and agency namespaces do not borrow ${suffix}`,async()=>{
    const issues=target(await check([line('1','A',undefined,'9'),...reason(),line('2','A',undefined,'89'),...reason('Z22'),reference()],alphabet,scope))
    assert.equal(issues.length,2); assert(issues.some(i=>i.description.includes('A / 9'))); assert(issues.some(i=>i.description.includes('A / 89')))
  })
  test(`header, party and later-register references are not invisible ${suffix}`,async()=>{
    for(const badBody of [
      [reference(),line(),...reason('Z22')],
      [reference(),line(),...reason(),reference()],
      [line(),...reason(),reference(),['NAD','UD','CUSTOMER'],reference()],
      [line('1','A','1'),...reason('Z22'),line('2','A','2'),reference()],
      [line('1','A','1'),...reason(),reference(),line('2','A','2'),reference()],
    ]) assert(target(await check(badBody,alphabet,scope)).length)
    assert.deepEqual(target(await check([line('1','A','1'),...reason(),reference(),line('2','A','2')],alphabet,scope)),[])
    assert(target(await check([line('1','A','1'),...reason(),line('2','A','2'),...reason(),reference()],alphabet,scope)).length)
  })
}
test('new source row is immutable and unrelated unresolved D cells remain unresolved',async()=>{
  const a=await api; const row=a.PRODAT_SOURCE_SUBTYPE_REQUIREMENTS.find(r=>r.messageCode==='Z04'&&r.fieldNumber==='319')
  assert(row); assert(Object.isFrozen(row)); assert(Object.isFrozen(row.outcomes))
  assert.equal(a.resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'210',facts:{canonicalSubtype:'F'}}).status,'undetermined')
})
