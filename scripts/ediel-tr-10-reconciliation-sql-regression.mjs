// masterplan: TR-10, AT-TR-10, SC-063
// Actual journal/result/copy SQL with explicitly finite actor, source and archive
// fixtures. This is not native source origination or authentic external SMTP.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const file = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const c = uid(1), actor = uid(2), original = 'DECLARED ORIGINAL', hash = createHash('sha256').update(original).digest('hex')
let checks = 0
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE companies(id uuid PRIMARY KEY); CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz); CREATE TABLE user_profiles(id uuid,user_status text); CREATE TABLE declared_permissions(actor uuid,allowed bool); CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE SQL AS 'SELECT coalesce((SELECT allowed FROM public.declared_permissions WHERE actor=$1),false)'; CREATE FUNCTION canonical_tenant_operation_decision(uuid,text) RETURNS TABLE(allowed bool) LANGUAGE SQL AS 'SELECT true'; CREATE FUNCTION ediel_require_scoped_capability_for_message_v1(uuid,uuid) RETURNS void LANGUAGE SQL AS 'SELECT NULL::void'; CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,communication_route_id uuid,receiver_email text,original_message_id text); CREATE TABLE ediel_message_payloads(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid,encrypted_payload_ref text,payload_kind text,metadata jsonb); CREATE TABLE ediel_outbox(id uuid PRIMARY KEY,company_id uuid,environment text,ediel_message_id uuid,status text,current_send_attempt_id uuid,locked_by text,locked_at timestamptz,updated_by uuid); CREATE SCHEMA gridex_ediel_ack_replay; CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE SQL AS 'SELECT NULL::void'; CREATE SCHEMA gridex_outbound_dispatch; CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RETURNS jsonb LANGUAGE SQL AS $$SELECT '{\"scoped\":false}'::jsonb$$;")
  await db.exec(file('20260930145115_ediel_generic_transport_attempts_v1.sql'))
  await db.exec("CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid PRIMARY KEY,company_id uuid,environment text,raw_payload text,payload_hash text,facts jsonb); CREATE TABLE gridex_outbound_dispatch.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,actor_user_id uuid,owner jsonb,binding jsonb); CREATE TABLE gridex_outbound_dispatch.reservations(message_id uuid PRIMARY KEY,attempt_id uuid,state text); CREATE TABLE gridex_outbound_dispatch.events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid,attempt_id uuid,company_id uuid,environment text,kind text,facts jsonb,observed_at timestamptz DEFAULT now(),created_xid xid8 DEFAULT pg_current_xact_id(),UNIQUE(attempt_id,kind)); CREATE TABLE gridex_outbound_dispatch.witnesses(event_id uuid PRIMARY KEY,company_id uuid,environment text,created_xid xid8 DEFAULT pg_current_xact_id());")
  const sealed = file('20260930215148_ediel_h_current_authorized_send_permission.sql')
  await db.exec(sealed.slice(sealed.indexOf('CREATE OR REPLACE FUNCTION'), sealed.indexOf('END $$;') + 8))
  await db.exec(file('20260930164356_ediel_transport_copy_read_v1.sql'))
  await db.query("INSERT INTO companies VALUES($1);", [c])
  await db.query("INSERT INTO auth.users VALUES($1);", [actor])
  await db.query("INSERT INTO user_profiles VALUES($1,'active');", [actor])
  await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now());", [c, actor])
  await db.query("INSERT INTO declared_permissions VALUES($1,true);", [actor])
  const metadata = async () => (await db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid)'::regprocedure")).rows[0].metadata
  const beforeMetadata = await metadata()
  if (process.env.EDIEL_RECONCILIATION_FORWARD) await db.exec(file(process.env.EDIEL_RECONCILIATION_FORWARD))
  assert.deepEqual(await metadata(), beforeMetadata); checks++
  const setup = async (n, owner = { kind: 'direct' }) => {
    const mid = uid(n), aid = uid(n + 1), snapshot = uid(n + 2)
    const binding = { originalHash: hash, routeId: uid(9), to: 'private-recipient@example.invalid', from: 'private-sender@example.invalid', payloadHash: hash, payloadLength: 17, mimeSha256: 'a'.repeat(64), mimeLength: 99, mimeArchiveRef: 'storage://declared/' + n, rfcMessageId: '<declared-' + n + '@example.invalid>', mimeMode: 'attachment', encoding: 'utf8' }
    await db.query("INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact',$3,now(),$4,$5,$6,NULL)", [mid, c, original, hash, uid(9), binding.to])
    await db.query("INSERT INTO ediel_message_payloads VALUES($1,$2,$3,$4,'raw_mime',$5)", [snapshot, c, mid, binding.mimeArchiveRef, { archive_verified: true, archived_mime_sha256: binding.mimeSha256, archived_mime_bytes: binding.mimeLength, archived_rfc_message_id: binding.rfcMessageId }])
    return { mid, aid, snapshot, binding, owner, identity: { companyId: c, actorUserId: actor, environment: 'test', messageId: mid, attemptId: aid } }
  }
  const call = (f, action, extra = {}) => db.query('SELECT gridex_ediel_transport.mutate_v1($1) receipt', [{ ...f.identity, action, ...extra }])
  const read = async f => (await db.query('SELECT public.gridex_ediel_transport_copy_v1($1,$2,$3) result', [c, actor, f.mid])).rows[0].result
  const f = await setup(20)
  await call(f, 'prepare', { owner: f.owner, binding: f.binding }); await call(f, 'enter')
  await call(f, 'observe', { result: { error: { code: 'ETIMEDOUT', command: 'DATA' } } })
  const first = await read(f)
  assert.equal(first.copies[0].smtpClassification, 'unknown')
  assert.equal(first.reconciliationCases?.length, 1, 'actual observed unknown must automatically create one tracking case')
  assert.equal(first.reconciliationCases[0].attemptId, f.aid); checks++
  // Additional assertions below are reached only after the missing-case RED.
  assert.equal(first.reconciliationCases[0].reason, 'provider_outcome_unknown')
  assert.equal(first.reconciliationCases[0].originalHash, hash)
  assert.equal(first.reconciliationCases[0].mimeSha256, f.binding.mimeSha256)
  assert.equal(first.reconciliationCases[0].authorizesResend, false)
  assert.equal(first.reconciliationCases[0].deliveryProven, false)
  assert.equal(JSON.stringify(first.reconciliationCases).includes('private-recipient'), false); checks++
  await call(f, 'observe', { result: { error: { code: 'ETIMEDOUT', command: 'DATA' } } })
  assert.deepEqual(await read(f), first); checks++
  const counts = async () => (await db.query("SELECT jsonb_build_object('cases',(SELECT count(*) FROM gridex_ediel_transport.reconciliation_cases),'events',(SELECT count(*) FROM gridex_ediel_transport.reconciliation_case_events)) state")).rows[0].state
  assert.deepEqual(await counts(), { cases: 1, events: 1 }); checks++
  await assert.rejects(call(f, 'release'), /release_unsafe/)
  assert.equal((await call(f, 'prepare', { owner: f.owner, binding: f.binding })).rows[0].receipt.proceed, false); checks++
  await db.query("UPDATE ediel_message_payloads SET metadata='{}' WHERE id=$1", [f.snapshot])
  const held = await read(f); assert.equal(held.status, 'held'); assert.deepEqual(held.reconciliationCases, first.reconciliationCases); checks++
  await db.query("UPDATE declared_permissions SET allowed=false WHERE actor=$1", [actor])
  await assert.rejects(read(f), /forbidden/); checks++
  await db.query("UPDATE declared_permissions SET allowed=true WHERE actor=$1", [actor])
  await assert.rejects(db.query('SELECT public.gridex_ediel_transport_copy_v1($1,$2,$3)', [uid(999), actor, f.mid]), /forbidden|unavailable/); checks++
  // Genuine generic owner prepares/enters; the public claim tuple is a declared
  // finite queue input. Only an exact entered worker attempt qualifies.
  const owner = { kind: 'worker', outboxId: uid(80), sendAttemptId: uid(81), workerId: 'declared-worker' }
  const crashed = await setup(30, owner)
  await db.query("INSERT INTO ediel_outbox VALUES($1,$2,'test',$3,'sending',$4,$5,now()-interval '20 minutes',$6)", [owner.outboxId, c, crashed.mid, owner.sendAttemptId, owner.workerId, actor])
  await call(crashed, 'prepare', { owner, binding: crashed.binding }); await call(crashed, 'enter')
  await db.query("UPDATE ediel_outbox SET status='delivery_uncertain',locked_by=NULL,locked_at=NULL WHERE id=$1", [owner.outboxId])
  const unresolved = await read(crashed)
  assert.equal(unresolved.reconciliationCases.length, 1); assert.equal(unresolved.reconciliationCases[0].reason, 'entry_unresolved_after_lease')
  assert.equal(unresolved.copies[0].smtpClassification, null); checks++
  const frozenOpening = (await db.query('SELECT to_jsonb(c) body FROM gridex_ediel_transport.reconciliation_cases c WHERE attempt_id=$1', [crashed.aid])).rows[0].body
  await call(crashed, 'observe', { result: { accepted: [crashed.binding.to], rejected: [] } })
  const late = (await read(crashed)).reconciliationCases[0]
  assert.equal(late.status, 'outcome_observed'); assert.equal(late.observedClassification, 'accepted'); assert.equal(late.deliveryProven, false)
  assert.equal(late.reason, 'entry_unresolved_after_lease'); assert.deepEqual((await db.query('SELECT to_jsonb(c) body FROM gridex_ediel_transport.reconciliation_cases c WHERE attempt_id=$1', [crashed.aid])).rows[0].body, frozenOpening); checks++
  const noEntry = await setup(40)
  await db.query("INSERT INTO ediel_outbox VALUES($1,$2,'test',$3,'sending',$4,'not-entered',now()-interval '20 minutes',$5)", [uid(82), c, noEntry.mid, uid(83), actor])
  await db.query("UPDATE ediel_outbox SET status='delivery_uncertain',locked_by=NULL,locked_at=NULL WHERE id=$1", [uid(82)])
  assert.equal((await read(noEntry)).reconciliationCases.length, 0); checks++
  const mismatchOwner = { kind: 'worker', outboxId: uid(142), sendAttemptId: uid(143), workerId: 'bound-worker' }
  const mismatch = await setup(140, mismatchOwner)
  await db.query("INSERT INTO ediel_outbox VALUES($1,$2,'test',$3,'sending',$4,$5,now(),$6)", [mismatchOwner.outboxId,c,mismatch.mid,mismatchOwner.sendAttemptId,mismatchOwner.workerId,actor])
  await call(mismatch, 'prepare', {owner:mismatchOwner,binding:mismatch.binding}); await call(mismatch, 'enter')
  await db.query("UPDATE ediel_outbox SET locked_by='different-worker' WHERE id=$1", [mismatchOwner.outboxId])
  await db.query("UPDATE ediel_outbox SET status='delivery_uncertain',locked_by=NULL,locked_at=NULL WHERE id=$1", [mismatchOwner.outboxId])
  assert.equal((await read(mismatch)).reconciliationCases.length,0); checks++
  const acceptedOwner={kind:'worker',outboxId:uid(162),sendAttemptId:uid(163),workerId:'accepted-worker'}
  const alreadyAccepted=await setup(160,acceptedOwner)
  await db.query("INSERT INTO ediel_outbox VALUES($1,$2,'test',$3,'sending',$4,$5,now(),$6)",[acceptedOwner.outboxId,c,alreadyAccepted.mid,acceptedOwner.sendAttemptId,acceptedOwner.workerId,actor])
  await call(alreadyAccepted,'prepare',{owner:acceptedOwner,binding:alreadyAccepted.binding}); await call(alreadyAccepted,'enter')
  await call(alreadyAccepted,'observe',{result:{accepted:[alreadyAccepted.binding.to],rejected:[]}})
  await db.query("UPDATE ediel_outbox SET status='delivery_uncertain',locked_by=NULL,locked_at=NULL WHERE id=$1",[acceptedOwner.outboxId])
  assert.equal((await read(alreadyAccepted)).reconciliationCases.length,0); checks++
  // Declared immutable sealed upstream entry/witness; execute the actual
  // production result classifier, rather than inserting its result event.
  const h = await setup(50)
  await db.query("INSERT INTO gridex_outbound_dispatch.originals VALUES($1,$2,'test',$3,$4,'{}')", [h.mid, c, original, hash])
  await db.query("INSERT INTO gridex_outbound_dispatch.attempts VALUES($1,$2,$3,'test',$4,$5,$6)", [h.aid, h.mid, c, actor, h.owner, h.binding])
  await db.query("INSERT INTO gridex_outbound_dispatch.reservations VALUES($1,$2,'provider_call_entered')", [h.mid, h.aid])
  await db.query("INSERT INTO gridex_outbound_dispatch.events(id,message_id,attempt_id,company_id,environment,kind,facts) VALUES($1,$2,$3,$4,'test','provider_call_entered','{}')", [uid(56), h.mid, h.aid, c])
  await db.query("INSERT INTO gridex_outbound_dispatch.witnesses(event_id,company_id,environment) VALUES($1,$2,'test')", [uid(56), c])
  await db.query('SELECT gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)', [{ ...h.identity, action: 'result', result: { error: { code: 'ETIMEDOUT', command: 'DATA' } } }])
  const sealedCase = (await read(h)).reconciliationCases
  assert.equal(sealedCase.length, 1); assert.equal(sealedCase[0].lane, 'sealed_z08'); assert.equal(sealedCase[0].attemptId, h.aid)
  assert.equal((await db.query("SELECT count(*) n FROM gridex_outbound_dispatch.witnesses w JOIN gridex_outbound_dispatch.events e ON e.id=w.event_id WHERE e.kind='provider_result'")).rows[0].n, 0); checks++
  const noWitness=await setup(180)
  await db.query("INSERT INTO gridex_outbound_dispatch.originals VALUES($1,$2,'test',$3,$4,'{}')",[noWitness.mid,c,original,hash])
  await db.query("INSERT INTO gridex_outbound_dispatch.attempts VALUES($1,$2,$3,'test',$4,$5,$6)",[noWitness.aid,noWitness.mid,c,actor,noWitness.owner,noWitness.binding])
  await db.query("INSERT INTO gridex_outbound_dispatch.reservations VALUES($1,$2,'provider_call_entered')",[noWitness.mid,noWitness.aid])
  await db.query("INSERT INTO gridex_outbound_dispatch.events(message_id,attempt_id,company_id,environment,kind,facts) VALUES($1,$2,$3,'test','provider_call_entered','{}')",[noWitness.mid,noWitness.aid,c])
  await assert.rejects(db.query('SELECT gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[{...noWitness.identity,action:'result',result:{error:{command:'DATA'}}}]),/query returned no rows/)
  assert.equal((await read(noWitness)).reconciliationCases.length,0)
  assert.equal((await db.query("SELECT count(*) n FROM gridex_outbound_dispatch.events WHERE attempt_id=$1 AND kind='provider_result'",[noWitness.aid])).rows[0].n,0); checks++
  for (const [n, result] of [[60, { accepted: [f.binding.to], rejected: [] }], [70, { error: { responseCode: 550 } }]]) {
    const known = await setup(n)
    await call(known, 'prepare', { owner: known.owner, binding: known.binding }); await call(known, 'enter'); await call(known, 'observe', { result })
    assert.equal((await read(known)).reconciliationCases.length, 0); checks++
  }
  for (const table of ['reconciliation_cases', 'reconciliation_case_events']) {
    await assert.rejects(db.exec('SET ROLE service_role; UPDATE gridex_ediel_transport.' + table + " SET company_id='" + uid(999) + "'"), /permission denied/); await db.exec('RESET ROLE'); checks++
    await assert.rejects(db.exec('UPDATE gridex_ediel_transport.' + table + " SET company_id='" + uid(999) + "'"), /append_only/); checks++
    await assert.rejects(db.exec('DELETE FROM gridex_ediel_transport.' + table), /append_only/); checks++
  }
  for(const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_ediel_transport.open_reconciliation_case_v1(text,uuid,text,text,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false)
    assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_ediel_transport.read_reconciliation_cases_v1(uuid,text,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false); checks++
  }
  await assert.rejects(db.exec('TRUNCATE gridex_ediel_transport.reconciliation_cases,gridex_ediel_transport.reconciliation_case_events'), /append_only/); checks++
  const doomed = await setup(90)
  await call(doomed, 'prepare', { owner: doomed.owner, binding: doomed.binding }); await call(doomed, 'enter')
  await db.exec("CREATE FUNCTION fixture_fail_case() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_final_case_log_failure'; END$$; CREATE TRIGGER fixture_fail_case BEFORE INSERT ON gridex_ediel_transport.reconciliation_case_events FOR EACH ROW EXECUTE FUNCTION fixture_fail_case()")
  const before = await counts()
  await assert.rejects(call(doomed, 'observe', { result: { error: { code: 'ETIMEDOUT', command: 'DATA' } } }), /declared_final_case_log_failure/)
  assert.deepEqual(await counts(), before)
  assert.equal((await db.query('SELECT classification FROM gridex_ediel_transport.attempts WHERE id=$1', [doomed.aid])).rows[0].classification, null)
  assert.equal((await db.query('SELECT state FROM gridex_ediel_transport.reservations WHERE message_id=$1', [doomed.mid])).rows[0].state, 'entered'); checks++
  console.log('PASS ' + checks + ' actual reconciliation SQL checks; declared finite upstream ports, native pending')
} catch (error) { console.error('FAIL after ' + checks + ': ' + error.message, error.code ?? '', error.where ?? ''); process.exitCode = 1 }
finally { await db.close() }
