// Actual parser and retained SQL owner, with the parent's declared finite
// authority/mail/attempt fixture. No native or authentic delivery evidence.
import { readFileSync, existsSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, SourceTextModule } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

process.env.EDIEL_DSN_EXTENDED_REGRESSION = '1'
const { db, uid, c, actor, mailbox, quote } = await import('./ediel-dsn-source-observation-sql-regression.mjs')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const context = createContext({ Buffer }), modules = new Map()
const load = file => {
  if (!modules.has(file)) modules.set(file, new SourceTextModule(stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' }), { context, identifier: file }))
  return modules.get(file)
}
const entry = load(resolve(root, 'lib/inbound-mail/dsnDisposition.ts'))
await entry.link((name, parent) => {
  assert.equal(name, './mimeStructure', 'only the actual pure MIME dependency is allowed')
  return load(resolve(dirname(parent.identifier), name + '.ts'))
})
await entry.evaluate()
const parse = raw => JSON.parse(JSON.stringify(entry.namespace.parseDeliveryStatusReport(raw)))
const sourceHash = raw => createHash('sha256').update(raw, 'utf8').digest('hex')
const source = (id, recipient, encoded) => {
  const status = `Reporting-MTA: dns; synthetic.invalid\r\n\r\nFinal-Recipient: rfc822; ${recipient}\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 synthetic exact refusal`
  const headers = `Message-ID: ${id}\r\nContent-Type: application/EDIFACT\r\n`
  const encode = value => encoded === 'quoted-printable' ? [...Buffer.from(value)].map(b => '=' + b.toString(16).padStart(2, '0')).join('') : encoded ? Buffer.from(value).toString('base64') : value
  const cte = encoded ? `Content-Transfer-Encoding: ${encoded === 'quoted-printable' ? encoded : 'base64'}\r\n` : ''
  return `Content-Type: multipart/report; report-type=${encoded ? 'global-' : ''}delivery-status; boundary=dsn\r\n\r\n--dsn\r\nContent-Type: message/${encoded ? 'global-' : ''}delivery-status\r\n${cte}\r\n${encode(status)}\r\n\r\n--dsn\r\nContent-Type: ${encoded ? 'message/global-headers' : 'text/rfc822-headers'}\r\n${cte}\r\n${encode(headers)}\r\n--dsn--\r\n`
}
const record = async (mail, raw, report, extra = {}) => {
  await db.exec('SET ROLE service_role')
  try { return (await db.query('SELECT public.ediel_record_dsn_source_observation_v1($1::jsonb) receipt', [
    JSON.stringify({ companyId: c, actorUserId: actor, inboundEmailMessageId: mail, sourceField: 'raw_email', sourceHash: sourceHash(raw), report, ...extra }),
  ])).rows[0].receipt } finally { await db.exec('RESET ROLE') }
}
let checks = 0
try {
  assert.equal(process.exitCode ?? 0, 0, 'inherited checks must pass')
  await db.exec('ALTER TABLE public.ediel_mailboxes ADD COLUMN smtp_from text')
  await db.exec(readFileSync(resolve(root, 'supabase/migrations/20261001142630_ediel_dsn_sending_mailbox_parameter_qualified.sql'), 'utf8'))
  assert.equal((await db.query('SELECT gridex_ediel_transport.dsn_sending_mailbox_v1($1,$2,$3) mailbox', [c, 'test', 'sender@example.invalid'])).rows[0].mailbox, mailbox); checks++
  const metadata = async () => (await db.query("SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) metadata FROM pg_proc p WHERE p.oid IN ('gridex_ediel_transport.record_dsn_v1(jsonb)'::regprocedure,'public.ediel_record_dsn_source_observation_v1(jsonb)'::regprocedure)")).rows[0].metadata
  const oldMetadata = await metadata()
  // No forward input deliberately reproduces the original literal-source RED.
  for (const file of (process.env.EDIEL_DSN_FORWARD_MIGRATIONS ?? '').split(',').filter(Boolean)) {
    const path = resolve(root, 'supabase/migrations', file)
    assert.ok(existsSync(path)); await db.exec(readFileSync(path, 'utf8'))
  }
  assert.deepEqual(await metadata(), oldMetadata); checks++
  const states = async () => (await db.query(`SELECT jsonb_build_object(
    'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_ediel_transport.attempts a),
    'sealed',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_outbound_dispatch.attempts a),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM gridex_outbound_dispatch.events e),
    'witnesses',(SELECT jsonb_agg(to_jsonb(w) ORDER BY event_id) FROM gridex_outbound_dispatch.witnesses w),
    'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM ediel_messages m),
    'memberships',(SELECT jsonb_agg(to_jsonb(m)) FROM company_memberships m),
    'profiles',(SELECT jsonb_agg(to_jsonb(p)) FROM user_profiles p)) state`)).rows[0].state
  for (const fixture of [
    { n: 30, encoded: false, field: 'raw_email' }, { n: 40, encoded: true, field: 'raw_email' },
    { n: 50, encoded: true, field: 'raw_email', sealed: true },
    { n: 60, encoded: 'quoted-printable', field: 'body_text' },
    { n: 70, encoded: true, field: 'attachment', forwarded: true },
  ]) {
    const { n, encoded, field, sealed, forwarded } = fixture, mid = uid(n), aid = uid(n + 1), mail = uid(n + 2)
    const id = `<original-${n}@example.invalid>`, recipient = `recipient-${n}@example.invalid`
    const inner = source(id, recipient, encoded)
    const raw = forwarded ? `Content-Type: multipart/mixed; boundary*=UTF-8''outer%2Dboundary\r\n\r\n--outer-boundary\r\nContent-Type: message/rfc822\r\n\r\n${inner}\r\n--outer-boundary--\r\n` : inner
    const report = parse(raw)
    assert.deepEqual(report.issues, []); assert.deepEqual(report.originalMessageIds, [id])
    if (encoded) { assert.equal(raw.includes(id), false); assert.equal(raw.includes(recipient), false) }
    const binding = quote(JSON.stringify({ rfcMessageId: id, to: recipient, sourceMailboxId: mailbox }))
    await db.exec(`INSERT INTO ediel_messages VALUES('${mid}','${c}','outbound','test');
      INSERT INTO inbound_email_messages VALUES('${mail}','${c}','${mailbox}','test',${field === 'raw_email' ? quote(raw) : 'NULL'},${field === 'body_text' ? quote(raw) : 'NULL'},'received');`)
    if (sealed) await db.exec(`INSERT INTO gridex_outbound_dispatch.attempts VALUES('${aid}','${mid}','${c}','test',${binding}::jsonb,now());
      INSERT INTO gridex_outbound_dispatch.events VALUES('${uid(n + 3)}','${aid}','${c}','test','provider_call_entered',now(),'{}'),('${uid(n + 4)}','${aid}','${c}','test','provider_result',now(),'{"classification":"accepted"}');
      INSERT INTO gridex_outbound_dispatch.witnesses VALUES('${uid(n + 3)}','${c}','test');`)
    else await db.exec(`INSERT INTO gridex_ediel_transport.attempts VALUES('${aid}','${mid}','${c}','test',${binding}::jsonb,now(),now(),now(),'accepted')`)
    const extra = { sourceField: field, attachmentId: field === 'attachment' ? uid(n + 3) : null }
    if (field === 'attachment') await db.exec(`INSERT INTO inbound_email_attachments VALUES('${extra.attachmentId}','${mail}',${quote(raw)})`)
    const before = await states()
    const observed = await record(mail, raw, report, extra)
    assert.equal(observed.attemptId, aid); assert.equal(observed.messageId, mid)
    assert.equal(observed.sourceHash, sourceHash(raw)); assert.equal(observed.authorizesResend, false); assert.equal(observed.deliveryProven, false)
    assert.deepEqual((await db.query('SELECT report FROM gridex_ediel_transport.dsn_observations WHERE id=$1', [observed.observationId])).rows[0].report, report)
    assert.equal((await db.query('SELECT lane FROM gridex_ediel_transport.dsn_observations WHERE id=$1', [observed.observationId])).rows[0].lane, sealed ? 'sealed_z08' : 'generic_journal')
    assert.deepEqual(await states(), before)
    assert.deepEqual(await record(mail, raw, report, extra), observed); checks++
    if (encoded === true && !sealed && !forwarded) {
      const refused = async forged => { await assert.rejects(record(mail, raw, forged, extra), /ediel_dsn_source_invalid/); checks++ }
      await refused({ ...report, originalMessageIds: ['<forged@example.invalid>'] })
      const recipientReport = report.recipients[0]
      for (const change of [
        { finalRecipient: { type: 'rfc822', address: 'forged@example.invalid' } },
        { action: 'delivered', status: '2.0.0' }, { diagnosticCode: { type: 'smtp', text: '250 forged' } },
        { originalRecipient: { type: 'rfc822', address: 'forged@example.invalid' } },
        { remoteMta: { type: 'dns', address: 'forged.invalid' } }, { lastAttemptDate: 'forged date' },
      ]) await refused({ ...report, recipients: [{ ...recipientReport, ...change }] })
      await refused({ ...report, reportingMta: { type: 'dns', address: 'forged.invalid' } })
      await refused({ ...report, originalEnvelopeId: 'forged envelope' })
      assert.deepEqual(await states(), before)
    }
  }
  if (process.env.EDIEL_DSN_FORWARD_MIGRATIONS) {
    const id = '<identity@example.invalid>', recipient = 'identity@example.invalid', raw = source(id, recipient, false), report = parse(raw)
    const matches = async (value, expected = report) => (await db.query('SELECT gridex_ediel_transport.dsn_source_identity_matches_v1($1,$2::jsonb) matches', [value, JSON.stringify(expected)])).rows[0].matches
    assert.equal(await matches(raw), true); checks++
    for (const invalid of [
      raw.replace('Content-Type: multipart/report;', 'Content-Type: text/plain;'),
      raw.replace('Action: failed', 'Action: failed\r\nAction: failed'),
      raw.replace(`Message-ID: ${id}`, `Message-ID: ${id}\r\nMessage-ID: ${id}`),
      raw.replace('Status: 5.1.1', 'Status: 5.1.1\r\n\r\nFinal-Recipient: rfc822; second@example.invalid\r\nAction: failed\r\nStatus: 5.1.1'),
      raw.replace('--dsn--', '--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; forged.invalid\r\n--dsn--'),
      raw.replace('Content-Type: message/delivery-status', 'Content-Type: message/delivery-status\r\nContent-Type: text/plain'),
      raw.replace('--dsn--', ''),
      source(id, recipient, true).replace('Content-Transfer-Encoding: base64', 'Content-Transfer-Encoding: invalid'),
      source(id, recipient, true).replace('\r\n\r\nUmVwb3J0', '\r\n\r\n!UmVwb3J0'),
      source(id, recipient, 'quoted-printable').replace('=52=65', '=ZZ=65'),
      `Content-Type: multipart/mixed; boundary*=UTF-8''bad%ZZ\r\n\r\n${raw}`,
      `Content-Type: text/plain\r\nX-Limit: ${'x'.repeat(65536)}\r\n\r\n${raw}`,
      Array.from({ length: 18 }, () => 'Content-Type: message/rfc822\r\n\r\n').join('') + raw,
    ]) { assert.equal(await matches(invalid), false); checks++ }
    // Identity text in prose cannot repair mismatching encoded typed fields.
    assert.equal(await matches(source('<forged@example.invalid>', 'forged@example.invalid', true) + `\r\n${id} ${recipient}`), false); checks++
    const acl = (await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.dsn_source_identity_matches_v1(text,jsonb)','execute') service,has_function_privilege('anon','gridex_ediel_transport.dsn_source_identity_matches_v1(text,jsonb)','execute') anon,has_function_privilege('authenticated','gridex_ediel_transport.dsn_source_identity_matches_v1(text,jsonb)','execute') authenticated")).rows[0]
    assert.deepEqual(acl, { service: false, anon: false, authenticated: false }); checks++
  }
  console.log(`PASS ${checks} TR-04 actual parser/current qualifier/encoded source-owner checks; finite ports, no native or authentic delivery claim`)
} catch (error) { console.error(`FAIL TR-04 after ${checks} checks: ${error.message}`); process.exitCode = 1 }
finally { await db.close() }
