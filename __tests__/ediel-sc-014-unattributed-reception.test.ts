// Bounded SC014 qualification, not an approval tag. Actual current admission
// and technical-source functions execute in WASM PostgreSQL. The finite DB
// transport, permission service and fetched MIME input do not establish native
// RLS, mailbox credentials, legal mandate, SMTP or a safe raw-mail ACK authority.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  db: null as PGlite | null,
  queries: [] as Array<{ table: string; operation: string; value: Row }>,
  attemptedTables: [] as string[],
  errors: [] as Array<{ table: string; error: unknown }>,
  business: {} as Record<string, Row[]>,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<{ key: string; operator: string; value: unknown }> = []
    one = false; exact = false; maximum = 10000; operation = 'select'; value: Row | Row[] = {}; columns = '*'
    constructor(readonly table: string) {}
    select(columns = '*', options?: { count?: string }) { this.columns = columns; this.exact = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push({ key, operator: '=', value }); return this }
    is(key: string, value: unknown) { this.filters.push({ key, operator: 'is', value }); return this }
    in(key: string, value: unknown[]) { this.filters.push({ key, operator: 'in', value }); return this }
    order() { return this }
    limit(maximum: number) { this.maximum = maximum; return this }
    abortSignal() { return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    insert(value: Row | Row[]) { this.operation = 'insert'; this.value = value; return this }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    then(onfulfilled: (value: unknown) => unknown, onrejected: (reason: unknown) => unknown) {
      return Promise.resolve().then(async () => {
        if (!port.db) throw Error('Finite DB unavailable')
        port.queries.push({ table: this.table, operation: this.operation, value: structuredClone(this.value as Row) })
        if (!tables.includes(this.table)) throw Error(`Undeclared DB access: ${this.table}`)
        const parameters: unknown[] = []
        const parameter = (value: unknown) => { parameters.push(value); return `$${parameters.length}` }
        const column = (key: string) => { if (!/^[a-z_][a-z_0-9]*$/.test(key)) throw Error(`Undeclared column ${key}`); return `"${key}"` }
        const where = this.filters.map(({ key, operator, value }) => operator === 'is'
          ? value === null ? `${column(key)} is null` : (() => { throw Error('Undeclared IS') })()
          : operator === 'in' ? `${column(key)} in (${(value as unknown[]).map(parameter).join(',')})`
          : `${column(key)}=${parameter(value)}`).join(' and ')
        const predicate = where ? ` where ${where}` : ''
        try {
          let rows: Row[]
          if (this.operation === 'insert') {
            rows = []
            for (const value of Array.isArray(this.value) ? this.value : [this.value]) {
              const entries = Object.entries(value).filter(([, item]) => item !== undefined)
              const tokens = entries.map(([, item]) => parameter(item))
              rows.push(...(await port.db.query<Row>(`insert into public.${this.table} (${entries.map(([key]) => column(key)).join(',')}) values (${tokens.join(',')}) returning *`, parameters)).rows)
              parameters.length = 0
            }
          } else if (this.operation === 'update') {
            const entries = Object.entries(this.value).filter(([, item]) => item !== undefined)
            rows = (await port.db.query<Row>(`update public.${this.table} set ${entries.map(([key, item]) => `${column(key)}=${parameter(item)}`).join(',')}${predicate} returning *`, parameters)).rows
          } else {
            rows = (await port.db.query<Row>(`select * from public.${this.table}${predicate} limit ${this.maximum}`, parameters)).rows
          }
          const count = rows.length
          if (this.table === 'inbound_email_messages' && this.columns.includes('ediel_mailboxes')) {
            for (const row of rows) row.ediel_mailboxes = (await port.db.query<Row>('select * from public.ediel_mailboxes where id=$1', [row.mailbox_id])).rows[0] ?? null
          }
          return { data: this.one ? rows[0] ?? null : rows, error: null, ...(this.exact ? { count } : {}) }
        } catch (error) {
          port.errors.push({ table: this.table, error }); return { data: null, error }
        }
      }).then(onfulfilled, onrejected)
    }
  }
  return { supabaseService: { from: (table: string) => { port.attemptedTables.push(table); return new Query(table) }, rpc: () => { throw Error('Undeclared RPC') } } }
})

import { storeMailboxFetchMessage, listEdielMessageIdsForInboundEmails } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { ownerSource, OWNER, ownerId } from './helpers/sourceOwnerFixtures'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const tables = ['ediel_messages', 'inbound_email_messages', 'inbound_email_attachments', 'inbound_ediel_parse_results', 'inbound_processing_jobs',
  'ediel_mailboxes', 'tenant_actor_identifiers', 'tenant_counterparty_relations', 'platform_actor_identifiers', 'ediel_actor_settings', 'ediel_route_profiles',
  'companies', 'company_memberships', 'user_profiles']
function definition(kind: 'TABLE' | 'FUNCTION', name: string) {
  const start = schema.indexOf(`CREATE ${kind} ${name}`)
  if (start < 0) throw Error(`Missing actual ${kind} ${name}`)
  if (kind === 'TABLE') {
    const end = schema.indexOf('\n);', start)
    if (end < 0) throw Error(`Missing actual table end ${name}`)
    return schema.slice(start, end + 3)
  }
  const match = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  if (!match) throw Error(`Missing actual function body ${name}`)
  const body = start + match.index + match[0].length
  const end = schema.indexOf(`${match[1]};`, body)
  if (end < 0) throw Error(`Missing actual function end ${name}`)
  return schema.slice(start, end + match[1].length + 1)
}
const knownWire = ownerSource().raw_payload!
const unknownLegalWire = knownWire.replace('NAD+DO+54321:160:SVK', 'NAD+DO+98765:160:SVK')
const actor = ownerId(50), mailboxId = ownerId(800)
const mime = (wire: string) => `From: sender@example.invalid\r\nTo: configured@example.invalid\r\nMessage-ID: <sc014@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${wire}`

async function rows(table: string) { return (await port.db!.query<Row>(`select * from ${table}`)).rows }
async function endpoint(sourceId: string, actorId = actor) {
  try {
    await port.db!.exec('set role service_role')
    return (await port.db!.query<{ value: Row | null }>('select public.ediel_read_technical_source_endpoint_v2($1,$2,$3) value', [sourceId, actorId, 'prepare'])).rows[0].value
  } finally { await port.db!.exec('reset role') }
}
async function admitKnownSource() {
  const parsed = parseEdifactPayload(knownWire)!
  return (await port.db!.query<Row>(`insert into ediel_messages(id,company_id,direction,message_standard,message_family,message_code,environment,raw_payload,message_received_at) values($1,$2,'inbound','edifact','PRODAT',$3,'production',$4,'2026-10-05T00:00:00Z') returning *`, [OWNER.source, OWNER.company, parsed.messageCode, knownWire])).rows[0]
}
beforeEach(async () => {
  port.queries = []; port.errors = []; port.attemptedTables = []
  port.business = {
    customers: [{ id: OWNER.customer, company_id: ownerId(999), personal_number: '001' }],
    customer_sites: [{ id: OWNER.site, company_id: ownerId(999), customer_id: OWNER.customer }],
    metering_points: [{ id: OWNER.point, company_id: ownerId(999), site_id: OWNER.site, meter_point_id: OWNER.external }],
    customer_permissions: [{ id: ownerId(998), company_id: ownerId(999), status: 'active' }],
    ediel_outbox: [{ id: ownerId(997), company_id: ownerId(999), status: 'pending' }],
  }
  const db = new PGlite(); port.db = db
  await db.exec(`create role service_role; create schema extensions; create schema gridex_utilts_binding; create schema gridex_ediel_technical_ack; create schema gridex_ediel_retention;
    -- PGlite crypto port: same PostgreSQL sha256 bytes, not an admission verdict.
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    -- Declared finite native permission service. Real current actor/profile/
    -- membership checks below remain the actual production function.
    create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as $$select $1='${actor}'::uuid and $2='${OWNER.company}'::uuid and $3='communication.write'$$;`)
  for (const name of ['public.gridex_normalize_org_number(', 'public.gridex_new_external_tenant_reference(']) await db.exec(definition('FUNCTION', name))
  for (const table of tables) await db.exec(definition('TABLE', `public.${table} (`))
  await db.exec(definition('TABLE', 'gridex_ediel_technical_ack.sources ('))
  await db.exec(definition('TABLE', 'gridex_ediel_retention.blob_tombstones ('))
  await db.exec(definition('FUNCTION', 'gridex_ediel_retention.public_content_v1('))
  await db.exec(definition('FUNCTION', 'public.ediel_is_qualified_retention_transition_v1('))
  for (const name of ['gridex_utilts_binding.wire_tokens_v1(', 'gridex_ediel_technical_ack.envelope(', 'gridex_ediel_technical_ack.capture_source(',
    'gridex_ediel_technical_ack.read_endpoint_v1(', 'gridex_ediel_technical_ack.require_actor_v1(', 'public.ediel_read_technical_source_endpoint_v2(',
    'public.gridex_validate_ediel_message_contract(']) await db.exec(definition('FUNCTION', name))
  for (const trigger of ['ediel_messages_canonical_contract_biu', 'ediel_capture_technical_source']) {
    const start = schema.indexOf(`CREATE TRIGGER ${trigger} `), end = schema.indexOf(';', start)
    if (start < 0 || end < 0) throw Error(`Missing actual trigger ${trigger}`)
    await db.exec(schema.slice(start, end + 1))
  }
  await db.exec('grant usage on schema public,gridex_ediel_technical_ack to service_role; grant select on all tables in schema public,gridex_ediel_technical_ack to service_role;')
  await db.query('insert into companies(id,name) values($1,$2)', [OWNER.company, 'Synthetic technical mailbox owner'])
  await db.query('insert into user_profiles(id) values($1)', [actor])
  await db.query('insert into company_memberships(company_id,user_id,accepted_at) values($1,$2,$3)', [OWNER.company, actor, '2026-01-01T00:00:00Z'])
  await db.query(`insert into tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) values($1,'production',$2,'EdielId','54321','2026-01-01T00:00:00Z')`, [OWNER.company, OWNER.actor])
  await db.query(`insert into ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,mailbox_type) values($1,$2,'production','Synthetic tenant mailbox','configured@example.invalid','tenant')`, [mailboxId, OWNER.company])
})
afterEach(async () => { await port.db?.close(); port.db = null })

describe('SC014 actual intake/admission qualification', () => {
  it('stages real MIME with a known technical mailbox but unknown legal NAD, without an admitted source or guessed customer', async () => {
    expect(unknownLegalWire).not.toBe(knownWire)
    expect(validateEdifactSyntax({ ...ownerSource(), environment: 'production', test_flag: 0, raw_payload: unknownLegalWire })).toMatchObject({ ok: true, grammarQualification: 'qualified' })
    const before = structuredClone(port.business)
    const mailbox = (await rows('ediel_mailboxes'))[0] as unknown as EdielMailboxRow
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor, message: { source: Buffer.from(mime(unknownLegalWire)), internalDate: new Date('2026-10-05T00:00:00Z') } })
    const received = (await rows('inbound_email_messages'))[0]
    expect(received).toMatchObject({ id: stored.id, company_id: OWNER.company, environment: 'production', raw_email: mime(unknownLegalWire), raw_edifact_payload: unknownLegalWire })
    expect((await rows('inbound_processing_jobs'))[0]).toMatchObject({ inbound_email_message_id: stored.id, company_id: OWNER.company, status: 'queued' })
    const result = await processInboundEmailMessage({ inboundEmailMessageId: stored.id, actorUserId: actor })
    expect(result).toMatchObject({ status: 'manual_review', companyId: null })
    const staged = (await rows('inbound_email_messages'))[0], parsed = (await rows('inbound_ediel_parse_results'))[0]
    expect(staged).toMatchObject({ company_id: null, mailbox_id: mailboxId, environment: 'production', processing_status: 'manual_review', raw_email: mime(unknownLegalWire), raw_edifact_payload: unknownLegalWire })
    expect(parsed).toMatchObject({ id: result.parseResultId, company_id: null, inbound_email_message_id: stored.id, raw_payload: unknownLegalWire })
    expect((parsed.parsed_payload as Row).tenantResolution).toMatchObject({ companyId: null, marketActorEdielId: '98765', receiverEdielId: '54321' })
    expect((parsed.parsed_payload as Row).errorCodes).toEqual([])
    const physical = (await port.db!.query<{ value: Row }>('select gridex_ediel_technical_ack.envelope($1) value', [staged.raw_edifact_payload])).rows[0].value
    expect(physical).toMatchObject({ environment: 'production', sender: ['12345', '14'], receiver: ['54321', '14'], interchangeReference: 'I' })
    expect(physical).toEqual((await port.db!.query<{ value: Row }>('select gridex_ediel_technical_ack.envelope($1) value', [knownWire])).rows[0].value)
    expect(await rows('tenant_actor_identifiers')).toHaveLength(1)
    expect((await rows('tenant_actor_identifiers'))[0]).toMatchObject({ company_id: OWNER.company, environment: 'production', actor_id: OWNER.actor, identifier_type: 'EdielId', identifier_value: '54321', valid_to: null })
    expect(port.errors).toHaveLength(1)
    expect(port.errors[0]).toMatchObject({ table: 'ediel_messages', error: { message: 'canonical_ediel_company_required', code: '23502' } })
    expect(await rows('ediel_messages')).toEqual([])
    expect(await rows('gridex_ediel_technical_ack.sources')).toEqual([])
    expect(await listEdielMessageIdsForInboundEmails([stored.id])).toEqual([])
    // Raw-mail and parse UUIDs cannot substitute for the canonical source ID.
    expect(await endpoint(stored.id)).toBeNull()
    expect(await endpoint(String(result.parseResultId))).toBeNull()
    expect(port.business).toEqual(before)
    expect(port.queries.filter(query => Object.hasOwn(port.business, query.table))).toEqual([])
    expect(port.attemptedTables.filter(table => !tables.includes(table) || Object.hasOwn(port.business, table))).toEqual([])
    expect(port.queries.filter(query => query.operation !== 'select').map(query => query.table)).toEqual(['inbound_email_messages', 'inbound_processing_jobs', 'inbound_ediel_parse_results', 'ediel_messages', 'inbound_email_messages'])
    expect((parsed.validation_report as Row).tenantResolution).toMatchObject({ companyId: null })
    expect((await rows('ediel_mailboxes'))[0]).toEqual(mailbox)
  })

  it('admits a known-company source through the same real contract and binds technical authority without granting business authority', async () => {
    const source = await admitKnownSource()
    expect(source.execution_context_snapshot).toMatchObject({ receivedProdatContext: { contextOrigin: 'database_insert', companyId: OWNER.company, environment: 'production', sourceMessageId: OWNER.source } })
    expect((await rows('gridex_ediel_technical_ack.sources'))[0]).toMatchObject({ source_message_id: OWNER.source, source_company_id: OWNER.company, company_id: OWNER.company, status: 'ready' })
    expect(await endpoint(OWNER.source)).toMatchObject({ kind: 'technical_endpoint_only', companyId: OWNER.company, environment: 'production', sourceMessageId: OWNER.source, authorizesBusinessEffect: false, executionActorUserId: actor, executionPhase: 'prepare', originalUNB: { receiver: ['54321', '14'], sender: ['12345', '14'] } })
  })

  it('holds an admitted source whose actual technical endpoint is not locally assigned', async () => {
    await port.db!.query('delete from tenant_actor_identifiers')
    await admitKnownSource()
    expect((await rows('gridex_ediel_technical_ack.sources'))[0]).toMatchObject({ status: 'held', reason: 'ediel_technical_endpoint_unqualified' })
    expect(await endpoint(OWNER.source)).toBeNull()
  })

  it('refuses a real ready source when the current execution actor is unqualified', async () => {
    await admitKnownSource()
    await expect(endpoint(OWNER.source, ownerId(999))).rejects.toMatchObject({ message: 'ediel_technical_ack_current_actor_required', code: '42501' })
    expect((await rows('gridex_ediel_technical_ack.sources'))[0]).toMatchObject({ status: 'ready' })
  })
})
