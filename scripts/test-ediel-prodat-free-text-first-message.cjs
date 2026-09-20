// PR359 review5753067624: real first-PRODAT selection regression.
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
    export { prodatFreeTextSendIssues, readProdatFreeText } from '@/lib/ediel/prodat/prodatFreeText';
    export { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer';
    export { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards';
    export { assertEdielSendLock } from '@/lib/ediel/transport/sendLock';
    export { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight';
    export { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator';
  `, { context, identifier: path.join(root, 'lib/ediel/ftx-first-message-test.ts') })
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


// Literal message framing is independent of production selection. Each UNH has
// its own UNT count/reference, within exactly one UNA/UNB/UNZ interchange.
const alphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']]
function interchange(alphabet, lengths, withProdat = true) {
  const [component, element, release, terminator] = alphabet
  const escape = value => [...String(value)].map(char => alphabet.includes(char) ? release + char : char).join('')
  const render = row => row.map(value => Array.isArray(value) ? value.map(escape).join(component) : escape(value)).join(element)
  const ack = [
    ['UNH','A',['APERAK','D','96A','UN','E2SE6A']], ['BGM','11','ACK','9'],
    ['DTM',['137','202609201200','203']], ['RFF',['ACW','ORIGINAL']], ['ERC','100'],
  ]
  const messages = [ack]
  if (withProdat) lengths.forEach((length,index) => messages.push([
    ['UNH',`P${index}`,['PRODAT','D','97A','UN','E2SE6A']], ['BGM','Z01',`D${index}`,'9','AB'],
    ['DTM',['137','202609201200','203']], ['FTX','AAI','','',[`HEADER-${index}`]],
    ['NAD','FR',['12345','160','SVK']], ['NAD','DO',['54321','160','SVK']],
    ['LIN','1','',['735123456789012345','','','9']], ['FTX','ACB','','',['X'.repeat(length)]],
  ]))
  const rows = [
    ['UNB',['UNOC','3'],['12345','14'],['54321','14'],['260920','1200'],'I','', '23-DDQ-PRODAT','','1','','1'],
    ...messages.flatMap(message => [...message,['UNT',String(message.length+1),message[0][1]]]), ['UNZ',String(messages.length),'I'],
  ]
  return `UNA${component}${element}.${release} ${terminator}`+rows.map(render).join(terminator)+terminator
}
function message(raw) {
  return { raw_payload:raw, company_id:'synthetic-company', direction:'outbound', environment:'test',
    message_family:'APERAK', message_code:'ERR', message_standard:'edifact', parsed_payload:{rulebookAllowInvalidSend:true} }
}
for (const alphabet of alphabets) {
  test(`literal multi-message frame ${alphabet.join('')}`,async()=>{
    const a=await api,t=a.tokenizeEdifact(interchange(alphabet,[71]))
    assert.equal(t.segments.filter(s=>s.tag==='UNH').length,2)
    let start=-1
    for (let i=0;i<t.segments.length;i++) {
      const token=t.segments[i]
      if(token.tag==='UNH')start=i
      if(token.tag==='UNT'){
        assert.equal(Number(a.segmentComposite(token,1,t.una)[0]),i-start+1)
        assert.equal(a.segmentComposite(token,2,t.una)[0],a.segmentComposite(t.segments[start],1,t.una)[0])
      }
    }
    assert.equal(a.segmentComposite(t.segments.at(-1),1,t.una)[0],'2')
  })
  test(`reader selects first PRODAT after APERAK without later text borrowing ${alphabet.join('')}`,async()=>{
    const a=await api,raw=interchange(alphabet,[70,71]),t=a.tokenizeEdifact(raw)
    const found=a.readProdatFreeText(t.segments,t.una,'Z01')
    assert.equal(found.length,2)
    assert.deepEqual(Array.from(found,e=>e.field),['301','303'])
    assert.equal(found[0].values[0],'HEADER-0')
    assert.equal(found[1].values[0],'X'.repeat(70))
    assert.equal(found.every(e=>e.malformed.length===0),true)
    assert.equal(a.prodatFreeTextSendIssues(message(raw)).length,0,'later PRODAT is not first-message FTX authority')
  })
  test(`first PRODAT malformed text is held despite leading APERAK ${alphabet.join('')}`,async()=>{
    const a=await api,raw=interchange(alphabet,[71,70]),s=message(raw),before=JSON.stringify(s)
    assert.ok(a.prodatFreeTextSendIssues(s).some(i=>i.code==='PRODAT_FTX_SEND_CONFORMANCE'))
    assert.equal(JSON.stringify(s),before)
  })
  for (const boundary of ['rulebook','lock','preflight','registry']) test(`leading non-PRODAT actual ${boundary} retains local FTX hold ${alphabet.join('')}`,async()=>{
    const a=await api,s=message(interchange(alphabet,[71]))
    if(boundary==='preflight'){
      const result=a.preflightEdielMessageRow(s,'send')
      assert.ok(result.issues.some(i=>i.code==='PRODAT_FTX_SEND_CONFORMANCE'),JSON.stringify(result.issues))
    } else if(boundary==='registry') {
      const result=await a.validateRulebookMessageWithRegistry({family:'APERAK',code:'ERR',direction:'outbound',mode:'send',rawPayload:s.raw_payload,parsedPayload:s.parsed_payload})
      assert.ok(result.issues.some(i=>i.code==='PRODAT_FTX_SEND_CONFORMANCE'),JSON.stringify(result.issues))
    } else assert.throws(()=>boundary==='lock'?a.assertEdielSendLock(s):a.assertRulebookAllowsSend(s),/PRODAT_FTX_SEND_CONFORMANCE/)
  })
  test(`no PRODAT cannot borrow stale row label ${alphabet.join('')}`,async()=>{
    const a=await api,s={...message(interchange(alphabet,[],false)),message_family:'PRODAT',message_code:'Z13'}
    assert.equal(a.prodatFreeTextSendIssues(s).length,0)
  })
}
test('review cases never reach external operations',async()=>assert.deepEqual((await api).effects,[]))
