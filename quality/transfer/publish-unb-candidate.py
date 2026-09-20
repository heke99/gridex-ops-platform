from pathlib import Path
R=Path.cwd()
def replace(p,a,b,n=1):
 q=R/p;s=q.read_text();assert s.count(a)==n,(p,s.count(a),a);q.write_text(s.replace(a,b))
replace('lib/ediel/core/edifactEnvelopeCodec.ts','  applicationReference?: string | null\n  environment:', '  applicationReference?: string | null\n  /** Technical ACK decision supplied by the canonical policy owner, not BGM/AB. */\n  acknowledgementRequest: boolean\n  environment:')
replace('lib/ediel/core/edifactEnvelopeCodec.ts',"  elements[UNB.APPLICATION_REFERENCE] = trimOrNull(input.applicationReference) ?? ''", "  elements[UNB.APPLICATION_REFERENCE] = trimOrNull(input.applicationReference) ?? ''\n  elements[UNB.ACK_REQUEST] = input.acknowledgementRequest ? '1' : ''")
replace('lib/ediel/core/edifactEnvelopeCodec.ts',"    if (input.messages.length === 0) throw new Error('edifact_at_least_one_message_required')", "    if (input.messages.length === 0) throw new Error('edifact_at_least_one_message_required')\n    if (typeof input.acknowledgementRequest !== 'boolean') {\n      throw new Error('edifact_acknowledgement_request_required')\n    }")
for p in ['lib/ediel/messages.ts','lib/ediel/core/edifactSerializer.ts','lib/ediel/core/unb.ts']:
 replace(p,'  applicationReference?: string | null','  applicationReference?: string | null\n  acknowledgementRequest: boolean')
 replace(p,'    applicationReference: input.applicationReference,','    applicationReference: input.applicationReference,\n    acknowledgementRequest: input.acknowledgementRequest,')
replace('lib/ediel/prodat/buildProdat.ts',"import { generateEdielInterchangeReference }", "import { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'\nimport { generateEdielInterchangeReference }")
replace('lib/ediel/prodat/buildProdat.ts','  const rawEdifact = serializeEdifact({',"  const ack = canonicalAckRequirementsForFamilyCode({ family: 'PRODAT', code: businessCode })\n  const rawEdifact = serializeEdifact({\n    acknowledgementRequest: ack.requiresContrl,")
# Move each existing canonical decision before the envelope and pass that same value.
for p,ack,indent in [
 ('lib/ediel/prodat/compatAdapter.ts',"    const ack = deriveEdielAckDefaults({\n      family: 'PRODAT',\n      code,\n    })\n",'    '),
 ('lib/ediel/utilts.ts',"  const ack = deriveEdielAckDefaults({\n    family: 'UTILTS',\n    code: input.code,\n  })\n",'  '),
 ('lib/ediel/intent/renderers/facilityLookupZ01.ts',"  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })\n",'  '),
 ('lib/ediel/intent/renderers/customerMasterdataZ01.ts',"  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })\n",'  '),
 ('lib/ediel/flows/prodatCustomerMasterdata.ts','    const ack = deriveEdielAckDefaults({ family: "PRODAT", code: "Z01" });\n','    '),
 ('lib/ediel/testing/agtEngine.ts',"  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code })\n",'  '),
]:
 q=R/p;s=q.read_text();start=s.index(indent+'const envelope = buildEdifactEnvelope({');idx=s.index(ack,start);s=s[:idx]+s[idx+len(ack):];s=s[:start]+ack+'\n'+s[start:];needle=indent+'const envelope = buildEdifactEnvelope({';assert s.count(needle)==1;s=s.replace(needle,needle+'\n'+indent+'  acknowledgementRequest: ack.requiresContrl,');q.write_text(s)
replace('lib/ediel/ack.ts','  defaultAckStatuses,\n  deriveEdielAckDefaults,\n  findExistingAckForSource,\n  getAutomaticAckPolicy,\n  getCanonicalAckState,\n  type AckFamily,','  defaultAckStatuses,\n  deriveEdielAckDefaults,\n  computeOutboundAckDueAt,\n  findExistingAckForSource,\n  getAutomaticAckPolicy,\n  getCanonicalAckState,\n  type AckFamily,')
replace('lib/ediel/ack.ts','  const ackStatuses = defaultAckStatuses()',"  const ackStatuses = deriveEdielAckDefaults({ family: params.ackFamily, code: params.ackFamily })")
replace('lib/ediel/ack.ts','  const envelope = buildEdifactEnvelope({','  const envelope = buildEdifactEnvelope({\n    acknowledgementRequest: ackStatuses.requiresContrl,\n    testFlag: params.sourceMessage.test_flag,')
replace('lib/ediel/ack.ts','    requiresContrl: false,\n    requiresAperak: false,','    requiresContrl: ackStatuses.requiresContrl,\n    requiresAperak: ackStatuses.requiresAperak,')
replace('lib/ediel/ack.ts','    ackDueAt: ackStatuses.ackDueAt,','    ackDueAt: computeOutboundAckDueAt(ackStatuses),')
# Non-send samples explicitly opt in for the sample; no provider capability implied.
replace('lib/ediel/productionReadiness.part-3.ts','        ? EdifactEnvelopeCodec.encode({','        ? EdifactEnvelopeCodec.encode({\n            acknowledgementRequest: true,')
replace('lib/ediel/verification/rulePackVerification.ts','        const sample = EdifactEnvelopeCodec.encode({','        const sample = EdifactEnvelopeCodec.encode({\n          acknowledgementRequest: true,')
# Real customer-case route: carry one canonical projection into envelope and stored fields.
p='lib/customer-cases/engine.ts'
replace(p,"import { buildEdifactEnvelope } from '@/lib/ediel/messages'", "import { buildEdifactEnvelope } from '@/lib/ediel/messages'\nimport { deriveEdielAckDefaults } from '@/lib/ediel/core/ackPolicy'")
replace(p,'function buildCancellationProdatPayload(params: {','function buildCancellationProdatPayload(params: {\n  acknowledgementRequest: boolean')
replace(p,'  const envelope = buildEdifactEnvelope({','  const envelope = buildEdifactEnvelope({\n    acknowledgementRequest: params.acknowledgementRequest,')
replace(p,"  const cancellation = sourceMessage", "  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z03' })\n  const cancellation = sourceMessage")
replace(p,'? buildCancellationProdatPayload({ caseRow, sourceMessage, customer, site, meteringPoint, switchRequest })','? buildCancellationProdatPayload({ caseRow, sourceMessage, customer, site, meteringPoint, switchRequest, acknowledgementRequest: ack.requiresContrl })')
replace(p,"    requiresContrl: true,\n    requiresAperak: true,\n    contrlStatus: 'pending',\n    aperakStatus: 'pending',", "    requiresContrl: ack.requiresContrl,\n    requiresAperak: ack.requiresAperak,\n    contrlStatus: ack.contrlStatus,\n    aperakStatus: ack.aperakStatus,")
for p,n in [('__tests__/ediel-canonical-envelope.test.ts',3),('__tests__/ediel-aperak-text-codec-boundary.test.ts',2)]:
 replace(p,'EdifactEnvelopeCodec.encode({','EdifactEnvelopeCodec.encode({ acknowledgementRequest: true,',n)
replace('lib/ediel/rulebook/rulebook.ts',"  | 'meter_values'\n","  | 'meter_values'\n  | 'functional_rejection'\n")
replace('lib/ediel/rulebook/rulebook.ts',"  if (normalizedFamily === 'UTILTS') {\n    return getCanonicalUtiltsProfile(normalizedCode) ? 'meter_values' : 'unknown'\n  }", "  if (normalizedFamily === 'UTILTS_ERR' || (normalizedFamily === 'UTILTS' && normalizedCode === 'ERR')) {\n    const process = getCanonicalUtiltsProfile('ERR')?.businessProcess\n    if (process !== 'functional_rejection') throw new Error('canonical_utilts_err_process_missing')\n    return process\n  }\n  if (normalizedFamily === 'UTILTS') {\n    return getCanonicalUtiltsProfile(normalizedCode) ? 'meter_values' : 'unknown'\n  }")
replace('lib/ediel/rulebook/rulebook.ts',"      processGroup: profile.messageCode === 'ERR' ? 'ediel_ack' : 'meter_values',", "      processGroup: processGroupForMessage(family, profile.messageCode),")
replace('lib/ediel/core/ackPolicy.ts',"  if (!contrlRequired && !aperakRequired && !utiltsErrStatus && contrlStatus !== 'pending' && aperakStatus !== 'pending') {", "  if (!contrlRequired && !aperakRequired && (utiltsErrStatus === null || utiltsErrStatus === 'not_required') && contrlStatus !== 'pending' && aperakStatus !== 'pending') {")
replace('scripts/test-ediel-unb-ack-request.cjs',"    export { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator';", "    export { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator';\n    export { processGroupForMessage, getRulebookRule } from '@/lib/ediel/rulebook/rulebook';\n    export { validateRulebookMessage } from '@/lib/ediel/rulebook/validator';")
q=R/'scripts/test-ediel-unb-ack-request.cjs'
q.write_text(q.read_text()+r'''
// Two narrowly approved convergence amendments: PR358 comment5752208557.
for (const [family, code, expected] of [
  ['UTILTS_ERR','ERR','functional_rejection'], ['UTILTS_ERR','UTILTS_ERR','functional_rejection'],
  ['UTILTS','ERR','functional_rejection'], ['UTILTS','E66','meter_values'],
  ['UTILTS','S02','meter_values'], ['APERAK','APERAK','ediel_ack'], ['CONTRL','CONTRL','ediel_ack'],
]) test(`process projection ${family}/${code} is ${expected}`, async () => {
  assert.equal((await api).processGroupForMessage(family, code), expected)
})
test('ERR compatibility projection agrees with canonical processing, not transport routing', async () => {
  assert.equal((await api).getRulebookRule('UTILTS_ERR','UTILTS_ERR').processGroup, 'functional_rejection')
})
test('actual ERR preflight rejects a wrong process group while allowing its canonical group', async () => {
  const a = await api, draft = a.buildUtiltsErrDraft({sourceMessage:source('UTILTS'),messageText:'E14'})
  const input = {family:'UTILTS_ERR',code:'ERR',rawPayload:draft.rawPayload,applicationReference:draft.applicationReference,
    direction:'outbound',mode:'send',environment:'test',businessDate:'2026-09-20',version:'E5SE5A'}
  const valid = a.validateRulebookMessage({...input,processGroup:'functional_rejection'})
  assert.equal(valid.issues.some(issue => issue.code==='CANONICAL_PROCESS_GROUP_MISMATCH'),false)
  const invalid = a.validateRulebookMessage({...input,processGroup:'ediel_ack'})
  assert.equal(invalid.issues.some(issue => issue.code==='CANONICAL_PROCESS_GROUP_MISMATCH'),true)
})
for (const value of [null,undefined,'not_required']) test(`no ACK requirements and UERR=${value} remains no_ack_required`, async () => {
  const a = await api
  assert.equal(a.getCanonicalAckState({requires_contrl:false,requires_aperak:false,contrl_status:'not_required',
    aperak_status:'not_required',utilts_err_status:value,ack_due_at:null}),'no_ack_required')
})
for (const [status, expected] of [['received','utilts_err_received'],['sent','utilts_err_received'],
  ['failed','in_progress'],['pending','in_progress']]) test(`UERR=${status} preserves prior precedence`, async () => {
  const a=await api
  assert.equal(a.getCanonicalAckState({requires_contrl:false,requires_aperak:false,contrl_status:'not_required',
    aperak_status:'not_required',utilts_err_status:status,ack_due_at:null}),expected)
})
for (const [overrides, expected] of [
  [{requires_contrl:true,contrl_status:'pending'},'awaiting_contrl'],
  [{requires_contrl:true,contrl_status:'failed',utilts_err_status:'received'},'contrl_failed'],
  [{aperak_status:'failed',utilts_err_status:'received'},'aperak_received_negative'],
  [{utilts_err_status:'pending',ack_due_at:'2026-09-20T11:00:00.000Z'},'ack_overdue'],
  [{requires_aperak:true,aperak_status:'pending'},'awaiting_aperak'],
]) test(`ACK state precedence stays ${expected}`,async()=>{
  const a=await api
  assert.equal(a.getCanonicalAckState({requires_contrl:false,requires_aperak:false,contrl_status:'not_required',
    aperak_status:'not_required',utilts_err_status:'not_required',ack_due_at:null,...overrides}),expected)
})
test('actual outbound route contract still selects ediel_ack for UTILTS_ERR',async()=>{
  // Execute the unchanged route consumer with synthetic configuration. Stop at
  // the application-reference boundary, before transport/certificate/DB work.
  const captured=[],stop=new Error('route projection captured'),context=createContext({Date,console})
  const synthetic=exports=>new SyntheticModule(Object.keys(exports),function(){
    for(const [key,value] of Object.entries(exports))this.setExport(key,value)
  },{context})
  const unavailable=()=>{throw new Error('Unexpected route-side effect')}
  const boundaries=new Map([
    ['@/lib/ediel/config',synthetic({getEdielRouteRuntimeByCommunicationRouteId:async(id,options)=>{
      assert.equal(id,'route-A');assert.equal(options.companyId,'tenant-A')
      return {is_enabled:true,communication_route_active:true,environment:'test',receiver_ediel_id:'12345',
        message_family:'UTILTS_ERR',target_email:'synthetic@example.invalid'}
    },evaluateProductionTransportSecurity:unavailable})],
    ['@/lib/ediel/certificateScope',synthetic({certificateMessageScopeBlocker:unavailable})],
    ['@/lib/supabase/service',synthetic({supabaseService:{from:unavailable,rpc:unavailable}})],
    ['@/lib/routes/routeReadiness',synthetic({expectedApplicationReference:requestType=>{captured.push(requestType);throw stop}})],
  ])
  const file=path.join(root,'lib/ediel/outbox/routeContract.ts')
  const module=new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'strip',sourceUrl:file}),{context,identifier:file})
  await module.link(name=>{assert.ok(boundaries.has(name),`Unexpected route dependency:${name}`);return boundaries.get(name)})
  await module.evaluate()
  await assert.rejects(module.namespace.evaluateEdielRouteContract({direction:'outbound',company_id:'tenant-A',
    communication_route_id:'route-A',environment:'test',message_family:'UTILTS_ERR',message_code:'ERR',
    receiver_ediel_id:'12345',receiver_email:'synthetic@example.invalid'}),error=>error===stop)
  assert.deepEqual(captured,['ediel_ack'])
})
''')
