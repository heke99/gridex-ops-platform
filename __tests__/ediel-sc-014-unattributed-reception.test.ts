// masterplan: SC-014
// Ordinary SC014 qualification. Actual current admission
// prospective custody and technical-source functions execute in WASM
// PostgreSQL. The finite DB/permission/MIME ports do not establish native
// full-trigger/RLS/FK, mailbox credentials, legal mandate, SMTP or SEND authority.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { createHash } from 'node:crypto'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  db: null as PGlite | null,
  queries: [] as Array<{ table: string; operation: string; value: Row }>,
  attemptedTables: [] as string[],
  errors: [] as Array<{ table: string; error: unknown }>,
  business: {} as Record<string, Row[]>,
  rpcs: [] as Array<{ name: string; args: Row }>,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<{ key: string; operator: string; value: unknown }> = []
    one = false; exact = false; maximum = 10000; operation = 'select'; value: Row | Row[] = {}; columns = '*'
    conflictKey: string | null = null
    constructor(readonly table: string) {}
    select(columns = '*', options?: { count?: string }) { this.columns = columns; this.exact = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push({ key, operator: '=', value }); return this }
    is(key: string, value: unknown) { this.filters.push({ key, operator: 'is', value }); return this }
    not(key: string, operator: string, value: unknown) { if (operator !== 'is' || value !== null) throw Error('Undeclared NOT'); this.filters.push({ key, operator: 'is not', value }); return this }
    in(key: string, value: unknown[]) { this.filters.push({ key, operator: 'in', value }); return this }
    order() { return this }
    limit(maximum: number) { this.maximum = maximum; return this }
    abortSignal() { return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    insert(value: Row | Row[]) { this.operation = 'insert'; this.value = value; return this }
    upsert(value: Row, options: { onConflict: string; ignoreDuplicates: boolean }) {
      if (this.table !== 'ediel_outbox' || options.onConflict !== 'lock_key' || !options.ignoreDuplicates) throw Error('Undeclared upsert')
      this.conflictKey = options.onConflict; return this.insert(value)
    }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    then(onfulfilled: (value: unknown) => unknown, onrejected: (reason: unknown) => unknown) {
      return Promise.resolve().then(async () => {
        if (!port.db) throw Error('Finite DB unavailable')
        port.queries.push({ table: this.table, operation: this.operation, value: structuredClone(this.value as Row) })
        if (!tables.includes(this.table)) throw Error(`Undeclared DB access: ${this.table}`)
        const parameters: unknown[] = []
        const parameter = (value: unknown) => { parameters.push(value); return `$${parameters.length}` }
        const column = (key: string) => { if (!/^[a-z_][a-z_0-9]*$/.test(key)) throw Error(`Undeclared column ${key}`); return `"${key}"` }
        const where = this.filters.map(({ key, operator, value }) => operator === 'is' || operator === 'is not'
          ? value === null ? `${column(key)} ${operator} null` : (() => { throw Error('Undeclared IS') })()
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
              const conflict = this.conflictKey ? ` on conflict (${column(this.conflictKey)}) do nothing` : ''
              rows.push(...(await asService(() => port.db!.query<Row>(`insert into public.${this.table} (${entries.map(([key]) => column(key)).join(',')}) values (${tokens.join(',')})${conflict} returning *`, parameters))).rows)
              parameters.length = 0
            }
          } else if (this.operation === 'update') {
            const entries = Object.entries(this.value).filter(([, item]) => item !== undefined)
            rows = (await asService(() => port.db!.query<Row>(`update public.${this.table} set ${entries.map(([key, item]) => `${column(key)}=${parameter(item)}`).join(',')}${predicate} returning *`, parameters))).rows
          } else {
            rows = (await asService(() => port.db!.query<Row>(`select * from public.${this.table}${predicate} limit ${this.maximum}`, parameters))).rows
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
  const rpc = async (name: string, args: Row) => {
    port.rpcs.push({ name, args: structuredClone(args) })
    const keys = rpcArguments[name]
    if (!keys || !port.db) throw Error(`Undeclared RPC ${name}`)
    try {
      const data = await asService(async () => (await port.db!.query<{ value: unknown }>(`select public.${name}(${keys.map((_, index) => `$${index + 1}`).join(',')}) value`, keys.map(key => args[key] ?? null))).rows[0].value)
      return { data, error: null }
    } catch (error) { return { data: null, error } }
  }
  return { supabaseService: { from: (table: string) => { port.attemptedTables.push(table); return new Query(table) }, rpc } }
})

import { storeMailboxFetchMessage, listEdielMessageIdsForInboundEmails } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { prepareSourceAckDraft } from '@/lib/ediel/ack/prepareSourceAckDraft'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { readPersistedEdielTechnicalContrlBasis } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { ownerSource, OWNER, ownerId } from './helpers/sourceOwnerFixtures'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const intakeMigrationSql = readFileSync('supabase/migrations/20261005043923_ediel_unattributed_technical_intake.sql', 'utf8')
const tables = ['ediel_messages', 'inbound_email_messages', 'inbound_email_attachments', 'inbound_ediel_parse_results', 'inbound_processing_jobs',
  'ediel_mailboxes', 'tenant_actor_identifiers', 'tenant_counterparty_relations', 'platform_actor_identifiers', 'ediel_actor_settings', 'ediel_route_profiles',
  'companies', 'company_memberships', 'user_profiles', 'communication_routes', 'ediel_transport_profiles', 'ediel_unresolved_items', 'ediel_message_events', 'ediel_outbox']
function definition(kind: 'TABLE' | 'FUNCTION' | 'TYPE', name: string) {
  const start = schema.indexOf(`CREATE ${kind} ${name}`)
  if (start < 0) throw Error(`Missing actual ${kind} ${name}`)
  if (kind !== 'FUNCTION') {
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
const actor = ownerId(50), receivingActor = ownerId(51), mailboxId = ownerId(800)
const routeId = ownerId(810), profileId = ownerId(811)
const guideMigration = 'supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql'
const guideSql = readFileSync(guideMigration, 'utf8')
// Exact committed source projection INSERT, no test-generated guide verdict.
const guideStart = guideSql.indexOf('INSERT INTO gridex_ediel_ack_guide.editions(')
const guideEnd = guideSql.indexOf("'::jsonb value) edition;", guideStart)
if (guideStart < 0 || guideEnd < 0) throw Error('Missing committed ACK guide projection')
const guideInsert = guideSql.slice(guideStart, guideEnd + "'::jsonb value) edition;".length)
const guideVersion = 'a30473a34535076e12e46386563adb3fa36431a0e7a245fc1be666c5737e8708'
// Named finite transport only: every result is produced by current SQL below.
const rpcArguments: Record<string, string[]> = {
  ediel_read_technical_source_endpoint_v2: ['p_source_message_id', 'p_actor_user_id', 'p_phase'],
  ediel_capture_technical_syntax_ack_basis_v2: ['p_company_id', 'p_message_id', 'p_actor_user_id', 'p_phase'],
  ediel_record_technical_syntax_facet_v2: ['p_company_id', 'p_source_message_id', 'p_source_payload_hash', 'p_facts_text', 'p_actor_user_id', 'p_phase'],
  ediel_admit_unattributed_technical_source_v1: ['p_inbound_email_message_id', 'p_parse_result_id', 'p_actor_user_id', 'p_expected_payload_hash', 'p_expected_environment'],
  ediel_read_unattributed_technical_intake_v1: ['p_inbound_email_message_id', 'p_source_message_id', 'p_actor_user_id'],
  gridex_actor_has_company_permission: ['p_actor_user_id', 'p_company_id', 'p_permission'],
  gridex_read_outbound_acks_for_source_v2: ['p_source_message_id', 'p_ack_family', 'p_actor_user_id', 'p_phase'],
  ediel_read_outbound_ack_replay_v1: ['p_company_id', 'p_environment', 'p_source_message_id', 'p_actor_user_id', 'p_ack_family', 'p_sequence_field', 'p_sequence_value'],
  ediel_require_source_bytes_available_v1: ['p_company_id', 'p_source_message_id'],
  ediel_require_technical_syntax_ack_basis_v2: ['p_company_id', 'p_message_id', 'p_actor_user_id', 'p_phase'],
  ediel_read_technical_syntax_ack_route_v1: ['p_company_id', 'p_actor_user_id', 'p_source_message_id', 'p_smtp_from', 'p_smtp_host', 'p_smtp_port'],
  ediel_create_outbound_ack_atomic_v1: ['p_company_id', 'p_environment', 'p_source_message_id', 'p_source_payload_hash', 'p_actor_user_id', 'p_ack_family', 'p_sequence_field', 'p_sequence_value', 'p_outcome', 'p_draft', 'p_common_smtp'],
  ediel_read_persisted_technical_contrl_basis_v2: ['p_company_id', 'p_environment', 'p_ack_message_id', 'p_actor_user_id', 'p_phase'],
}
const mime = (wire: string) => `From: sender@example.invalid\r\nTo: configured@example.invalid\r\nMessage-ID: <sc014@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${wire}`

async function rows(table: string) { return (await port.db!.query<Row>(`select * from ${table}`)).rows }
async function endpoint(sourceId: string, actorId = actor) {
  try {
    await port.db!.exec('set role service_role')
    return (await port.db!.query<{ value: Row | null }>('select public.ediel_read_technical_source_endpoint_v2($1,$2,$3) value', [sourceId, actorId, 'prepare'])).rows[0].value
  } finally { await port.db!.exec('reset role') }
}
async function admitKnownSource({ reception = false } = {}) {
  const parsed = parseEdifactPayload(knownWire)!
  const db = port.db!
  // A known-company route now needs a real original reception. Its receive
  // actor is separate from the unchanged WRITE-only preparation actor.
  const mail = reception ? (await db.query<Row>(`insert into inbound_email_messages(company_id,mailbox_id,environment,received_at,raw_email,raw_edifact_payload) values($1,$2,'production','2026-10-05T00:00:00Z',$3,$4) returning *`, [OWNER.company, mailboxId, mime(knownWire), knownWire])).rows[0] : null
  const source = (await db.query<Row>(`insert into ediel_messages(id,company_id,direction,message_standard,message_family,message_code,environment,raw_payload,message_received_at,mailbox_message_id,inbound_email_message_id,sender_ediel_id,receiver_ediel_id,interchange_reference,application_reference) values($1,$2,'inbound','edifact','PRODAT',$3,'production',$4,'2026-10-05T00:00:00Z',$5,$6,$7,$8,$9,$10) returning *`, [OWNER.source, OWNER.company, parsed.messageCode, knownWire, mail?.id ?? null, mail?.id ?? null, reception ? parsed.senderEdielId : null, reception ? parsed.receiverEdielId : null, reception ? parsed.interchangeReference : null, reception ? parsed.applicationReference : null])).rows[0]
  if (mail) {
    const parse = (await db.query<Row>(`insert into inbound_ediel_parse_results(inbound_email_message_id,company_id,message_family,message_code,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,interchange_reference,application_reference,raw_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [mail.id, OWNER.company, parsed.messageFamily, parsed.messageCode, parsed.senderEdielId, parsed.receiverEdielId, parsed.senderSubAddress, parsed.receiverSubAddress, parsed.interchangeReference, parsed.applicationReference, knownWire])).rows[0]
    await db.query('insert into user_profiles(id) values($1)', [receivingActor])
    await db.query("insert into company_memberships(company_id,user_id,accepted_at) values($1,$2,'2026-01-01T00:00:00Z')", [OWNER.company, receivingActor])
    const receipt = await asService(async () => (await db.query<{ value: Row }>('select public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) value', [OWNER.company, source.id, receivingActor, mail.id, parse.id])).rows[0].value)
    expect(receipt).toMatchObject({ classification: 'first_reception', businessEffectAuthorized: false })
  }
  return source
}
async function asService<T>(work: () => Promise<T>) {
  try { await port.db!.exec('set role service_role'); return await work() }
  finally { await port.db!.exec('reset role') }
}
async function captureKnownSyntax() {
  const source = await admitKnownSource({ reception: true })
  const syntax = validateEdifactSyntax({ ...ownerSource(), environment: 'production', test_flag: 0 })
  expect(syntax).toMatchObject({ ok: true, grammarQualification: 'qualified' })
  const facts = JSON.stringify({ version: 1, owner: 'canonical-runtime-syntax-v1', syntaxDecision: syntax.ok ? 'accepted' : 'rejected', reasonCodes: syntax.issues.filter(issue => issue.severity === 'error').map(issue => issue.code) })
  await asService(() => port.db!.query('select public.ediel_record_technical_syntax_facet_v2($1,$2,$3,$4,$5,$6)', [OWNER.company, source.id, source.immutable_payload_hash, facts, actor, 'prepare']))
  const basis = await asService(async () => (await port.db!.query<{ value: Row }>('select public.ediel_capture_technical_syntax_ack_basis_v2($1,$2,$3,$4) value', [OWNER.company, source.id, actor, 'prepare'])).rows[0].value)
  expect(basis).toMatchObject({ companyId: OWNER.company, sourceMessageId: source.id, sourceHash: source.immutable_payload_hash, syntaxDecision: 'accepted' })
  expect((await rows('gridex_ediel_ack_guide.source_bindings'))[0]).toMatchObject({ source_message_id: source.id, kind: 'technical', company_id: OWNER.company, source_version: guideVersion, original_basis: basis })
  return basis
}
async function configuredRoute(actorId = actor, smtp = assertEdielSmtpReadiness(), sourceId = OWNER.source) {
  return asService(async () => (await port.db!.query<{ value: Row }>('select public.ediel_read_technical_syntax_ack_route_v1($1,$2,$3,$4,$5,$6) value', [OWNER.company, actorId, sourceId, smtp.from, smtp.host, smtp.port])).rows[0].value)
}
async function installUnattributedTechnicalIntake() {
  const db = port.db!
  // Real references and the unchanged tenant-link/national-capture guards
  // accompany the forward migration. This remains selected SQL evidence;
  // the complete native trigger/RLS graph is a separate qualification.
  for (const table of ['ediel_messages', 'inbound_email_messages', 'inbound_email_attachments', 'inbound_ediel_parse_results', 'ediel_mailboxes', 'companies', 'user_profiles']) {
    for (const match of schema.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n[\\s\\S]*?;`, 'g'))) {
      if (/ADD CONSTRAINT .* PRIMARY KEY \(/.test(match[0])) await db.exec(match[0])
    }
  }
  for (const name of ['wire_tokens_bounded_v1', 'closure_wire_tokens_v1', 'source_wire_point_v1']) await db.exec(definition('FUNCTION', `gridex_received_sources.${name}(`))
  await db.exec(definition('TABLE', 'gridex_received_sources.sources ('))
  for (const name of ['gridex_received_sources.capture_insert(', 'gridex_received_sources.capture_utilts_insert_v1(', 'public.gridex_ediel_message_inbound_email_tenant_guard(']) await db.exec(definition('FUNCTION', name))
  for (const trigger of ['gridex_capture_received_prodat_source', 'gridex_capture_received_utilts_source', 'trg_ediel_message_inbound_email_tenant_guard']) {
    const start = schema.indexOf(`CREATE TRIGGER ${trigger} `), end = schema.indexOf(';', start)
    if (start < 0 || end < 0) throw Error(`Missing actual trigger ${trigger}`)
    await db.exec(schema.slice(start, end + 1))
  }
  if (!intakeMigrationSql.trim()) throw Error('Forward technical intake migration is not implemented')
  await db.exec(intakeMigrationSql)
  // Current IMP05 custody is prospective: install its actual capture function
  // and triggers after intake, without scanning or attesting older raw mail.
  for (const match of schema.matchAll(/ALTER TABLE ONLY gridex_ediel_inbound_receptions\.technical_mailbox_births\n[\s\S]*?;/g)) await db.exec(match[0])
  for (const match of schema.matchAll(/ALTER TABLE (?:ONLY )?gridex_ediel_inbound_receptions\.technical_mailbox_births (?:ENABLE|FORCE) ROW LEVEL SECURITY;/g)) await db.exec(match[0])
  await db.exec(definition('FUNCTION', 'gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1('))
  for (const match of schema.matchAll(/CREATE TRIGGER [^\n]+ ON (?:gridex_ediel_inbound_receptions\.technical_mailbox_births|gridex_unattributed_intake\.raw_births) [^\n]+;/g)) {
    if (match[0].includes('gridex_ediel_inbound_receptions.')) await db.exec(match[0])
  }
}
async function installCurrentAtomicCustody() {
  const db = port.db!
  for (const namespace of ['auth', 'gridex_ack_authority', 'gridex_ediel_ack_replay', 'gridex_ediel_duplicate_responses', 'gridex_ediel_outbound_owner', 'gridex_ediel_common_header', 'gridex_ediel_wire_namespace', 'gridex_bilateral_prodat', 'gridex_regulated_supply', 'gridex_service_administration', 'gridex_metering_method_changes', 'gridex_prodat_object_batch', 'gridex_ediel_source_rules']) await db.exec(`create schema ${namespace}`)
  // The public snapshot excludes auth.users. The current lock-only helper
  // touches this empty external relation; it supplies no user/grant verdict.
  await db.exec('create table auth.users(id uuid)')
  for (const name of ['gridex_new_public_resource_reference', 'gridex_normalize_personal_number', 'gridex_normalize_facility_id', 'gridex_normalize_email', 'gridex_normalize_phone', 'gridex_normalize_metering_point_id']) await db.exec(definition('FUNCTION', `public.${name}(`))
  // Actual CHECK dependencies of the graph's empty service-evidence table.
  for (const name of ['canonical_tuple_projection_v1', 'requested_method_supported_v1']) await db.exec(definition('FUNCTION', `gridex_metering_method_changes.${name}(`))
  const locks = ['gridex_ediel_ack_replay.lock_current_graph_v2', 'gridex_bilateral_prodat.lock_graph_v1', 'gridex_regulated_supply.lock_graph_v1', 'gridex_bilateral_prodat.lock_source_receipts_v1']
  const lockTables = locks.flatMap(name => [...definition('FUNCTION', `${name}(`).matchAll(/LOCK TABLE ([\s\S]*?) IN SHARE(?: ROW EXCLUSIVE)? MODE;/g)].flatMap(match => match[1].split(',').map(table => table.trim())))
  const custodyTables = ['gridex_ediel_ack_replay.creation_receipts', 'gridex_ediel_outbound_owner.witnesses', 'gridex_ediel_outbound_owner.consumptions',
    'gridex_ediel_common_header.sources', 'gridex_ediel_common_header.negative_witnesses', 'gridex_ediel_common_header.negative_consumptions',
    'gridex_ediel_duplicate_responses.intents', 'gridex_ediel_duplicate_responses.consumptions', 'gridex_ediel_wire_namespace.reservations', 'gridex_ediel_wire_namespace.coverage',
    'gridex_ediel_ack_guide.established_prodat_acks', 'gridex_received_sources.prodat_mixed_object_receipts', 'gridex_ediel_source_rules.receipts', 'public.ediel_message_events']
  for (const table of new Set([...lockTables, ...custodyTables])) {
    if ((await db.query<{ present: boolean }>('select to_regclass($1) is not null present', [table])).rows[0].present) continue
    await db.exec(definition('TABLE', `${table} (`))
  }
  // Namespace allocation's real conflict key and private immutable custody
  // rows retain their actual primary/unique constraints from current schema.
  for (const table of ['gridex_ediel_wire_namespace.reservations', 'gridex_ediel_wire_namespace.coverage', 'gridex_ediel_ack_replay.creation_receipts']) {
    for (const match of schema.matchAll(new RegExp(`ALTER TABLE ONLY ${table.replaceAll('.', '\\.') }\\n[\\s\\S]*?;`, 'g'))) if (/ADD CONSTRAINT .* (PRIMARY KEY|UNIQUE) \(/.test(match[0])) await db.exec(match[0])
  }
  for (const name of [...locks, 'gridex_prodat_object_batch.require_service_v1', 'gridex_ack_authority.wire_v1', 'gridex_ediel_duplicate_responses.is_duplicate_ack_v1', 'gridex_ediel_duplicate_responses.allows_message_v1',
    'gridex_ediel_technical_ack.retained_source_v1', 'gridex_ediel_technical_ack.require_contrl_v1', 'gridex_ack_authority.read_outbound_originals_v1', 'gridex_ediel_common_header.require_ack_v1', 'gridex_ediel_source_rules.require_v1',
    'gridex_ediel_duplicate_responses.require_business_read_actor_v1', 'gridex_ediel_duplicate_responses.require_business_binding_v1', 'gridex_ediel_duplicate_responses.require_business_creation_outcome_v1',
    'gridex_ediel_ack_guide.tail_populated_v1', 'gridex_ediel_ack_guide.validate_before_registered_responses_v1', 'gridex_ediel_ack_guide.validate_v1', 'gridex_ediel_ack_guide.validate_response_for_message_v1',
    'gridex_ediel_ack_guide.qualify_err_reason_projection_v1', 'gridex_ediel_ack_guide.require_before_mixed_object_results_v1', 'gridex_ediel_ack_guide.require_before_prodat_scope_v1',
    'gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2', 'gridex_ediel_ack_replay.require_readonly_guide_v2', 'gridex_ediel_duplicate_responses.read_business_original_v1',
    'gridex_ediel_duplicate_responses.matches_business_sequence_v1', 'gridex_ediel_ack_replay.read_v1', 'gridex_ediel_ack_replay.create_v1',
    'gridex_ediel_wire_namespace.keys', 'gridex_ediel_wire_namespace.reserve', 'gridex_ediel_wire_namespace.before_message_write',
    'public.gridex_require_outbound_reply_basis_v1', 'public.gridex_capture_ediel_rule_pack_snapshot', 'public.ediel_require_source_bytes_available_v1',
    'public.gridex_read_outbound_acks_for_source_v2', 'public.ediel_read_outbound_ack_replay_v1', 'public.ediel_require_technical_syntax_ack_basis_v2', 'public.ediel_create_outbound_ack_atomic_v1',
    'gridex_ediel_technical_ack.read_persisted_contrl_v2', 'public.ediel_read_persisted_technical_contrl_basis_v2']) await db.exec(definition('FUNCTION', `${name}(`))
  for (const name of ['gridex_ack_authority', 'gridex_ediel_ack_replay']) {
    const grant = `GRANT USAGE ON SCHEMA ${name} TO service_role;`
    expect(schema).toContain(grant)
    await db.exec(grant)
  }
  for (const trigger of ['ediel_wire_reference_namespace_before_write', 'ediel_messages_rule_pack_snapshot_trg']) {
    const start = schema.indexOf(`CREATE TRIGGER ${trigger} `), end = schema.indexOf(';', start)
    if (start < 0 || end < 0) throw Error(`Missing actual trigger ${trigger}`)
    await db.exec(schema.slice(start, end + 1))
  }
}
beforeEach(async () => {
  port.queries = []; port.errors = []; port.attemptedTables = []; port.rpcs = []
  port.business = {
    customers: [{ id: OWNER.customer, company_id: ownerId(999), personal_number: '001' }],
    customer_sites: [{ id: OWNER.site, company_id: ownerId(999), customer_id: OWNER.customer }],
    metering_points: [{ id: OWNER.point, company_id: ownerId(999), site_id: OWNER.site, meter_point_id: OWNER.external }],
    customer_permissions: [{ id: ownerId(998), company_id: ownerId(999), status: 'active' }],
  }
  const db = new PGlite(); port.db = db
  for (const [key, value] of Object.entries({ EDIEL_EMAIL_PROVIDER: 'strato', EMAIL_PROVIDER: 'resend', EDIEL_SMTP_FROM: 'configured@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_PORT: '465', EDIEL_SMTP_USER: 'finite-account', EDIEL_SMTP_PASS: 'synthetic-not-a-credential' })) vi.stubEnv(key, value)
  await db.exec(`create role service_role; create role anon; create role authenticated; create schema extensions; create schema gridex_utilts_binding; create schema gridex_ediel_technical_ack; create schema gridex_ediel_retention; create schema gridex_negative_fixtures; create schema gridex_received_sources; create schema gridex_ediel_ack_guide; create schema gridex_ediel_inbound_receptions;
    -- PGlite crypto port: same PostgreSQL sha256 bytes, not an admission verdict.
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    -- Declared finite native permission service. Real current actor/profile/
    -- membership checks below remain the actual production function.
    create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as $$select $2='${OWNER.company}'::uuid and (($1='${actor}'::uuid and $3='communication.write') or ($1='${receivingActor}'::uuid and $3='communication.send'))$$;`)
  for (const name of ['public.gridex_normalize_org_number(', 'public.gridex_new_external_tenant_reference(']) await db.exec(definition('FUNCTION', name))
  await db.exec(definition('TYPE', 'public.ediel_environment_type AS ENUM ('))
  for (const table of tables) await db.exec(definition('TABLE', `public.${table} (`))
  // Install genuine empty private receipt readers used by current source guards.
  // These fixtures create no assigned negative birth or header authority.
  await db.exec('create schema gridex_ediel_header_negative_birth')
  await db.exec(definition('TABLE', 'gridex_ediel_header_negative_birth.receipts ('))
  for (const name of ['gridex_ediel_header_negative_birth.is_bound_v1(', 'gridex_ediel_header_negative_birth.evidence_v1(']) await db.exec(definition('FUNCTION', name))
  // Real rowtypes required by the current configured-route owner, followed by
  // the real ordinary-reception owner used only for known-company fixtures.
  for (const table of ['receptions', 'response_requests', 'technical_mailbox_births']) await db.exec(definition('TABLE', `gridex_ediel_inbound_receptions.${table} (`))
  for (const match of schema.matchAll(/ALTER TABLE ONLY gridex_ediel_inbound_receptions\.receptions\n[\s\S]*?;/g)) if (/ADD CONSTRAINT .* (PRIMARY KEY|UNIQUE) \(/.test(match[0])) await db.exec(match[0])
  for (const name of ['gridex_ediel_inbound_receptions.authorize_v1(', 'gridex_ediel_inbound_receptions.result_v1(', 'public.ediel_record_inbound_reception_v1(']) await db.exec(definition('FUNCTION', name))
  const outboxIndexStart = schema.indexOf('CREATE UNIQUE INDEX ediel_outbox_lock_key_uidx ')
  if (outboxIndexStart < 0) throw Error('Missing actual outbox lock key index')
  await db.exec(schema.slice(outboxIndexStart, schema.indexOf(';', outboxIndexStart) + 1))
  await db.exec(definition('TABLE', 'gridex_ediel_technical_ack.sources ('))
  for (const table of ['gridex_ediel_technical_ack.replies', 'gridex_ediel_technical_ack.syntax_facets', 'gridex_received_sources.validation_assessments',
    'gridex_ediel_ack_guide.editions', 'gridex_ediel_ack_guide.source_bindings', 'gridex_ediel_ack_guide.edition_extensions', 'gridex_ediel_ack_guide.err_reason_source_editions']) await db.exec(definition('TABLE', `${table} (`))
  await db.exec(definition('TABLE', 'gridex_ediel_retention.blob_tombstones ('))
  await db.exec(definition('FUNCTION', 'gridex_ediel_retention.public_content_v1('))
  await db.exec(definition('FUNCTION', 'public.ediel_is_qualified_retention_transition_v1('))
  for (const name of ['gridex_utilts_binding.wire_tokens_v1(', 'gridex_ediel_technical_ack.envelope(', 'gridex_ediel_technical_ack.capture_source(',
    'gridex_ediel_technical_ack.read_endpoint_v1(', 'gridex_ediel_technical_ack.require_actor_v1(', 'public.ediel_read_technical_source_endpoint_v2(',
    'public.gridex_validate_ediel_message_contract(', 'gridex_ediel_technical_ack.record_syntax_v1(',
    'gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1(', 'gridex_ediel_technical_ack.capture_reply_v1(', 'gridex_ediel_technical_ack.require_source_v1(',
    'gridex_ediel_technical_ack.require_current_endpoint_v1(', 'gridex_negative_fixtures.assert_actor_v1(', 'gridex_negative_fixtures.assert_prepare_actor_v1(',
    'gridex_ediel_technical_ack.select_configured_reply_route_v2(', 'gridex_ediel_technical_ack.read_route_v1(', 'public.ediel_read_technical_syntax_ack_route_v1(',
    'public.ediel_record_technical_syntax_facet_v2(', 'public.ediel_capture_technical_syntax_ack_basis_v2(', 'gridex_ediel_ack_guide.bind_source_before_registered_scope_v1(',
    'gridex_ediel_ack_guide.bind_source_v1(', 'gridex_ediel_ack_guide.require_registered_basis_v1(', 'gridex_ediel_ack_guide.projection_before_err_reason_scopes_v1(',
    'gridex_ediel_ack_guide.projection_for_original_v1(']) await db.exec(definition('FUNCTION', name))
  await db.exec(guideInsert)
  for (const trigger of ['ediel_messages_canonical_contract_biu', 'ediel_capture_technical_source']) {
    const start = schema.indexOf(`CREATE TRIGGER ${trigger} `), end = schema.indexOf(';', start)
    if (start < 0 || end < 0) throw Error(`Missing actual trigger ${trigger}`)
    await db.exec(schema.slice(start, end + 1))
  }
  await db.exec('grant usage on schema public,gridex_ediel_technical_ack to service_role; grant select,insert,update,delete on all tables in schema public to service_role; grant select on all tables in schema gridex_ediel_technical_ack to service_role;')
  // A foreign public queue row is a finite transport fixture, never ACK
  // custody. Its complete retry/transport state must survive own preparation.
  await db.query(`insert into public.ediel_outbox(id,company_id,ediel_message_id,message_family,message_code,environment,status,lock_key,payload) values($1,$2,$3,'CONTRL','CONTRL','production','queued','SC014-foreign-transport',$4)`, [ownerId(997), ownerId(999), ownerId(996), JSON.stringify({ foreignRetry: 'unchanged' })])
  await db.query('insert into companies(id,name) values($1,$2)', [OWNER.company, 'Synthetic technical mailbox owner'])
  await db.query('insert into user_profiles(id) values($1)', [actor])
  await db.query('insert into company_memberships(company_id,user_id,accepted_at) values($1,$2,$3)', [OWNER.company, actor, '2026-01-01T00:00:00Z'])
  await db.query(`insert into tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) values($1,'production',$2,'EdielId','54321','2026-01-01T00:00:00Z')`, [OWNER.company, OWNER.actor])
  await db.query(`insert into ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,mailbox_type) values($1,$2,'production','Synthetic tenant mailbox','configured@example.invalid','tenant')`, [mailboxId, OWNER.company])
  await db.query(`insert into communication_routes(id,company_id,route_name,route_scope,environment_type,target_email) values($1,$2,'Finite configured CONTRL','ediel_ack','production','sender@example.invalid')`, [routeId, OWNER.company])
  await db.query(`insert into ediel_route_profiles(id,company_id,communication_route_id,environment,is_active,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port) values($1,$2,$3,'production',true,'CONTRL','CONTRL','54321','12345','23-DDQ-PRODAT','configured@example.invalid','smtp.example.invalid',465)`, [profileId, OWNER.company, routeId])
})
afterEach(async () => { await port.db?.close(); port.db = null; vi.unstubAllEnvs() })

describe('SC014 actual intake/admission qualification', () => {
  it('requires the actual service session and each present JWT role without hiding contradictory claims', async () => {
    await installCurrentAtomicCustody()
    await installUnattributedTechnicalIntake()
    await asService(async () => {
      const read = () => port.db!.query<{ value: Row | null }>('select public.ediel_read_unattributed_technical_intake_v1(null,$1,$2) value', [ownerId(999999), actor])
      expect((await read()).rows[0].value).toBeNull()
      await port.db!.query("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'authenticated' })])
      await expect(read()).rejects.toMatchObject({ message: 'ediel_technical_intake_service_required', code: '42501' })
      await port.db!.query("select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })])
      await expect(read()).rejects.toMatchObject({ message: 'ediel_technical_intake_service_required', code: '42501' })
      await port.db!.query("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })])
      expect((await read()).rows[0].value).toBeNull()
    })
  })
  it('holds previously stored unattested MIME with unknown legal NAD without backfilling a source or guessing a customer', async () => {
    expect(unknownLegalWire).not.toBe(knownWire)
    expect(validateEdifactSyntax({ ...ownerSource(), environment: 'production', test_flag: 0, raw_payload: unknownLegalWire })).toMatchObject({ ok: true, grammarQualification: 'qualified' })
    const before = structuredClone(port.business)
    const mailbox = (await rows('ediel_mailboxes'))[0] as unknown as EdielMailboxRow
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor, message: { source: Buffer.from(mime(unknownLegalWire)), internalDate: new Date('2026-10-05T00:00:00Z') } })
    // The real original was stored before the prospective custody migration.
    // Its mutable public bytes must never acquire retrospective authority.
    await installCurrentAtomicCustody()
    await installUnattributedTechnicalIntake()
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
    expect(port.errors).toEqual([])
    expect(await rows('gridex_unattributed_intake.raw_births')).toEqual([])
    expect(await rows('gridex_unattributed_intake.technical_births')).toEqual([])
    expect(await rows('ediel_messages')).toEqual([])
    expect(await rows('gridex_ediel_technical_ack.sources')).toEqual([])
    expect(await listEdielMessageIdsForInboundEmails([stored.id])).toEqual([])
    // Raw-mail and parse UUIDs cannot substitute for the canonical source ID.
    expect(await endpoint(stored.id)).toBeNull()
    expect(await endpoint(String(result.parseResultId))).toBeNull()
    await expect(configuredRoute(actor, assertEdielSmtpReadiness(), stored.id)).rejects.toMatchObject({ message: 'ediel_historical_technical_ack_basis_unavailable' })
    expect(port.business).toEqual(before)
    expect(port.queries.filter(query => Object.hasOwn(port.business, query.table))).toEqual([])
    expect(port.attemptedTables.filter(table => !tables.includes(table) || Object.hasOwn(port.business, table))).toEqual([])
    expect(port.queries.filter(query => query.operation !== 'select').map(query => query.table)).toEqual(['inbound_email_messages', 'inbound_processing_jobs', 'inbound_ediel_parse_results', 'inbound_email_messages'])
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

  it('binds real syntax and committed guide provenance, then reads the exact configured CONTRL route with write-only preparation authority', async () => {
    const basis = await captureKnownSyntax()
    expect(basis.originalUNB).toEqual((await port.db!.query<{ value: Row }>('select gridex_ediel_technical_ack.envelope($1) value', [unknownLegalWire])).rows[0].value)
    const permissions = (await port.db!.query<{ write: boolean; send: boolean }>("select public.gridex_actor_has_company_permission($1,$2,'communication.write') write, public.gridex_actor_has_company_permission($1,$2,'communication.send') send", [actor, OWNER.company])).rows[0]
    expect(permissions).toEqual({ write: true, send: false })
    expect(await configuredRoute()).toMatchObject({ kind: 'technical_syntax_ack_route', companyId: OWNER.company, environment: 'production', sourceMessageId: OWNER.source,
      sourceHash: basis.sourceHash, authorizesBusinessEffect: false, senderEdielId: '54321', receiverEdielId: '12345', senderQualifier: '14', receiverQualifier: '14', senderSubAddress: null, receiverSubAddress: null,
      applicationReference: '23-DDQ-PRODAT', smtpHost: 'smtp.example.invalid', smtpPort: 465, senderEmail: 'configured@example.invalid', receiverEmail: 'sender@example.invalid',
      route: { id: routeId, company_id: OWNER.company }, routeRuntime: { route_profile_id: profileId, communication_route_id: routeId, company_id: OWNER.company, environment: 'production' } })
  })

  it('holds missing or ambiguous exact routes, changed SMTP binding and an unqualified current route actor', async () => {
    await captureKnownSyntax()
    expect(await configuredRoute()).toMatchObject({ kind: 'technical_syntax_ack_route' })
    await port.db!.query('update ediel_route_profiles set is_enabled=false where id=$1', [profileId])
    await expect(configuredRoute()).rejects.toMatchObject({ message: 'ediel_technical_ack_route_count:0' })
    await port.db!.query('update ediel_route_profiles set is_enabled=true where id=$1', [profileId])
    await port.db!.query(`insert into ediel_route_profiles select (jsonb_populate_record(null::ediel_route_profiles,to_jsonb(p)||jsonb_build_object('id',$1::uuid))).* from ediel_route_profiles p where id=$2`, [ownerId(812), profileId])
    await expect(configuredRoute()).rejects.toMatchObject({ message: 'ediel_technical_ack_route_count:2' })
    await port.db!.query('delete from ediel_route_profiles where id=$1', [ownerId(812)])
    const smtp = assertEdielSmtpReadiness()
    // Current original-mailbox custody rejects changed FROM before route lookup.
    await expect(configuredRoute(actor, { ...smtp, from: 'old@example.invalid' })).rejects.toMatchObject({ message: 'ediel_original_mailbox_smtp_custody_required', code: 'P0001' })
    for (const changed of [{ ...smtp, host: 'old.example.invalid' }, { ...smtp, port: 25 }]) await expect(configuredRoute(actor, changed)).rejects.toMatchObject({ message: 'ediel_technical_ack_route_count:0' })
    await expect(configuredRoute(ownerId(999))).rejects.toMatchObject({ message: 'ediel_negative_fixture_actor_not_authorized', code: '42501' })
    expect(await configuredRoute()).toMatchObject({ kind: 'technical_syntax_ack_route' })
  })

  it('persists a fresh actual kernel CONTRL through current atomic SQL and requalifies its immutable custody with WRITE-only PREPARE authority', async () => {
    const basis = await captureKnownSyntax()
    await installCurrentAtomicCustody()
    const source = (await rows('public.ediel_messages'))[0] as unknown as EdielMessageRow
    const beforeSource = structuredClone(source), beforeGuide = await rows('gridex_ediel_ack_guide.source_bindings'), beforeBusiness = structuredClone(port.business)
    const domainTables = ['customers', 'customer_sites', 'metering_points', 'customer_contracts', 'metering_permissions']
    const beforeDomain = await Promise.all(domainTables.map(table => rows(`public.${table}`)))
    expect(await rows('gridex_ediel_ack_replay.creation_receipts')).toEqual([])
    expect(await rows('public.ediel_message_events')).toEqual([])
    expect(await rows('gridex_ediel_wire_namespace.reservations')).toEqual([])
    const prepared = await prepareSourceAckDraft({ actorUserId: actor, sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive' })
    expect(prepared.kind).toBe('draft')
    if (prepared.kind !== 'draft') throw Error('Fresh actual draft required')
    const ack = await createCanonicalAckMessage({ actorUserId: actor, sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive', draft: prepared.draft })
    const ackHash = createHash('sha256').update(ack.raw_payload!).digest('hex')
    expect(ack).toMatchObject({ company_id: OWNER.company, environment: 'production', direction: 'outbound', message_family: 'CONTRL', related_message_id: source.id, ack_outcome: 'positive', status: 'draft', immutable_payload_hash: ackHash,
      canonical_rule_pack_id: null, customer_id: null, site_id: null, metering_point_id: null, requires_contrl: false, requires_aperak: false })
    expect((ack as unknown as Row).immutable_rendered_at).toBeTruthy()
    expect(ack.raw_payload).toBe(prepared.draft.rawPayload)
    expect((await port.db!.query<{ value: Row }>('select to_jsonb(m) value from public.ediel_messages m where id=$1', [ack.id])).rows[0].value).toEqual(ack)
    expect((await rows('public.ediel_messages')).find(row => row.id === source.id)).toEqual(beforeSource)
    expect(await rows('gridex_ediel_ack_guide.source_bindings')).toEqual(beforeGuide)
    expect(await rows('gridex_ediel_wire_namespace.coverage')).toEqual([expect.objectContaining({ source_message_id: ack.id, payload_sha256: ackHash, company_id: OWNER.company, environment: 'production' })])
    const keys = (await port.db!.query<{ value: Row[] }>('select gridex_ediel_wire_namespace.keys($1) value', [ack.raw_payload])).rows[0].value
    const reservations = await rows('gridex_ediel_wire_namespace.reservations')
    expect(reservations).toHaveLength(keys.length)
    for (const key of keys) expect(reservations).toContainEqual(expect.objectContaining({ source_message_id: ack.id, company_id: OWNER.company, environment: 'production', first_payload_sha256: ackHash, sender_namespace: key.sender, application_namespace: key.application, reference_kind: key.kind, wire_reference: key.value }))
    const receipts = await rows('gridex_ediel_ack_replay.creation_receipts'), events = await rows('public.ediel_message_events')
    expect(receipts).toHaveLength(1); expect(events).toHaveLength(1)
    const [receipt] = receipts, [event] = events
    expect(receipt).toMatchObject({ ack_message_id: ack.id, source_message_id: source.id, company_id: OWNER.company, environment: 'production', actor_user_id: actor, source_payload_hash: basis.sourceHash, ack_payload_hash: ackHash, event_id: event.id, family: 'CONTRL', outcome: 'positive', sequence_field: null, sequence_value: null })
    expect(event).toMatchObject({ company_id: OWNER.company, ediel_message_id: ack.id, event_type: 'created', created_by: actor, event_payload: { sourceMessageId: source.id, sourceOperationId: receipt.source_operation_id, atomicOwner: true } })
    const actual = await readPersistedEdielTechnicalContrlBasis({ companyId: OWNER.company, environment: 'production', ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: actor, phase: 'prepare' })
    expect(actual.ackMessage).toEqual(ack)
    expect(actual.evidence).toEqual(basis)
    expect(port.rpcs.filter(call => call.name === 'ediel_create_outbound_ack_atomic_v1')).toHaveLength(1)
    expect(port.rpcs.filter(call => call.name === 'ediel_read_persisted_technical_contrl_basis_v2')).toEqual([expect.objectContaining({ args: expect.objectContaining({ p_actor_user_id: actor, p_phase: 'prepare' }) })])
    expect(port.business).toEqual(beforeBusiness)
    expect(await Promise.all(domainTables.map(table => rows(`public.${table}`)))).toEqual(beforeDomain)
    expect(port.attemptedTables.filter(table => !tables.includes(table) || Object.hasOwn(port.business, table))).toEqual([])
    expect(await rows('gridex_ediel_outbound_owner.witnesses')).toEqual([])
    expect(await rows('gridex_ediel_outbound_owner.consumptions')).toEqual([])
  })

  it('admits fresh unknown-legal intake only as a protected technical original and persists its prescribed CONTRL without business attribution', async () => {
    await installCurrentAtomicCustody()
    await installUnattributedTechnicalIntake()
    const syntax = validateEdifactSyntax({ ...ownerSource(), environment: 'production', test_flag: 0, raw_payload: unknownLegalWire })
    expect(syntax).toMatchObject({ ok: true, grammarQualification: 'qualified' })
    const beforeBusiness = structuredClone(port.business)
    const mailbox = (await rows('ediel_mailboxes'))[0] as unknown as EdielMailboxRow
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor, message: { source: Buffer.from(mime(unknownLegalWire)), internalDate: new Date('2026-10-05T00:00:00Z') } })
    const result = await processInboundEmailMessage({ inboundEmailMessageId: stored.id, actorUserId: actor })
    expect(result).toMatchObject({ status: 'manual_review', companyId: null })
    const staged = (await rows('inbound_email_messages'))[0]
    expect(staged).toMatchObject({ company_id: null, environment: 'production', raw_email: mime(unknownLegalWire), raw_edifact_payload: unknownLegalWire })
    expect((await rows('inbound_ediel_parse_results'))[0]).toMatchObject({ company_id: null, raw_payload: unknownLegalWire })
    expect(port.business).toEqual(beforeBusiness)
    expect(port.attemptedTables.filter(table => !tables.includes(table) || Object.hasOwn(port.business, table))).toEqual([])
    // A real mailbox caller must expose an actual protected source ID. The
    // staged raw/parse UUIDs and the mailbox's transport company are not one.
    const ids = await listEdielMessageIdsForInboundEmails([stored.id])
    expect(ids).toHaveLength(1)
    const sourceRow = (await rows('ediel_messages')).find(row => row.id === ids[0])
    if (!sourceRow) throw Error('Protected source must be persisted')
    const source = sourceRow as unknown as EdielMessageRow
    expect(source).toMatchObject({ company_id: null, resolved_company_id: null, environment: 'production', direction: 'inbound', raw_payload: unknownLegalWire,
      inbound_email_message_id: stored.id, customer_id: null, site_id: null, metering_point_id: null })
    expect(source.execution_context_snapshot).not.toHaveProperty('receivedProdatContext')
    expect(await endpoint(source.id)).toMatchObject({ companyId: OWNER.company, sourceMessageId: source.id })
    const facts = JSON.stringify({ version: 1, owner: 'canonical-runtime-syntax-v1', syntaxDecision: 'accepted', reasonCodes: [] })
    expect(sourceRow.immutable_payload_hash).toBe(createHash('sha256').update(unknownLegalWire, 'utf8').digest('hex'))
    await asService(() => port.db!.query('select public.ediel_record_technical_syntax_facet_v2($1,$2,$3,$4,$5,$6)', [OWNER.company, source.id, sourceRow.immutable_payload_hash, facts, actor, 'prepare']))
    await asService(() => port.db!.query('select public.ediel_capture_technical_syntax_ack_basis_v2($1,$2,$3,$4)', [OWNER.company, source.id, actor, 'prepare']))
    const beforeSource = structuredClone(source)
    const prepared = await prepareSourceAckDraft({ actorUserId: actor, sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive' })
    expect(prepared.kind).toBe('draft')
    if (prepared.kind !== 'draft') throw Error('Fresh actual technical draft required')
    const ack = await createCanonicalAckMessage({ actorUserId: actor, sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive', draft: prepared.draft })
    expect(ack).toMatchObject({ company_id: OWNER.company, environment: 'production', direction: 'outbound', message_family: 'CONTRL', related_message_id: source.id, ack_outcome: 'positive', status: 'draft',
      customer_id: null, site_id: null, metering_point_id: null, canonical_rule_pack_id: null, requires_contrl: false, requires_aperak: false })
    const retained = await readPersistedEdielTechnicalContrlBasis({ companyId: OWNER.company, environment: 'production', ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: actor, phase: 'prepare' })
    expect(retained.ackMessage).toEqual(ack)
    expect((await rows('ediel_messages')).find(row => row.id === source.id)).toEqual(beforeSource)
    expect(port.business).toEqual(beforeBusiness)
    expect(await rows('gridex_ediel_outbound_owner.witnesses')).toEqual([])
    expect(await rows('gridex_ediel_outbound_owner.consumptions')).toEqual([])
  })

  it('keeps a protected original technical-only across reprocessing, later transactions and ordinary-source operations', async () => {
    await installCurrentAtomicCustody()
    await installUnattributedTechnicalIntake()
    const mailbox = (await rows('ediel_mailboxes'))[0] as unknown as EdielMailboxRow
    const beforeBusiness = structuredClone(port.business)
    const beforeOutbox = await rows('ediel_outbox')
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor, message: { source: Buffer.from(mime(unknownLegalWire)), internalDate: new Date('2026-10-05T00:00:00Z') } })
    const first = await processInboundEmailMessage({ inboundEmailMessageId: stored.id, actorUserId: actor })
    const [sourceId] = await listEdielMessageIdsForInboundEmails([stored.id])
    expect(sourceId).toBeTruthy()
    const original = (await rows('ediel_messages')).find(row => row.id === sourceId)!
    const births = await rows('gridex_unattributed_intake.technical_births')
    const repeated = await processInboundEmailMessage({ inboundEmailMessageId: stored.id, actorUserId: actor })
    expect(repeated).toMatchObject({ companyId: null, parseResultId: first.parseResultId })
    expect(await rows('inbound_ediel_parse_results')).toHaveLength(1)
    expect(await listEdielMessageIdsForInboundEmails([stored.id])).toEqual([sourceId])
    await processInboundEdielMessage({ actorUserId: actor, edielMessageId: sourceId })
    expect((await rows('ediel_messages')).find(row => row.id === sourceId)).toEqual(original)
    const acks = (await rows('ediel_messages')).filter(row => row.direction === 'outbound')
    expect((await rows('ediel_message_events')).filter(row => (row.event_payload as Row | null)?.blockedBy === 'canonical_inbound_ack_guard')).toEqual([])
    expect(acks, JSON.stringify(await rows('ediel_message_events'))).toEqual([expect.objectContaining({ message_family: 'CONTRL', related_message_id: sourceId, company_id: OWNER.company })])
    expect(await rows('ediel_outbox')).toEqual([...beforeOutbox, expect.objectContaining({ ediel_message_id: acks[0].id, source_message_id: sourceId, company_id: OWNER.company, status: 'queued' })])
    expect(port.attemptedTables.filter(table => Object.hasOwn(port.business, table))).toEqual([])
    expect(port.business).toEqual(beforeBusiness)
    // This UPDATE is a separate actual SQL transaction from the source birth.
    await asService(() => port.db!.query('update public.ediel_messages set validation_report=$2 where id=$1', [sourceId, JSON.stringify({ diagnostic: 'later technical review' })]))
    expect((await rows('ediel_messages')).find(row => row.id === sourceId)).toMatchObject({ company_id: null, resolved_company_id: null, raw_payload: unknownLegalWire })
    expect(await rows('gridex_unattributed_intake.technical_births')).toEqual(births)
    await expect(asService(() => port.db!.query('update public.ediel_messages set company_id=$2,resolved_company_id=$2 where id=$1', [sourceId, OWNER.company]))).rejects.toMatchObject({ code: '23514' })
    // The existing canonical NULL guard runs before the later identity guard.
    await expect(asService(() => port.db!.query('update public.ediel_messages set inbound_email_message_id=$2 where id=$1', [sourceId, ownerId(999999)]))).rejects.toMatchObject({ message: 'canonical_ediel_company_required', code: '23502' })
    await expect(asService(() => port.db!.query('delete from public.ediel_messages where id=$1', [sourceId]))).rejects.toMatchObject({ message: 'ediel_technical_intake_original_immutable' })
    // A later legally known producer cannot add a second protected physical
    // interchange, even when its NAD differs from the held legal projection.
    await expect(admitKnownSource()).rejects.toMatchObject({ message: 'ediel_technical_intake_physical_original_exists', code: '23505' })
    const distinctWire = knownWire.replace('+I++23-DDQ-PRODAT', '+DISTINCT++23-DDQ-PRODAT').replace('UNZ+1+I', 'UNZ+1+DISTINCT')
    expect(distinctWire).not.toBe(knownWire)
    await port.db!.query(`insert into public.ediel_messages(id,company_id,direction,message_standard,message_family,message_code,environment,raw_payload,message_received_at) values($1,$2,'inbound','edifact','PRODAT','Z04','production',$3,'2026-10-05T00:00:00Z')`, [OWNER.source, OWNER.company, distinctWire])
    expect((await port.db!.query<Row>('delete from public.ediel_messages where id=$1 returning id', [OWNER.source])).rows).toEqual([{ id: OWNER.source }])
    expect((await rows('ediel_messages')).filter(row => row.direction === 'inbound')).toHaveLength(1)
  })

  it('holds technical admission outside the supported READ COMMITTED transaction boundary', async () => {
    await installCurrentAtomicCustody()
    await installUnattributedTechnicalIntake()
    const mailbox = (await rows('ediel_mailboxes'))[0] as unknown as EdielMailboxRow
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor, message: { source: Buffer.from(mime(unknownLegalWire)), internalDate: new Date('2026-10-05T00:00:00Z') } })
    await port.db!.exec("set default_transaction_isolation='repeatable read'")
    const result = await processInboundEmailMessage({ inboundEmailMessageId: stored.id, actorUserId: actor })
    expect(result).toMatchObject({ status: 'manual_review', companyId: null })
    expect(await rows('gridex_unattributed_intake.technical_births')).toEqual([])
    expect(await rows('gridex_unattributed_intake.physical_claims')).toEqual([])
    expect(await rows('ediel_messages')).toEqual([])
    await expect(asService(() => port.db!.query('select public.ediel_admit_unattributed_technical_source_v1($1,$2,$3,$4,$5)', [stored.id, result.parseResultId, actor, createHash('sha256').update(unknownLegalWire).digest('hex'), 'production']))).rejects.toMatchObject({ message: 'ediel_technical_intake_read_committed_required', code: '25000' })
  })
})
