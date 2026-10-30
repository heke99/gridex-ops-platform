// Actual MAIN intake/parser/tokenizer; finite Data API observation/task ports only.
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

type Row = Record<string, unknown>
const wire = (ref = 'A', text = 'VALUE A', password = '', indicator = '') =>
  `UNA:+.? 'UNB+UNOC:3+111:14+222:14+261024:1200+${ref}+${password}+UTILTS++++${indicator}'UNH+1+UTILTS:D:04B:UN:E5SE0A'BGM+E66+DOC-${ref}+9'FTX+AAI+++${text}'UNT+4+1'UNZ+1+${ref}'`
const custom = (indicator = '') => `UNA:*.! ~UNB*UNOC:3*111:14*222:14*261024:1200*A*PW!!*UTILTS****${indicator}~UNH*1*UTILTS:D:04B:UN:E5SE0A~BGM*E66*DOC-A*9~FTX*AAI***VALUE A!~B~UNT*4*1~UNZ*1*A~`
async function intake(row: Row, attachments: Row[] = [], environment = 'production', protectedSource = false, binding?: { companyId: string; customerId: string }, failStatus = false) {
  const updates: Row[] = [], tasks: Row[] = [], queries: string[] = []
  let observed: ParsedEdifactEnvelope | null = null
  const reached = new Error('finite_stop_at_real_tenant_boundary')
  const forbidden = () => { throw new Error('unexpected_business_effect') }
  const ports: Record<string, unknown> = {
    '@/lib/ediel/inbound/duplicateResponses': { prepareDuplicate103Response: forbidden },
    '@/lib/ediel/inbound/receptions': { InboundReceptionHeldError: Error, readUnattributedTechnicalIntake: async () => protectedSource ? { sourceMessageId: 'protected', parseResultId: 'protected-parse' } : null },
    './dsnDisposition': { parseDeliveryStatusReport: (raw: string) => (load('lib/inbound-mail/dsnDisposition.ts') as { parseDeliveryStatusReport(input: string): unknown }).parseDeliveryStatusReport(raw) },
    './dsnTransportCandidates': { projectDsnTransportCandidates: async () => ({ status: 'no_candidate' }) },
    './dsnSourceObservations': { recordDsnSourceObservation: forbidden },
    '@/lib/inbound-mail/inboundTenantResolver': { resolveTenantForInboundEdiel: async (input: { parsed: ParsedEdifactEnvelope }) => { observed = input.parsed; throw reached } },
    '@/lib/inbound-mail/inboundMatcher': { matchMeteringPointForInbound: forbidden, matchOutboundRequestForInbound: forbidden },
    '@/lib/inbound-mail/inboundTaskFactory': { createInboundMailTask: async (input: Row) => { tasks.push(input) } },
    '@/lib/inbound-mail/canonicalInboundAckStatusUpdater': { applyCanonicalInboundAckStatusUpdate: forbidden },
    '@/lib/inbound-mail/inboundAckTransportGuard': { failClosedOutboundMatchForAck: forbidden, verifyInboundAckTransportCorrelation: forbidden },
    '@/lib/inbound-mail/inboundStatusUpdater': { applySafeInboundStatusUpdate: forbidden, createInboundEdielMessage: forbidden, createParseResult: forbidden, createUnresolvedInboundEdielMessage: forbidden, updateInboundEmailProcessingStatus: async (input: Row) => { updates.push(input); if (failStatus) throw new Error('status_write_failed') } },
    '@/lib/ediel/aiListFormat': { parseAiBiTechnicalFile: forbidden },
    '@/lib/ediel/core/kernel': { registerInboundCanonicalMessage: forbidden },
    '@/lib/supabase/service': { supabaseService: { from: (table: string) => {
      queries.push(table)
      if (!['inbound_email_messages', 'inbound_email_attachments'].includes(table)) return forbidden()
      const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: { id: 'mail', company_id: 'company', environment, ...row }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: attachments, error: null }).then(resolve) }
      return chain
    } } },
  }
  const cache = new Map<string, unknown>()
  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file)
    const source = readFileSync(file, 'utf8')
    if (file.endsWith('.json')) { const value: unknown = JSON.parse(source); cache.set(file, value); return value }
    const exports: Record<string, unknown> = {}; cache.set(file, exports)
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true } }).outputText, {
      exports, Buffer, TextDecoder, console, require: (id: string) => {
        if (file.endsWith('edielInboundProcessor.ts') && id in ports) return ports[id]
        if (!id.startsWith('@/') && !id.startsWith('.')) throw new Error('undeclared module: ' + id)
        const prefix = id.startsWith('@/') ? id.slice(2) : path.join(path.dirname(file), id)
        const found = [prefix, prefix + '.ts', prefix + '.json', prefix + '/index.ts'].find(p => existsSync(p) && statSync(p).isFile())
        if (!found) throw new Error('missing actual module: ' + id)
        return load(found)
      },
    })
    return exports
  }
  const intakeModule = load('lib/inbound-mail/edielInboundProcessor.ts') as { processInboundEmailMessage(input: Row): Promise<unknown> }
  let result: unknown
  try { result = await intakeModule.processInboundEmailMessage({ inboundEmailMessageId: 'mail', actorUserId: 'actor', testCenterTenantBinding: binding }) } catch (error) { if (error !== reached) throw error }
  return { result, parsed: observed as ParsedEdifactEnvelope | null, updates, tasks, queries }
}
const A = wire(), B = wire('B', 'VALUE B')
it.each([
  { name: 'different no-UNA physical files', row: { raw_edifact_payload: A.slice(9) }, attachments: [{ raw_text: B.slice(9) }] },
  { name: 'different UNA files', row: { raw_edifact_payload: A }, attachments: [{ raw_text: B }] },
  { name: 'conflicting body and attachment', row: { body_text: B }, attachments: [{ raw_text: A }] },
  { name: 'same reference different field data', row: { body_text: wire('A', 'VALUE B') }, attachments: [{ raw_text: A }] },
  { name: 'meaningful whitespace differs', row: { raw_edifact_payload: wire('A', 'AB') }, attachments: [{ raw_text: wire('A', 'A B') }] },
])('holds $name before tenant/parse-result/business effects', async ({ row, attachments }) => {
  const out = await intake(row, attachments)
  expect(out.result).toMatchObject({ status: 'manual_review', parseResultId: null })
  expect(out.parsed).toBeNull()
  expect(out.updates).toHaveLength(1)
  expect(out.updates[0]).toMatchObject({ matchStatus: 'multiple_interchanges', matchPayload: { authorizesBusinessEffect: false } })
  expect(out.tasks).toHaveLength(1)
})
it.each([
  { name: 'single source', row: { raw_edifact_payload: A }, attachments: [] },
  { name: 'exact repeated projection', row: { raw_edifact_payload: A }, attachments: [{ raw_text: A }] },
  { name: 'BOM outer newline duplicate', row: { raw_edifact_payload: A }, attachments: [{ raw_text: '\uFEFF' + A + '\r\n' }] },
  { name: 'no-UNA duplicate', row: { raw_edifact_payload: A.slice(9) }, attachments: [{ raw_text: A.slice(9) }] },
  { name: 'body only', row: { body_text: A }, attachments: [] },
  { name: 'raw mail fallback', row: { raw_email: 'Subject: EDIFACT\r\n\r\n' + A }, attachments: [] },
  { name: 'exact decrypted S/MIME copy', row: { raw_edifact_payload: A }, attachments: [{ raw_text: A, filename: 'smime.p7m' }] },
  { name: 'cover letter', row: { body_text: 'We are unable to unzip that file' }, attachments: [{ raw_text: A }] },
])('preserves $name as one unchanged original', async ({ row, attachments }) => {
  const out = await intake(row, attachments)
  expect(out.parsed).toMatchObject({ interchangeReference: 'A', bgmReference: 'DOC-A', freeText: ['VALUE A'] })
  expect(out.updates).toEqual([]); expect(out.tasks).toEqual([])
})
it('does not treat an escaped terminator followed by UNB data as another interchange', async () => {
  const out = await intake({ raw_edifact_payload: wire('A', "A?'UNB+literal") })
  expect(out.parsed?.interchangeReference).toBe('A'); expect(out.tasks).toEqual([])
})
it('uses custom UNA for exact duplicate framing', async () => {
  const out = await intake({ raw_edifact_payload: custom() }, [{ raw_text: custom() }])
  expect(out.parsed).toMatchObject({ interchangeReference: 'A', freeText: ['VALUE A~B'] }); expect(out.tasks).toEqual([])
})
it.each(['PW??', 'PW?+', "PW?'"])('holds released-password test indicator %j in production before tenant resolution', async password => {
  const out = await intake({ raw_edifact_payload: wire('A', 'VALUE A', password, '1') })
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'environment_mismatch' }); expect(out.tasks).toHaveLength(1)
})
it('holds custom UNA test indicator in production', async () => {
  const out = await intake({ raw_edifact_payload: custom('1') })
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'environment_mismatch' })
})
it('preserves the test mailbox lane', async () => {
  const out = await intake({ raw_edifact_payload: wire('A', 'VALUE A', 'PW??', '1') }, [], 'test')
  expect(out.parsed?.interchangeReference).toBe('A'); expect(out.updates).toEqual([])
})
it('retains protected technical-intake refusal before source parsing', async () => {
  const out = await intake({ raw_edifact_payload: A }, [{ raw_text: B }], 'production', true)
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'technical_only_unattributed' }); expect(out.queries).toEqual(['inbound_email_messages'])
})
it('retains the complete physical attachment cap', async () => {
  const out = await intake({}, Array.from({ length: 129 }, () => ({ raw_text: A })))
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'physical_attachment_limit_exceeded' })
})
it('holds two no-UNA interchanges in one raw container', async () => {
  const out = await intake({ raw_email: 'Subject: files\r\n\r\n' + A.slice(9) + '\r\n' + B.slice(9) })
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'multiple_interchanges' })
})
it('holds undecoded multipart fallback rather than mixing or silently dropping a part', async () => {
  const raw = 'Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n' + A.slice(9) + '\r\n--b\r\nContent-Type: text/plain\r\n\r\n' + B.slice(9) + '\r\n--b--\r\n'
  const out = await intake({ raw_email: raw })
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'multiple_interchanges' }); expect(out.tasks).toHaveLength(1)
})

it('preserves validated isolated Test Center source acceptance', async () => {
  const out = await intake({ raw_edifact_payload: wire('A', 'VALUE A', '', '1'), match_status: 'test_center_raw_import', match_payload: { source: 'test_center_raw_edifact_import_v1', test_center_customer_id: 'customer', external_side_effects_allowed: false } }, [], 'test', false, { companyId: 'company', customerId: 'customer' })
  expect(out.parsed?.interchangeReference).toBe('A'); expect(out.tasks).toEqual([])
})
it('retains refusal of a Test Center binding in production before test-marker handling', async () => {
  await expect(intake({ raw_edifact_payload: wire('A', 'VALUE A', '', '1') }, [], 'production', false, { companyId: 'company', customerId: 'customer' })).rejects.toThrow('Test Center tenantbindning kunde inte verifieras')
})
it('does not disguise failure to persist a multiple-source HOLD as a successful review', async () => {
  await expect(intake({ raw_edifact_payload: A }, [{ raw_text: B }], 'production', false, undefined, true)).rejects.toThrow('status_write_failed')
})
it('leaves unsupported UNB test markers to current canonical validation', async () => {
  const out = await intake({ raw_edifact_payload: wire('A', 'VALUE A', '', '2') })
  expect(out.parsed?.interchangeReference).toBe('A'); expect(out.updates).toEqual([])
})
it('also holds a BOM-prefixed undecoded multipart container', async () => {
  const raw = '\uFEFFContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n' + A.slice(9) + '\r\n--b\r\nContent-Type: text/plain\r\n\r\n' + B.slice(9) + '\r\n--b--\r\n'
  const out = await intake({ raw_email: raw })
  expect(out.parsed).toBeNull(); expect(out.updates[0]).toMatchObject({ matchStatus: 'multiple_interchanges' })
})
const multipart = (payloads: string[], encoding = '7bit') => 'Content-Type: multipart/mixed; boundary="b"\r\n\r\n' + payloads.map(payload => '--b\r\nContent-Type: application/EDIFACT; charset=iso-8859-1\r\nContent-Transfer-Encoding: '+encoding+'\r\n\r\n'+(encoding==='base64'?Buffer.from(payload,'latin1').toString('base64'):encoding==='quoted-printable'?payload.replace(/=/g,'=3D').replace(/Å/g,'=C5'):payload)+'\r\n').join('')+'--b--\r\n'
it.each([{filename:'smime.p7m'},{filename:'smime.p7s'},{mime_type:'application/pkcs7-mime'}])('does not discard distinct framed text due to label %j', async label => {
 const out=await intake({raw_edifact_payload:A},[{raw_text:B,...label}]);expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'multiple_interchanges'})
})
it('ignores an actual non-EDIFACT encrypted container projection',async()=>{
 const out=await intake({raw_edifact_payload:A},[{raw_text:'MIIFakeSyntheticEncryptedBytes==',filename:'smime.p7m',mime_type:'application/pkcs7-mime'}]);expect(out.parsed?.interchangeReference).toBe('A')
})
it.each(['7bit','base64','quoted-printable'])('reconciles partial raw multipart inventory through %s',async encoding=>{
 const out=await intake({raw_email:multipart([A,B],encoding),raw_edifact_payload:A},[{raw_text:A}]);expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'multiple_interchanges'})
})
it.each(['7bit','base64','quoted-printable'])('accepts complete duplicate raw multipart projections through %s',async encoding=>{
 const payload=wire('A','VÅR');const out=await intake({raw_email:multipart([payload],encoding),raw_edifact_payload:payload},[{raw_text:payload}]);expect(out.parsed).toMatchObject({interchangeReference:'A',freeText:['VÅR']});expect(out.updates).toEqual([])
})
it('reconciles decrypted MIME containers instead of trusting S/MIME labels',async()=>{
 const out=await intake({raw_edifact_payload:A},[{raw_text:multipart([A,B]),filename:'smime.p7m',mime_type:'application/pkcs7-mime'}]);expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'multiple_interchanges'})
})
it('preserves raw EDIFACT field newlines rather than treating its UNB colon as a MIME header',async()=>{
 const out=await intake({raw_email:wire('A','A\r\n\r\nB')});expect(out.parsed?.interchangeReference).toBe('A');expect(out.updates).toEqual([])
})
it('holds a nested message container even with a valid-looking partial projection',async()=>{
 const raw='Content-Type: message/rfc822\r\n\r\nContent-Type: text/plain\r\n\r\n'+B;const out=await intake({raw_email:raw,raw_edifact_payload:A});expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'edifact_unparseable'})
})
it('holds unclosed raw multipart inventory even with a selected projection',async()=>{
 const out=await intake({raw_email:multipart([A]).replace('--b--\r\n',''),raw_edifact_payload:A});expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'dsn_transport_review'})
})

it('accepts a healthy raw multipart source without relying on stored projections',async()=>{
 const out=await intake({raw_email:multipart([A])});expect(out.parsed).toMatchObject({interchangeReference:'A',freeText:['VALUE A']});expect(out.updates).toEqual([])
})
it('preserves header-like text inside a physical EDIFACT field',async()=>{
 const payload=wire('A','A\r\nSubject: note\r\n\r\nB');const out=await intake({raw_email:payload});expect(out.parsed?.rawPayload).toBe(payload);expect(out.updates).toEqual([])
})
const headerless = (body: string) => 'Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\n\r\n'+body+'\r\n--b--\r\n'
it('accepts a valid single empty-header MIME part with default text/plain',async()=>{
 const out=await intake({raw_email:headerless(A)});expect(out.parsed).toMatchObject({interchangeReference:'A',freeText:['VALUE A']});expect(out.updates).toEqual([])
})
it('deduplicates a complete empty-header part and its retained projections',async()=>{
 const out=await intake({raw_email:headerless(A),raw_edifact_payload:A},[{raw_text:A}]);expect(out.parsed?.interchangeReference).toBe('A');expect(out.updates).toEqual([])
})
it('holds distinct empty-header B hidden behind retained A',async()=>{
 const raw=multipart([A]).replace('--b--\r\n','--b\r\n\r\n'+B+'\r\n--b--\r\n');const out=await intake({raw_email:raw,raw_edifact_payload:A},[{raw_text:A}]);expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'multiple_interchanges'})
})
it('accepts a non-EDIFACT empty-header sibling without dropping its inventory entry',async()=>{
 const raw=multipart([A]).replace('--b--\r\n','--b\r\n\r\ncover letter\r\n--b--\r\n');const out=await intake({raw_email:raw,raw_edifact_payload:A});expect(out.parsed?.interchangeReference).toBe('A');expect(out.updates).toEqual([])
})
it('refuses a boundary child that cannot be represented by the MIME inventory',async()=>{
 const raw=multipart([A]).replace('--b--\r\n','--b\r\n'+B+'\r\n--b--\r\n');const out=await intake({raw_email:raw,raw_edifact_payload:A});expect(out.parsed).toBeNull();expect(out.updates[0]).toMatchObject({matchStatus:'edifact_unparseable'})
})
