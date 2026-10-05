import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const wirePort = vi.hoisted(() => ({ db: null as PGlite | null, calls: [] as Array<{ name: string; input: Row }> }))
// Only external Supabase transport is replaced. Business watch, source decoder,
// sweep, process decision, overdue task writer and task reader execute normally.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: (name: string, args: Row) => rpc(name, args),
  from: (table: string) => query(table),
} }))

import { prepareEdielBusinessExpectationPlan, registerEdielBusinessExpectations, readEdielBusinessExpectations } from '@/lib/ediel/businessExpectations'
import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { sweepEdielBusinessExpectations } from '@/lib/ediel/operations/businessExpectationSweep'
import { createInboundOverdueTasks } from '@/lib/inbound-mail/inboundOverdueMonitor'
import { listAllOperationTasks } from '@/lib/operations/db'
import { isTaskLikelyResolved } from '@/lib/operations/taskResolution'
import { permissionAckMessage } from './fixtures/prodat-permission-ack'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uid(22001), actor = uid(22002), customer = uid(22003), foreign = uid(22004), site = uid(22006), point = uid(22007)
const scope = { companyId: company, actorUserId: actor, environment: 'test' as const }
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const db = () => { if (!wirePort.db) throw Error('SC022 DB port not initialized'); return wirePort.db }

// Fixture extraction executes complete installed definitions, without copying
// any matching, clock, expiration, authorization or task implementation.
function definition(source: string, anchor: string) {
  const start = source.indexOf(anchor), tail = source.slice(start)
  const end = /END\s*\$\$\s*;/.exec(tail)
  if (start < 0 || !end) throw Error(`SC022 installed definition unavailable: ${anchor}`)
  return tail.slice(0, end.index + end[0].length)
}

async function rpc(name: string, args: Row) {
  const input = args.p_input as Row
  wirePort.calls.push({ name, input: structuredClone(input) })
  // Independent Z09 owner has no declared watches in this fixture. This is an
  // explicit external empty port, never a substitute for the Z13 watch owner.
  if (name === 'gridex_ediel_metering_method_expectations_v1') return { data: [], error: null }
  if (name !== 'gridex_ediel_business_expectations_v1') throw Error(`Unexpected RPC ${name}`)
  await db().exec('SAVEPOINT sc022_rpc;SET ROLE service_role')
  try {
    const result = await db().query<{ result: unknown }>('SELECT public.gridex_ediel_business_expectations_v1($1::jsonb) result', [JSON.stringify(input)])
    return { data: result.rows[0].result, error: null }
  } catch (error) {
    await db().exec('ROLLBACK TO SAVEPOINT sc022_rpc')
    return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
  } finally { await db().exec('RESET ROLE;RELEASE SAVEPOINT sc022_rpc') }
}

// Finite parameterized table port preserves all actual caller filters/counts
// and persisted writes. It cannot write messages, permissions, ledgers or outbox.
function query(table: string) {
  if (!['company_memberships', 'ediel_messages', 'outbound_requests', 'customer_operation_tasks'].includes(table)) throw Error(`Unexpected table ${table}`)
  const identifier = (value: string) => { if (!/^[a-z_]+$/.test(value)) throw Error(`Unexpected column ${value}`); return value }
  const values: unknown[] = [], predicates: string[] = []
  let selection = '*', countOnly = false, maximum = 1000, ordering = '', update: Row | null = null, inserts: Row[] | null = null
  const parameter = (value: unknown) => { values.push(value); return `$${values.length}` }
  const q = {
    select(columns = '*', options?: { count?: string; head?: boolean }) { selection = columns; countOnly = options?.head === true; return q },
    eq(column: string, value: unknown) { predicates.push(`${identifier(column)}=${parameter(value)}`); return q },
    in(column: string, selected: unknown[]) { predicates.push(`${identifier(column)} IN (${selected.map(parameter).join(',')})`); return q },
    not(column: string, operator: string, value: unknown) { if (operator !== 'is' || value !== null) throw Error('Unexpected NOT port'); predicates.push(`${identifier(column)} IS NOT NULL`); return q },
    lt(column: string, value: unknown) { predicates.push(`${identifier(column)}<${parameter(value)}`); return q },
    contains(column: string, value: Row) { predicates.push(`${identifier(column)} @> ${parameter(JSON.stringify(value))}::jsonb`); return q },
    order(column: string, options?: { ascending?: boolean }) { ordering = ` ORDER BY ${identifier(column)} ${options?.ascending === false ? 'DESC' : 'ASC'}`; return q },
    limit(value: number) { maximum = value; return q },
    insert(value: Row) { if (table !== 'customer_operation_tasks') throw Error('Forbidden write port'); inserts = [value]; return q },
    update(value: Row) { if (table !== 'outbound_requests') throw Error('Forbidden write port'); update = value; return q },
    async then<T, E>(resolve: (value: { data: Row[]; count: number | null; error: null }) => T, reject?: (error: unknown) => E): Promise<T | E> {
      try {
        let result: Row[]
        const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : ''
        if (inserts) {
          const record = inserts[0], keys = Object.keys(record)
          result = (await db().query<Row>(`INSERT INTO ${table}(${keys.map(identifier).join(',')}) VALUES(${keys.map(key => parameter(typeof record[key] === 'object' && record[key] !== null ? JSON.stringify(record[key]) : record[key])).join(',')}) RETURNING *`, values)).rows
        } else if (update) {
          const record = update
          result = (await db().query<Row>(`UPDATE ${table} SET ${Object.keys(record).map(key => `${identifier(key)}=${parameter(record[key])}`).join(',')}${where} RETURNING *`, values)).rows
        } else {
          const columns = countOnly ? 'count(*)::integer n' : selection === '*' ? '*' : selection.split(',').map(value => identifier(value.trim())).join(',')
          result = (await db().query<Row>(`SELECT ${columns} FROM ${table}${where}${countOnly ? '' : ordering + ` LIMIT ${Math.floor(maximum)}`}`, values)).rows
        }
        return resolve({ data: countOnly ? [] : result, count: countOnly ? Number(result[0].n) : null, error: null })
      } catch (error) { if (reject) return reject(error); throw error }
    },
  }
  return q
}

beforeAll(async () => {
  wirePort.db = new PGlite()
  await db().exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE user_profiles(id uuid,user_status text);
    CREATE TABLE declared_permissions(actor uuid,company uuid,permission text);
    CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT EXISTS(SELECT FROM public.declared_permissions WHERE actor=$1 AND company=$2 AND permission=$3)';
    CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,outbound_request_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,status text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,source_operation_id text,operation_id uuid,requires_contrl boolean,contrl_status text,contrl_due_at timestamptz,requires_aperak boolean,aperak_status text);
    CREATE TABLE ediel_business_expectations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_operation_id text,expected_family text,expected_code text,expected_subtype text,expected_case_reference text,due_at timestamptz NOT NULL,status text DEFAULT 'pending',fulfilled_by_message_id uuid,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX expectations_identity ON ediel_business_expectations(company_id,environment,source_message_id,expected_family,expected_code,coalesce(expected_subtype,''));
    CREATE SCHEMA gridex_ediel_transport;CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,entered_at timestamptz,observed_at timestamptz,classification text,binding jsonb);
    CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.permission_transitions(source_message_id uuid,company_id uuid,previous_state jsonb,resulting_state jsonb,payload_hash text,qualified_original_message_id uuid,qualified_expected_message_code text,applied_at timestamptz DEFAULT now());
    CREATE TABLE gridex_received_sources.z02_core_applications(source_message_id uuid,company_id uuid,environment text,source_payload_hash text,originating_z01_message_id uuid,object_id text,identity_agency text,applied_at timestamptz DEFAULT now());
    CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,grid_owner_id uuid,request_type text,message_family text,message_code text,sent_at timestamptz,acknowledged_at timestamptz,status text,external_reference text,updated_at timestamptz DEFAULT now(),failure_reason text);
    CREATE TABLE customer_operation_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,customer_id uuid NOT NULL,site_id uuid,metering_point_id uuid,task_type text,status text,priority text,title text,description text,metadata jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE grid_owner_data_requests(id uuid);CREATE TABLE customer_info_requests(id uuid);
    CREATE TABLE metering_access_permissions(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,state_version integer,source_message_id uuid);
    CREATE TABLE ediel_outbox(id uuid PRIMARY KEY,company_id uuid,message_id uuid,status text);
    CREATE SCHEMA gridex_supply_rescission;CREATE TABLE gridex_supply_rescission.end_receipts(source_message_id uuid,company_id uuid,environment text,original_message_id uuid,original_payload_hash text,source_payload_hash text,mandate_id uuid,transition_hash text);
    CREATE SCHEMA gridex_outbound_dispatch;CREATE TABLE gridex_outbound_dispatch.attempts(id uuid PRIMARY KEY);
    -- Unrelated national Z08 authority remains closed. Its function signature
    -- is planned in the current shared owner even for a Z13 short-circuit.
    CREATE FUNCTION gridex_supply_rescission.sender_v1(uuid,uuid) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SC022 unrelated Z08 authority must not execute';END$$;`)
  const decoder = migration('20260930144205_ediel_permission_source_atomic_transitions.sql')
  await db().exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'), decoder.indexOf('-- Keep the existing closure budget')))
  await db().exec(migration('20260930154712_ediel_source_bound_business_expectations_v1.sql'))
  await db().exec(migration('20260930170258_ediel_business_expectation_applied_scope_v2.sql'))
  const projection = migration('20260930223407_ediel_atomic_accepted_source_projection.sql')
  await db().exec(definition(projection, 'CREATE OR REPLACE FUNCTION gridex_business_expectations.mutate_v1('))
  await db().exec(definition(projection, 'CREATE FUNCTION public.ediel_project_accepted_source_state_v1('))
  const national = migration('20261001115200_ediel_national_supply_rescission_business_watch.sql')
  const watchStart = national.indexOf('DO $watch$'), watchEnd = national.indexOf('END$watch$;', watchStart)
  await db().exec(national.slice(watchStart, watchEnd + 'END$watch$;'.length))
  await db().exec('ALTER FUNCTION gridex_business_expectations.reconcile_v1(uuid) RENAME TO reconcile_before_supply_rescission_v1;')
  await db().exec(definition(national, 'CREATE FUNCTION gridex_business_expectations.reconcile_v1('))
  await db().exec(migration('20261002234300_ediel_expectation_sealed_z08_acceptance.sql'))
}, 30_000)

beforeEach(async () => {
  wirePort.calls = []
  await db().exec(`BEGIN;INSERT INTO companies VALUES('${company}'),('${foreign}');
    INSERT INTO company_memberships VALUES('${company}','${actor}','active',true,now());INSERT INTO user_profiles VALUES('${actor}','active');
    INSERT INTO declared_permissions VALUES('${actor}','${company}','communication.read'),('${actor}','${company}','communication.send');
    INSERT INTO metering_access_permissions VALUES('${uid(22005)}','${company}','${customer}','requested',3,NULL);`)
})
afterEach(async () => { await db().exec('ROLLBACK;RESET ROLE') })
afterAll(async () => { await wirePort.db?.close(); wirePort.db = null })

async function seed(n: number, acceptedDaysAgo: number, accepted = true) {
  const messageId = uid(n), requestId = uid(n + 100), attemptId = uid(n + 200)
  const observed = (await db().query<{ observed: string }>('SELECT (now()-make_interval(days=>$1::integer))::text observed', [acceptedDaysAgo])).rows[0].observed
  const message = { ...permissionAckMessage('Z13'), id: messageId, company_id: company, environment: 'test', direction: 'outbound', status: 'sent', message_code: 'Z13', message_family: 'PRODAT', message_standard: 'edifact' } as EdielMessageRow
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: 'V', direction: 'outbound', referenceDate: '2026-09-30', mode: 'catalog_evidence' })
  const plan = prepareEdielBusinessExpectationPlan(message, policy)!
  expect(plan).toMatchObject({ expectedCode: 'Z14', expectedSubtypes: ['V', 'N'], offset: 21, unit: 'calendar_days', timerRuleId: 'TM-ESCO21', remoteReceiptKnown: false,
    deadlineSource: { document: 'Svensk Elmarknadshandbok', edition: '26A', section: '11.3', pages: '207' } })
  const reference = parseCanonicalMessageRow(message).transactionReference
  expect(reference).toBe('CASE:A+B?C')
  expect(reference).not.toBe(message.transaction_reference)
  await db().query(`INSERT INTO ediel_messages(id,company_id,customer_id,site_id,metering_point_id,outbound_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash,source_operation_id,requires_contrl,contrl_status,requires_aperak,aperak_status)
    VALUES($1,$2,$6,$7,$8,$5,'test','outbound','edifact','PRODAT','Z13','sent',$3,now(),$4,$9,false,'not_required',false,'not_required')`, [messageId, company, message.raw_payload, sha(message.raw_payload!), requestId, customer, site, point, requestId])
  await db().query(`INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',$4::timestamptz-interval '1 second',$4::timestamptz,$5,$6::jsonb)`, [attemptId, messageId, company, observed, accepted ? 'accepted' : 'unknown', JSON.stringify({ originalHash: sha(message.raw_payload!), businessExpectationPlan: plan })])
  // Finite accepted SMTP and positive-ACK projections share the production
  // message.outbound_request_id/company/customer/site/point tuple. SMTP owns
  // sent_at; the separate ACK writer owns status/acknowledged_at. Neither
  // projector, mailbox orchestration nor provider entry is executed here.
  await db().query(`INSERT INTO outbound_requests(id,company_id,customer_id,site_id,metering_point_id,request_type,message_family,message_code,sent_at,acknowledged_at,status,external_reference)
    VALUES($1,$2,$3,$6,$7,'metering_access','PRODAT','Z13',$4,$4,'application_accepted',$5)`, [requestId, company, customer, observed, reference, site, point])
  return { messageId, requestId, attemptId, observed, plan, reference }
}

async function immutableSnapshot() {
  const tables = ['ediel_messages', 'metering_access_permissions', 'ediel_outbox', 'gridex_received_sources.permission_transitions', 'gridex_received_sources.z02_core_applications', 'gridex_business_expectations.bindings', 'gridex_ediel_transport.attempts', 'gridex_supply_rescission.end_receipts']
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db().query<Row>(`SELECT * FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])))
}
const taskClient = { from: query } as unknown as SupabaseClient

describe('SC022 actual source watch -> sweep -> persisted overdue task and operator tracking', () => {
  it('expires the source-owned21day watch and exposes a real source-linked open task without inventing a response or permission', async () => {
    const source = await seed(22100, 22)
    const registered = (await registerEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]
    expect(registered).toMatchObject({ source_message_id: source.messageId, expected_code: 'Z14', status: 'pending', metadata: { anchorType: 'actual_accepted_smtp_observed_at', timerRuleId: 'TM-ESCO21', remoteReceiptKnown: false, automaticResendAllowed: false, transportAttemptId: source.attemptId } })
    const localParts = (value: string) => Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]))
    const anchor = localParts(source.observed), due = localParts(registered.due_at!)
    expect(Date.UTC(Number(due.year), Number(due.month) - 1, Number(due.day)) - Date.UTC(Number(anchor.year), Number(anchor.month) - 1, Number(anchor.day))).toBe(21 * 86_400_000)
    expect([due.hour, due.minute, due.second]).toEqual([anchor.hour, anchor.minute, anchor.second])
    expect((await db().query<Row>('SELECT * FROM gridex_business_expectations.bindings WHERE expectation_id=$1', [registered.id])).rows[0]).toMatchObject({ company_id: company, environment: 'test', source_message_id: source.messageId, transport_attempt_id: source.attemptId, plan: source.plan })
    const before = await immutableSnapshot()
    const sweep = await sweepEdielBusinessExpectations({ actorUserId: actor })
    expect(sweep).toMatchObject({ scopes: 2, observed: 1, manualReview: 1, fulfilled: 0, rejected: 0, blocked: [] })
    expect(sweep.nextActions[0]).toMatchObject({ companyId: company, environment: 'test', decision: { sourceMessageId: source.messageId, cause: 'business_watch_overdue', responsibility: 'tenant_operator', waitingFor: ['Z14'], allowedActions: ['read_source'], authorizesProviderEntry: false, automaticResendAllowed: false } })
    expect((await readEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]).toMatchObject({ id: registered.id, status: 'manual_review', fulfilled_by_message_id: null, metadata: { remoteReceiptKnown: false, automaticResendAllowed: false } })
    expect(await createInboundOverdueTasks()).toEqual({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 1 })
    const tasks = await listAllOperationTasks(taskClient, { companyId: company, status: 'open' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ company_id: company, customer_id: customer, site_id: site, metering_point_id: point, task_type: 'ediel_z14_overdue', status: 'open', priority: 'high', title: 'Z14-svar saknas', metadata: { sourceId: source.requestId, monitor: 'z14_overdue', outboundRequest: { id: source.requestId, company_id: company, customer_id: customer, site_id: site, metering_point_id: point, message_code: 'Z13', external_reference: source.reference } } })
    expect(tasks[0].description).toContain(source.requestId)
    expect(isTaskLikelyResolved({ task: tasks[0], sites: [], meteringPoints: [], powersOfAttorney: [] })).toBe(false)
    expect(await listAllOperationTasks(taskClient, { companyId: foreign, status: 'open' })).toEqual([])
    expect((await db().query<Row>('SELECT * FROM ediel_messages WHERE id=$1', [source.messageId])).rows[0]).toMatchObject({ outbound_request_id: source.requestId, company_id: company, customer_id: customer, site_id: site, metering_point_id: point })
    expect((await db().query<Row>('SELECT * FROM outbound_requests WHERE id=$1', [source.requestId])).rows[0]).toMatchObject({ company_id: company, customer_id: customer, site_id: site, metering_point_id: point, status: 'waiting_attention' })
    expect(await createInboundOverdueTasks()).toEqual({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 })
    expect(await listAllOperationTasks(taskClient, { companyId: company, status: 'open' })).toEqual(tasks)
    expect(await immutableSnapshot()).toEqual(before)
  })

  it('keeps a recent source watch pending without task or outbound-status side effects', async () => {
    const source = await seed(22200, 0)
    const registered = (await registerEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]
    const before = await immutableSnapshot()
    const requestBefore = (await db().query<Row>('SELECT * FROM outbound_requests')).rows
    const sweep = await sweepEdielBusinessExpectations({ actorUserId: actor })
    expect(sweep).toMatchObject({ observed: 1, manualReview: 0, fulfilled: 0, rejected: 0, blocked: [] })
    expect(sweep.nextActions[0].decision).toMatchObject({ cause: 'business_response_pending', waitingFor: ['Z14'], responsibility: 'counterparty', automaticResendAllowed: false, authorizesProviderEntry: false })
    expect((await readEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]).toEqual(registered)
    expect(await createInboundOverdueTasks()).toEqual({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 })
    expect(await listAllOperationTasks(taskClient, { companyId: company })).toEqual([])
    expect((await db().query<Row>('SELECT * FROM outbound_requests')).rows).toEqual(requestBefore)
    expect(await immutableSnapshot()).toEqual(before)
  })

  it('keeps proactive24h operator tracking separate from the still-pending21day business decision', async () => {
    const source = await seed(22300, 2)
    const registered = (await registerEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]
    const before = await immutableSnapshot()
    expect(await createInboundOverdueTasks()).toMatchObject({ z14Overdue: 1 })
    expect((await readEdielBusinessExpectations({ ...scope, messageId: source.messageId }))[0]).toEqual(registered)
    const sweep = await sweepEdielBusinessExpectations({ actorUserId: actor })
    expect(sweep).toMatchObject({ manualReview: 0, fulfilled: 0, rejected: 0, blocked: [] })
    expect(sweep.nextActions[0].decision).toMatchObject({ cause: 'business_response_pending', waitingFor: ['Z14'], automaticResendAllowed: false, authorizesProviderEntry: false })
    expect(await immutableSnapshot()).toEqual(before)
  })

  it('refuses absent SMTP acceptance and foreign reader scope before creating an expectation or changing source/domain/outbox', async () => {
    const source = await seed(22400, 22, false)
    const before = await immutableSnapshot()
    await expect(registerEdielBusinessExpectations({ ...scope, messageId: source.messageId })).rejects.toMatchObject({ message: 'ediel_expectation_actual_smtp_acceptance_required' })
    await expect(readEdielBusinessExpectations({ ...scope, companyId: foreign, messageId: source.messageId })).rejects.toMatchObject({ message: 'ediel_expectation_actor_not_authorized' })
    expect((await db().query<Row>('SELECT * FROM ediel_business_expectations')).rows).toEqual([])
    expect(await immutableSnapshot()).toEqual(before)
  })
})
