// Focused actual namespace owner sequence only; no full migration replay,
// Supabase/PostgREST/RLS, source approval or transport authority is claimed.
import { readFileSync,readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned temporary @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const packageInfo=JSON.parse(readFileSync(new URL('../package.json',pathToFileURL(process.env.EDIEL_PGLITE_MODULE)), 'utf8'))
assert.equal(packageInfo.name,'@electric-sql/pglite');assert.equal(packageInfo.version,'0.3.14')
const db = new PGlite()
const root = fileURLToPath(new URL('..', import.meta.url))
const modules = await createServer({ root, configFile: false, resolve: { alias: { '@': root } }, server: { middlewareMode: true }, appType: 'custom' })
const migrationRoot=new URL('../supabase/migrations/',import.meta.url)
const ownerSequence=readdirSync(migrationRoot).filter(name=>name.endsWith('.sql')&&/^CREATE (?:OR REPLACE )?FUNCTION gridex_ediel_wire_namespace\.keys\(p_raw text\)/m.test(readFileSync(new URL(name,migrationRoot),'utf8'))).sort()
assert.deepEqual(ownerSequence,['20260930171116_ediel_wire_reference_namespace.sql','20260930184410_ediel_protected_technical_contrl_source_basis.sql','20260930192030_ediel_aperak_unused_document_namespace.sql','20260930213117_ediel_contrl_empty_application_namespace.sql'])
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const wire = ({ sender = 'ESCO', app = '23-DGI-E66-T', interchange = 'I-ONE', document = 'D-ONE', ide = 'TX-ONE', family = 'UTILTS', dm = null } = {}) =>
  `UNB+UNOC:3+${sender}:14+DSO:14+260930:1200+${interchange}++${app}++++1'UNH+1+${family}:D:04A:UN:E5SE5A'BGM+${family === 'APERAK' ? '312' : 'E66'}+${document}+9'NAD+MS+${sender}::9'${dm ? `RFF+DM:${dm}'` : `IDE+24+${ide}'`}UNT+5+1'UNZ+1+${interchange}'`
const insert = async (id, company, raw) => db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,raw_payload) values($1,$2,'test','outbound','UTILTS',$3)", [uid(id), uid(company), raw])
let checks = 0
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    `)
  const snapshot=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
  const table=snapshot.match(/CREATE TABLE public\.ediel_messages \([\s\S]*?\n\);/)?.[0];assert.ok(table)
  await db.exec(table)
  await db.exec('alter table public.ediel_messages add primary key(id)')
  const tokenizer = readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', import.meta.url), 'utf8')
  await db.exec(tokenizer.slice(tokenizer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), tokenizer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  // Genuine pre-migration retained fixture. No synthetic send/approval stamp.
  await insert(1, 100, wire())
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930171116_ediel_wire_reference_namespace.sql', import.meta.url), 'utf8')); checks++
  const functionIdentity = (await db.query("select oid,proowner,proacl,provolatile,proconfig from pg_proc where oid='gridex_ediel_wire_namespace.keys(text)'::regprocedure")).rows[0]
  const technical=readFileSync(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'utf8')
  // These are all replacements of keys(text) in the current migration history.
  // Load only that actual function from the technical authority migration;
  // its separate endpoint/syntax/actor commands remain independently tested.
  await db.exec(technical.slice(technical.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys'),technical.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_source_rules.capture_v1')))
  const noAppContrl="UNB+UNOC:3+54321:14+12345:14+260930:1200+NOAPP-CONTRL++++++1'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIGINAL-I+12345:14+54321:14+4'UNT+3+1'UNZ+1+NOAPP-CONTRL'"
  assert.deepEqual((await db.query('select gridex_ediel_wire_namespace.keys($1) k',[noAppContrl])).rows[0].k.map(key=>key.kind),['UNB','UNH']);checks++
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930192030_ediel_aperak_unused_document_namespace.sql', import.meta.url), 'utf8'))
  await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[noAppContrl]),/ediel_wire_reference_source_invalid/);checks++
  await assert.rejects(insert(90,100,noAppContrl),/ediel_wire_reference_source_invalid/);checks++
  assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(90)])).rows[0].n,0);checks++
  console.log('171116 -> 184410 -> 192030: qualified blank-application CONTRL regression RED reproduced')
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930213117_ediel_contrl_empty_application_namespace.sql',import.meta.url),'utf8'))
  await insert(90,100,noAppContrl);checks++
  const appContrl=noAppContrl.replace('+NOAPP-CONTRL++++++1', '+APP-CONTRL++23-DDQ-PRODAT++++1').replace("UNZ+1+NOAPP-CONTRL'", "UNZ+1+APP-CONTRL'")
  await insert(91,100,appContrl);checks++
  for(const id of [90,91]){
    const before=(await db.query('select to_jsonb(m) m from public.ediel_messages m where id=$1',[uid(id)])).rows[0]
    const reserved=(await db.query('select jsonb_agg(to_jsonb(r) order by reference_kind,wire_reference) r from gridex_ediel_wire_namespace.reservations r where source_message_id=$1',[uid(id)])).rows[0]
    await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)',[uid(100),uid(id)])
    assert.deepEqual((await db.query('select to_jsonb(m) m from public.ediel_messages m where id=$1',[uid(id)])).rows[0],before)
    assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(r) order by reference_kind,wire_reference) r from gridex_ediel_wire_namespace.reservations r where source_message_id=$1',[uid(id)])).rows[0],reserved);checks++
  }
  const beforeCollision=(await db.query(`select jsonb_build_object(
    'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.ediel_messages m),
    'reservations',(select jsonb_agg(to_jsonb(r) order by sender_namespace,reference_kind,wire_reference) from gridex_ediel_wire_namespace.reservations r),
    'coverage',(select jsonb_agg(to_jsonb(c) order by source_message_id) from gridex_ediel_wire_namespace.coverage c)) state`)).rows[0]
  await assert.rejects(insert(92,200,noAppContrl),/ediel_wire_reference_namespace_collision/);checks++
  assert.deepEqual((await db.query(`select jsonb_build_object(
    'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.ediel_messages m),
    'reservations',(select jsonb_agg(to_jsonb(r) order by sender_namespace,reference_kind,wire_reference) from gridex_ediel_wire_namespace.reservations r),
    'coverage',(select jsonb_agg(to_jsonb(c) order by source_message_id) from gridex_ediel_wire_namespace.coverage c)) state`)).rows[0],beforeCollision);checks++
  await assert.rejects(db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)',[uid(200),uid(90)]),/ediel_wire_reference_source_invalid/);checks++
  const noFamilyContrl=noAppContrl.replace('UNH+1+CONTRL:2:2:UN:EDIEL2', 'UNH+1')
  await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[noFamilyContrl]),/ediel_wire_reference_source_invalid/);checks++
  await assert.rejects(insert(93,100,noFamilyContrl),/ediel_wire_reference_source_invalid/);checks++
  const noFamilyAppContrl=appContrl.replace('UNH+1+CONTRL:2:2:UN:EDIEL2','UNH+1')
  await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[noFamilyAppContrl]),/ediel_wire_reference_source_invalid/);checks++
  await assert.rejects(insert(94,100,noFamilyAppContrl),/ediel_wire_reference_source_invalid/);checks++
  for(const family of ['PRODAT','UTILTS','APERAK']){
    await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[noAppContrl.replace('CONTRL:2:2:UN:EDIEL2',family+':D:04A:UN:E5SE5A')]),/ediel_wire_reference_source_invalid/);checks++
  }
  await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[noAppContrl.replace('NOAPP-CONTRL','THIS-IS-OVER-14-CHARS')]),/ediel_wire_reference_source_invalid/);checks++

  assert.deepEqual((await db.query("select oid,proowner,proacl,provolatile,proconfig from pg_proc where oid='gridex_ediel_wire_namespace.keys(text)'::regprocedure")).rows[0], functionIdentity); checks++
  await assert.rejects(insert(2, 200, wire()), /ediel_wire_reference_namespace_collision/); checks++
  await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(100), uid(1)])
  const initial = (await db.query('select count(*)::int n from gridex_ediel_wire_namespace.reservations')).rows[0].n
  assert.equal(initial, 8); checks++
  await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(100), uid(1)])
  assert.equal((await db.query('select count(*)::int n from gridex_ediel_wire_namespace.reservations')).rows[0].n, initial); checks++
  await assert.rejects(db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(200), uid(1)]), /ediel_wire_reference_source_invalid/); checks++
  await assert.rejects(insert(3, 200, wire({ interchange: 'I-TWO' })), /ediel_wire_reference_namespace_collision/); checks++
  await assert.rejects(insert(4, 200, wire({ interchange: 'I-TWO', document: 'D-TWO' })), /ediel_wire_reference_namespace_collision/); checks++
  await insert(5, 200, wire({ interchange: 'I-TWO', document: 'D-TWO', ide: 'TX-TWO' })); checks++
  // Same external sender across tenants: different application namespaces may
  // use the same BGM/IDE, while the interchange reference remains sender-wide.
  await insert(6, 200, wire({ app: '23-DDQ-E66-T', interchange: 'I-THREE' })); checks++
  await assert.rejects(insert(7, 200, wire({ app: '23-DDQ-E66-T', document: 'D-THREE', ide: 'TX-THREE' })), /ediel_wire_reference_namespace_collision/); checks++
  await insert(8, 200, wire({ sender: 'OTHER' })); checks++
  await assert.rejects(db.exec(`update ediel_messages set company_id='${uid(200)}' where id='${uid(1)}'`), /ediel_wire_reference_namespace_context_immutable/); checks++
  await assert.rejects(db.exec('delete from gridex_ediel_wire_namespace.reservations'), /ediel_wire_reference_reservation_immutable/); checks++
  await insert(9, 200, wire({ family: 'APERAK', interchange: 'ACK-I', document: 'ACK-D', dm: 'ACK-T' })); checks++
  await assert.rejects(insert(10, 100, wire({ family: 'APERAK', interchange: 'ACK-I-TWO', document: 'ACK-D-TWO', dm: 'ACK-T' })), /ediel_wire_reference_namespace_collision/); checks++
  const keys = (await db.query('select gridex_ediel_wire_namespace.keys($1) result', [wire({ sender: 'ESC?+O', interchange: 'RELEASED', document: 'DOC?+X', ide: 'IDE?:X' })])).rows[0].result
  assert.ok(keys.some(key => key.sender === 'ESC+O' && key.kind === 'IDE' && key.value === 'IDE:X')); checks++
  const alternate = "UNA;*.! ~UNB*UNOC;3*ESCO;14*DSO;14*260930;1200*ALT-I**23-DGI-E66-T****1~UNH*1*UTILTS;D;04A;UN;E5SE5A~BGM*E66*ALT-D*9~NAD*MS*ESCO;;9~IDE*24*ALT!*ID~UNT*5*1~UNZ*1*ALT-I~"
  await insert(11, 100, alternate); checks++
  assert.ok((await db.query('select gridex_ediel_wire_namespace.keys($1) result', [alternate])).rows[0].result.some(key => key.kind === 'IDE' && key.value === 'ALT*ID')); checks++
  await assert.rejects(insert(12, 100, wire({ interchange: 'THIS-IS-OVER-14-CHARS' })), /ediel_wire_reference_source_invalid/); checks++
  await assert.rejects(db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,raw_payload) values($1,$2,'production','outbound','UTILTS',$3)", [uid(13), uid(100), wire({ sender: 'ANOTHER' })]), /ediel_wire_reference_source_invalid/); checks++
  // ACK-10 / AT-ACK-10, frozen P26.A/16.B pp98–100: P-APERAK has
  // BGM+++27/34, unused 1001/1004 and ACW to the original PRODAT BGM.
  // Render the real mixed-Z04 field error, not a guessed APERAK document ID.
  const [{ renderAperakEdiel }, { renderContrl2Ediel2 }, { EdifactEnvelopeCodec }, fixture,
    { mixedZ04Parts }, { canonicalProdat26AFieldRules }, { validateFieldMatrixPayload }, { projectProdatDiagnostics }, { validateEdifactSyntax }] = await Promise.all([
    modules.ssrLoadModule('/lib/ediel/aperakEngine.ts'), modules.ssrLoadModule('/lib/ediel/contrlEngine.ts'),
    modules.ssrLoadModule('/lib/ediel/core/edifactEnvelopeCodec.ts'), modules.ssrLoadModule('/__tests__/fixtures/prodat-register.ts'),
    modules.ssrLoadModule('/__tests__/helpers/mixedZ04Fixture.ts'), modules.ssrLoadModule('/lib/ediel/prodat/prodat26AFieldMatrix.ts'),
    modules.ssrLoadModule('/lib/ediel/rulebook/fieldMatrix.ts'), modules.ssrLoadModule('/lib/ediel/prodat/prodatDiagnosticProjection.ts'), modules.ssrLoadModule('/lib/ediel/core/syntaxValidator.ts'),
  ])
  const sourceRaw = fixture.raw(mixedZ04Parts(), 'Z04').replace('UNB+UNOC:3+S+R+260917:1200+I++23-DDQ-PRODAT', 'UNB+UNOC:3+12345:14+54321:14+260917:1200+P-SOURCE-I++23-DDQ-PRODAT++1++1').replace("UNZ+1+I'", "UNZ+1+P-SOURCE-I'")
  assert.equal(validateEdifactSyntax({ message_family: 'PRODAT', message_code: 'Z04', raw_payload: sourceRaw, validation_report: {} }).ok, true); checks++
  const applicationErrors = projectProdatDiagnostics(validateFieldMatrixPayload(fixture.input(sourceRaw),
    canonicalProdat26AFieldRules('Z04').filter(rule => rule.fieldNumber === '213'))).applicationErrors
  assert.deepEqual(applicationErrors.map(error => [error.ercCode, error.fieldCode, error.referenceNumber]), [['41', '213', '735123456789012345']]); checks++
  const ackEnvelope = (segments, type) => EdifactEnvelopeCodec.encode({ sender: '54321', senderQualifier: '14', receiver: '12345', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test', interchangeReference: type.startsWith('CONTRL') ? 'P-CONTRL-I' : 'P-APERAK-I',
    messages: [{ messageReference: '1', messageTypeToken: type, businessSegments: segments }] })
  const pAperak = ackEnvelope(renderAperakEdiel({ source: { id: uid(1000), rawPayload: sourceRaw, messageFamily: 'PRODAT', messageCode: 'Z04', senderEdielId: '12345', receiverEdielId: '54321' },
    refs: {}, externalReference: 'P-ACK-ARCHIVE', transactionReference: 'P-ACK-ARCHIVE', outcome: 'negative', applicationErrors }).segments, 'APERAK:D:96A:UN:E2SE6A')
  assert.ok(pAperak.includes("BGM+++34'") && pAperak.includes("RFF+ACW:D'") && pAperak.includes('FTX+AAO++213::260')); checks++
  const contrl = ackEnvelope(renderContrl2Ediel2({ source: { rawPayload: sourceRaw }, outcome: 'positive' }).segments, 'CONTRL:2:2:UN:EDIEL2')
  for (const [family, raw] of [['CONTRL', contrl], ['APERAK', pAperak], ['CONTRL',noAppContrl], ['CONTRL',appContrl]]) {
    assert.equal(validateEdifactSyntax({ message_family: family, message_code: family, raw_payload: raw, validation_report: {} }).ok, true); checks++
  }
  await insert(20, 100, contrl); checks++
  await insert(21, 100, pAperak); checks++
  const pKeys = (await db.query('select gridex_ediel_wire_namespace.keys($1) result', [pAperak])).rows[0].result
  assert.deepEqual(pKeys.map(key => key.kind).sort(), ['UNB', 'UNH']); checks++
  const headerAperak=pAperak.replace('BGM+++34','BGM+++27').replaceAll('P-APERAK-I','P-HEADER-I')
  assert.equal(validateEdifactSyntax({message_family:'APERAK',message_code:'APERAK',raw_payload:headerAperak,validation_report:{}}).ok,true);checks++
  assert.deepEqual((await db.query('select gridex_ediel_wire_namespace.keys($1) result',[headerAperak])).rows[0].result.map(key=>key.kind).sort(),['UNB','UNH']);checks++
  await insert(24,100,headerAperak);checks++
  await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)',[pAperak.replace('23-DDQ-PRODAT','')]),/ediel_wire_reference_source_invalid/);checks++
  // Physical family/association choose the unused-field rule. A row label,
  // original ACW, missing U-APERAK ID or fabricated P BGM never grants it.
  const invalid = [pAperak.replace('BGM+++34', 'BGM++FABRICATED+34'), pAperak.replace('BGM+++34', 'BGM+34++34'),
    pAperak.replace('BGM+++34', 'BGM+++9'), pAperak.replace('BGM+++34', 'BGM++'), pAperak.replace('BGM+++34', 'BGM+++34:27'),
    pAperak.replace('BGM+++34', 'BGM+++34+AB'), pAperak.replace('BGM+++34', "BGM+++34'BGM+++34"),
    pAperak.replace("BGM+++34'", ''), pAperak.replace('APERAK:D:96A:UN:E2SE6A', 'APERAK:D:04A:UN:E5SE5A'),
    pAperak.replace('APERAK:D:96A:UN:E2SE6A', 'APERAK:D:96A:UN:E5SE5A'), pAperak.replace('APERAK:D:96A:UN:E2SE6A', 'UTILTS:D:96A:UN:E2SE6A')]
  for (const raw of invalid) { await assert.rejects(db.query('select gridex_ediel_wire_namespace.keys($1)', [raw]), /ediel_wire_reference_source_invalid/); checks++ }
  await assert.rejects(insert(23, 100, wire({ family: 'APERAK', interchange: 'U-MISSING-I', document: '', dm: 'U-MISSING-T' })), /ediel_wire_reference_source_invalid/); checks++
  await assert.rejects(insert(22, 200, pAperak), /ediel_wire_reference_namespace_collision/); checks++
  const beforeRetry=(await db.query('select jsonb_agg(to_jsonb(r) order by sender_namespace,reference_kind,wire_reference) r from gridex_ediel_wire_namespace.reservations r')).rows[0]
  const beforeMessages=(await db.query('select jsonb_agg(to_jsonb(m) order by id) m from public.ediel_messages m')).rows[0]
  await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(100), uid(21)])
  assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(r) order by sender_namespace,reference_kind,wire_reference) r from gridex_ediel_wire_namespace.reservations r')).rows[0],beforeRetry)
  assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(m) order by id) m from public.ediel_messages m')).rows[0],beforeMessages);checks++
  const acl = (await db.query("select has_function_privilege('authenticated','public.ediel_reserve_wire_reference_namespace_v1(uuid,uuid)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_wire_namespace.reservations','insert') direct_write")).rows[0]
  assert.deepEqual(acl, { user_rpc: false, direct_write: false }); checks++
  console.log(`Focused PostgreSQL chained namespace/blank-app-CONTRL/P-APERAK/collision/immutability/tenant/full-row-retry/ACL checks: ${checks} PASS`)
} finally { await modules.close(); await db.close() }
