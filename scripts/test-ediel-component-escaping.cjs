// ISO 9735 / UNECE syntax: a released service character is literal data at
// every subsequent parsing level. Tests run real source modules, no DB/network.
// node --experimental-vm-modules --test scripts/test-ediel-component-escaping.cjs
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
    export { parseCanonicalEdifactAst, canonicalComposite, canonicalMessageFacts } from '@/lib/ediel/core/canonicalEdifactAst';
    export { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer';
    export { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec';
    export { parseUnh } from '@/lib/ediel/core/unh';
  `, { identifier: path.join(root, 'lib/ediel/escaping-test.ts') })
  await entry.link((specifier, parent) => {
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'))
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts','/index.ts'].map(suffix=>base+suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root,'lib/ediel/')))
    if(!modules.has(file)) modules.set(file,new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'strip',sourceUrl:file}),{identifier:file}))
    return modules.get(file)
  })
  await entry.evaluate()
  return entry.namespace
}
const api = runtime()
// A test-only wire serializer independent of the application encoder. Preserve
// the expected component arrays so structural equality, not just no-crash, is checked.
const advice = [
  { component: ':', element: '+', decimal: '.', release: '?', end: "'", name: 'default' },
  { component: '^', element: '*', decimal: ',', release: '!', end: '~', name: 'custom' },
  { component: '|', element: ';', decimal: '.', release: '?', end: '~', name: 'alternate' },
]
function fixture(a, components) {
  const escaped = s => [...s].map(ch => [a.component,a.element,a.release,a.end].includes(ch) ? a.release+ch : ch).join('')
  const segment = (tag, fields) => [tag,...fields.map(field => (Array.isArray(field) ? field : [field]).map(escaped).join(a.component))].join(a.element)
  const sender = ['12345','','OPS'+a.component+'MAIN'+a.release]
  const receiver = ['54321','14','RECEIVE'+a.end+'BOX']
  const unh = ['PRODAT','D','96A','UN','E2SE6A'+a.component+'LITERAL']
  const segments = [
    segment('UNB',[['UNOC','3'],sender,receiver,['260916','1200'],'I'+a.release,'','PRODAT']),
    segment('UNH',['M'+a.release,unh]),
    segment('BGM',['Z14','DOC'+a.element+'REF','9']),
    segment('LIN',['1','',['OBJECT'+a.component+'ID','','','9']]),
    segment('FTX',['AAI','','',components]),
    segment('RFF',[['Z09','PERMISSION'+a.component+'A'+a.release]]),
    segment('UNT',['6','M'+a.release]), segment('UNZ',['1','I'+a.release]),
  ]
  return { wire:'UNA'+a.component+a.element+a.decimal+a.release+' '+a.end+segments.join(a.end)+a.end, sender,receiver,unh,segments }
}
for (const a of advice) {
  const samples = [
    ['plain','','last',''],
    ['with'+a.component+'separator','','second'],
    ['with'+a.element+'separator','next'],
    ['with'+a.end+'terminator','next'],
    ['with'+a.release+'release','next'],
    ['ends-with'+a.release,'next'],
    [a.release+a.release,a.component+a.element+a.end+a.release,''],
    ['prefix'+a.component+'S18','','suffix'],
    ['leading','',a.release+a.component,'','trailing',''],
  ]
  for (const [index, expected] of samples.entries()) {
    test(`${a.name}: composite ${index} retains released characters and empty positions`,async()=>{
      const r=await api, f=fixture(a,expected), ast=r.parseCanonicalEdifactAst(f.wire)
      assert.equal(ast.segments.length,8)
      const ftx=ast.segments.find(s=>s.tag==='FTX')
      assert.deepEqual(r.canonicalComposite(ftx,4,ast.una),expected)
      assert.equal(ast.messages[0].lineGroups[0].itemId,'OBJECT'+a.component+'ID')
      assert.deepEqual(ast.messages[0].lineGroups[0].references.Z09,['PERMISSION'+a.component+'A'+a.release])
      assert.equal(ast.interchangeReference,'I'+a.release)
      assert.equal(ast.messages[0].documentReference,'DOC'+a.element+'REF')
    })
  }
  test(`${a.name}: decoded envelope never reinterprets released address characters`,async()=>{
    const r=await api,f=fixture(a,['NORMAL']), decoded=r.EdifactEnvelopeCodec.decode(f.wire)
    assert.equal(decoded.sender,f.sender[0]);assert.equal(decoded.senderQualifier,null)
    assert.equal(decoded.senderSubAddress,f.sender[2]);assert.equal(decoded.receiverSubAddress,f.receiver[2])
    assert.equal(decoded.date,'260916');assert.equal(decoded.time,'1200')
    assert.equal(decoded.interchangeReference,'I'+a.release)
  })
  test(`${a.name}: UNH profile components never split on a released separator`,async()=>{
    const r=await api,f=fixture(a,['NORMAL']), tokens=r.tokenizeEdifact(f.wire)
    const unh=r.parseUnh(tokens.segments.find(s=>s.tag==='UNH'),tokens.una)
    assert.equal(unh.associationAssignedCode,f.unh[4])
    assert.equal(unh.messageReference,'M'+a.release)
  })
  test(`${a.name}: a released separator cannot manufacture scalar control token S18`,async()=>{
    const r=await api,f=fixture(a,['PREFIX'+a.component+'S18'])
    const facts=r.canonicalMessageFacts(f.wire)
    assert(!facts.scalarTokens.has('S18'))
    assert(facts.scalarTokens.has('PREFIX'+a.component+'S18'))
  })
}
test('legacy tokenized segment shape and decoded element behavior remain unchanged',async()=>{
  const r=await api,token=r.tokenizeEdifact("FTX+AAI+++A?:B??:C?+D'").segments[0]
  assert.deepEqual(token,{index:0,tag:'FTX',raw:'FTX+AAI+++A?:B??:C?+D',elements:['FTX','AAI','','','A:B?:C+D']})
})
test('dangling wire release still rejects instead of silently discarding data',async()=>{
  const r=await api
  assert.throws(()=>r.tokenizeEdifact('FTX+AAI+++BROKEN?'),/edifact_dangling_release_character/)
})

for (const a of advice) {
  test(`${a.name}: exhaustive pairs of service characters preserve all component boundaries`, async()=>{
    const r=await api, alphabet=['A','',a.component,a.element,a.release,a.end]
    for (const first of alphabet) for (const second of alphabet) for (const third of alphabet) {
      const expected=[first+second+third,'',third+first,second,'']
      const f=fixture(a,expected),ast=r.parseCanonicalEdifactAst(f.wire)
      assert.deepEqual(r.canonicalComposite(ast.segments.find(s=>s.tag==='FTX'),4,ast.una),expected)
    }
  })
}
