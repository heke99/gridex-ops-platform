// E011 / ENV-04: T24.A rev6 p12 §2.1 and p25 §4.2.
// Synthetic, source-qualified ACK references; no live market or provider calls.
// Run with: node --experimental-vm-modules --test scripts/test-ediel-unb-ack-request.cjs
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
    export { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec';
    export { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat';
    export { buildProdatZ03FromSwitch } from '@/lib/ediel/prodat/compatAdapter';
    export { buildAperakDraft, buildContrlDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack';
    export { getCanonicalAckState, deriveEdielAckDefaults } from '@/lib/ediel/core/ackPolicy';
    export { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade';
    export { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator';
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

// Independent lexical oracle: retain release sequences while counting structure.
function splitWire(value, delimiter, release) {
  const result = []; let current = ''; let escaped = false
  for (const char of value) {
    if (escaped) { current += char; escaped = false; continue }
    if (char === release) { current += char; escaped = true; continue }
    if (char === delimiter) { result.push(current); current = '' } else current += char
  }
  assert.equal(escaped, false, 'wire cannot end with an unmatched release character')
  result.push(current)
  return result
}
function finalWire(raw) {
  assert.equal(typeof raw, 'string'); assert.ok(raw.startsWith("UNA:+.? '"), 'existing canonical output alphabet')
  const segments = splitWire(raw.slice(9), "'", '?').filter(value => value !== '')
  const rows = segments.map(segment => splitWire(segment, '+', '?'))
  const unb = rows.find(row => row[0] === 'UNB')
  const unh = rows.find(row => row[0] === 'UNH')
  const unt = rows.find(row => row[0] === 'UNT')
  const unz = rows.find(row => row[0] === 'UNZ')
  assert.ok(unb && unh && unt && unz)
  assert.equal(Number(unt[1]), rows.indexOf(unt) - rows.indexOf(unh) + 1, 'literal UNT count')
  assert.equal(unt[2], unh[1], 'literal UNH/UNT reference')
  assert.equal(unz[1], '1'); assert.equal(unz[2], unb[5], 'literal UNB/UNZ reference')
  return { unb, rows }
}
const alphabets = [[':', '+', '?', "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']]
function source(family = 'PRODAT', testFlag = 1, alphabet = alphabets[0]) {
  const [component, element, release, terminator] = alphabet
  const escape = text => [...String(text)].map(char => alphabet.includes(char) ? release + char : char).join('')
  const render = row => row.map(value => Array.isArray(value) ? value.map(escape).join(component) : escape(value)).join(element)
  const code = family === 'PRODAT' ? 'Z03' : family === 'UTILTS_ERR' ? 'ERR' : 'E66'
  const app = family === 'PRODAT' ? '23-DDQ-PRODAT' : '23-DDQ-E66-S'
  const rows = family === 'PRODAT' ? [
    ['UNH', 'SOURCE-M', ['PRODAT','D','97A','UN','E2SE6A']], ['BGM',code,'SOURCE-DOC','9','AB'],
    ['DTM',['137','202609201200','203']], ['NAD','FR',['12345','160','SVK']], ['NAD','DO',['54321','160','SVK']],
    ['LIN','1','',['735999888000000017','','','9']], ['RFF',['LI','SOURCE-LI']],
  ] : [
    ['UNH','SOURCE-M',['UTILTS','D','02B','UN','E5SE5A']], ['BGM',code,'SOURCE-DOC','9','AB'],
    ['DTM',['137','202609201200','203']], ['MKS','23',['E02','','260']],
    ['NAD','MS',['12345','','9']], ['NAD','MR',['54321','','9']], ['NAD','DDQ',['54321','','9']],
    ['IDE','24','SOURCE-TX'], ['LOC','172',['735999888000000017','','9']], ['LOC','239',['TES','SVK','260']],
    ['DTM',['324','202609010000202610010000','719']], ['DTM',['354','15','806']], ['STS','7','',['E88','','260']],
    ['MEA','AAZ','','KWH'], ['SEQ','','1'], ['QTY',['136','1']],
  ]
  const raw = `UNA${component}${element}.${release} ${terminator}` + [
    ['UNB',['UNOC','3'],['12345','14'],['54321','14'],['260920','1200'],'SOURCE-I','',app,'','1','',testFlag ? '1' : ''],
    ...rows, ['UNT',String(rows.length + 1),'SOURCE-M'], ['UNZ','1','SOURCE-I'],
  ].map(render).join(terminator) + terminator
  return { id: 'synthetic-source', company_id: 'tenant-A', direction: 'inbound', message_standard: 'edifact',
    message_family: family, message_code: code, environment: testFlag ? 'test' : 'production', test_flag: testFlag,
    sender_ediel_id: '12345', receiver_ediel_id: '54321', sender_sub_address: 'SOURCE', receiver_sub_address: 'RETURN',
    application_reference: app, external_reference: 'SOURCE-DOC', transaction_reference: 'SOURCE-TX',
    interchange_reference: 'SOURCE-I', raw_payload: raw, parsed_payload: {}, created_at: NOW,
    syntax_check_status: 'ok', status: 'received' }
}
function stateRow(draft) {
  return { requires_contrl: draft.requiresContrl, requires_aperak: draft.requiresAperak,
    contrl_status: draft.contrlStatus, aperak_status: draft.aperakStatus,
    utilts_err_status: draft.utiltsErrStatus, ack_due_at: draft.ackDueAt }
}
function assertPending(a, draft, requiresAperak) {
  assert.equal(draft.requiresContrl, true, 'outgoing draft must require CONTRL')
  assert.equal(draft.contrlStatus, 'pending')
  assert.equal(draft.requiresAperak, requiresAperak)
  assert.equal(draft.aperakStatus, requiresAperak ? 'pending' : 'not_required')
  assert.equal(draft.ackDueAt, '2026-09-20T12:30:00.000Z', 'existing 30 minute ACK deadline')
  assert.equal(a.getCanonicalAckState(stateRow(draft)), 'awaiting_contrl')
}
function codecInput(acknowledgementRequest, environment = 'test') {
  return { sender: '12345', receiver: '54321', interchangeReference: 'I', applicationReference: '23-DDQ-PRODAT',
    environment, createdAt: new Date(NOW), acknowledgementRequest,
    messages: [{ messageReference: 'M', messageTypeToken: acknowledgementRequest ? 'PRODAT:D:97A:UN:E2SE6A' : 'CONTRL:2:2:UN:EDIEL2',
      businessSegments: acknowledgementRequest ? ['BGM+Z01+DOC+9+NA'] : ['UCI+SOURCE-I+12345:14+54321:14+7'] }] }
}
for (const environment of ['test','production']) for (const request of [true,false]) {
  test(`codec request=${request} environment=${environment} has independent literal UNB0031 and0035`, async () => {
    const a = await api; const { unb } = finalWire(a.EdifactEnvelopeCodec.encode(codecInput(request, environment)))
    assert.equal(unb[9] || '', request ? '1' : '', 'UNB element9 is ACK request, not test indicator')
    assert.equal(unb[11] || '', environment === 'test' ? '1' : '')
    assert.equal(unb[7], '23-DDQ-PRODAT')
  })
}
for (const bad of [undefined,null,0,1,'1','false',{}]) {
  test(`codec rejects missing/malformed explicit decision ${JSON.stringify(bad)}`, async () => {
    const a = await api
    assert.throws(() => a.EdifactEnvelopeCodec.encode(codecInput(bad)), /edifact_acknowledgement_request_required/)
  })
}
for (const family of ['PRODAT','UTILTS','UTILTS_ERR']) for (const outcome of ['positive','negative']) {
  test(`${family}-origin ${outcome} APERAK requests CONTRL on the actual final wire`, async () => {
    const a = await api, original = source(family), before = JSON.stringify(original)
    assert.equal(a.validateEdifactSyntax(original).ok, true, 'source has a coherent envelope')
    const draft = a.buildAperakDraft({ sourceMessage: original, outcome, applicationErrors: outcome === 'negative'
      ? [{ ercCode:'42', fieldCode:'207', text:'INVALID' }] : null })
    assert.equal(finalWire(draft.rawPayload).unb[9], '1')
    assert.equal(JSON.stringify(original), before)
  })
  test(`${family}-origin ${outcome} APERAK monitoring uses outgoing APERAK not source family`, async () => {
    const a = await api
    assertPending(a, a.buildAperakDraft({ sourceMessage:source(family), outcome, applicationErrors: outcome === 'negative'
      ? [{ ercCode:'42', fieldCode:'207', text:'INVALID' }] : null }), false)
  })
}
for (const flag of [0,1]) for (const ack of ['APERAK','CONTRL','UTILTS_ERR']) {
  test(`${ack} passes source test_flag=${flag} to the actual UNB0035`, async () => {
    const a = await api, s = source(ack === 'UTILTS_ERR' ? 'UTILTS' : 'PRODAT', flag)
    const draft = ack === 'APERAK' ? a.buildAperakDraft({ sourceMessage:s, outcome:'negative' })
      : ack === 'CONTRL' ? a.buildContrlDraft({ sourceMessage:s, outcome:'negative' })
        : a.buildUtiltsErrDraft({ sourceMessage:s, messageText:'E14' })
    assert.equal(draft.testFlag, flag)
    assert.equal(draft.environment, flag ? 'test' : 'production')
    assert.equal(finalWire(draft.rawPayload).unb[11] || '', flag ? '1' : '', 'test flag is independent of ACK outcome')
  })
}
test('UTILTS_ERR has a CONTRL request and canonical persisted CONTRL plus APERAK expectations', async () => {
  const a = await api, s = source('UTILTS'), before = JSON.stringify(s)
  const draft = a.buildUtiltsErrDraft({ sourceMessage:s, messageText:'E14' })
  assert.equal(finalWire(draft.rawPayload).unb[9], '1')
  assertPending(a, draft, true); assert.equal(JSON.stringify(s), before)
})
test('CONTRL opposing control neither requests nor awaits a new ACK', async () => {
  const a = await api, draft = a.buildContrlDraft({ sourceMessage:source() })
  assert.equal(finalWire(draft.rawPayload).unb[9] || '', '')
  assert.equal(draft.requiresContrl, false); assert.equal(draft.requiresAperak, false)
  assert.equal(draft.contrlStatus, 'not_required'); assert.equal(draft.aperakStatus, 'not_required')
  assert.equal(draft.ackDueAt, null); assert.equal(a.getCanonicalAckState(stateRow(draft)), 'no_ack_required')
})
for (const alphabet of alphabets) test(`real P-APERAK consumer preserves request after incoming alphabet ${alphabet.join('')}`, async () => {
  const a = await api, s = source('PRODAT', 1, alphabet), before = JSON.stringify(s)
  const draft = a.buildAperakDraft({ sourceMessage:s })
  assert.equal(finalWire(draft.rawPayload).unb[9], '1')
  assert.equal(finalWire(draft.rawPayload).unb[7], s.application_reference)
  assert.ok(draft.rawPayload.includes('RFF+ACW:SOURCE-DOC'))
  assert.equal(JSON.stringify(s), before)
})
test('caller payload booleans cannot override the outgoing canonical ACK decision', async () => {
  const a = await api, s = source()
  s.parsed_payload = { requiresContrl:false, acknowledgementRequest:false, ackRule:{technicalAck:'none'} }
  s.validation_report = { canonicalPolicy:{ackRule:{technicalAck:'none'}} }
  const draft = a.buildAperakDraft({sourceMessage:s})
  assert.equal(finalWire(draft.rawPayload).unb[9], '1'); assertPending(a,draft,false)
})
test('unsupported family has no manufactured default CONTRL request', async () => {
  const a = await api
  assert.throws(() => a.canonicalAckRequirementsForFamilyCode({family:'NOT_EDIEL',code:'X'}), /ediel_ack_family_unsupported/)
})
test('Z01 retains its application-response exception without suppressing technical CONTRL', async () => {
  const a = await api, result = a.deriveEdielAckDefaults({family:'PRODAT',code:'Z01'})
  assert.equal(result.requiresContrl,true); assert.equal(result.requiresAperak,false)
})
function selections(id, company, user, lines = [], postalCode = '', city = '') {
  const identity = {id:user,qualifier:'',agency:'89'}
  const address = {lines:[lines[0] || '',lines[1] || '',lines[2] || ''],postalCode,city,country:'SE',
    representation:{convention:'independent synthetic postal tuple',reference:'UNB fixture',mode:1}}
  const provenance = {kind:'caller_selection',companyId:company,reference:'UNB fixed synthetic source'}
  return { market:'electricity',
    endUserAddressObjects:[{meteringPointId:id,identityAgency:'9',endUser:identity,availability:lines.length?'available':'unavailable',addressLines:lines,source:provenance}],
    invoiceeObjects:[{meteringPointId:id,identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['Invoicee'],address,availability:lines.length?'available':'unavailable'},event:{state:'none',reference:'no invoice-address change'},source:provenance}] }
}
for (const requestAck of [undefined,false,true]) test(`generic PRODAT alternate serializer ignores BGM requestAck=${requestAck} for technical ACK`, async () => {
  const a = await api, input = {companyId:'test',role:'supplier',businessCode:'Z03',sender:{edielId:'12345'},receiver:{edielId:'54321'},
    meteringPoint:{id:'OBJECT'},customer:{id:'CUSTOMER',idAgency:'89',name:'Customer'},
    dates:{createdAt:NOW,startDate:'2026-10-01'},codedAttributes:{Z13:'Z22'},references:{documentReference:'DOC+1',LI:'CASE'},
    requestAck,environment:'test',dependentConditionFacts:selections('OBJECT','test','CUSTOMER')}
  const built = a.buildProdatMessage(input), wire = finalWire(built.rawEdifact)
  assert.equal(wire.unb[9], '1'); assert.equal(wire.rows.find(row=>row[0]==='BGM')[4], requestAck===false?'NA':'AB')
})
test('actual saved-switch PRODAT draft carries the same request and persisted monitoring', async () => {
  const a = await api, id = '735999888000000017'
  const portalData = {facilityId:id,customerId:'USER',customerIdAgency:'89',powerOfAttorneyReference:'POA',customerName:'Synthetic',
    customerAddress:'Street',customerPostalCode:'12345',customerCity:'Town',customerCountry:'SE',siteAddress:'Street',siteCountry:'SE',
    gridAreaId:'TES',agreementStartDateTime:'202610010000',validityDateTime:'202610010000',reasonForTransaction:'Z22',observationLength:'15',observationLengthFormat:'806',
    registers:[],dependentConditionFacts:selections(id,'company','USER',['Street'],'12345','Town'),meteringMethod:'Z03',reportingFrequency:'D',
    meterNumber:'NEW',oldMeterNumber:'OLD',productCode:'8716867000030',settlementMethod:'D',installationStatus:'E22',balanceResponsibleId:'12345'}
  const input = {actorUserId:'actor',senderEdielId:'12345',receiverEdielId:'54321',senderSubAddress:'DDQ',receiverSubAddress:'DDQ',applicationReference:'23-DDQ-PRODAT',environment:'test',
    switchRequest:{id:'switch',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'meter',grid_owner_id:'owner',requested_start_date:'2026-10-01',request_type:'supplier_switch',status:'draft',current_supplier_name:'Existing',power_of_attorney_id:'poa',validation_snapshot:{portalData}},
    site:{id:'site',company_id:'company',customer_id:'customer',facility_id:id,grid_owner_id:'owner',move_in_date:'2026-10-01',street:'Street',postal_code:'12345',city:'Town'},
    meteringPoint:{id:'meter',company_id:'company',site_id:'site',customer_id:'customer',meter_point_id:id,grid_owner_id:'owner'},gridOwner:{id:'owner',ediel_id:'54321',owner_code:'TES'}}
  const before = JSON.stringify(input), draft = await a.buildProdatZ03FromSwitch(input)
  assert.equal(finalWire(draft.rawPayload).unb[9], '1')
  assertPending(a,draft,true); assert.equal(JSON.stringify(input),before)
  assert.equal(draft.customerId,'customer'); assert.equal(draft.siteId,'site'); assert.equal(draft.switchRequestId,'switch')
})
test('all exercised consumers kept provider, database and transport boundaries closed', async () => {
  assert.deepEqual((await api).effects, [])
})
