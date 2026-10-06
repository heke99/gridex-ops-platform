// masterplan: TR-09, AT-TR-09
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const historicalPath = 'supabase/migrations/20261001000609_ediel_source_owned_temporary_transport_exceptions.sql'
const forwardPath = 'supabase/migrations/20261006205324_ediel_production_all_family_smime.sql'
const historical = readFileSync(historicalPath, 'utf8')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const refusal = 'transport_exception_actual_approved_plaintext_source_required'
const plaintextModes = [undefined, 'ediel-singlepart-base64', 'ediel-singlepart-lines',
  'ediel-singlepart-compact', 'ediel-multipart-validation-base64', 'nodemailer-attachment'] as const
const families = ['PRODAT', 'UTILTS', 'APERAK', 'CONTRL', 'MSCONS', 'AI_LIST'] as const
const journalTables = ['approvals', 'revocations', 'operations', 'events', 'alarms'] as const
type Message = { family?: string; standard?: string; environment?: string; direction?: string }
type Stage = { mimeMode?: string | null; explicitNullException?: boolean; action?: string;
  response?: Record<string, unknown>; companyId?: string; messageId?: string }
let db: PGlite

function declaration(start: string, end: string) {
  const first = historical.indexOf(start)
  const last = historical.indexOf(end, first)
  if (first < 0 || last < 0) throw Error(`Historical SQL declaration absent: ${start}`)
  return historical.slice(first, last + end.length)
}

beforeAll(async () => {
  db = new PGlite()
  // Declared host rows isolate stage's NULL-exception branch. These are not
  // public message-birth, syntax, authorization or production-admission proofs.
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA gridex_transport_exception;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.companies(id uuid PRIMARY KEY);
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY, company_id uuid NOT NULL,
      direction text NOT NULL, message_standard text NOT NULL, message_family text NOT NULL,
      environment text NOT NULL, raw_payload text NOT NULL);
    INSERT INTO auth.users VALUES ('${uid(3)}'); INSERT INTO public.companies VALUES ('${uid(2)}');`)
  // Actual rowtypes/relations and actual PL/pgSQL, with no read_v1 stub and no
  // incident, approval, opaque capability or accepted exception fabricated.
  for (const table of journalTables) {
    await db.exec(declaration(`CREATE TABLE gridex_transport_exception.${table}(`, ');'))
  }
  await db.exec(declaration('CREATE FUNCTION gridex_transport_exception.stage_v1(', 'END$$;'))
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
}, 180_000)

beforeEach(async () => { await db.exec('DELETE FROM public.ediel_messages') })
afterAll(async () => { await db?.close() })

async function snapshot() {
  const tables = ['ediel_messages', ...journalTables.map(table => `gridex_transport_exception.${table}`)]
  const fields = tables.map(table => `'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM ${table} t)`)
  return (await db.query<{ state: unknown }>(`SELECT jsonb_build_object(${fields.join(',')}) state`)).rows[0].state
}

async function exercise(message: Message = {}, stage: Stage = {}) {
  await db.query(`INSERT INTO public.ediel_messages VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid(1), uid(2), message.direction ?? 'outbound', message.standard ?? 'edifact',
      message.family ?? 'PRODAT', message.environment ?? 'production', 'isolated unchanged stage original'])
  const binding: Record<string, unknown> = {}
  if (stage.mimeMode !== undefined) binding.mimeMode = stage.mimeMode
  if (stage.explicitNullException) binding.transportException = null
  const input = { action: stage.action ?? 'prepare', companyId: stage.companyId ?? uid(2),
    messageId: stage.messageId ?? uid(1), actorUserId: uid(3), attemptId: uid(4),
    environment: message.environment ?? 'production', binding }
  const before = await snapshot()
  let failure: unknown = null
  try {
    await db.query('SELECT gridex_transport_exception.stage_v1($1::jsonb,$2::jsonb)',
      [JSON.stringify(input), JSON.stringify(stage.response ?? { proceed: true })])
  } catch (error) { failure = error }
  // Check durable effects even when the refusal assertion will fail on old SQL.
  expect(await snapshot()).toEqual(before)
  return failure
}

describe('actual stage_v1: production plaintext without an exception source', () => {
  const cases = families.flatMap(family => plaintextModes.map(mimeMode => ({ family, mimeMode,
    standard: family === 'AI_LIST' ? 'ai_list' : 'edifact', mode: mimeMode ?? 'omitted' })))
  it.each(cases)('refuses $family/$standard/$mode without changing originals or journals', async ({ family, standard, mimeMode }) => {
    expect(await exercise({ family, standard }, { mimeMode })).toMatchObject({ message: refusal })
  })

  it.each(plaintextModes)('refuses non-EDIFACT PRODAT with plaintext marker %s', async mimeMode => {
    expect(await exercise({ standard: 'ai_list' }, { mimeMode })).toMatchObject({ message: refusal })
  })

  it('JSON null is not an approved exception for outbound production UTILTS', async () => {
    expect(await exercise({ family: 'UTILTS' }, { explicitNullException: true })).toMatchObject({ message: refusal })
  })

  it('a JSON null MIME marker is not S/MIME', async () => {
    expect(await exercise({ family: 'APERAK' }, { mimeMode: null })).toMatchObject({ message: refusal })
  })
})

describe('actual stage_v1: bounded controls without fabricated exception authority', () => {
  it.each(families)('leaves encrypted production %s untouched', async family => {
    expect(await exercise({ family }, { mimeMode: 'ediel-smime-enveloped' })).toBeNull()
  })
  it.each(families)('leaves test-environment plaintext %s untouched', async family => {
    expect(await exercise({ family, environment: 'test' })).toBeNull()
  })
  it.each(families)('leaves inbound production plaintext %s untouched', async family => {
    expect(await exercise({ family, direction: 'inbound' })).toBeNull()
  })
  it.each([{ proceed: false }, {}, { proceed: null }])('does not prepare when upstream response is %j', async response => {
    expect(await exercise({ family: 'UTILTS' }, { response })).toBeNull()
  })
  it.each(['enter', 'observe', 'result', 'release'])('does not invent an operation or journal for unprepared %s', async action => {
    expect(await exercise({ family: 'UTILTS' }, { action })).toBeNull()
  })
  it('requires the stored message to belong to the selected company', async () => {
    expect(await exercise({}, { companyId: uid(9), mimeMode: 'ediel-smime-enveloped' })).toMatchObject({ message: 'query returned no rows' })
  })
  it('requires an actual stored message even for an encrypted marker', async () => {
    expect(await exercise({}, { messageId: uid(9), mimeMode: 'ediel-smime-enveloped' })).toMatchObject({ message: 'query returned no rows' })
  })
})
