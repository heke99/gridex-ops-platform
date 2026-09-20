// F3C-02: original PRODAT26.A r3 pp16/18/44/53,115/119–121.
// Synthetic, source-qualified ACK references; no live market or provider calls.
// Run with: node --experimental-vm-modules --test scripts/test-ediel-prodat-free-text.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { createContext, SourceTextModule, SyntheticModule } = require('node:vm')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const NOW = '2026-09-20T12:00:00.000Z'

async function loadRuntime() {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])) }
    static now() { return Date.parse(NOW) }
  }
  const effects = []
  const deny = name => () => { effects.push(name); throw new Error(`Unexpected external operation: ${name}`) }
  const context = createContext({ Date: FixedDate, console, Buffer, URL, TextEncoder, TextDecoder, structuredClone,
    process: { env: { NODE_ENV: 'test' } }, fetch: deny('fetch') })
  const synthetic = (exports) => new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context })
  const boundaries = new Map([
    ['@/lib/supabase/service', synthetic({ supabaseService: { from: deny('db'), rpc: deny('rpc') } })],
    ['@/lib/customers/canonicalOnboarding', synthetic({ canonicalIdempotencyKey: deny('idempotency'), onboardCustomerGraph: deny('onboarding') })],
    ['@/lib/tenant/context', synthetic({ createTenantContext: deny('tenant-context') })],
    ['@/lib/supabase/tenantDb', synthetic({ tenantDb: deny('tenant-db') })],
  ])
  const crypto = synthetic({ randomUUID: require('node:crypto').randomUUID, createHash: require('node:crypto').createHash })
  const modules = new Map()
  const entry = new SourceTextModule(`
    export { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
    export { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix';
    export { fieldRulePresent } from '@/lib/ediel/rulebook/fieldMatrix';
    export { validateRulebookMessage } from '@/lib/ediel/rulebook/validator';
    export { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision';
    export { buildAperakDraft } from '@/lib/ediel/ack';
    export { preflightEdielPayload, preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
    export { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards';
    export { assertEdielSendLock } from '@/lib/ediel/transport/sendLock';
    export { parseProdatMessage } from '@/lib/ediel/prodat/parser';
    export { renderProdatRegisterObject } from '@/lib/ediel/prodat/render/registers';
    export { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat';
  `, { context, identifier: path.join(root, 'lib/ediel/unb-request-test.ts') })
  await entry.link((name, parent) => {
    if (boundaries.has(name)) return boundaries.get(name)
    if (name === 'crypto' || name === 'node:crypto') return crypto
    assert(name.startsWith('@/lib/ediel/') || name.startsWith('.'), `Unexpected dependency: ${name}`)
    const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(parent.identifier), name)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), `Not a real Ediel source: ${name}`)
    if (!modules.has(file)) modules.set(file, new SourceTextModule(
      stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip', sourceUrl: file }),
      { context, identifier: file }))
    return modules.get(file)
  })
  await entry.evaluate()
  return { ...entry.namespace, effects }
}
const api = loadRuntime()

// Independent synthetic wire data. Expected FTX semantics are literal source rules,
// never inferred from production descriptors or the reader under test.
const alphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']]
const lin = (seq='1', id='735123456789012345', reg, agency='9') =>
  ['LIN',seq,'',[id,'','',agency],...(reg ? [['1',reg]] : [])]
const cc = (qualifier, value, pos=0) => [['CCI','',qualifier],['CAV',[...Array(pos).fill(''),value]]]
const ftx = (qualifier='ACB', values=['NOTE']) => ['FTX',qualifier,'','',values]
const head = () => [['NAD','FR',['12345','160','SVK'],'','','','','','','SE'],
  ['NAD','DO',['54321','160','SVK'],'','','','','','','SE']]
function body(code='Z01') {
  if (code === 'Z01') return [lin(),['DTM',['92','202610010000','203']],...cc('Z13','Z22'),
    ['RFF',['Z05','NET']],['RFF',['ANJ','AGREEMENT']],['RFF',['LI','CASE']],
    ['NAD','UD',['001','','89'],'','Synthetic','Street','City','','12345','SE']]
  if (code === 'Z13' || code === 'Z14') return [code === 'Z13' ? ['LIN','1'] : lin(),
    ['DTM',['90','202610010000','203']],...(code === 'Z14' ? [['DTM',['354','15','806']],['DTM',['693','202609171200','203']]] : []),
    ...cc('Z04',code === 'Z13' ? 'Z03' : 'Z04'),...cc('Z22','E19'),...cc('Z12','D',3),...cc('Z24','B72'),
    ...cc('Z13','S17'),...cc('Z14','8716867000030',4),...(code === 'Z14' ? cc('Z23','A74') : []),
    ...(code === 'Z14' ? [['RFF',['Z05','NET']],['RFF',['Z09','PERMISSION']]] : []),
    ['RFF',['LI','CASE']],...(code === 'Z13' ? [['RFF',['ANJ','AGREEMENT']]] : []),
    ...(code === 'Z14' ? [['NAD','IT',['735123456789012345','','9'],'','','Street','City','','12345','SE']] : []),
    ['NAD','UD',['001','','89'],'','Synthetic','','','','','SE']]
  return [lin(),['DTM',['693','202609171200','203']],['DTM',['164','202610010000','203']],...cc('Z13',code === 'Z15' ? 'Z24' : 'S17'),
    ...(code === 'Z15' ? cc('Z23','A74') : []),...cc('Z25','E37'),
    ['RFF',['Z05','NET']],['RFF',['LI','CASE']],['RFF',['Z09','PERMISSION']],
    ['NAD','UD',['001','','89'],'','Synthetic','','','','','SE']]
}
function wire(code='Z01', object=body(code), header=[], alphabet=alphabets[0]) {
  const [component,element,release,terminator] = alphabet
  const esc = text => [...String(text)].map(ch => alphabet.includes(ch) ? release + ch : ch).join('')
  const render = row => row.map(value => Array.isArray(value) ? value.map(esc).join(component) : esc(value)).join(element)
  const app = ['Z13','Z14','Z15','Z18'].includes(code) ? '23-DGI-PRODAT' : '23-DDQ-PRODAT'
  const rows = [['UNH','M',['PRODAT','D','97A','UN','E2SE6A']],['BGM',code,'D','9','AB'],
    ['DTM',['137','202609171200','203']],['DTM',['ZZZ','1','805']],...header,...head(),...object]
  return `UNA${component}${element}.${release} ${terminator}` + [
    ['UNB',['UNOC','3'],['12345','14'],['54321','14'],['260917','1200'],'I','',app,'','1','','1'],
    ...rows,['UNT',String(rows.length+1),'M'],['UNZ','1','I']].map(render).join(terminator)+terminator
}
function row(raw, code='Z01', direction='inbound') {return { id:'00000000-0000-4000-8000-000000000001',
  company_id:'synthetic-company', direction, message_standard:'edifact', message_family:'PRODAT', message_code:code,
  environment:'test', test_flag:1, sender_ediel_id:'12345', receiver_ediel_id:'54321',
  application_reference:['Z13','Z14','Z15','Z18'].includes(code) ? '23-DGI-PRODAT' : '23-DDQ-PRODAT',
  raw_payload:raw, parsed_payload:{}, validation_report:{}, created_at:NOW}}
function present(a,field,raw,code='Z01') {
  const t = a.tokenizeEdifact(raw), rule = a.canonicalProdat26AFieldRules(code).find(r => r.fieldNumber === field)
  return a.fieldRulePresent(rule,{family:'PRODAT',code,rawSegments:t.segments.map(s=>s.raw),una:t.una,mode:'parse'})
}
function withEvidence(a,s) {
  const t=a.tokenizeEdifact(s.raw_payload)
  const facts={market:'electricity',endUserAddressObjects:[{meteringPointId:'735123456789012345',identityAgency:'9',
    endUser:{id:'001',qualifier:'',agency:'89'},availability:'available',addressLines:['Street'],
    source:{kind:'caller_selection',companyId:'synthetic-company',reference:'independent synthetic address selection'}}]}
  return {...s,parsed_payload:{prodatEngine:{registerEvidence:a.createProdatRegisterEvidence({code:'Z01',rawSegments:t.segments.map(s=>s.raw),una:t.una,facts})}}}
}
function issues(decision) {return JSON.stringify(decision.issues.map(i=>({code:i.code,description:i.description}))) }
for (const code of ['Z01','Z13','Z14','Z15','Z18']) test(`setup: source-valid text-free ${code} actual runtime`,async()=>{
  const a=await api,d=a.resolveCanonicalRuntimeDecision(row(wire(code),code))
  assert.equal(d.syntaxDecision,'accepted',issues(d)); assert.equal(d.applicationDecision,'accepted',issues(d))
})
for (const alphabet of alphabets) {
  for (const [name,h,o,headerPresent,objectPresent] of [
    ['none',[],[],false,false],
    ['header AAI',[ftx('AAI')],[],true,false],
    ['object ACB',[],[ftx()],false,true],
    ['both',[ftx('AAI')],[ftx()],true,true],
    ['wrong header ACB',[ftx()],[],false,false],
    ['wrong object AAI',[],[ftx('AAI')],false,false],
    ['unknown header AAO',[ftx('AAO')],[],false,false],
    ['unknown object AAZ',[],[ftx('AAZ')],false,false],
  ]) test(`qualified presence ${name} ${alphabet.join('')}`,async()=>{
    const a=await api, b=body(), raw=wire('Z01',[...b.slice(0,2),...o,...b.slice(2)],h,alphabet)
    assert.equal(present(a,'301',raw),headerPresent,'header301 must only use its own AAI')
    assert.equal(present(a,'303',raw),objectPresent,'object303 must only use its own ACB')
  })
  for (const code of ['Z13','Z14','Z15','Z18']) for (const values of [['NOTE'],[''],['','OTHER'],['X'.repeat(71)],['A','B','C','D','E','F']]) {
    test(`unused incoming303 ${code} ${JSON.stringify(values).slice(0,25)} ${alphabet.join('')} keeps real positive APERAK`,async()=>{
      const a=await api,b=body(code),s=row(wire(code,[...b.slice(0,1),ftx('ACB',values),...b.slice(1)],[],alphabet),code)
      const before=JSON.stringify(s),d=a.resolveCanonicalRuntimeDecision(s)
      const plan=d.responsePlan.find(p=>p.family==='APERAK'); assert.ok(plan,issues(d))
      // Build the actual planned reply before checking its decision; this is not a helper-only assertion.
      const ack=a.buildAperakDraft({sourceMessage:s,outcome:plan.outcome,applicationErrors:plan.applicationErrors})
      assert.ok(ack.rawPayload.includes('ERC+100'),JSON.stringify({wire:ack.rawPayload,issues:d.issues}))
      assert.equal(d.applicationDecision,'accepted',issues(d))
      assert.notEqual(d.prodatProcessingDisposition?.kind,'internal_review',issues(d))
      assert.equal(JSON.stringify(s),before,'incoming evidence remains byte-identical')
    })
  }
  test(`incoming303 cannot hide unrelated required322 ${alphabet.join('')}`,async()=>{
    const a=await api,b=body('Z14').filter((r,i,rows)=>!(r[0]==='CCI'&&r[2]==='Z23')&&!(r[0]==='CAV'&&rows[i-1]?.[2]==='Z23'))
    const s=row(wire('Z14',[...b.slice(0,1),ftx(),...b.slice(1)],[],alphabet),'Z14'), d=a.resolveCanonicalRuntimeDecision(s)
    const plan=d.responsePlan.find(p=>p.family==='APERAK'&&p.outcome==='negative');assert.ok(plan,issues(d))
    const ack=a.buildAperakDraft({sourceMessage:s,outcome:plan.outcome,applicationErrors:plan.applicationErrors})
    assert.ok(ack.rawPayload.includes('ERC+41')&&ack.rawPayload.includes('FTX+AAO++322::260'),ack.rawPayload)
    assert.ok(!plan.applicationErrors?.some(e=>e.fieldCode==='303'),'ignored303 must not pollute another national error')
  })
}
for (const values of [['A'],['A','','C'],['A','B','C','D','E'],["A:+?'".repeat(14)]]) {
  test(`outbound source-valid optional text ${JSON.stringify(values).slice(0,35)}`,async()=>{
    const a=await api,b=body(),s=row(wire('Z01',[...b.slice(0,2),ftx('ACB',values),...b.slice(2)],[ftx('AAI',values)]),'Z01','outbound'); const ready=withEvidence(a,s)
    const p=a.preflightEdielMessageRow(ready,'send');assert.equal(p.ok,true,JSON.stringify(p.issues))
    assert.doesNotThrow(()=>a.assertRulebookAllowsSend(ready));assert.doesNotThrow(()=>a.assertEdielSendLock(ready))
  })
}
const badTexts = [
  ['empty first',ftx('ACB',[])],['empty leading',ftx('ACB',['','B'])],
  ['six components',ftx('ACB',['A','B','C','D','E','F'])],['71 decoded chars',ftx('ACB',[':'.repeat(71)])],
  ['unknown qualifier',ftx('XYZ')],['header qualifier in object',ftx('AAI')],
  ['coded-text slot',['FTX','ACB','',['CODE'],['NOTE']]],['language slot',['FTX','ACB','','',['NOTE'],'SE']],
]
for (const [name,part] of badTexts) for (const mode of ['normal','intentional-invalid','stale-metadata','metadata-error']) for(const boundary of ['preflight','rulebook','lock']) {
  test(`outbound actual preflight/send guards block ${name} ${mode} ${boundary}`,async()=>{
    const a=await api,b=body(),s=withEvidence(a,row(wire('Z01',[...b.slice(0,2),part,...b.slice(2)]),'Z01','outbound'))
    if(mode==='intentional-invalid')s.parsed_payload={...s.parsed_payload,rulebookAllowInvalidSend:true,intentionalInvalid:true}
    if(mode==='stale-metadata')s.parsed_payload={...s.parsed_payload,code:'Z14',family:'APERAK',rawSegments:['FTX+AAI+++GOOD']}
    if(mode==='metadata-error')s.parsed_payload={prodatEngine:{registerEvidence:{invalid:true}}}
    if(boundary==='preflight'){
      const p=a.preflightEdielMessageRow(s,'send')
      assert.equal(p.ok,false,`malformed optional text escaped preflight: ${name}`)
      assert.ok(p.issues.some(i=>i.code.startsWith('PRODAT_FTX_')&&i.severity==='error'),JSON.stringify(p.issues))
    } else assert.throws(()=>boundary==='rulebook'?a.assertRulebookAllowsSend(s):a.assertEdielSendLock(s),/PRODAT_FTX_/)
  })
}
for(const alphabet of alphabets)test(`parser raw preservation and isolated common first-register scope ${alphabet.join('')}`,async()=>{
  const a=await api,raw=wire('Z04',[lin('1','OBJECT-A','1','89'),ftx('ACB',['FIRST:+?\'']),lin('2','OBJECT-A','2','89'),ftx('ACB',['LATER']),lin('3','OBJECT-B',undefined,'89'),ftx('ACB',['OTHER'])],[ftx('AAI',['HEADER'])],alphabet)
  const p=a.parseProdatMessage(raw);assert.equal(p.rawPayload,raw)
  assert.equal(p.lineItems.length,3);const t=a.tokenizeEdifact(raw)
  const texts=t.segments.filter(s=>s.tag==='FTX')
  for(let i=0;i<3;i++)assert.ok(p.lineItems[i].rawSegments.includes(texts[i+1].raw))
  assert.equal(present(a,'301',raw,'Z04'),true);assert.equal(present(a,'303',raw,'Z04'),true)
  const noFirst=wire('Z04',[lin('1','OBJECT-A','1','89'),lin('2','OBJECT-A','2','89'),ftx(),lin('3','OBJECT-B',undefined,'89'),ftx()],[],alphabet)
  assert.equal(present(a,'303',noFirst,'Z04'),false,'later or other object cannot supply the first register text')
})
test('real register renderer keeps supplied common text only on its first register',async()=>{
  const a=await api,text="FTX+ACB+++FIRST?:?+??'",out=a.renderProdatRegisterObject({code:'Z04',segments:['LIN+1++OBJECT:::89',text],registers:[{annualConsumption:'1'},{annualConsumption:'2'}]})
  assert.equal(out.segments.filter(x=>x===text).length,1)
  assert.ok(out.segments.indexOf(text)<out.segments.findIndex(x=>x.startsWith('LIN+2')))
})
test('all actual paths stayed inside synthetic external boundaries',async()=>assert.deepEqual((await api).effects,[]))

for(const [name,parts] of [
  ['other object',[lin('1','OBJECT-A',undefined,'89'),lin('2','OBJECT-B',undefined,'89'),ftx()]],
  ['other agency',[lin('1','OBJECT-A',undefined,'89'),lin('2','OBJECT-A',undefined,'9'),ftx()]],
  ['invalid chain',[lin('1','OBJECT-A','2','89'),lin('2','OBJECT-A','1','89'),ftx()]],
]) test(`303 does not borrow ${name}`,async()=>assert.equal(present(await api,'303',wire('Z04',parts),'Z04'),false))
test('second message does not supply missing header301',async()=>{
 const a=await api,raw=wire('Z01')+wire('Z01',body(),[ftx('AAI',['OTHER MESSAGE'])])
 assert.equal(present(a,'301',raw),false)
})
for(const field of ['301','303'])test(`${field} rejects empty literal as field value but optional absence is not required`,async()=>{
 const a=await api,b=body(),raw=wire('Z01',[...b.slice(0,2),...(field==='303'?[ftx('ACB',[])]:[]),...b.slice(2)],field==='301'?[ftx('AAI',[])]:[])
 assert.equal(present(a,field,raw),false)
})
