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

beforeEach(async () => {
  db = new PGlite()
  await db.exec('create role service_role; create role anon; create role authenticated; create schema gridex_ediel_technical_ack')
  for (const table of ['ediel_messages', 'ediel_outbox']) await db.exec(definition('TABLE', `public.${table} (`))
  await db.exec(definition('FUNCTION', 'public.claim_ediel_outbox_item('))
  await db.exec(`revoke all on function public.claim_ediel_outbox_item(uuid,text,uuid) from public,anon,authenticated;
    grant execute on function public.claim_ediel_outbox_item(uuid,text,uuid) to service_role;
    create table public.finite_private_reader_port(proof jsonb not null);
    -- Declared dependency only. Genuine source/namespace/send authority is
    -- separately exercised by the original H100 producer, not this port.
    create function gridex_ediel_technical_ack.read_persisted_contrl_v2(uuid,text,uuid,uuid,text)
    returns jsonb language sql as $$select proof from public.finite_private_reader_port$$;`)
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
})
