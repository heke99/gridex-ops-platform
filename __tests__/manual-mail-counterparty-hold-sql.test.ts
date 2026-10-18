import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

type Row = Record<string, unknown>
const CO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CUSTOMER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', REQUEST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const INBOUND = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', SUPPLIER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const ACTOR = '11111111-1111-4111-8111-111111111111', CONTACT = '22222222-2222-4222-8222-222222222222'
const CIR = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444'
const POSITIVE = '55555555-5555-4555-8555-555555555555'
const HASH = 'a'.repeat(64)
let db: PGlite
const io = vi.hoisted(() => ({ rpc: vi.fn(), event: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: io.rpc,
  // Every fixture has a completed/cancelled GOIR: the legacy open-only update
  // correctly matches no rows. New completed holds execute the actual SQL RPC.
  from: () => { const q = { update: () => q, select: () => q, eq: () => q, in: () => q,
    maybeSingle: async () => ({ data: null, error: null }) }; return q },
} }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: io.event }))
import { recordManualCounterpartyReply } from '@/lib/inbound-mail/manualCounterpartyReply'
import { assessManualReply } from '@/lib/inbound-mail/manualReplyAssessment'
import { evaluateManualSupplierReadiness } from '@/lib/customer-operations/manualSupplierReadiness'

const assessment = assessManualReply('Vi nekar er fullmakt. Återkom med korrekt fullmakt.')!
const snapshot = { version: 1, companyId: CO, customerId: CUSTOMER, siteId: SITE, requestId: REQUEST,
  inboundId: POSITIVE, sourceHash: 'b'.repeat(64), terms: { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01' } }
const positiveApplication = { ...snapshot, applied: true, complete: true, inbound_id: POSITIVE }
const proof = { sender_credible: true, sender_verification: { version: 1, status: 'verified', method: 'dkim', raw_sha256: HASH,
  from_email: 'specialist@supplier.example', signing_domain: 'supplier.example', signed_headers: ['from', 'content-type', 'content-transfer-encoding', 'mime-version'] },
  reply_assessment: assessment, manual_reply_structure_requires_review: false, mime_requires_review: false,
  customer_identity_review_reasons: [],
  ai_read_only: { status: 'completed', paid_attempt: 'preserved' }, manual_automation: { version: 1, sourceHash: HASH } }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.grid_owner_information_requests(id uuid primary key,company_id uuid,customer_id uuid,customer_site_id uuid,request_type text,status text,metadata jsonb,parsed_payload jsonb,received_payload jsonb,received_at timestamptz,completed_at timestamptz,next_follow_up_at timestamptz,last_error_code text,last_error_message text,updated_at timestamptz,grid_owner_id uuid,recipient_email text,poa_id uuid);
    create table public.manual_inbound_messages(id uuid primary key,company_id uuid,request_id uuid,customer_id uuid,customer_site_id uuid,resolution_status text,extracted_payload jsonb,received_at timestamptz,processing_state text,from_email text);
    create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,current_supplier_id uuid,current_supplier_response_status text,metadata jsonb,updated_at timestamptz);
    create table public.customer_info_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,target_party_type text,status text,verified_payload jsonb,blocker_code text,blocker_reason text,blocker_details jsonb,next_required_action text,updated_at timestamptz);
    create table public.electricity_suppliers(id uuid primary key,company_id uuid,platform_market_actor_id uuid,is_active boolean);
    create table public.platform_market_actors(id uuid primary key,status text,match_status text);
    create table public.platform_actor_roles(actor_id uuid,actor_role text,is_active boolean);
    create table public.platform_actor_contacts(id uuid primary key,actor_id uuid,email text,is_verified boolean,verified_at timestamptz,channel text,contact_type text,valid_from date,valid_to date);
    create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,status text,request_type text,prodat_variant text,prodat_reason text,submitted_at timestamptz,completed_at timestamptz,outbound_z03_message_id uuid,lifecycle_blocked boolean,lifecycle_block_source text,pause_reason text,paused_at timestamptz,metadata jsonb,updated_at timestamptz);
    create table public.customer_operation_events(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,customer_site_id uuid,event_code text,title text,message text,status text,severity text,action_required boolean,source text,payload jsonb,idempotency_key text);
    create unique index event_idempotency on public.customer_operation_events(company_id,idempotency_key) where idempotency_key is not null;
    create table public.ediel_messages(id uuid primary key,status text,raw_payload text);
    create table public.powers_of_attorney(id uuid primary key,status text,valid_to date);
    grant all on all tables in schema public to service_role;
  `)
  // Isolate the actual command from unrelated migration dependencies. The full
  // migration is also exercised by manual-mail-atomic-application.test.ts.
  const sql = fs.readFileSync(process.env.GRIDEX_COUNTERPARTY_HOLD_SQL_PATH ?? 'supabase/migrations/20261018183448_manual_mail_automatic_application.sql', 'utf8')
  const start = sql.indexOf('create or replace function public.gridex_hold_manual_counterparty_reply_v1(')
  if (start >= 0) {
    const grant = sql.indexOf('grant execute on function public.gridex_hold_manual_counterparty_reply_v1', start)
    await db.exec(sql.slice(start, sql.indexOf(';', grant) + 1))
  }
})
afterAll(async () => { await db.close() })

beforeEach(async () => {
  vi.clearAllMocks()
  await db.exec('truncate grid_owner_information_requests,manual_inbound_messages,customer_sites,customer_info_requests,electricity_suppliers,platform_market_actors,platform_actor_roles,platform_actor_contacts,supplier_switch_requests,customer_operation_events,ediel_messages,powers_of_attorney')
  await db.query(`insert into customer_sites values($1,$2,$3,$4,'free_to_switch',$5,null)`, [SITE, CO, CUSTOMER, SUPPLIER, JSON.stringify({ manual_supplier_terms: snapshot })])
  await db.query(`insert into grid_owner_information_requests(id,company_id,customer_id,customer_site_id,request_type,status,metadata,parsed_payload,received_payload,received_at,completed_at,recipient_email,poa_id)
    values($1,$2,$3,$4,'current_supplier_contract_information_request','completed',$5,$6,'{}','2026-10-01T10:00:00Z','2026-10-10T10:00:00Z','avtal@supplier.example',$7)`,
  [REQUEST, CO, CUSTOMER, SITE, JSON.stringify({ target_party: 'current_supplier', supplier_id: SUPPLIER, supplier_actor_id: ACTOR, supplier_contact_id: CONTACT, customer_info_request_id: CIR }), JSON.stringify(positiveApplication), OTHER])
  await db.query(`insert into manual_inbound_messages values($1,$2,$3,$4,$5,'matched',$6,'2026-10-02T10:00:00Z','matched','specialist@supplier.example')`, [INBOUND, CO, REQUEST, CUSTOMER, SITE, JSON.stringify(proof)])
  await db.query(`insert into manual_inbound_messages values($1,$2,$3,$4,$5,'matched',$6,'2026-10-01T10:00:00Z','applied','specialist@supplier.example')`,
    [POSITIVE, CO, REQUEST, CUSTOMER, SITE, JSON.stringify({ ...proof,
      manual_automation: { version: 1, sourceHash: positiveApplication.sourceHash, application: positiveApplication } })])
  await db.query(`insert into customer_info_requests(id,company_id,customer_id,site_id,target_party_type,status,verified_payload) values($1,$2,$3,$4,'current_supplier','ready_for_switch',$5)`, [CIR, CO, CUSTOMER, SITE,
    JSON.stringify({ manual_supplier_request_id: REQUEST, supplier_id: SUPPLIER, supplier_actor_id: ACTOR, supplier_contact_id: CONTACT })])
  await db.exec(`insert into electricity_suppliers values('${SUPPLIER}',null,'${ACTOR}',true);
    insert into platform_market_actors values('${ACTOR}','active','verified');
    insert into platform_actor_roles values('${ACTOR}','electricity_supplier',true);
    insert into platform_actor_contacts values('${CONTACT}','${ACTOR}','avtal@supplier.example',true,now(),'email','poa',null,null);
    insert into supplier_switch_requests values('${REQUEST}','${CO}','${CUSTOMER}','${SITE}','${SITE}','queued','switch','L','Z22',null,null,null,false,null,null,null,'{}',null),
      ('${OTHER}','${CO}','${CUSTOMER}','${SITE}','${SITE}','submitted','switch','L','Z22',now(),null,'${ACTOR}',false,null,null,null,'{}',null),
      ('${CONTACT}','${CO}','${CUSTOMER}','${SITE}','${SITE}','queued','switch','C','Z24',null,null,null,false,null,null,null,'{}',null);
    insert into ediel_messages values('${ACTOR}','sent','SYNTHETIC immutable original');
    insert into powers_of_attorney values('${OTHER}','revoked','2025-01-01');`)
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'gridex_manual_supplier_start_floor_v1') return { data: '2027-04-01', error: null }
    if (name === 'gridex_manual_supplier_terms_verified_v1') return { data: (await read('grid_owner_information_requests', REQUEST)).status === 'completed', error: null }
    if (name !== 'gridex_hold_manual_counterparty_reply_v1') throw new Error(`Undeclared SQL RPC: ${name}`)
    try {
      const data = await db.transaction(async tx => {
        await tx.exec('set local role service_role')
        return (await tx.query<{ result: Row }>('select public.gridex_hold_manual_counterparty_reply_v1($1,$2,$3,$4::jsonb) result',
          [args.p_company_id, args.p_request_id, args.p_inbound_id, JSON.stringify(args.p_assessment)])).rows[0].result
      })
      return { data, error: null }
    } catch (error) { return { data: null, error } }
  })
})

async function read(table: string, id?: string): Promise<Row> {
  return (await db.query<Row>(`select * from public.${table}${id ? ' where id=$1' : ''} order by id limit 1`, id ? [id] : [])).rows[0]
}
async function readiness() {
  return evaluateManualSupplierReadiness({ companyId: CO, customerId: CUSTOMER, siteId: SITE, site: await read('customer_sites') as CustomerSiteRow,
    requestType: 'switch', requestedStartDate: '2027-04-01' })
}
async function reject(patch: Row = {}) {
  await recordManualCounterpartyReply({ companyId: CO, request: { ...await read('grid_owner_information_requests', REQUEST), ...patch }, inboundId: INBOUND, assessment })
}

describe('new counterparty denial after completed commercial facts', () => {
  it.each([
    null, {}, { ok: true, held: false }, { ok: false, held: true }, { ok: 'false', held: false },
    { ok: true, held: true, customerId: OTHER, customerSiteId: SITE },
    { ok: true, held: true, customerId: CUSTOMER },
  ])('throws on malformed or contradictory hold RPC data: %j', async (data) => {
    io.rpc.mockResolvedValueOnce({ data, error: null })
    await expect(reject()).rejects.toThrow(/manual_counterparty_hold_(?:invalid_result|scope_mismatch)/)
    expect(await read('customer_sites')).toMatchObject({ current_supplier_response_status: 'free_to_switch' })
    expect(io.event).not.toHaveBeenCalled()
  })

  it('accepts an explicit canonical non-hold result without side effects', async () => {
    io.rpc.mockResolvedValueOnce({ data: { ok: false, held: false }, error: null })
    await expect(reject()).resolves.toBeUndefined()
    expect(await read('customer_sites')).toMatchObject({ current_supplier_response_status: 'free_to_switch' })
    expect(io.event).not.toHaveBeenCalled()
  })

  it('blocks a newer verified rejection in the actual SQL command and canonical dispatch guard', async () => {
    expect((await readiness()).ready).toBe(true)
    const original = await read('ediel_messages')
    const sentSwitch = await read('supplier_switch_requests', OTHER)
    const cancelSwitch = await read('supplier_switch_requests', CONTACT)
    const priorFacts = (await read('grid_owner_information_requests')).parsed_payload
    await reject()
    expect((await readiness()).ready).toBe(false)
    expect((await readiness()).blockers).toContainEqual(expect.objectContaining({ code: 'current_supplier_manual_review' }))
    expect(await read('grid_owner_information_requests')).toMatchObject({ status: 'completed', parsed_payload: priorFacts,
      metadata: { counterparty_reply: { requires_review: true, inbound_id: INBOUND } } })
    expect(await read('supplier_switch_requests', REQUEST)).toMatchObject({ lifecycle_blocked: true, status: 'manual_followup_required' })
    expect(await read('supplier_switch_requests', OTHER)).toEqual(sentSwitch)
    expect(await read('supplier_switch_requests', CONTACT)).toEqual(cancelSwitch)
    expect(await read('ediel_messages')).toEqual(original)
    expect((await read('manual_inbound_messages', INBOUND)).extracted_payload).toMatchObject({ ai_read_only: { paid_attempt: 'preserved' } })
  })

  it('closes the race when the caller saw an open request before its positive completion committed', async () => {
    await reject({ status: 'waiting_manual_response' })
    expect((await readiness()).ready).toBe(false)
  })

  it('records the hold once despite a repeated callback', async () => {
    await reject(); await reject({ status: 'completed' })
    expect((await db.query('select * from customer_operation_events')).rows).toHaveLength(1)
    expect((await readiness()).ready).toBe(false)
  })

  it.each([
    [11, 13, 14], [11, 14, 13], [13, 11, 14],
    [13, 14, 11], [14, 11, 13], [14, 13, 11],
  ])('keeps the newest authenticated hold source when open replies arrive in order %j', async (...days) => {
    await db.exec(`update grid_owner_information_requests set status='waiting_manual_response',received_at=null,parsed_payload='{}';
      update customer_sites set current_supplier_response_status='waiting_response'`)
    const ids: Record<number, string> = { 11: CONTACT, 13: OTHER, 14: INBOUND }
    for (const day of [11, 13, 14]) {
      const source = { ...proof, manual_automation: { version: 1, sourceHash: String(day).repeat(32) } }
      if (day === 14) await db.query('update manual_inbound_messages set received_at=$1,extracted_payload=$2 where id=$3',
        [`2026-10-${day}T10:00:00Z`, JSON.stringify(source), ids[day]])
      else await db.query(`insert into manual_inbound_messages values($1,$2,$3,$4,$5,'matched',$6,$7,'matched','specialist@supplier.example')`,
        [ids[day], CO, REQUEST, CUSTOMER, SITE, JSON.stringify(source), `2026-10-${day}T10:00:00Z`])
    }
    for (const day of days) await recordManualCounterpartyReply({ companyId: CO, request: await read('grid_owner_information_requests'),
      inboundId: ids[day], assessment })
    expect(await read('grid_owner_information_requests')).toMatchObject({ status: 'needs_review',
      metadata: { counterparty_reply: { requires_review: true, inbound_id: INBOUND, sourceHash: '14'.repeat(32) } } })
    expect((await read('grid_owner_information_requests')).received_at).toEqual(new Date('2026-10-14T10:00:00Z'))
    expect(await read('customer_info_requests')).toMatchObject({ status: 'manual_review_required',
      verified_payload: { counterparty_reply: { inbound_id: INBOUND } } })
    expect((await readiness()).ready).toBe(false)
  })

  it('retains the first held source when another authenticated denial has the same receipt time', async () => {
    await reject()
    await db.query(`insert into manual_inbound_messages values($1,$2,$3,$4,$5,'matched',$6,'2026-10-02T10:00:00Z','matched','specialist@supplier.example')`,
      [CONTACT, CO, REQUEST, CUSTOMER, SITE, JSON.stringify(proof)])
    await recordManualCounterpartyReply({ companyId: CO, request: await read('grid_owner_information_requests'), inboundId: CONTACT, assessment })
    expect((await read('grid_owner_information_requests')).metadata).toMatchObject({ counterparty_reply: { inbound_id: INBOUND } })
    expect((await db.query('select * from customer_operation_events')).rows).toHaveLength(1)
  })

  it('does not create an open commercial hold when its source has no durable receipt time', async () => {
    await db.exec(`update grid_owner_information_requests set status='waiting_manual_response',received_at=null;
      update manual_inbound_messages set received_at=null`)
    const before = await read('grid_owner_information_requests')
    await reject()
    expect(await read('grid_owner_information_requests')).toEqual(before)
    expect(await read('customer_sites')).toMatchObject({ current_supplier_response_status: 'free_to_switch' })
  })

  it.each([
    `update manual_inbound_messages set received_at='2026-09-30T10:00:00Z'`,
    `update manual_inbound_messages set received_at='2026-10-01T10:00:00Z'`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_credible}','false')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,status}','"unverified"')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation,sourceHash}','"bad"')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_reply_structure_requires_review}','true')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{mime_requires_review}','true')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','["other_customer"]')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','"malformed"')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{customer_identity_review_reasons}','{}')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{sender_verification,from_email}','"other@supplier.example"')`,
    `update manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{reply_assessment,message}','"different source"')`,
    `update manual_inbound_messages set customer_id='${OTHER}'`,
    `update customer_sites set current_supplier_id='${OTHER}'`,
    `update platform_actor_contacts set is_verified=false`,
    `update platform_actor_contacts set email='changed@supplier.example'`,
    `update grid_owner_information_requests set status='cancelled'`,
  ])('does not let an older, untrusted or stale-counterparty source pause the customer: %s', async (mutation) => {
    await db.exec(mutation.startsWith('update manual_inbound_messages ') ? `${mutation} where id='${INBOUND}'` : mutation)
    const site = await read('customer_sites'), request = await read('grid_owner_information_requests')
    const before = await read('supplier_switch_requests', REQUEST)
    await reject()
    expect(await read('customer_sites')).toEqual(site)
    expect(await read('grid_owner_information_requests')).toEqual(request)
    expect(await read('supplier_switch_requests', REQUEST)).toEqual(before)
    expect((await db.query('select * from customer_operation_events')).rows).toHaveLength(0)
  })

  it('can stop a process even when the rejected POA is already expired or revoked', async () => {
    expect(await read('powers_of_attorney')).toMatchObject({ status: 'revoked' })
    await reject()
    expect((await readiness()).ready).toBe(false)
  })

  it('keeps a stronger pre-existing site hold intact', async () => {
    await db.exec(`update customer_sites set current_supplier_response_status='blocked'`)
    await reject()
    expect(await read('customer_sites')).toMatchObject({ current_supplier_response_status: 'blocked' })
  })

  it('does not let an older denial to an earlier conversation overwrite a newer applied positive reply', async () => {
    const positive = { ...snapshot, requestId: OTHER, inboundId: CONTACT, applied: true, complete: true, inbound_id: CONTACT, sourceHash: HASH }
    await db.query(`insert into grid_owner_information_requests(id,company_id,customer_id,customer_site_id,request_type,status,metadata,parsed_payload,received_at)
      values($1,$2,$3,$4,'current_supplier_contract_information_request','completed',$5,$6,'2026-10-03T10:00:00Z')`,
    [OTHER, CO, CUSTOMER, SITE, JSON.stringify({ supplier_id: SUPPLIER }), JSON.stringify(positive)])
    await db.query(`insert into manual_inbound_messages values($1,$2,$3,$4,$5,'matched',$6,'2026-10-03T10:00:00Z','applied','specialist@supplier.example')`,
    [CONTACT, CO, OTHER, CUSTOMER, SITE, JSON.stringify({ ...proof, manual_automation: { sourceHash: HASH, application: positive } })])
    await reject()
    expect(await read('customer_sites')).toMatchObject({ current_supplier_response_status: 'free_to_switch' })
    expect((await db.query('select * from customer_operation_events')).rows).toHaveLength(0)
  })

  it('rolls back every hold projection when its atomic audit fails', async () => {
    const tables = ['customer_sites', 'grid_owner_information_requests', 'supplier_switch_requests', 'manual_inbound_messages', 'customer_info_requests']
    const before = await Promise.all(tables.map((table) => db.query(`select * from ${table} order by id`)))
    await db.exec(`create function reject_hold_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$;
      create trigger reject_hold_audit before insert on customer_operation_events for each row execute function reject_hold_audit();`)
    try {
      await expect(reject()).rejects.toThrow('synthetic audit failure')
      expect(await Promise.all(tables.map((table) => db.query(`select * from ${table} order by id`)))).toEqual(before)
    } finally { await db.exec('drop trigger reject_hold_audit on customer_operation_events; drop function reject_hold_audit()') }
  })

  it.each(['anon', 'authenticated'])('does not expose the hold command to %s', async (role) => {
    await expect(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`)
      await tx.query('select public.gridex_hold_manual_counterparty_reply_v1($1,$2,$3,$4::jsonb)', [CO, REQUEST, INBOUND, JSON.stringify(assessment)])
    })).rejects.toMatchObject({ code: '42501' })
  })
})
