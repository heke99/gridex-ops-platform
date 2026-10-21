// Finite actual PostgreSQL INSERT/trigger regression with declared synthetic
// catalog/message/receipt rows. This is not native, production or market proof.
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = resolve(process.env.EDIEL_NATIVE_SCHEMA_FILE || resolve(root, 'supabase/schema.sql'))
const schema = readFileSync(schemaPath, 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const migrationPath = 'supabase/migrations/20261021094313_ediel_swedish_utilts25a5_inbound_profile_supersession.sql'
const sql = existsSync(resolve(root, migrationPath)) ? readFileSync(resolve(root, migrationPath), 'utf8') : null
const signature = 'public.gridex_bind_inbound_ediel_rule_pack_evidence()'
const helper = 'gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(text,text,text,text,date)'
const beforeHash = 'ca403a7cb7fc48dd3a3e7aa13faa5533ed8c72f909090dd9ee0f6183933db391'
const afterHash = 'dc9335075c4e9f622f84c89d693d347f91c93768a9c8807fcc7ab499f18f75dd'
const needle = "    and rp.status in ('active','future')"
const replacement = needle + '\n    and NOT gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(rp.market,rp.family,rp.guide_version,rp.guide_revision,v_effective_date)'
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const matrix = []
let serial = 100
let insideTransaction = false

// Read a genuine schema input. A later captured post-fix definition is also
// usable: its exact two-filter inverse must recover the same old5062bytes.
// The command receipt records the whole input's SHA; no trigger port is used.
function fn(name) {
  const at = schema.indexOf('CREATE FUNCTION ' + name + '(')
  assert.ok(at >= 0, name)
  const tail = schema.slice(at), open = /\bAS (\$[\w]*\$)/.exec(tail)
  assert.ok(open, name)
  const end = tail.indexOf(open[1] + ';', open.index + open[0].length)
  assert.ok(end >= 0, name)
  return tail.slice(0, end + open[1].length + 1)
}
function table(name) {
  const at = schema.indexOf('CREATE TABLE ' + name + ' (')
  assert.ok(at >= 0, name)
  const end = schema.indexOf('\n);', at)
  assert.ok(end >= 0, name)
  return schema.slice(at, end + 3)
}
function bodyOf(definition) {
  const open = /\bAS (\$[\w]*\$)/.exec(definition)
  assert.ok(open)
  const start = open.index + open[0].length
  const end = definition.indexOf(open[1], start)
  assert.ok(end >= start)
  return definition.slice(start, end)
}
function predecessorDefinition(definition) {
  const body = bodyOf(definition)
  if (hash(body) === beforeHash) return definition
  assert.equal(hash(body), afterHash, 'Only the exact reviewed predecessor or successor is accepted')
  assert.equal(body.split(replacement).length - 1, 2)
  const predecessor = body.replaceAll(replacement, needle)
  assert.equal(hash(predecessor), beforeHash)
  return definition.replace(body, predecessor)
}
const inputBinderBodySHA256 = hash(bodyOf(fn('public.gridex_bind_inbound_ediel_rule_pack_evidence')))
const inputBinderKind = inputBinderBodySHA256 === beforeHash ? 'PRE' : 'POST'
assert.equal(hash(bodyOf(predecessorDefinition(fn('public.gridex_bind_inbound_ediel_rule_pack_evidence')))), beforeHash)
assert.equal(hash(bodyOf(fn('gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1'))), 'b55425f8b59404066120fe10804a5798175e76007acacc85fc3e41eb8325c37c')
assert.equal(hash(bodyOf(fn('gridex_ediel_source_rules.pack_effective_v1'))), '34402a992bdf463012257b21110fa1878f0657874ac427d6f93c82c89245ac9d')
assert.equal(hash(bodyOf(fn('gridex_ediel_header_negative_birth.is_bound_v1'))), '6c7da3256dc17fe810cdaa5885e85716ae7ffb50ab4829c6695cafc3adb3fe38')
assert.equal(hash(bodyOf(fn('gridex_ediel_header_negative_birth.evidence_v1'))), 'cc29b4668c2724093ee7ace8fc347334c1bedf39b2b172ef3f4bd3c0cb4b5ca2')
const names = [
  'public.gridex_bind_inbound_ediel_rule_pack_evidence',
  'gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1',
  'gridex_ediel_source_rules.pack_effective_v1',
  'gridex_ediel_source_rules.require_v1',
  'gridex_ediel_source_rules.immutable',
  'gridex_ediel_header_negative_birth.is_bound_v1',
  'gridex_ediel_header_negative_birth.evidence_v1'
]
const tables = ['public.ediel_rule_packs', 'public.ediel_message_profiles', 'public.ediel_messages',
  'gridex_ediel_header_negative_birth.receipts', 'gridex_ediel_source_rules.receipts']
const modulePath = process.env.EDIEL_PGLITE_MODULE
assert.ok(modulePath, 'Use the existing pinned PGlite module; do not install a backend')
const packageInfo = JSON.parse(readFileSync(resolve(dirname(modulePath), '../package.json'), 'utf8'))
assert.equal(packageInfo.name, '@electric-sql/pglite')
assert.equal(packageInfo.version, '0.3.14')
assert.match(process.version, /^v22\./)
const {PGlite} = await import(pathToFileURL(modulePath).href)
const db = new PGlite()

async function check(name, run) {
  await run()
  matrix.push(name)
  console.log(JSON.stringify({check: name, result: 'PASS'}))
}
async function rowState() {
  const out = {}
  for (const name of tables) out[name] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${name} t`)).rows[0].value
  return out
}
async function catalogState() {
  return (await db.query(`select jsonb_agg(to_jsonb(p) order by p.oid) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('gridex_ediel_source_rules','gridex_ediel_header_negative_birth') or p.oid=$1::regprocedure`, [signature])).rows[0].value
}
async function meta(name = signature) {
  return (await db.query("select p.oid,prosrc,to_jsonb(p)-'prosrc' metadata,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner from pg_proc p where p.oid=$1::regprocedure", [name])).rows[0]
}
async function transaction(run) {
  await db.exec('BEGIN')
  insideTransaction = true
  try { return await run() } finally { await db.exec('ROLLBACK'); insideTransaction = false }
}
async function refuses(action, expected) {
  if (!insideTransaction) return assert.rejects(action, expected)
  await db.exec('SAVEPOINT declared_expected_refusal')
  try { await assert.rejects(action, expected) } finally {
    await db.exec('ROLLBACK TO SAVEPOINT declared_expected_refusal; RELEASE SAVEPOINT declared_expected_refusal')
  }
}
async function insert(overrides = {}) {
  const n = ++serial
  const message = {id: uid(n), company_id: uid(90), environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', raw_payload: 'declared-wire-' + n, message_received_at: '2026-10-21T12:00:00Z', ...overrides}
  const keys = Object.keys(message)
  return (await db.query(`insert into public.ediel_messages(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning to_jsonb(ediel_messages) value`, keys.map(k => message[k]))).rows[0].value
}
function rejectsCount(action, count, date = '2026-10-21', family = 'UTILTS', code = 'E66') {
  return refuses(action, error => error.code === '23514' && error.message.includes(`canonical_inbound_rule_profile_resolution_failed:${family}:${code}:${date}:${count}`))
}
function assertU5(row, effectiveDate) {
  assert.equal(row.canonical_rule_pack_id, uid(5))
  assert.equal(row.rule_profile_version_id, uid(15))
  assert.equal(row.rule_profile_key, 'DECLARED:U5')
  assert.equal(row.rule_profile_version, '25-A-5:r5')
  assert.equal(row.rule_pack_checksum, '5'.repeat(64))
  assert.deepEqual(row.rule_pack_snapshot, {family: 'UTILTS', code: 'E66', direction: 'inbound', environment: 'test', profileKey: 'DECLARED:U5', profileVersionId: uid(15), version: '25-A-5:r5', checksum: '5'.repeat(64), authority: 'gridex_bind_inbound_ediel_rule_pack_evidence', databaseRole: 'evidence_only', effectiveDate})
  assert.equal(row.company_id, uid(90))
}
async function directAcl() {
  return (await db.query("select role,has_function_privilege(role,$1,'execute') helper,has_function_privilege(role,$2,'execute') binder from unnest(array['anon','authenticated','service_role']) role order by role", [helper, signature])).rows
}

try {
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE declared_denied_owner;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_header_negative_birth;SET TIME ZONE \'UTC\';')
  for (const name of tables) {
    await db.exec(table(name))
    for (const statement of schema.matchAll(/ALTER TABLE ONLY ([\w.]+)\n[\s\S]*?;/g)) {
      if (statement[1] === name && /ADD CONSTRAINT .* (PRIMARY KEY|UNIQUE) \(/.test(statement[0])) await db.exec(statement[0])
    }
  }
  for (const name of names) await db.exec(name === 'public.gridex_bind_inbound_ediel_rule_pack_evidence' ? predecessorDefinition(fn(name)) : fn(name))
  // Retain real source ACL statements. Synthetic INSERT/SELECT grants below
  // expose only this finite test port, never a production permission change.
  for (const statement of schema.matchAll(/(?:REVOKE|GRANT) [^;]+;/g)) {
    if (names.some(name => statement[0].includes('ON FUNCTION ' + name + '('))) await db.exec(statement[0])
    else if (['gridex_ediel_source_rules', 'gridex_ediel_header_negative_birth'].some(name => statement[0].includes('ON SCHEMA ' + name + ' '))) await db.exec(statement[0])
  }
  const trigger = schema.split('\n').find(line => line.startsWith('CREATE TRIGGER trg_gridex_bind_inbound_ediel_rule_pack_evidence '))
  assert.ok(trigger)
  await db.exec(trigger)
  await db.exec(`CREATE TRIGGER declared_protected_receipts_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_source_rules.receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_source_rules.immutable();
    GRANT USAGE ON SCHEMA public TO service_role;GRANT INSERT,SELECT ON public.ediel_messages TO service_role;`)
  await db.exec(`INSERT INTO public.ediel_rule_packs(id,market,family,guide_version,guide_revision,unh_association_code,valid_from,valid_to,status,source_document,source_hash) VALUES
    ('${uid(3)}','electricity','UTILTS','25-A-3','3','E5SE5A','2025-06-01','2026-09-30','active','declared historic U3','${'3'.repeat(64)}'),
    ('${uid(4)}','electricity','UTILTS','25-A-4','4','E5SE5A','2026-10-01',NULL,'future','declared historic U4','${'4'.repeat(64)}'),
    ('${uid(5)}','electricity','UTILTS','25-A-5','5','E5SE5A','2026-10-01',NULL,'active','declared Swedish U5','${'5'.repeat(64)}'),
    ('${uid(6)}','electricity','PRODAT','26.A','3','E2SE6A','2026-01-01',NULL,'future','declared PRODAT','${'6'.repeat(64)}');
    INSERT INTO public.ediel_message_profiles(id,rule_pack_id,message_code,direction,business_process,profile_key,profile) VALUES
    ('${uid(13)}','${uid(3)}','E66','inbound','declared','DECLARED:U3','{"family":"UTILTS"}'),
    ('${uid(14)}','${uid(4)}','E66','inbound','declared','DECLARED:U4','{"family":"UTILTS"}'),
    ('${uid(15)}','${uid(5)}','E66','inbound','declared','DECLARED:U5','{"family":"UTILTS"}'),
    ('${uid(16)}','${uid(6)}','Z03','inbound','declared','DECLARED:PRODAT','{"family":"PRODAT"}');`)
  const original = await meta(), helperOriginal = await meta(helper), oldCatalog = await catalogState()
  assert.equal(hash(original.prosrc), beforeHash)
  const beforeAcl = await directAcl()
  assert.deepEqual(beforeAcl, [
    {role: 'anon', helper: false, binder: false},
    {role: 'authenticated', helper: false, binder: false},
    {role: 'service_role', helper: false, binder: true}
  ])
  await check('actual_predecessor_INSERT_reproduces_count2_without_message_write', async () => {
    const before = await rowState()
    await rejectsCount(() => insert(), 2)
    assert.deepEqual(await rowState(), before)
  })
  // With the new forward absent the next actual INSERT is the external TDD
  // RED. The same final test source is then rerun with the authored forward.
  if (sql) await db.exec(sql)
  await check('prospective_INSERT_selects_exact_U5_on_Oct1_14_15_21', async () => {
    for (const date of ['2026-10-21', '2026-10-01', '2026-10-14', '2026-10-15']) await transaction(async () => assertU5(await insert({message_received_at: date + 'T12:00:00Z'}), date))
  })
  await check('whole_pg_proc_profile_only_two_predicates_and_inverse', async () => {
    const after = await meta()
    assert.equal(hash(after.prosrc), afterHash)
    assert.equal(after.prosrc.split(replacement).length - 1, 2)
    assert.equal(after.prosrc.replaceAll(replacement, needle), original.prosrc)
    assert.equal(bodyOf(predecessorDefinition(after.definition)), original.prosrc)
    assert.throws(() => predecessorDefinition(after.definition.replace(after.prosrc, after.prosrc + '\n-- declared unknown input\n')), /Only the exact reviewed predecessor or successor/)
    assert.deepEqual(after.metadata, original.metadata)
    assert.equal(after.oid, original.oid)
    assert.deepEqual(await meta(helper), helperOriginal)
    const afterCatalog = await catalogState()
    for (const item of afterCatalog) {
      const previous = oldCatalog.find(old => old.oid === item.oid)
      assert.ok(previous)
      assert.deepEqual(String(item.oid) === String(original.oid) ? {...item, prosrc: original.prosrc} : item, previous)
    }
    assert.equal(afterCatalog.length, oldCatalog.length)
    assert.equal((await db.query("select pg_get_triggerdef(oid) value from pg_trigger where tgname='trg_gridex_bind_inbound_ediel_rule_pack_evidence'")).rows.length, 1)
  })
  await check('missing_disabled_draft_retired_future_expired_U5_never_falls_back_to_U4', async () => {
    for (const change of ["DELETE FROM public.ediel_message_profiles WHERE rule_pack_id='" + uid(5) + "'", "UPDATE public.ediel_message_profiles SET is_enabled=false WHERE rule_pack_id='" + uid(5) + "'", "UPDATE public.ediel_rule_packs SET status='draft' WHERE id='" + uid(5) + "'", "UPDATE public.ediel_rule_packs SET status='retired' WHERE id='" + uid(5) + "'", "UPDATE public.ediel_rule_packs SET valid_from='2026-10-22' WHERE id='" + uid(5) + "'", "UPDATE public.ediel_rule_packs SET valid_to='2026-10-20' WHERE id='" + uid(5) + "'"]) await transaction(async () => {
      await db.exec(change)
      const before = await rowState()
      await rejectsCount(() => insert(), 0)
      assert.deepEqual(await rowState(), before)
    })
    await transaction(async () => {
      await db.query('delete from public.ediel_message_profiles where rule_pack_id=$1', [uid(5)])
      await db.query('delete from public.ediel_rule_packs where id=$1', [uid(5)])
      await rejectsCount(() => insert(), 0)
    })
  })
  await check('duplicate_valid_U5_still_refuses_count2', async () => transaction(async () => {
    await db.query("insert into public.ediel_message_profiles(id,rule_pack_id,message_code,direction,business_process,profile_key,profile) values($1,$2,'E66','both','declared','DECLARED:DUP','{\"family\":\"UTILTS\"}')", [uid(19), uid(5)])
    await rejectsCount(() => insert(), 2)
  }))
  await check('receipt_date_and_created_date_fallbacks_and_U3_original_calendar', async () => {
    await transaction(async () => assert.equal((await insert({message_received_at: '2026-09-30T12:00:00Z'})).rule_profile_version, '25-A-3:r3'))
    await transaction(async () => assertU5(await insert({message_received_at: null, created_at: '2026-10-14T12:00:00Z'}), '2026-10-14'))
    const current = (await db.query('select current_date::text value')).rows[0].value
    if (current >= '2026-10-01') await transaction(async () => {
      // created_at is a real NOT NULL column, so current_date is the source's
      // preserved final fallback, not a fabricated nullable-table scenario.
      assertU5(await insert({message_received_at: null}), current)
    })
    for (const [date, direction, wanted] of [['2026-10-01', 'inbound', true], ['2026-10-14', 'inbound', true], ['2026-10-15', 'inbound', false], ['2026-10-01', 'outbound', false], ['2026-10-14', 'outbound', false]]) {
      assert.equal((await db.query('select gridex_ediel_source_rules.pack_effective_v1($1,$2,$3) value', [uid(3), direction, date])).rows[0].value, wanted)
    }
    for (const direction of ['inbound', 'outbound']) assert.equal((await db.query("select gridex_ediel_source_rules.pack_effective_v1($1,$2,'2026-10-01') value", [uid(4), direction])).rows[0].value, false)
  })
  await check('historical_complete_original_and_partial_evidence_boundary', async () => {
    for (const version of [3, 4]) await transaction(async () => {
      await db.query('delete from public.ediel_message_profiles where rule_pack_id=$1', [uid(5)])
      const snapshot = {declaredOriginal: true, version: '25-A-' + version + ':r' + version, immutableHistorical: true}
      const fields = {canonical_rule_pack_id: uid(version), rule_profile_key: 'DECLARED:U' + version, rule_profile_version_id: uid(10 + version), rule_profile_version: '25-A-' + version + ':r' + version, rule_pack_checksum: String(version).repeat(64), rule_pack_snapshot: snapshot}
      const row = await insert(fields)
      for (const [name, value] of Object.entries(fields)) assert.deepEqual(row[name], value)
      const updated = (await db.query('update public.ediel_messages set message_received_at=message_received_at,status=\'received\' where id=$1 returning to_jsonb(ediel_messages) value', [row.id])).rows[0].value
      for (const [name, value] of Object.entries(fields)) assert.deepEqual(updated[name], value)
      await rejectsCount(() => insert({...fields, rule_pack_checksum: null}), 0)
    })
    await transaction(async () => {
      const row = await insert({canonical_rule_pack_id: uid(4), rule_profile_key: 'PARTIAL:OLD', rule_profile_version: '25-A-4:r4'})
      assertU5(row, '2026-10-21')
    })
  })
  await check('actual_original_receipt_require_rejects_company_digest_environment_drift', async () => transaction(async () => {
    const row = await insert(), basis = {declaredImmutableOriginal: true, version: row.rule_profile_version, snapshot: row.rule_pack_snapshot}
    await db.query('insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence)values($1,$2,$3,$4,$5,$6)', [row.id, row.company_id, row.environment, row.direction, hash(row.raw_payload), basis])
    const require = company => db.query('select gridex_ediel_source_rules.require_v1($1,$2) value', [company, row.id])
    assert.deepEqual((await require(row.company_id)).rows[0].value, basis)
    await refuses(() => require(uid(91)), /basis_required/)
    await db.query('update public.ediel_messages set raw_payload=raw_payload||\'tampered\' where id=$1', [row.id])
    await refuses(() => require(row.company_id), /basis_required/)
    await db.query('update public.ediel_messages set raw_payload=$2,environment=\'production\' where id=$1', [row.id, row.raw_payload])
    await refuses(() => require(row.company_id), /basis_required/)
    await refuses(() => db.exec('update gridex_ediel_source_rules.receipts set evidence=\'{}\''), /basis_immutable/)
    await refuses(() => db.exec('delete from gridex_ediel_source_rules.receipts'), /basis_immutable/)
  }))
  await check('negative_birth_pending_INSERT_consumed_UPDATE_and_changed_scope_refusal', async () => transaction(async () => {
    const id = uid(++serial), company = uid(90), actor = uid(92), mail = uid(93), raw = 'declared-negative-original'
    const facts = {messageCode: 'Z99', applicationReference: 'DECLARED', senderEdielId: 'SENDER', receiverEdielId: 'RECEIVER', interchangeReference: 'DECLARED-INT'}
    const evidence = {declaredAssignedNegative: id}
    await db.query(`insert into gridex_ediel_header_negative_birth.receipts values($1,$2,'test',$3,$4,$5,$6,'2026-10-21T12:00:00Z',clock_timestamp(),txid_current(),'pending',$7,$8)`, [id, company, actor, mail, uid(94), hash(raw), facts, evidence])
    const row = await insert({id, company_id: company, created_by: actor, inbound_email_message_id: mail, mailbox_message_id: mail, resolved_company_id: company, message_family: 'PRODAT', message_code: 'Z99', raw_payload: raw, application_reference: facts.applicationReference, sender_ediel_id: facts.senderEdielId, receiver_ediel_id: facts.receiverEdielId, interchange_reference: facts.interchangeReference})
    assert.equal(row.canonical_rule_pack_id, null)
    await db.query("update gridex_ediel_header_negative_birth.receipts set status='consumed' where source_message_id=$1", [id])
    const updated = (await db.query("update public.ediel_messages set status='received',message_received_at=message_received_at where id=$1 returning to_jsonb(ediel_messages) value", [id])).rows[0].value
    assert.equal(updated.status, 'received')
    assert.equal(updated.canonical_rule_pack_id, null)
    assert.deepEqual((await db.query('select gridex_ediel_header_negative_birth.evidence_v1(m) value from public.ediel_messages m where id=$1', [id])).rows[0].value, evidence)
    for (const assignment of ["raw_payload=raw_payload||'changed'", "company_id='" + uid(91) + "'", "sender_ediel_id='CHANGED'"]) await rejectsCount(() => db.query('update public.ediel_messages set ' + assignment + ',message_received_at=message_received_at where id=$1', [id]), 0, '2026-10-21', 'PRODAT', 'Z99')
    assert.deepEqual((await db.query('select to_jsonb(m) value from public.ediel_messages m where id=$1', [id])).rows[0].value, updated)
  }))
  await check('PRODAT_outbound_other_family_null_company_behavior_unchanged', async () => {
    const current = await meta()
    for (const overrides of [{message_family: 'PRODAT', message_code: 'Z03'}, {direction: 'outbound'}, {message_family: 'CONTRL', message_code: 'CONTRL'}, {company_id: null}]) {
      let oldRow
      await transaction(async () => {
        await db.exec(original.definition)
        oldRow = await insert({id: uid(900), created_at: '2026-10-21T12:00:00Z', updated_at: '2026-10-21T12:00:00Z', raw_payload: 'comparison-wire', ...overrides})
      })
      await transaction(async () => assert.deepEqual(await insert({id: uid(900), created_at: '2026-10-21T12:00:00Z', updated_at: '2026-10-21T12:00:00Z', raw_payload: 'comparison-wire', ...overrides}), oldRow))
    }
    assert.deepEqual(await meta(), current)
  })
  await check('service_INSERT_uses_unchanged_definer_owner_without_broadening_helper_ACL', async () => {
    assert.deepEqual(await directAcl(), beforeAcl)
    await db.exec('SET ROLE service_role')
    try {
      assertU5(await insert(), '2026-10-21')
      await assert.rejects(db.query("select gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1('electricity','UTILTS','25-A-4','4','2026-10-21')"), /permission denied/)
    } finally { await db.exec('RESET ROLE') }
    assert.deepEqual(await directAcl(), beforeAcl)
  })
  await check('wrong_predecessor_helper_or_owner_access_path_aborts_without_changes', async () => {
    const current = await meta()
    for (const fault of ['predecessor', 'helper', 'owner']) {
      const wholeBeforeRows = await rowState(), wholeBeforeCatalog = await catalogState()
      await db.exec('BEGIN')
      if (fault === 'predecessor') await db.exec(current.definition.replace(current.prosrc, original.prosrc + '\n-- declared drift\n'))
      else {
        await db.exec(original.definition)
        if (fault === 'helper') await db.exec(helperOriginal.definition.replace(helperOriginal.prosrc, helperOriginal.prosrc + '\n-- declared drift\n'))
        else await db.exec('ALTER FUNCTION ' + signature + ' OWNER TO declared_denied_owner')
      }
      // The forward owns BEGIN/COMMIT; BEGIN inside this test transaction is
      // intentional. Its failure rolls back exactly this declared fault too.
      await assert.rejects(db.exec(sql), new RegExp(fault === 'predecessor' ? 'selector_predecessor_required' : fault === 'helper' ? 'supersession_source_required' : 'owner_path_required'))
      await db.exec('ROLLBACK')
      assert.deepEqual(await meta(), current)
      assert.deepEqual(await meta(helper), helperOriginal)
      assert.deepEqual(await rowState(), wholeBeforeRows)
      assert.deepEqual(await catalogState(), wholeBeforeCatalog)
    }
    const before = await rowState(), catalog = await catalogState()
    await assert.rejects(db.exec(sql), /selector_predecessor_required/)
    await db.exec('ROLLBACK')
    assert.deepEqual(await rowState(), before)
    assert.deepEqual(await catalogState(), catalog)
  })
  console.log(JSON.stringify({scope: 'finite_actual_INSERT_trigger_SQL_with_synthetic_catalog_not_native', migration: migrationPath, sqlSHA256: hash(sql), sourceSchemaSHA256: hash(schema), sourceSchemaBytes: Buffer.byteLength(schema), inputBinderKind, inputBinderBodySHA256, checks: matrix.length, matrix, result: 'PASS', native: 'NOT_RUN', production: 'NOT_RUN'}))
} finally {
  await db.close()
}
