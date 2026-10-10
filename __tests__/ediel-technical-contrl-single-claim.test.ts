// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Selected real PostgreSQL claim body and tables; the private reader below is
// an explicitly finite dependency port. This proves the consumer boundary,
// never protected-source authority, full triggers/RLS, concurrent locks or H acceptance.
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Row = Record<string, unknown>
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forwardPath = 'supabase/migrations/20261008144257_ediel_source_qualified_contrl_single_claim.sql'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), actor = id(2), sourceId = id(3), ackId = id(4), outboxId = id(5)
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')
let db: PGlite
let originalMetadata: Row

function definition(kind: 'TABLE' | 'FUNCTION', name: string) {
  const start = schema.indexOf(`CREATE ${kind} ${name}`)
  if (start < 0) throw new Error(`Missing current ${kind} ${name}`)
  if (kind === 'TABLE') {
    const end = schema.indexOf('\n);', start)
    if (end < 0) throw new Error('Missing table terminator')
    return schema.slice(start, end + 3)
  }
  const delimiter = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  if (!delimiter) throw new Error('Missing actual function body')
  const end = schema.indexOf(`${delimiter[1]};`, start + delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Missing function terminator')
  return schema.slice(start, end + delimiter[1].length + 1)
}

async function snapshot() {
  return (await db.query<{ value: Row }>(`select jsonb_build_object(
    'messages',(select jsonb_agg(to_jsonb(m) order by id) from ediel_messages m),
    'outbox',(select jsonb_agg(to_jsonb(o) order by id) from ediel_outbox o)) value`)).rows[0].value
}
async function claim(worker = 'finite-worker') {
  try {
    await db.exec('set role service_role')
    return (await db.query<Row>('select * from public.claim_ediel_outbox_item($1,$2,$3)', [outboxId, worker, actor])).rows
  } finally { await db.exec('reset role') }
}
async function proof() {
  return (await db.query<{ proof: Row }>('select proof from finite_private_reader_port')).rows[0].proof
}
async function setProof(value: unknown) {
  await db.query('update finite_private_reader_port set proof=$1', [JSON.stringify(value)])
}
async function behavior(value: string) {
  await db.query('update finite_private_reader_port set behavior=$1', [value])
}
async function proc() {
  return (await db.query<{ value: Row }>(`select to_jsonb(p) value from pg_proc p
    where oid='public.claim_ediel_outbox_item(uuid,text,uuid)'::regprocedure`)).rows[0].value
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec('create role service_role; create role anon; create role authenticated; create schema gridex_ediel_technical_ack')
  for (const table of ['ediel_messages', 'ediel_outbox']) await db.exec(definition('TABLE', `public.${table} (`))
  await db.exec(definition('FUNCTION', 'public.claim_ediel_outbox_item('))
  await db.exec(`revoke all on function public.claim_ediel_outbox_item(uuid,text,uuid) from public,anon,authenticated;
    grant execute on function public.claim_ediel_outbox_item(uuid,text,uuid) to service_role;
    create table public.finite_private_reader_port(proof jsonb,behavior text default '',calls integer default 0);
    -- Declared dependency only. Genuine source/namespace/send authority is
    -- separately exercised by the original H100 producer, not this port.
    create function gridex_ediel_technical_ack.read_persisted_contrl_v2(uuid,text,uuid,uuid,text)
    returns jsonb language plpgsql as $$declare f finite_private_reader_port%rowtype;begin
      update finite_private_reader_port set calls=calls+1 returning * into f;
      if f.behavior='deny' or (f.behavior='deny_second' and f.calls=2) then
        raise exception 'finite_private_send_authority_denied' using errcode='42501';
      end if;
      if f.behavior='ack_second' and f.calls=2 then
        update ediel_messages set raw_payload='changed reply' where id=$3;
      end if;
      if f.behavior='source_first' and f.calls=1 then
        update ediel_messages set raw_payload='changed original' where direction='inbound';
      end if;
      if f.behavior='proof_second' and f.calls=2 then
        return jsonb_set(f.proof,'{executionPhase}','"read"');
      end if;
      if f.behavior='lose_outbox' and f.calls=1 then
        update ediel_outbox set status='sent' where ediel_message_id=$3;
      end if;
      if f.behavior='retarget_outbox' and f.calls=2 then
        update ediel_outbox set company_id='00000000-0000-4000-8000-000000000099' where ediel_message_id=$3;
      end if;
      return f.proof;
    end$$;`)
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,environment,raw_payload)
    values($1,$2,'inbound','PRODAT','test','finite original')`, [sourceId, company])
  await db.query(`insert into public.ediel_messages(id,company_id,direction,message_family,message_code,environment,
    raw_payload,immutable_payload_hash,immutable_rendered_at,related_message_id,ack_outcome)
    values($1,$2,'outbound','CONTRL','CONTRL','test','finite reply',$3,'2026-10-08T00:00:00Z',$4,'positive')`,
  [ackId, company, hash('finite reply'), sourceId])
  await db.query(`insert into public.ediel_outbox(id,company_id,ediel_message_id,source_message_id,status,lock_key,environment)
    values($1,$2,$3,$4,'queued','finite-lock','test')`, [outboxId, company, ackId, sourceId])
  const ack = (await db.query<{ value: Row }>('select to_jsonb(m) value from ediel_messages m where id=$1', [ackId])).rows[0].value
  await db.query('insert into finite_private_reader_port(proof) values($1)', [{
    version: 2, executionActorUserId: actor, executionPhase: 'send', ackMessage: ack,
    technicalSyntaxAckEvidence: { kind: 'technical_syntax_ack', version: 1, companyId: company,
      environment: 'test', sourceMessageId: sourceId, sourceHash: hash('finite original'), syntaxDecision: 'accepted' },
  }])
  // Before the correction exists, the exact current claimant is the baseline.
  // Once authored, execute the real forward on that same original function.
  originalMetadata = await proc()
  delete originalMetadata.prosrc
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
})
afterEach(async () => { await db.close() })

describe('protected technical CONTRL single-item claim consumer', () => {
  it('claims one null-business-pack reply using the private send dependency and preserves all message bytes', async () => {
    const before = await snapshot()
    const rows = await claim()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: outboxId, company_id: company, ediel_message_id: ackId,
      status: 'sending', locked_by: 'finite-worker', attempts: 1, send_attempt_count: 1, updated_by: actor })
    expect(rows[0].current_send_attempt_id).toEqual(expect.any(String))
    const claimed = await snapshot()
    expect(claimed.messages).toEqual(before.messages)
    expect(await claim('second-worker')).toEqual([])
    expect(await snapshot()).toEqual(claimed)
  })

  it('claims a protected negative syntax projection without rewriting its two stale public caches', async () => {
    const value = await proof()
    const evidence = value.technicalSyntaxAckEvidence as Row
    const ack = value.ackMessage as Row
    evidence.syntaxDecision = 'rejected'; ack.ack_outcome = 'negative'
    await setProof(value)
    await db.query('update ediel_messages set related_message_id=$1,ack_outcome=null where id=$2', [id(90), ackId])
    const before = await snapshot()
    expect(await claim()).toHaveLength(1)
    expect((await snapshot()).messages).toEqual(before.messages)
  })

  it('retains the ordinary application-profile claimant without consulting the technical port', async () => {
    await db.query(`update ediel_messages set message_family='UTILTS',rule_profile_version_id=$1,
      rule_pack_checksum='actual finite ordinary snapshot' where id=$2`, [id(10), ackId])
    await behavior('deny')
    expect(await claim()).toHaveLength(1)
    expect((await db.query<{ calls: number }>('select calls from finite_private_reader_port')).rows[0].calls).toBe(0)
  })

  const invalidProofs: Array<[string, string[], unknown]> = [
    ['version', ['version'], 1], ['null version', ['version'], null],
    ['actor', ['executionActorUserId'], id(99)], ['null actor', ['executionActorUserId'], null],
    ['phase', ['executionPhase'], 'read'], ['null phase', ['executionPhase'], null],
    ['null ACK', ['ackMessage'], null], ['array ACK', ['ackMessage'], []],
    ['ACK tenant', ['ackMessage', 'company_id'], id(99)], ['ACK environment', ['ackMessage', 'environment'], 'production'],
    ['ACK payload', ['ackMessage', 'raw_payload'], 'forged reply'], ['ACK resource', ['ackMessage', 'customer_id'], id(99)],
    ['ACK source', ['ackMessage', 'related_message_id'], id(99)], ['null ACK source', ['ackMessage', 'related_message_id'], null],
    ['ACK outcome', ['ackMessage', 'ack_outcome'], 'negative'], ['null ACK outcome', ['ackMessage', 'ack_outcome'], null],
    ['null evidence', ['technicalSyntaxAckEvidence'], null],
    ['kind', ['technicalSyntaxAckEvidence', 'kind'], 'business'], ['null kind', ['technicalSyntaxAckEvidence', 'kind'], null],
    ['evidence version', ['technicalSyntaxAckEvidence', 'version'], 2], ['null evidence version', ['technicalSyntaxAckEvidence', 'version'], null],
    ['evidence tenant', ['technicalSyntaxAckEvidence', 'companyId'], id(99)], ['null evidence tenant', ['technicalSyntaxAckEvidence', 'companyId'], null],
    ['evidence environment', ['technicalSyntaxAckEvidence', 'environment'], 'production'], ['null environment', ['technicalSyntaxAckEvidence', 'environment'], null],
    ['syntax decision', ['technicalSyntaxAckEvidence', 'syntaxDecision'], 'not_checked'], ['null decision', ['technicalSyntaxAckEvidence', 'syntaxDecision'], null],
    ['absent source', ['technicalSyntaxAckEvidence', 'sourceMessageId'], id(99)], ['null source', ['technicalSyntaxAckEvidence', 'sourceMessageId'], null],
    ['malformed source', ['technicalSyntaxAckEvidence', 'sourceMessageId'], 'bad UUID'],
    ['original hash', ['technicalSyntaxAckEvidence', 'sourceHash'], hash('another original')],
    ['reply hash is not source hash', ['technicalSyntaxAckEvidence', 'sourceHash'], hash('finite reply')],
    ['null original hash', ['technicalSyntaxAckEvidence', 'sourceHash'], null],
  ]
  it.each(invalidProofs)('refuses %s with complete message/outbox rollback', async (_name, path, value) => {
    await db.query('update finite_private_reader_port set proof=jsonb_set(proof,$1,$2)', [path, JSON.stringify(value)])
    const before = await snapshot()
    await expect(claim()).rejects.toThrow(/ediel_technical_contrl_claim_/)
    expect(await snapshot()).toEqual(before)
  })
  it.each([[null], [undefined], [[]], ['untrusted scalar']])('refuses a malformed top-level private result %j', async value => {
    await setProof(value)
    const before = await snapshot()
    await expect(claim()).rejects.toThrow('ediel_technical_contrl_claim_basis_required')
    expect(await snapshot()).toEqual(before)
  })
  it.each(['deny', 'deny_second', 'ack_second', 'source_first', 'proof_second'])('rechecks and rolls back the %s dependency transition', async transition => {
    await behavior(transition)
    const before = await snapshot()
    await expect(claim()).rejects.toThrow(/finite_private_send_authority_denied|ediel_technical_contrl_claim_/)
    expect(await snapshot()).toEqual(before)
  })
  it.each(['lose_outbox', 'retarget_outbox'])('does not create an attempt when the %s dependency transition loses the routing candidate', async transition => {
    await behavior(transition)
    const messages = (await snapshot()).messages
    expect(await claim()).toEqual([])
    expect((await snapshot()).messages).toEqual(messages)
    const outbox = (await db.query<Row>('select * from ediel_outbox')).rows[0]
    expect(outbox).toMatchObject({ attempts: 0, send_attempt_count: 0, locked_by: null, current_send_attempt_id: null })
    // Only the declared dependency mutation exists; the claimant wrote no lease.
    expect(outbox.status).toBe(transition === 'lose_outbox' ? 'sent' : 'queued')
    expect(outbox.company_id).toBe(transition === 'retarget_outbox' ? id(99) : company)
  })
  it.each([
    "update ediel_messages set message_family='APERAK' where direction='outbound'",
    "update ediel_messages set company_id=null where direction='outbound'",
    "update ediel_messages set direction='inbound' where id='00000000-0000-4000-8000-000000000004'",
    "update ediel_messages set environment='production' where direction='outbound'",
    "update ediel_outbox set company_id=null",
    "update ediel_outbox set status='delivery_uncertain'",
  ])('preserves no eligible claim for %s', async mutation => {
    await db.exec(mutation)
    const before = await snapshot()
    expect(await claim()).toEqual([])
    expect(await snapshot()).toEqual(before)
  })
  it('aborts the whole claim if a later real UPDATE trigger rejects it', async () => {
    await db.exec(`create function finite_reject_claim() returns trigger language plpgsql as $$begin
      raise exception 'finite_claim_trigger_refusal';end$$;
      create trigger finite_reject_claim before update on ediel_outbox for each row execute function finite_reject_claim()`)
    const before = await snapshot()
    await expect(claim()).rejects.toThrow('finite_claim_trigger_refusal')
    expect(await snapshot()).toEqual(before)
  })
  it('preserves the function OID, all metadata and the exact inert successor on reapplication', async () => {
    const before = await proc()
    const currentMetadata = { ...before }
    delete currentMetadata.prosrc
    expect(currentMetadata).toEqual(originalMetadata)
    await db.exec(readFileSync(forwardPath, 'utf8'))
    expect(await proc()).toEqual(before)
    expect((await proc()).prosecdef).toBe(true)
  })
  it('refuses an unknown body without changing it or any claim state', async () => {
    await db.exec(`create or replace function public.claim_ediel_outbox_item(p_outbox_item_id uuid,p_worker_id text,p_actor_user_id uuid)
      returns setof public.ediel_outbox language plpgsql security definer set search_path=public as $$begin return;end$$`)
    const metadata = await proc(), before = await snapshot()
    await expect(db.exec(readFileSync(forwardPath, 'utf8'))).rejects.toThrow('ediel_technical_contrl_claim_source_shape_changed')
    await db.exec('rollback')
    expect(await proc()).toEqual(metadata)
    expect(await snapshot()).toEqual(before)
  })
  it('refuses changed security metadata without rewriting it', async () => {
    await db.exec('alter function public.claim_ediel_outbox_item(uuid,text,uuid) security invoker')
    const before = await proc()
    await expect(db.exec(readFileSync(forwardPath, 'utf8'))).rejects.toThrow('ediel_technical_contrl_claim_metadata_changed')
    await db.exec('rollback')
    expect(await proc()).toEqual(before)
  })
  it.each([null, hash('different reply')])('refuses a current ACK with an invalid seal %j even if the finite projection agrees', async seal => {
    await db.query('update ediel_messages set immutable_payload_hash=$1 where id=$2', [seal, ackId])
    const value = await proof()
    value.ackMessage = (await db.query<{ value: Row }>('select to_jsonb(m) value from ediel_messages m where id=$1', [ackId])).rows[0].value
    await setProof(value)
    const before = await snapshot()
    await expect(claim()).rejects.toThrow('ediel_technical_contrl_claim_current_binding_required')
    expect(await snapshot()).toEqual(before)
  })
  it.each([
    [null, 'worker', actor], [outboxId, ' ', actor], [outboxId, 'worker', null],
  ])('retains required RPC arguments for %j', async (item, worker, user) => {
    const before = await snapshot()
    try {
      await db.exec('set role service_role')
      await expect(db.query('select * from public.claim_ediel_outbox_item($1,$2,$3)', [item, worker, user])).rejects.toThrow('ediel_outbox_claim_arguments_required')
    } finally { await db.exec('reset role') }
    expect(await snapshot()).toEqual(before)
  })
  it.each(['anon', 'authenticated'])('preserves the caller ACL refusal for %s', async role => {
    const before = await snapshot()
    try {
      await db.exec(`set role ${role}`)
      await expect(db.query('select * from public.claim_ediel_outbox_item($1,$2,$3)', [outboxId, 'worker', actor])).rejects.toThrow('permission denied for function claim_ediel_outbox_item')
    } finally { await db.exec('reset role') }
    expect(await snapshot()).toEqual(before)
  })
})
