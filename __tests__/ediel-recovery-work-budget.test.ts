
const state = vi.hoisted(() => ({ calls: [] as {name:string;args:Record<string,unknown>}[], targets: [] as unknown[], failStart:false }));
import fs from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,afterAll} from 'vitest'
// reality-defects: O2
// Reality finding O2: inbound UTILTS held for internal review were released
// only by a platform admin (who is also a tenant member) pressing "Återuppta
// hållna transaktioner" per message (scenario F step F6c: ~123 clicks), and
// each held file became an APERAK/UTILTS-ERR SLA breach. The inbound cron now
// resumes a held source through the operator's own engine path once every held
// transaction's hold reason is resolved without a human decision (issuer or
// periodic evidence now present, bounded structure re-check), and never a hold
// that needs a human. Synthetic in-memory rows only; no database, no cron endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  active:false,
  beforeEvent: null as null | ((input: {edielMessageId:string;payload?:Row})=>Promise<void>),
  tables: {} as Record<string, Row[]>,
  issuerQualified: new Set<string>(),
  periodicQualified: new Set<string>(),
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  processed: [] as Array<{ actorUserId: string; edielMessageId: string }>,
  processImpl: null as null | ((input: { actorUserId: string; edielMessageId: string }) => Promise<void>),
  members: new Set<string>(),
  activeTgtCase: null as string | null,
  clock: { now: new Date('2026-10-23T12:00:00.000Z') },
}))

function columnValue(row: Row, column: string): unknown {
  const [base, key] = column.split('->>')
  if (key === undefined) return row[base]
  const value = row[base]
  if (!value || typeof value !== 'object') return undefined
  const member = (value as Row)[key]
  return member === undefined || member === null ? null : typeof member === 'object' ? JSON.stringify(member) : String(member)
}

vi.mock('@/lib/supabase/service', () => {
  class Query implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: Array<(row: Row) => boolean> = []
    private patch: Row | null = null
    private max: number | null = null
    private orderBy: { column: string; ascending: boolean } | null = null
    private single = false
    constructor(private readonly table: string) {}
    select() { return this }
    abortSignal() { return this }
    update(patch: Row) { this.patch = patch; return this }
    eq(column: string, value: unknown) { this.filters.push((row) => columnValue(row, column) === value); return this }
    in(column: string, values: unknown[]) {
      if (values.length > 100) throw new Error('URI too long')
      this.filters.push((row) => values.includes(columnValue(row, column)))
      return this
    }
    or(expression: string) {
      // The held owner emits an OR of quoted, exact company/message pairs.
      // Reject unsupported PostgREST syntax rather than silently broadening it.
      const matches = [...expression.matchAll(/and\(company_id\.eq\.("(?:\\.|[^"\\])*"),ediel_message_id\.eq\.("(?:\\.|[^"\\])*")\)/g)]
      if (!matches.length || matches.map((match) => match[0]).join(',') !== expression) throw new Error('unsupported pair filter')
      const pairs = matches.map((match) => [JSON.parse(match[1]) as string, JSON.parse(match[2]) as string])
      this.filters.push((row) => pairs.some(([company, message]) => row.company_id === company && row.ediel_message_id === message))
      return this
    }
    is(column: string, value: null) { this.filters.push((row) => (columnValue(row, column) ?? null) === value); return this }
    not(column: string, operator: string, value: unknown) {
      if (operator !== 'is' || value !== null) throw new Error('unsupported not filter')
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
      return this
    }
    lt(column: string, value: string) { this.filters.push((row) => String(row[column]) < value); return this }
    gt(column: string, value: string) { this.filters.push((row) => String(row[column]) > value); return this }
    order(column: string, options: { ascending: boolean }) { this.orderBy = { column, ...options }; return this }
    limit(count: number) { this.max = count; return this }
    maybeSingle() { this.single = true; return this }
    private run(): { data: unknown; error: unknown } {
      const rows = io.tables[this.table] ?? []
      let matched = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.patch) {
        for (const row of matched) Object.assign(row, this.patch)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      if (this.orderBy) {
        const { column, ascending } = this.orderBy
        matched = [...matched].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1))
      }
      if (this.max !== null) matched = matched.slice(0, this.max)
      const copies = matched.map((row) => structuredClone(row))
      return { data: this.single ? copies[0] ?? null : copies, error: null }
    }
    then<A = { data: unknown; error: unknown }, B = never>(
      resolve?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
      reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve().then(() => this.run()).then(resolve, reject)
    }
  }
  // The protected read RPCs, scoped like the SQL (company + source); status from the synthetic evidence state.
  const probeRpc = async (name: string, args: Row) => {
    io.rpcCalls.push({ name, args })
    const source = (io.tables.ediel_messages ?? []).find((row) => row.id === args.p_message_id && row.company_id === args.p_company_id)
    if (!source) return { data: null, error: { message: 'scope' } }
    const base = { version: 1, companyId: source.company_id, environment: source.environment, sourceMessageId: source.id }
    if (name === 'gridex_read_utilts_issuer_identity_authority_v1') {
      const qualified = io.issuerQualified.has(String(source.id))
      return { data: { ...base, status: qualified ? 'qualified' : 'held', authorityVersionId: qualified ? '55555555-5555-4555-8555-555555555555' : null,
        namespaceEpoch: qualified ? '1' : null, messageReferenceCollision: false, transactionReferenceCollisions: [],
        holdReason: qualified ? null : 'ediel_utilts_historical_issuer_basis_unavailable' }, error: null }
    }
    if (name === 'gridex_read_periodic_dgi_e66_reason_v1') {
      const qualified = io.periodicQualified.has(String(source.id))
      return { data: { ...base, status: qualified ? 'qualified' : 'held', expectedReasons: qualified ? [{ scopeHash: 'a'.repeat(64) }] : [],
        holdReason: qualified ? null : 'ediel_periodic_reason_current_contract_source_fact_required' }, error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  }
  const rpc=(name:string,args:Row)=>{
    if(!io.active){state.calls.push({name,args});return {async abortSignal(){if(name==='ediel_recovery_discover_v1')return {data:{scanned:200},error:null};if(name==='ediel_recovery_lease_v1')return {data:{claimed:state.targets,candidates:state.targets.length,claimedSources:state.targets.length},error:null};if(args.p_operation==='start'&&state.failStart)return {data:null,error:new Error('start network ambiguity')};return {data:{attempt:1,maxAttempts:3},error:null}}}}
    const promise=name.startsWith('ediel_recovery_')?ownerRpc(name,args):probeRpc(name,args)
    return Object.assign(promise,{abortSignal:()=>promise})
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc } }
})

vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: async (input: { edielMessageId: string; eventType: string; eventStatus?: string; message?: string; payload?: Row; actorUserId: string }) => {
    if (io.beforeEvent) await io.beforeEvent(input)
    const row = { ediel_message_id: input.edielMessageId, event_type: input.eventType, event_status: input.eventStatus ?? 'info',
      message: input.message ?? null, payload: input.payload ?? {}, actor_user_id: input.actorUserId, created_at: new Date().toISOString() }
    io.tables.ediel_message_events.push(row)
    return row
  },
}))

vi.mock('@/lib/ediel/services/authorization', () => ({
  // Active tenant member with the permission (synthetic membership set "company|actor").
  assertEdielTenantActor: async (input: { companyId: string; actorUserId: string; permission: string }) => {
    if (!io.members.has(`${input.companyId}|${input.actorUserId}`)) throw new Error('ediel_tenant_actor_forbidden')
  },
}))

vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  resolveUtiltsRuntimeTestCaseCode: async (input: { sourceMessage: Row }) =>
    (input.sourceMessage.parsed_payload as Row | undefined)?.testCaseCode as string | undefined
      ?? (input.sourceMessage.environment === 'test' ? io.activeTgtCase : null),
}))

// The canonical processor. Like the real engine it re-reads the evidence: a source
// whose issuer/periodic basis is now present leaves review and gets its APERAK,
// queued in the outbox (operational origin, F112); otherwise it stays held.
vi.mock('@/lib/ediel/operationalBridge', () => ({
  processEdielOperationalMessage: async (input: { actorUserId: string; edielMessageId: string }) => {
    io.processed.push(input)
    if (io.processImpl) return io.processImpl(input)
    const rows = io.tables.ediel_ack_transaction_results.filter((row) => row.source_message_id === input.edielMessageId)
    for (const row of rows) {
      const codes = row.issue_codes as string[]
      const blocked = (codes.includes('UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE') && !io.issuerQualified.has(input.edielMessageId))
        || (codes.includes('UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE') && !io.periodicQualified.has(input.edielMessageId))
        || codes.includes('UTILTS_STRUCTURE_UNAVAILABLE')
      if (blocked) continue
      const ackId = `aperak-${input.edielMessageId}-${String(row.source_transaction_id)}`
      io.tables.ediel_messages.push({ id: ackId, company_id: row.company_id, environment: row.environment, direction: 'outbound',
        message_family: 'APERAK', message_code: 'APERAK', status: 'prepared', related_message_id: input.edielMessageId,
        transaction_reference: row.source_transaction_id })
      io.tables.ediel_outbox.push({ ediel_message_id: ackId, status: 'prepared' })
      Object.assign(row, { disposition: 'accepted', planned_response_type: 'positive_aperak', final_response_type: 'positive_aperak',
        response_message_id: ackId, finalized_at: io.clock.now.toISOString(), issue_codes: [] })
    }
  },
}))

// The inbound-mail cron engine around the resume (mailbox polling and the other resumes find nothing here).
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', () => ({
  NO_ACTIVE_EDIEL_MAILBOX_ERROR: 'no mailbox', nowIso: () => new Date().toISOString(),
  envInt: (_name: string, fallback: number) => fallback,
  listConfiguredEdielMailboxes: async () => [{ id: 'mb-1' }],
  mailboxSkipReason: () => null, mailboxDebugItem: (mailbox: unknown) => mailbox,
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', () => ({
  pollEdielMailbox: async () => ({ mailboxId: 'mb-1', mailboxName: 'shared', fetched: 0, stored: 0, deduped: 0,
    inboundEmailMessageIds: [], dedupedInboundEmailMessageIds: [], errors: [] }),
  processQueuedInboundProcessingJobs: async () => ({ processed: 0, failed: 0, processedInboundEmailMessageIds: [] }),
  listEdielMessageIdsForInboundEmails: async () => [],
  ensureDiagnosticEdielMessagesForInboundEmails: async () => [], listRecentParsedInboundEmailIds: async () => [],
  logInboundPollRun: async () => undefined,
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, work: (item: T) => Promise<R>) => Promise.all(items.map(work)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({
  processInboundEdielMessage: async () => { throw new Error('first-run processing is not the held resume') },
  resumeInboundTechnicalAck: async () => { throw new Error('not the held resume') },
}))

vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-3',()=>({runInboundEdielMailEngine:async()=>{throw new Error('poller is outside this direct resumer behavior probe')}}))


import { HELD_UTILTS_RESUME_MARKER, resumeHeldInboundUtilts } from '@/lib/ediel/utilts/heldUtiltsResume'

const ACTOR = '22222222-2222-4222-8222-222222222222'
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '99999999-9999-4999-8999-999999999999'
const ISSUER = 'UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'
const at = (minutesAgo: number) => new Date(io.clock.now.getTime() - minutesAgo * 60_000).toISOString()
let serial = 0

function heldSource(input: { company?: string; environment?: 'test' | 'production'; codes?: string[][]; heldMinutesAgo?: number; source?: Row } = {}) {
  serial += 1
  const id = `src-${String(serial).padStart(3, '0')}`
  const company = input.company ?? TENANT_A, environment = input.environment ?? 'production'
  io.tables.ediel_messages.push({ id, company_id: company, environment, direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'validated', updated_at: at(input.heldMinutesAgo ?? 30),
    sender_ediel_id: '16700', receiver_ediel_id: '70309', application_reference: '23-DDQ-E66-S', raw_payload: "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    parsed_payload: {}, validation_report: {}, ...(input.source ?? {}) })
  // The technical CONTRL exists already; it never blocks a held transaction.
  io.tables.ediel_messages.push({ id: `contrl-${id}`, company_id: company, environment, direction: 'outbound', message_family: 'CONTRL',
    message_code: 'CONTRL', status: 'sent', related_message_id: id, transaction_reference: null })
  for (const [index, codes] of (input.codes ?? [[ISSUER]]).entries()) {
    io.tables.ediel_ack_transaction_results.push({ company_id: company, environment, source_message_id: id, source_transaction_id: `T${serial}-${index}`,
      disposition: 'internal_review', planned_response_type: 'none', final_response_type: null, response_message_id: null, finalized_at: null,
      issue_codes: codes, created_at: at(input.heldMinutesAgo ?? 30), updated_at: at(input.heldMinutesAgo ?? 30) })
  }
  return id
}

const run = (overrides: Partial<Parameters<typeof resumeHeldInboundUtilts>[0]> = {}) => resumeHeldInboundUtilts({
  environment: 'production', actorUserId: ACTOR, workerId: 'worker-1', now: () => io.clock.now, ...overrides })
const resumeEvents = (id: string) => io.tables.ediel_message_events
  .filter((row) => row.ediel_message_id === id && (row.payload as Row).resume === HELD_UTILTS_RESUME_MARKER)
beforeEach(() => {
  io.active=false
  io.beforeEvent=null
  io.tables = { ediel_messages: [], ediel_message_events: [], ediel_ack_transaction_results: [], ediel_outbox: [] }
  io.issuerQualified = new Set(); io.periodicQualified = new Set(); io.rpcCalls = []; io.processed = []; io.processImpl = null
  io.members = new Set([`${TENANT_A}|${ACTOR}`, `${TENANT_B}|${ACTOR}`]); io.activeTgtCase = null
  io.clock.now = new Date(); serial = 0
})


const db=new PGlite();
const ids=new Map<string,string>();
function sqlId(value:unknown):string|null {if(value==null)return null;const s=String(value);if(/^[a-f0-9-]{36}$/.test(s))return s;if(!ids.has(s))ids.set(s,`00000000-0000-4000-8000-${String(ids.size+1).padStart(12,'0')}`);return ids.get(s)!}
async function q(sql:string,params:unknown[]=[]){return (await db.query<Row>(sql,params)).rows}
async function syncEvidence(){
 for(const m of io.tables.ediel_messages)await q(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,status,processing_status,created_at,updated_at,related_message_id) VALUES($1,$2,$3,$4,'edifact',$5,$6,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET status=excluded.status,processing_status=excluded.processing_status,updated_at=excluded.updated_at`,[sqlId(m.id),m.company_id,m.environment,m.direction,m.message_family,m.status,at(120),m.updated_at??at(30),sqlId(m.related_message_id)]);
 await db.exec('DELETE FROM ediel_ack_transaction_results');
 for(const h of io.tables.ediel_ack_transaction_results)await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,final_response_type,finalized_at,response_message_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[h.company_id,h.environment,sqlId(h.source_message_id),h.disposition,h.final_response_type,h.finalized_at,sqlId(h.response_message_id)]);
 // Rebuild only fixture evidence; ownership/counters remain the actual migration's state.
 await db.exec('DELETE FROM ediel_message_events');
 for(const e of io.tables.ediel_message_events){const m=io.tables.ediel_messages.find(m=>m.id===e.ediel_message_id);await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload,created_at) VALUES($1,$2,$3,$4,$5)`,[m?.company_id,sqlId(e.ediel_message_id),e.event_type,JSON.stringify(e.payload),e.created_at]);}
}
async function ownerRpc(name:string,args:Row){
 try{await syncEvidence();const params=Object.values(args);const keys=Object.keys(args);await db.exec('SET ROLE service_role');let result:unknown;
 try{result=(await q(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) result`,params))[0].result}finally{await db.exec('RESET ROLE')}
 if(name==='ediel_recovery_lease_v1'){const data=result as {claimed:Row[]};for(const t of data.claimed){const original=[...ids].find(([,id])=>id===t.sourceMessageId);if(original)t.sourceMessageId=original[0]}}
 return {data:result,error:null}
 }catch(error){return {data:null,error}}
}
async function activate(){io.active=true;ids.clear();await db.exec('TRUNCATE gridex_ediel_recovery.reconcile_audit,gridex_ediel_recovery.terminal_receipts,gridex_ediel_recovery.work,gridex_ediel_recovery.source_claims,gridex_ediel_recovery.cursors,gridex_ediel_recovery.lease_cursors,ediel_message_events,ediel_ack_transaction_results,ediel_messages CASCADE')}
beforeAll(async()=>{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,status text,processing_status text,tenant_resolution_status text,inbound_email_message_id uuid,related_message_id uuid,sender_ediel_id text,receiver_ediel_id text,created_at timestamptz,updated_at timestamptz,UNIQUE(company_id,id));
CREATE TABLE ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,disposition text,final_response_type text,finalized_at timestamptz,response_message_id uuid,id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now()-interval '1 hour',updated_at timestamptz NOT NULL DEFAULT now()-interval '1 hour');
CREATE TABLE inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,environment text,processing_status text,match_status text);
CREATE TABLE ediel_message_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,event_type text,message text,payload jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE ediel_outbox(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid,environment text,status text,source_message_id uuid);
CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active boolean DEFAULT true);
CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,membership_role text);
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text,is_active boolean DEFAULT true);
CREATE TABLE admin_users(user_id uuid,is_active boolean,role text);
CREATE TABLE roles(id uuid,key text,name text);
CREATE TABLE user_roles(user_id uuid,company_id uuid,role_id uuid,status text,is_active boolean,role text);
CREATE TABLE user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
CREATE TABLE user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE fixture_effective_permissions(user_id uuid,company_id uuid,key text);
CREATE FUNCTION gridex_get_user_permissions_in_company(uuid,uuid) RETURNS text[] LANGUAGE sql AS $$SELECT coalesce(array_agg(key),'{}'::text[]) FROM fixture_effective_permissions WHERE user_id=$1 AND company_id=$2$$;`);
const canonical=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const actor=canonical.match(/CREATE FUNCTION public\.gridex_actor_has_company_permission\([\s\S]*?\n\$\$;/g);if(actor?.length!==1)throw new Error("canonical actor missing");await db.exec(actor![0]);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261023232112_ediel_bounded_recovery_work.sql',import.meta.url),'utf8'));

});
afterAll(async()=>{await db.close()});
import { claimRecoveryWork, runRecoveryBatch, type RecoveryClaim } from '@/lib/inbound-mail/edielRecoveryWork';
const target=():RecoveryClaim & {companyId:string}=>({companyId:"company",attempt:1,maxAttempts:3,recovery:{workId:'work',token:'token',leaseUntil:'later',deadline:performance.now()+45_000}});
beforeEach(()=>{state.calls=[];state.targets=[];state.failStart=false;vi.useRealTimers()});
describe('bounded recovery wrapper',()=>{
 it('does exactly one finite discovery and lease, clamps target cap',async()=>{state.targets=[target()];const r=await claimRecoveryWork('runtime',{environment:'production',replyLimit:200});expect(r.claimed).toHaveLength(1);expect(state.calls).toHaveLength(2);expect(state.calls[0].args.p_page).toBe(200);expect(state.calls[1].args.p_target_limit).toBe(50)});
 it('rejects oversized exclusions before any request',async()=>{await expect(claimRecoveryWork('stranded',{environment:'test',excludeIds:Array(501).fill('x')})).rejects.toThrow('excludes_exceeded');expect(state.calls).toHaveLength(0)});
 it('starts before action, finishes only after action',async()=>{const observations:string[]=[];await runRecoveryBatch([target()],async()=>{observations.push(String(state.calls.at(-1)?.args.p_operation));return 'completed'},[]);expect(observations).toEqual(['start']);expect(state.calls.map(x=>x.name==='ediel_recovery_record_terminal_v1'?'receipt':x.args.p_operation)).toEqual(['start','receipt','finish'])});
 it('does not run action after ambiguous START',async()=>{state.failStart=true;const action=vi.fn();await runRecoveryBatch([target()],action,[]);expect(action).not.toHaveBeenCalled();expect(state.calls.map(x=>x.args.p_operation)).toEqual(['start','uncertain'])});
 it('deadline releases only work that never started',async()=>{const a=target();a.recovery.deadline=performance.now()-1;await runRecoveryBatch([a],vi.fn(),[]);expect(state.calls.map(x=>x.args.p_operation)).toEqual(['release'])});
 it('timed out callback is marked uncertain and remaining leases released',async()=>{vi.useFakeTimers();const a=target();a.recovery.deadline=performance.now()+6000;const b=target();b.recovery.workId='second';const errors:string[]=[];const action=vi.fn(()=>new Promise<"completed">(()=>{}));const pending=runRecoveryBatch([a,b],action,errors);await vi.advanceTimersByTimeAsync(6500);await pending;expect(action).toHaveBeenCalledTimes(1);expect(state.calls.map(x=>x.args.p_operation)).toEqual(['start','uncertain','release']);expect(errors.join()).toContain('action_deadline')});
 it('does not release a callback that threw before settlement',async()=>{await runRecoveryBatch([target()],async()=>{throw new Error('action failed')},[]);expect(state.calls.map(x=>x.args.p_operation)).toEqual(['start','uncertain'])});
 it('rejects unexpectedly oversized leased target response',async()=>{state.targets=Array.from({length:51},target);await expect(claimRecoveryWork('runtime',{environment:'test'})).rejects.toThrow('response_invalid')});
 it('unknown terminal outcome never emits an owner receipt or finish',async()=>{await runRecoveryBatch([target()],async()=>"ambiguous",[]);expect(state.calls.map(x=>x.args.p_operation)).toEqual(['start','uncertain']);expect(state.calls.some(x=>x.name==='ediel_recovery_record_terminal_v1')).toBe(false)});
 it('late recognized completion records only after uncertainty, without rearming or cancelling',async()=>{vi.useFakeTimers();const a=target();a.recovery.deadline=performance.now()+6000;let resolve!: (outcome:"completed")=>void;const pending=runRecoveryBatch([a],()=>new Promise<"completed">(done=>{resolve=done}),[]);await vi.advanceTimersByTimeAsync(6500);await pending;expect(state.calls.map(x=>x.args.p_operation)).toEqual(['start','uncertain']);resolve("completed");await vi.advanceTimersByTimeAsync(1);expect(state.calls.at(-1)?.name).toBe('ediel_recovery_record_terminal_v1');expect(state.calls.at(-1)?.args.p_expected_state).toBe('uncertain');expect(state.calls.some(x=>x.args.p_operation==='finish')).toBe(false)});

});

describe.sequential('O2 actual held resumer with actual durable SQL owner',()=>{
 it('fresh selection timestamp cannot enter the owner while a first callback is running',async()=>{
  await activate();const id=heldSource();io.issuerQualified.add(id);let entered!:()=>void;const ready=new Promise<void>(done=>entered=done);let release!:()=>void;const barrier=new Promise<void>(done=>release=done);let calls=0;
  io.processImpl=async()=>{calls++;if(calls===1){entered();await barrier}else throw Object.assign(new Error('utilts_transaction_ack_finalization_conflict'),{code:'23505'})};
  const first=run();await ready;io.clock.now=new Date(io.clock.now.getTime()+1000);io.tables.ediel_messages.find(m=>m.id===id)!.updated_at=at(30);
  const second=await run({workerId:'worker-2'});expect(second.claimed).toBe(0);expect(calls).toBe(1);release();await first;
  expect(resumeEvents(id).filter(e=>(e.payload as Row).kind==='attempt').map(e=>(e.payload as Row).attempt)).toEqual([1]);expect((await q('SELECT attempts FROM gridex_ediel_recovery.work'))[0].attempts).toBe(1);
 });
 it('delayed attempt note cannot admit another attempt-one worker at maxAttempts one',async()=>{
  await activate();const id=heldSource();io.issuerQualified.add(id);let entered!:()=>void;const ready=new Promise<void>(done=>entered=done);let release!:()=>void;const barrier=new Promise<void>(done=>release=done);let calls=0;
  io.beforeEvent=async input=>{if(input.payload?.kind==='attempt' && input.payload?.workerId==='worker-1'){entered();await barrier}};io.processImpl=async()=>{calls++};
  const first=run({maxAttempts:1});await ready;const second=await run({workerId:'worker-2',maxAttempts:1});expect(second.claimed).toBe(0);expect(calls).toBe(0);expect((await q('SELECT attempts,state FROM gridex_ediel_recovery.work'))[0]).toMatchObject({attempts:1,state:'running'});release();await first;expect(calls).toBe(1);expect(resumeEvents(id).filter(e=>(e.payload as Row).kind==='attempt').map(e=>(e.payload as Row).attempt)).toEqual([1]);
 });
 it('unknown actual owner failure keeps UNCERTAIN and blocks a later callback',async()=>{
  await activate();const id=heldSource();io.issuerQualified.add(id);io.processImpl=async()=>{throw new Error('statement timeout')};await run();expect((await q('SELECT attempts,state FROM gridex_ediel_recovery.work'))[0]).toMatchObject({attempts:1,state:'uncertain'});expect((await run({workerId:'worker-2'})).claimed).toBe(0);expect(io.processed).toHaveLength(1);
 });
 it('a finished actual retained-original resumption leaves a correlated terminal receipt',async()=>{
  await activate();const id=heldSource();io.issuerQualified.add(id);const first=await run();expect(first.resumed).toBe(1);expect(first.errors).toEqual([]);expect((await q('SELECT state,attempts FROM gridex_ediel_recovery.work'))[0]).toMatchObject({state:'done',attempts:1});expect(await q('SELECT * FROM gridex_ediel_recovery.terminal_receipts')).toHaveLength(1);expect((await run()).claimed).toBe(0);expect(io.processed).toHaveLength(1);
 });
});
