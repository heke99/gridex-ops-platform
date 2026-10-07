// Finite physical serialization/append proof on PGlite. Registered witness,
// source row and canonical field decision are declared synthetic input ports.
// No source admission, native ACK, generated parity or whole H acceptance.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
const {PGlite} = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const definition = name => {
  const start = schema.indexOf(`CREATE FUNCTION gridex_received_sources.${name}(`)
  assert(start >= 0)
  const end = schema.indexOf('\n\n--\n-- Name:', start)
  assert(end > start)
  return schema.slice(start, end)
}
const signature = 'gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'
const forwardPath = '../supabase/migrations/20261007212410_ediel_rejected_identity_register_scope.sql'
const baseline = process.env.EDIEL_REJECTED_SCOPE_BASELINE === '1'
let checks = 0
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA gridex_received_sources;
    CREATE TABLE public.ediel_rule_packs(id uuid PRIMARY KEY, guide_version text, guide_revision text, source_hash text);
    CREATE TABLE public.ediel_message_profiles(id uuid PRIMARY KEY, rule_pack_id uuid, profile_key text);
    CREATE TABLE public.ediel_rule_pack_sources(id uuid PRIMARY KEY, rule_pack_id uuid, title text);
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY, company_id uuid, environment text, message_family text);
    CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY, company_id uuid, environment text,
      payload_hash text, received_context jsonb, raw_payload text);
    CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_message_id uuid, company_id uuid, environment text, source_payload_hash text, previous_assessment_id uuid,
      facts_text text, facts_hash text);
    INSERT INTO public.ediel_rule_packs VALUES('${uid(1)}','26-A','3','${'a'.repeat(64)}');
    INSERT INTO public.ediel_message_profiles VALUES('${uid(2)}','${uid(1)}','SYNTHETIC-PRODAT-PHYSICAL-SERIALIZATION');
    INSERT INTO public.ediel_rule_pack_sources VALUES('${uid(3)}','${uid(1)}','declared finite registered witness');
    INSERT INTO public.ediel_messages VALUES('${uid(4)}','${uid(100)}','test','PRODAT');`)
  const lexer = readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql', import.meta.url), 'utf8')
  await db.exec(lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),
    lexer.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1')))
  await db.exec(definition('identity_omission_cases_v1') + definition('identity_omission_scope_v1') + definition('append_validation_before_reference_profile_v1'))
  await db.exec(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`)
  const catalog = async () => (await db.query('SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid=$1::regprocedure', [signature])).rows[0].metadata
  const before = await catalog()
  const snapshot = (await db.query(`SELECT jsonb_build_object('rulePack',(SELECT to_jsonb(p) FROM public.ediel_rule_packs p),
    'messageProfile',(SELECT to_jsonb(p) FROM public.ediel_message_profiles p),
    'guideSources',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.ediel_rule_pack_sources p)) value`)).rows[0].value
  const pack = {profileKey: snapshot.messageProfile.profile_key, messageProfileId: uid(2), rulePackId: uid(1),
    sourceHash: 'a'.repeat(64), version: '26-A:r3', snapshot}
  const line = (n = 1, identity = ':::9', li = `L${n}`, reason = 'Z25') =>
    `LIN+${n}++${identity}'CCI++Z13'CAV+${reason}'RFF+LI:${li}'NAD+UD+199001011234:SE2:260'`
  const wire = (body = line(), code = 'Z05') => `UNH+DOC+PRODAT:D:96B:UN'BGM+${code}+DOC+9'${body}UNT+8+DOC'`
  const input = async (raw = wire(), disposition = 'rejected') => {
    const tokens = (await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) tokens', [raw])).rows[0].tokens
    const objects = tokens.filter(t => t.tag === 'LIN').map((t, i) => ({messageIndex: 0, messageReference: 'DOC',
      objectId: t.elements[3]?.[0] || null, identityAgency: t.elements[3]?.[3] || null, disposition,
      registers: [{lineIndex: i, lineNumber: t.elements[1]?.[0] || null, registerIndex: null, registerPosition: 1, segmentIndex: t.index}],
      reasons: disposition === 'accepted' ? [] : ['FIELD_MATRIX_FIELD_FORMAT_INVALID']}))
    return {raw, facts: {version: 1, owner: 'canonical-runtime-with-registry-v1', sourceDisposition: 'not_established',
      objectDisposition: 'not_checked', partyDisposition: 'not_checked', coverage: 'canonical_runtime_only',
      originalTenantMatch: 'matched', syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'not_applicable',
      messageReference: 'DOC', reasonCodes: ['FIELD_MATRIX_FIELD_FORMAT_INVALID'], rulePackEvidence: pack,
      registerValidation: {version: 1, owner: 'validateProdatRegisterPolicy', coverage: 'canonical_register_only', objects}}}
  }
  const seed = async value => {
    await db.query(`INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',encode(sha256(convert_to($3,'UTF8')),'hex'),'{"contextOrigin":"declared_finite_port"}',$3)
      ON CONFLICT(source_message_id) DO UPDATE SET payload_hash=excluded.payload_hash,raw_payload=excluded.raw_payload`, [uid(4), uid(100), value.raw])
    return (await db.query('SELECT payload_hash FROM gridex_received_sources.sources WHERE source_message_id=$1', [uid(4)])).rows[0].payload_hash
  }
  const call = async (value, options = {}) => {
    const hash = await seed(value)
    if (options.purged) await db.query('UPDATE gridex_received_sources.sources SET raw_payload=NULL WHERE source_message_id=$1', [uid(4)])
    return (await db.query(`SELECT ${signature.slice(0, signature.indexOf('('))}($1,$2,$3,$4,$5) receipt`,
      [uid(options.company ?? 100), options.env ?? 'test', uid(4), options.hash ?? hash, JSON.stringify(value.facts)])).rows[0].receipt
  }
  const count = async () => (await db.query('SELECT count(*)::int n FROM gridex_received_sources.validation_assessments')).rows[0].n
  const refused = async (value, message, options) => {
    const n = await count()
    await assert.rejects(call(value, options), {code: '23514', message})
    assert.equal(await count(), n); checks += 2
  }
  for (const value of [await input(wire(line(1, '735123456789012345:::9')), 'accepted'),
    await input(wire("LIN+1'CCI++Z13'CAV+Z96'RFF+LI:L1'", 'Z14'), 'accepted')]) {
    assert.ok((await call(value)).assessmentId); checks++
  }
  const required = await input()
  if (!baseline) {
    await refused(required, 'received_register_unvalidated_scope')
    await db.exec(readFileSync(new URL(forwardPath, import.meta.url), 'utf8'))
    const after = await catalog(), {prosrc: oldBody, ...oldMetadata} = before, {prosrc: newBody, ...newMetadata} = after
    assert.deepEqual(newMetadata, oldMetadata)
    const oldTerm = "(obj->>'disposition'='accepted' AND gridex_received_sources.identity_omission_scope_v1(src.raw_payload,obj))"
    const newTerm = `(${oldTerm} OR (obj->>'disposition'='rejected' AND gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE))`
    assert.equal(newBody.split(newTerm).join(oldTerm), oldBody); checks += 2
  }
  // In baseline mode the actual current append fails here with its precise
  //23514 guard. Setup and both preserved controls must already have passed.
  const accepted = await call(required)
  assert.ok(accepted.assessmentId)
  assert.equal(accepted.sourceDisposition, 'not_established'); checks += 2
  if (baseline) throw Error('baseline_expected_real_guard_failure')
  for (const raw of [wire("LIN+1'CCI++Z13'CAV+Z25'RFF+LI:L1'"), wire(line(1, ':::9', 'L1', 'Z22')),
    wire(line() + line(2)), wire(line(1, '735123456789012345:::9') + line(2))]) {
    const receipt = await call(await input(raw)); assert.ok(receipt.assessmentId); checks++
  }
  // Existing lawful omission and ordinary nonnull acceptance remain available.
  for (const value of [await input(wire(line(1, '735123456789012345:::9')), 'accepted'),
    await input(wire("LIN+1'CCI++Z13'CAV+Z96'RFF+LI:L1'", 'Z14'), 'accepted')]) {
    assert.ok((await call(value)).assessmentId); checks++
  }
  await refused(await input(wire(), 'accepted'), 'received_register_unvalidated_scope')
  const mutations = [v => {v.facts.registerValidation.objects[0].identityAgency = '89'},
    v => {v.facts.registerValidation.objects[0].messageReference = 'FOREIGN'},
    v => {v.facts.registerValidation.objects[0].registers[0].segmentIndex++},
    v => {v.facts.registerValidation.objects[0].registers[0].lineIndex++},
    v => {v.facts.registerValidation.objects[0].registers[0].lineNumber = '2'}]
  for (const mutate of mutations) {
    const value = structuredClone(required); mutate(value)
    await refused(value, 'received_register_unvalidated_scope')
  }
  for (const raw of [wire(line(2)), wire(line(1, ':::9', 'L1', 'Z24')), wire(line() + line(2, ':::9', 'L2', 'Z22')),
    wire(line() + line(2, ':::9', 'L1')), wire(line().replace('RFF+LI:L1', 'RFF+LI:')),
    wire(line().replace('RFF+LI:L1', 'NAD+UD+FOREIGN\'RFF+LI:L1')),
    wire(line().replace('LIN+1++:::9', 'LIN+1++:::9+1:1')),
    wire(line()).replace('PRODAT:D', 'UTILTS:D'), wire(line()).replace('UNH+DOC', 'UNH+FOREIGN')]) {
    await refused(await input(raw), 'received_register_unvalidated_scope')
  }
  await refused(required, 'received_register_unvalidated_scope', {purged: true})
  for (const options of [{hash: '0'.repeat(64)}, {company: 101}, {env: 'production'}])
    await refused(required, 'received_validation_source_unavailable', options)
  const forged = structuredClone(required); forged.facts.rulePackEvidence.snapshot.rulePack.guide_revision = '999'
  await refused(forged, 'received_validation_rule_evidence_unavailable')
  const extra = structuredClone(required); extra.facts.registerValidation.objects[0].extra = true
  await refused(extra, 'received_register_object_invalid')
  const promoted = structuredClone(required); promoted.facts.sourceDisposition = 'accepted'
  await refused(promoted, 'received_validation_not_source_approval')
  const persisted = (await db.query('SELECT facts_text::jsonb facts,previous_assessment_id FROM gridex_received_sources.validation_assessments ORDER BY id')).rows
  assert(persisted.some(v => v.previous_assessment_id))
  assert(persisted.every(v => v.facts.sourceDisposition === 'not_established' && v.facts.objectDisposition === 'not_checked'
    && v.facts.partyDisposition === 'not_checked' && v.facts.coverage === 'canonical_runtime_only')); checks += 2
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_received_sources.rejected_identity_scope_v1(text,jsonb)','execute') ok", [role])).rows[0].ok, false)
    checks++
  }
  const after = await catalog()
  // Unknown predecessor: mutate an unrelated body byte in a private transaction,
  // remove only the new helper and exercise the actual forward's strict guard.
  await db.exec('BEGIN')
  await db.exec('DROP FUNCTION gridex_received_sources.rejected_identity_scope_v1(text,jsonb)')
  const currentDefinition = (await db.query('SELECT pg_get_functiondef($1::regprocedure) def', [signature])).rows[0].def
  await db.exec(currentDefinition.replace('-- Lock per source', '-- Unknown predecessor Lock per source'))
  await assert.rejects(db.exec(readFileSync(new URL(forwardPath, import.meta.url), 'utf8')),
    {code: '23514', message: 'rejected_identity_append_owner_changed'})
  await db.exec('ROLLBACK')
  assert.deepEqual(await catalog(), after)
  assert.equal((await db.query("SELECT to_regprocedure('gridex_received_sources.rejected_identity_scope_v1(text,jsonb)') IS NOT NULL ok")).rows[0].ok, true); checks += 3
  console.log(JSON.stringify({status: 'PASS', checks, scope: 'actual current append/lexer/old omission plus forward; finite witness/source/decision ports; no native/parity/whole credit'}))
} catch (error) {
  console.error(JSON.stringify({status: 'FAIL', baseline, checks, code: error.code, message: error.message}))
  process.exitCode = 1
} finally {await db.close()}
