// Bounded producer regression for AT-Z04L-SUPPLIER / AT-Z04LK-SUPPLIER.
// This is not whole acceptance or a tagged native proof. Real captured endpoint
// bodies execute on selected captured columns; auth/storage/graph IO is finite.
// Legacy predecessors come from immutable migrations, not a regenerated schema.
// A synthetic legacy accepted status is an adversarial input, NEVER an immutable
// confirmation, accepted transport receipt, legal profile or market authority.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
const forward = resolve('supabase/migrations/20261007210437_ediel_z04_legacy_activation_canonical_guard.sql')
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const company = id(1), actor = id(2), customer = id(3), request = id(4)
const site = id(5), point = id(6), source = id(7), outsider = id(8)
let db: PGlite
let predecessorCatalog: unknown
const signatures = ['public.gridex_finalize_supplier_switch_activation(uuid,uuid,uuid)', 'public.gridex_finalize_supplier_switch_v1(uuid,uuid,uuid,jsonb)']
const legacySources = [
  { name: 'public.gridex_finalize_supplier_switch_activation', path: 'supabase/migrations/20260903090000_atomic_supplier_switch_activation_sweep.sql', fileHash: '8d6d8f8bb7e19e4ecf7b0a4e0ffce68eca923b66c00449bbad13e36a6949462a', oldHash: '2e6ff99f4dc704da085b056378dea9bcbc96a2fa032d2b4ba6581a8e9c423095', newHash: 'a6b5c2a1a881157866c2362a5fa008ca2c2092aa0c7b20dcc09bfd552c5da308' },
  { name: 'public.gridex_finalize_supplier_switch_v1', path: 'supabase/migrations/20261002215000_supplier_switch_atomic_writes.sql', fileHash: '4f0ac7babe95e3b847594a0e0b7feb878831da730dd487a12e5395367936963d', oldHash: 'a69f65d2472c856358e825f711910f1e9aef88d75062eed02b3589bd89c2b139', newHash: '280657250589279b01ef7b114517e532fe13553f90b8ff1c862f72a68ebabf9b' },
]
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

function immutableLegacyFunction(name: string) {
  const origin = legacySources.find(value => value.name === name)
  if (!origin) throw Error('Unreviewed legacy function origin')
  const bytes = readFileSync(resolve(origin.path))
  expect(digest(bytes)).toBe(origin.fileHash)
  const sql = bytes.toString('utf8')
  const starts = [...sql.matchAll(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\(`, 'gi'))]
  if (starts.length !== 1) throw Error('Immutable legacy function must occur once')
  const start = starts[0].index!
  const opening = /\bas\s+(\$[a-zA-Z_0-9]*\$)/i.exec(sql.slice(start))
  if (!opening) throw Error('Immutable legacy dollar-quoted body absent')
  const bodyStart = start + opening.index + opening[0].length
  const end = sql.indexOf(`${opening[1]};`, bodyStart)
  if (end < 0) throw Error('Immutable legacy function terminator absent')
  expect(digest(sql.slice(bodyStart, end))).toBe(origin.oldHash)
  expect(origin.oldHash).not.toBe(origin.newHash)
  return sql.slice(start, end + opening[1].length + 1)
}

async function endpointBodyHashes() {
  return (await db.query<{hash: string}>(`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid IN($1::regprocedure,$2::regprocedure) ORDER BY oid`, signatures)).rows.map(value => value.hash)
}

function capturedFunction(name: string) {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
  if (start < 0) throw Error(`Captured function absent: ${name}`)
  const opening = /\bAS (\$[a-zA-Z_0-9]*\$)/.exec(schema.slice(start))
  if (!opening) throw Error(`Captured function body absent: ${name}`)
  const bodyStart = start + opening.index + opening[0].length
  const end = schema.indexOf(`${opening[1]};`, bodyStart)
  if (end < 0) throw Error(`Captured function terminator absent: ${name}`)
  return schema.slice(start, end + opening[1].length + 1)
}

// Preserve actual selected column types/defaults/NOT NULL. Foreign-key/RLS,
// trigger and external graph enforcement are NOT represented by these tables.
function capturedColumns(table: string, names: string[]) {
  const start = schema.indexOf(`CREATE TABLE ${table} (`)
  const end = schema.indexOf('\n);', start)
  if (start < 0 || end < 0) throw Error(`Captured table absent: ${table}`)
  const lines = schema.slice(start, end).split('\n')
  const columns = names.map(name => {
    const matches = lines.filter(line => line.trimStart().startsWith(`${name} `))
    if (matches.length !== 1) throw Error(`Captured column not unique: ${table}.${name}`)
    return matches[0].trim().replace(/,$/, '')
  })
  return `CREATE TABLE ${table} (${columns.join(',\n')});`
}

const selectedTables: [string, string[]][] = [
  ['public.supplier_switch_requests', ['id','company_id','customer_id','site_id','customer_site_id','metering_point_id','contract_id','customer_contract_id','status','lifecycle_blocked','inbound_z04_message_id','outbound_z03_message_id','requested_start_date','confirmed_start_date','incoming_supplier_name','incoming_supplier_org_number','current_supplier_name','grid_owner_id','price_area_code','completed_at','failure_reason','created_at','updated_at','updated_by']],
  ['public.customer_sites', ['id','company_id','customer_id','status','current_supplier_name','current_supplier_org_number','grid_owner_id','price_area_code','updated_at','updated_by']],
  ['public.metering_points', ['id','company_id','customer_id','site_id','status','grid_owner_id','price_area_code','updated_at','updated_by']],
  ['public.supplier_switch_events', ['id','company_id','switch_request_id','event_type','event_status','message','payload','created_by','created_at']],
  ['public.ediel_messages', ['id','company_id','environment','direction','message_family','message_code','raw_payload','immutable_rendered_at','immutable_payload_hash']],
  ['public.user_profiles', ['id','user_status']],
  ['public.company_memberships', ['company_id','user_id','status','is_active','accepted_at']],
  ['public.customer_supply_periods', ['id','company_id','customer_id','metering_point_id','contract_id','customer_contract_id','start_date','actual_start_date','end_date','status','market_start_at','market_end_at','market_state_version','source_message_id','source_switch_request_id','metadata']],
  ['public.customer_contracts', ['id','company_id','customer_id','metering_point_id','status']],
  ['gridex_received_sources.normal_switch_confirmations', ['source_message_id','period_id','company_id','switch_id','original_message_id','original_payload_hash','contract_id','protected_contract_hash','source_object','legal_context','market_start_at','confirmed_period','confirmed_switch','created_at']],
  ['gridex_received_sources.normal_supply_activations', ['period_id','company_id','source_message_id','actor_user_id','previous_period','resulting_period','result','activated_at']],
  ['gridex_received_sources.supply_source_transitions', ['source_message_id','company_id','payload_hash','qualified_switch_ids']],
  ['public.tenant_ediel_profiles', ['id','company_id','environment','market','is_enabled','valid_from','valid_to']],
  ['public.tenant_actor_roles', ['id','company_id','environment','actor_id','role_code','valid_from','valid_to']],
  ['public.tenant_actor_identifiers', ['id','company_id','environment','actor_id','identifier_type','identifier_value','valid_from','valid_to']],
]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA gridex_bilateral_prodat; CREATE SCHEMA gridex_received_sources;
    CREATE SCHEMA gridex_ediel_inbound_context; CREATE SCHEMA gridex_ediel_source_rules;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '${actor}'::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'authenticated'::text$$;
    CREATE TABLE public.finite_permission_port(actor_id uuid,company_id uuid,permission text,allowed boolean);
    CREATE TABLE public.finite_billing_port(id uuid,company_id uuid,period_id uuid,basis jsonb);
    CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$
      SELECT coalesce((SELECT allowed FROM public.finite_permission_port WHERE actor_id=$1 AND company_id=$2 AND permission=$3),false)$$;
    CREATE FUNCTION public.gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql AS $$
      SELECT public.gridex_actor_has_company_permission(auth.uid(),$1,'metering.write')$$;
    -- Explicit finite graph lock port, not a multi-session/concurrency proof.
    CREATE FUNCTION gridex_bilateral_prodat.lock_supply_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;`)
  for (const [table, columns] of selectedTables) await db.exec(capturedColumns(table, columns))
  for (const name of ['public.gridex_assert_switch_writer_v1','public.activate_customer_supply_v1','public.gridex_finalize_supplier_switch_activation','public.gridex_finalize_supplier_switch_v1','public.gridex_process_ready_supplier_switch_activations']) {
    await db.exec(legacySources.some(value => value.name === name) ? immutableLegacyFunction(name) : capturedFunction(name))
  }
  const actualPredecessorHashes = await endpointBodyHashes()
  expect(actualPredecessorHashes).toEqual(legacySources.map(value => value.oldHash))
  // Positive cases below declare finite external authority/effect inputs, not
  // genuine native confirmations. The TOP canonical function remains actual.
  await db.exec(`
    CREATE TABLE public.finite_activation_port(company_id uuid,request_id uuid,source_id uuid,original_id uuid,period_id uuid,contract_id uuid,qualified boolean,contract_hash text,failure_mode text);
    CREATE TABLE public.finite_activation_calls(kind text,company_id uuid,source_id uuid);
    CREATE FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid) RETURNS boolean LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.finite_activation_calls VALUES('recorded_source',$1,$2);
      RETURN coalesce((SELECT qualified FROM public.finite_activation_port WHERE company_id=$1 AND source_id=$2),false); END$$;
    CREATE FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.finite_activation_calls VALUES('contract_records',$1,$2);
      IF NOT EXISTS(SELECT FROM public.finite_activation_port WHERE company_id=$1 AND contract_id=$2 AND qualified) THEN RAISE EXCEPTION 'finite_contract_port_unavailable';END IF;END$$;
    CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.finite_activation_calls VALUES('source_bytes',$1,$2);
      IF NOT EXISTS(SELECT FROM public.finite_activation_port WHERE company_id=$1 AND $2 IN(source_id,original_id) AND qualified) THEN RAISE EXCEPTION 'finite_source_port_unavailable';END IF;END$$;
    CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.finite_activation_calls VALUES('legal_source',$1,$2);
      IF NOT EXISTS(SELECT FROM public.finite_activation_port WHERE company_id=$1 AND source_id=$2 AND qualified) THEN RAISE EXCEPTION 'finite_legal_port_unavailable';END IF;RETURN '{"declaredFiniteLegalPort":true}'::jsonb;END$$;
    CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.finite_activation_calls VALUES('rule_source',$1,$2);
      IF NOT EXISTS(SELECT FROM public.finite_activation_port WHERE company_id=$1 AND source_id=$2 AND qualified) THEN RAISE EXCEPTION 'finite_rule_port_unavailable';END IF;RETURN '{"declaredFiniteRulePort":true}'::jsonb;END$$;
    CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(public.ediel_messages) RETURNS boolean LANGUAGE sql AS $$
      SELECT EXISTS(SELECT FROM public.finite_activation_port WHERE company_id=($1).company_id AND original_id=($1).id AND qualified)$$;
    CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(public.customer_contracts) RETURNS text LANGUAGE sql AS $$
      SELECT contract_hash FROM public.finite_activation_port WHERE company_id=($1).company_id AND contract_id=($1).id$$;
    CREATE FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)
      RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid)
      LANGUAGE plpgsql AS $$DECLARE port public.finite_activation_port%rowtype; BEGIN
      SELECT * INTO STRICT port FROM public.finite_activation_port WHERE company_id=$1 AND request_id=$2 AND source_id=$3 AND qualified;
      IF $6 IS DISTINCT FROM 'ediel-normal-activation:'||port.period_id THEN RAISE EXCEPTION 'finite_child_wrong_key';END IF;
      INSERT INTO public.finite_activation_calls VALUES('subordinate_effect',$1,$3);
      UPDATE public.customer_supply_periods SET status='active',actual_start_date=$4,market_state_version=market_state_version+1 WHERE id=port.period_id AND company_id=$1;
      UPDATE public.supplier_switch_requests SET status='completed',completed_at=now(),updated_at=now() WHERE id=$2 AND company_id=$1;
      UPDATE public.customer_contracts SET status='active' WHERE id=port.contract_id AND company_id=$1;
      INSERT INTO public.finite_billing_port VALUES('${id(80)}',$1,port.period_id,'{"declaredMechanicalChild":true}');
      IF port.failure_mode='throw_after_write' THEN RAISE EXCEPTION 'finite_child_failure_after_write';END IF;
      RETURN QUERY SELECT $2,CASE WHEN port.failure_mode='replace_period' THEN '${id(99)}'::uuid ELSE port.period_id END,port.contract_id,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid;
    END$$;
    CREATE ROLE finite_activation_reader; GRANT EXECUTE ON FUNCTION ${signatures[0]} TO finite_activation_reader;
  `)
  predecessorCatalog = await catalog()
  // Apply the complete maintained forward to the pinned historical endpoints.
  // Current captured canonical activation and other consumers remain actual.
  expect(existsSync(forward)).toBe(true)
  await db.exec(readFileSync(forward, 'utf8'))
  const actualSuccessorHashes = await endpointBodyHashes()
  expect(actualSuccessorHashes).toEqual(legacySources.map(value => value.newHash))
  console.info('Z04_IMMUTABLE_ENDPOINT_STATES ' + JSON.stringify({ actualPredecessorHashes, actualSuccessorHashes }))
  expect(await catalog()).toEqual(predecessorCatalog)
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('BEGIN')
  await db.query('INSERT INTO public.user_profiles(id,user_status) VALUES($1,\'active\')', [actor])
  await db.query(`INSERT INTO public.company_memberships(company_id,user_id,status,is_active,accepted_at) VALUES($1,$2,'active',true,now())`, [company, actor])
  await db.query(`INSERT INTO public.finite_permission_port VALUES($1,$2,'metering.write',true)`, [actor, company])
  await db.query(`INSERT INTO public.customer_sites(id,company_id,customer_id,status,current_supplier_name) VALUES($1,$2,$3,'draft','Original supplier')`, [site, company, customer])
  await db.query(`INSERT INTO public.metering_points(id,company_id,customer_id,site_id,status) VALUES($1,$2,$3,$4,'draft')`, [point, company, customer, site])
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) VALUES($1,$2,'test','inbound','PRODAT','Z04','finite legacy Z04 identity only')`, [source, company])
  await db.query(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,status,lifecycle_blocked,inbound_z04_message_id,requested_start_date,confirmed_start_date,incoming_supplier_name,incoming_supplier_org_number,current_supplier_name)
    VALUES($1,$2,$3,$4,$5,'accepted',false,$6,(now() AT TIME ZONE 'Europe/Stockholm')::date,(now() AT TIME ZONE 'Europe/Stockholm')::date,'New supplier','finite-org','Original supplier')`, [request, company, customer, site, point, source])
  for (const table of ['public.supplier_switch_requests', 'public.customer_sites', 'public.metering_points', 'public.ediel_messages', 'public.user_profiles', 'public.company_memberships']) {
    expect((await db.query<{count: number}>(`SELECT count(*)::int count FROM ${table}`)).rows).toEqual([{ count: 1 }])
  }
})
afterEach(async () => { await db.exec('ROLLBACK') })

type Outcome = { value?: Record<string, unknown>; error?: Error & { code?: string } }
async function attempt(sql: string, args: unknown[]): Promise<Outcome> {
  await db.exec('SAVEPOINT endpoint_attempt')
  try {
    const result = await db.query<{value: Record<string, unknown>}>(sql, args)
    await db.exec('RELEASE SAVEPOINT endpoint_attempt')
    return { value: result.rows[0]?.value }
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT endpoint_attempt; RELEASE SAVEPOINT endpoint_attempt')
    return { error: error as Error & { code?: string } }
  }
}
const automatic = (c = company, r = request, a: string | null = actor) => attempt('SELECT public.gridex_finalize_supplier_switch_activation($1,$2,$3) value', [c,r,a])
const manual = (c = company, r = request) => attempt(`SELECT public.gridex_finalize_supplier_switch_v1($1,$2,$3,'{"event_type":"execution_completed","message":"finite caller event"}'::jsonb) value`, [c,r,actor])
const canonical = (c = company, r = request, s = source, a: string | null = actor) => attempt('SELECT to_jsonb(x) value FROM public.activate_customer_supply_v1($1,$2,$3,NULL,$4,NULL) x', [c,r,s,a])
const sweep = () => attempt('SELECT public.gridex_process_ready_supplier_switch_activations($1,50) value', [actor])
async function snapshot() {
  const tables = [...selectedTables.map(([name]) => name), 'public.finite_billing_port']
  const state: Record<string, unknown> = {}
  for (const table of tables) state[table] = (await db.query<{row: unknown}>(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(x => x.row)
  return state
}

async function catalog() {
  return (await db.query<{metadata: unknown}>(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN($1::regprocedure,$2::regprocedure) ORDER BY oid`, signatures)).rows.map(x => x.metadata)
}

async function mechanicalConfirmation() {
  // Transparent synthetic positive mechanism only. No claim of public/native
  // birth, real legal/rule/transport authority or whole Z04 acceptance.
  const original = id(9), period = id(20), contract = id(21), legalActor = id(40)
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,immutable_rendered_at,immutable_payload_hash)
    VALUES($1,$2,'test','outbound','PRODAT','Z03','declared finite SENT original',now(),encode(sha256(convert_to('declared finite SENT original','UTF8')),'hex'))`, [original, company])
  await db.query(`INSERT INTO public.customer_contracts(id,company_id,customer_id,metering_point_id,status) VALUES($1,$2,$3,$4,'signed')`, [contract,company,customer,point])
  await db.query(`UPDATE public.supplier_switch_requests SET contract_id=$1,customer_contract_id=$1,customer_site_id=$2,outbound_z03_message_id=$3 WHERE id=$4`, [contract,site,original,request])
  await db.query(`INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,status,market_start_at,market_state_version,source_message_id,source_switch_request_id,metadata)
    VALUES($1,$2,$3,$4,$5,$5,(now() AT TIME ZONE 'Europe/Stockholm')::date,'confirmed_by_grid_owner',now()-interval '1 second',1,$6,$7,'{}')`, [period,company,customer,point,contract,source,request])
  await db.query(`INSERT INTO public.tenant_ediel_profiles(id,company_id,environment,market,is_enabled,valid_from) VALUES($1,$2,'test','electricity',true,now()-interval '1 hour')`, [id(31),company])
  await db.query(`INSERT INTO public.tenant_actor_roles(id,company_id,environment,actor_id,role_code,valid_from) VALUES($1,$2,'test',$3,'electricity_supplier',now()-interval '1 hour')`, [id(32),company,legalActor])
  await db.query(`INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,$2,'test',$3,'EdielId','12345',now()-interval '1 hour')`, [id(33),company,legalActor])
  await db.query(`INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,qualified_switch_ids)
    SELECT id,company_id,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),ARRAY[$1::uuid] FROM public.ediel_messages WHERE id=$2`, [request,source])
  await db.query(`INSERT INTO public.finite_activation_port VALUES($1,$2,$3,$4,$5,$6,true,repeat('c',64),NULL)`, [company,request,source,original,period,contract])
  await db.query(`INSERT INTO gridex_received_sources.normal_switch_confirmations(source_message_id,period_id,company_id,switch_id,original_message_id,original_payload_hash,contract_id,protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch)
    SELECT $1,$2,$3,$4,$5,o.immutable_payload_hash,$6,repeat('c',64),'{"declaredMechanicalObject":true}',jsonb_build_object('legalActorId',$7::text,'legalEdielId','12345'),p.market_start_at,to_jsonb(p),to_jsonb(r)
    FROM public.customer_supply_periods p JOIN public.supplier_switch_requests r ON r.id=$4 JOIN public.ediel_messages o ON o.id=$5 WHERE p.id=$2`, [source,period,company,request,original,contract,legalActor])
  return { period, contract }
}
async function proveMissingCanonicalConfirmation() {
  const before = await snapshot()
  expect(before['gridex_received_sources.normal_switch_confirmations']).toEqual([])
  expect(before['gridex_received_sources.normal_supply_activations']).toEqual([])
  const result = await canonical()
  expect(result.error?.message).toBe('normal_supply_activation_immutable_confirmation_required')
  expect(await snapshot()).toEqual(before)
}

describe('missing immutable canonical confirmation is not legacy activation authority', () => {
  it.each(['automatic', 'manual'] as const)('%s endpoint must refuse before any durable projection', async endpoint => {
    await proveMissingCanonicalConfirmation()
    const before = await snapshot()
    const result = await (endpoint === 'automatic' ? automatic() : manual())
    // First assertion exposes actual old durable writes rather than a missing API.
    expect(await snapshot(), JSON.stringify({ endpoint, result })).toEqual(before)
    expect(result.error?.message).toBe('normal_supply_activation_immutable_confirmation_required')
  })
  it('actual sweep must retain the refused request/site/point/period/billing and report the canonical failure', async () => {
    await proveMissingCanonicalConfirmation()
    const before = await snapshot(), result = await sweep()
    expect(await snapshot(), JSON.stringify(result)).toEqual(before)
    expect(result.value).toMatchObject({ scanned: 1, activated: 0, failed: 1,
      failures: [expect.objectContaining({ message: 'normal_supply_activation_immutable_confirmation_required' })] })
  })
})

describe('automatic early branches retain existing API and zero effects', () => {
  it.each([
    ['not accepted', "UPDATE public.supplier_switch_requests SET status='draft'", 'blocked', 'supplier_switch_not_accepted'],
    ['lifecycle blocked', 'UPDATE public.supplier_switch_requests SET lifecycle_blocked=true', 'blocked', 'supplier_switch_lifecycle_blocked'],
    ['no Z04', 'UPDATE public.supplier_switch_requests SET inbound_z04_message_id=NULL', 'blocked', 'missing_z04_confirmation'],
    ['wrong family', "UPDATE public.ediel_messages SET message_family='UTILTS'", 'blocked', 'invalid_z04_confirmation'],
    ['wrong direction', "UPDATE public.ediel_messages SET direction='outbound'", 'blocked', 'invalid_z04_confirmation'],
    ['wrong code', "UPDATE public.ediel_messages SET message_code='Z02'", 'blocked', 'invalid_z04_confirmation'],
    ['foreign Z04', `UPDATE public.ediel_messages SET company_id='${outsider}'`, 'blocked', 'invalid_z04_confirmation'],
    ['no date', 'UPDATE public.supplier_switch_requests SET confirmed_start_date=NULL,requested_start_date=NULL', 'blocked', 'missing_effective_start_date'],
    ['tomorrow', "UPDATE public.supplier_switch_requests SET confirmed_start_date=(now() AT TIME ZONE 'Europe/Stockholm')::date+1", 'waiting', 'awaiting_effective_start_date'],
    ['closed site', "UPDATE public.customer_sites SET status='closed'", 'blocked', 'supplier_switch_site_closed'],
    ['closed point', "UPDATE public.metering_points SET status='closed'", 'blocked', 'supplier_switch_metering_point_closed'],
  ])('%s', async (_name, mutation, status, reason_code) => {
    await db.exec(mutation)
    const before = await snapshot(), result = await automatic()
    expect(result.error).toBeUndefined()
    expect(result.value).toMatchObject({ status, reason_code })
    expect(await snapshot()).toEqual(before)
  })
  it('wrong-company request is not found and cannot change either graph', async () => {
    const before = await snapshot()
    expect((await automatic(outsider)).value).toMatchObject({ status: 'not_found', reason_code: 'supplier_switch_not_found_in_tenant' })
    expect(await snapshot()).toEqual(before)
  })
  it.each([null, actor])('already-completed ordering is preserved with actor %s', async a => {
    await db.exec("UPDATE public.supplier_switch_requests SET status='completed'")
    const before = await snapshot(), result = await automatic(company, request, a)
    if (a === null) expect(result.error?.message).toBe('supplier_switch_activation_scope_required')
    else expect(result.value).toMatchObject({ status: 'already_completed', request_id: request })
    expect(await snapshot()).toEqual(before)
  })
})

describe('manual and canonical authority controls remain real', () => {
  it('manual still checks the actual writer before request access', async () => {
    await db.exec('UPDATE public.finite_permission_port SET allowed=false')
    const before = await snapshot(), result = await manual()
    expect(result.error).toMatchObject({ message: 'supplier_switch_write_not_allowed', code: '42501' })
    expect(await snapshot()).toEqual(before)
  })
  it('manual wrong-company request preserves P0002 and both graphs', async () => {
    await db.query(`INSERT INTO public.finite_permission_port VALUES($1,$2,'metering.write',true)`, [actor, outsider])
    const before = await snapshot(), result = await manual(outsider)
    expect(result.error).toMatchObject({ message: 'supplier_switch_not_found_for_tenant', code: 'P0002' })
    expect(await snapshot()).toEqual(before)
  })
  it.each(['draft', 'accepted'])('manual preserves accepted/Z04 check for %s input', async status => {
    await db.query('UPDATE public.supplier_switch_requests SET status=$1,inbound_z04_message_id=NULL', [status])
    const before = await snapshot(), result = await manual()
    expect(result.error).toMatchObject({ message: 'supplier_switch_finalize_requires_accepted_z04', code: '23514' })
    expect(await snapshot()).toEqual(before)
  })
  it('manual completed result remains read-only', async () => {
    await db.exec("UPDATE public.supplier_switch_requests SET status='completed'")
    const before = await snapshot(), result = await manual()
    expect(result.value).toMatchObject({ already_completed: true, request: { id: request, status: 'completed' } })
    expect(await snapshot()).toEqual(before)
  })
  it.each(['revoked permission', 'inactive actor', 'inactive membership'] as const)('canonical %s rejects before missing confirmation', async variant => {
    const mutation = variant === 'revoked permission' ? 'UPDATE public.finite_permission_port SET allowed=false' : variant === 'inactive actor' ? "UPDATE public.user_profiles SET user_status='inactive'" : 'UPDATE public.company_memberships SET is_active=false'
    await db.exec(mutation)
    const before = await snapshot(), result = await canonical()
    expect(result.error).toMatchObject({ message: 'normal_supply_activation_actor_forbidden', code: '42501' })
    expect(await snapshot()).toEqual(before)
  })
})

describe('actual canonical delegation with declared finite subordinate inputs', () => {
  it.each(['automatic', 'manual'] as const)('%s adapts one actual canonical same-period effect and retains read-only replay', async endpoint => {
    const { period, contract } = await mechanicalConfirmation()
    const previousPeriod = (await db.query<{row: unknown}>('SELECT to_jsonb(p) row FROM public.customer_supply_periods p')).rows[0].row
    const result = await (endpoint === 'automatic' ? automatic() : manual())
    expect(result.error).toBeUndefined()
    if (endpoint === 'automatic') expect(result.value).toMatchObject({ status: 'activated', request_id: request, company_id: company, metering_point_id: point })
    else expect(result.value).toMatchObject({ already_completed: false, request: { id: request, status: 'completed' }, site_before: { status: 'draft' }, site_after: { status: 'active' }, metering_point_before: { status: 'draft' }, metering_point_after: { status: 'active' } })
    expect((await db.query('SELECT id,status,actual_start_date=start_date same_date,market_state_version FROM public.customer_supply_periods')).rows).toEqual([{ id: period, status: 'active', same_date: true, market_state_version: 2 }])
    const receipts = (await db.query<{period_id: string; previous_period: unknown; result: unknown; resulting_period: unknown}>('SELECT period_id,previous_period,result,resulting_period FROM gridex_received_sources.normal_supply_activations')).rows
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ period_id: period, previous_period: previousPeriod, result: { supplier_switch_request_id: request, supply_period_id: period, contract_id: contract } })
    expect(receipts[0].resulting_period).toEqual((await db.query<{row: unknown}>('SELECT to_jsonb(p) row FROM public.customer_supply_periods p')).rows[0].row)
    expect((await db.query('SELECT kind,company_id,source_id FROM public.finite_activation_calls ORDER BY kind,source_id')).rows).toEqual([
      { kind: 'contract_records', company_id: company, source_id: contract },
      { kind: 'legal_source', company_id: company, source_id: source },
      { kind: 'recorded_source', company_id: company, source_id: source },
      { kind: 'rule_source', company_id: company, source_id: source },
      { kind: 'source_bytes', company_id: company, source_id: source },
      { kind: 'source_bytes', company_id: company, source_id: id(9) },
      { kind: 'subordinate_effect', company_id: company, source_id: source },
    ])
    expect((await db.query('SELECT event_type,event_status,created_by FROM public.supplier_switch_events')).rows).toEqual([{ event_type: 'execution_completed', event_status: 'completed', created_by: actor }])
    expect((await db.query('SELECT current_supplier_name,status FROM public.customer_sites')).rows).toEqual([{ current_supplier_name: 'New supplier', status: 'active' }])
    expect((await db.query('SELECT status FROM public.metering_points')).rows).toEqual([{ status: 'active' }])
    expect((await db.query('SELECT period_id FROM public.finite_billing_port')).rows).toEqual([{ period_id: period }])
    const beforeReplay = await snapshot(), callsBefore = (await db.query('SELECT * FROM public.finite_activation_calls')).rows
    const replay = await (endpoint === 'automatic' ? automatic() : manual())
    expect(replay.error).toBeUndefined()
    expect(replay.value).toMatchObject(endpoint === 'automatic' ? { status: 'already_completed' } : { already_completed: true })
    expect(await snapshot()).toEqual(beforeReplay)
    expect((await db.query('SELECT * FROM public.finite_activation_calls')).rows).toEqual(callsBefore)
  })
  it.each(['automatic', 'manual'] as const)('%s retains current actor refusal even for a declared confirmation', async endpoint => {
    await mechanicalConfirmation()
    await db.exec('UPDATE public.finite_permission_port SET allowed=false')
    const before = await snapshot(), result = await (endpoint === 'automatic' ? automatic() : manual())
    expect(result.error).toMatchObject({ code: '42501', message: endpoint === 'automatic' ? 'normal_supply_activation_actor_forbidden' : 'supplier_switch_write_not_allowed' })
    expect(await snapshot()).toEqual(before)
  })
  it.each([
    ['recorded source revoked', 'UPDATE public.finite_activation_port SET qualified=false', 'bilateral_supply_activation_recorded_profile_required'],
    ['not due', "UPDATE gridex_received_sources.normal_switch_confirmations SET market_start_at=now()+interval '1 second'", 'normal_supply_activation_not_due'],
    ['changed own bytes', "UPDATE public.ediel_messages SET raw_payload='changed source' WHERE direction='inbound'", 'normal_supply_activation_source_changed'],
    ['legal identifier revoked', 'DELETE FROM public.tenant_actor_identifiers', 'normal_supply_activation_current_legal_actor_required'],
    ['changed confirmed period', 'UPDATE public.customer_supply_periods SET market_state_version=2', 'normal_supply_activation_current_confirmation_changed'],
    ['child replaced period', "UPDATE public.finite_activation_port SET failure_mode='replace_period'", 'normal_supply_activation_period_replaced'],
    ['child throws after writes', "UPDATE public.finite_activation_port SET failure_mode='throw_after_write'", 'finite_child_failure_after_write'],
  ])('%s cannot leave any legacy or canonical mutation', async (_name, mutation, message) => {
    await mechanicalConfirmation()
    await db.exec(mutation)
    const before = await snapshot(), result = await automatic()
    expect(result.error?.message).toBe(message)
    expect(await snapshot()).toEqual(before)
  })
  it.each(['automatic', 'manual'] as const)('%s rolls back actual canonical effects when legacy event storage fails', async endpoint => {
    await mechanicalConfirmation()
    await db.exec(`CREATE FUNCTION public.finite_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'finite_legacy_event_storage_failure';END$$;
      CREATE TRIGGER finite_event_failure BEFORE INSERT ON public.supplier_switch_events FOR EACH ROW EXECUTE FUNCTION public.finite_event_failure();`)
    const before = await snapshot(), result = await (endpoint === 'automatic' ? automatic() : manual())
    expect(result.error?.message).toBe('finite_legacy_event_storage_failure')
    expect(await snapshot()).toEqual(before)
    expect((await db.query('SELECT * FROM public.finite_activation_calls')).rows).toEqual([])
  })
  it('an altered activation receipt cannot pass the legacy compatibility adapter', async () => {
    await mechanicalConfirmation()
    await db.exec(`CREATE FUNCTION public.finite_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.resulting_period='{}'::jsonb;RETURN NEW;END$$;
      CREATE TRIGGER finite_receipt_fault BEFORE INSERT ON gridex_received_sources.normal_supply_activations FOR EACH ROW EXECUTE FUNCTION public.finite_receipt_fault();`)
    const before = await snapshot(), result = await automatic()
    expect(result.error?.message).toBe('supplier_switch_activation_canonical_receipt_required')
    expect(await snapshot()).toEqual(before)
  })
})

describe('guarded two-endpoint forward lifecycle', () => {
  async function bodies() {
    return (await db.query<{signature: string; prosrc: string}>(`SELECT oid::regprocedure::text signature,prosrc FROM pg_proc WHERE oid IN($1::regprocedure,$2::regprocedure) ORDER BY oid`, signatures)).rows
  }
  async function forwardInSavepoint(): Promise<Outcome> {
    // The whole file is applied above. For replay/refusal inside the test's
    // outer transaction, omit ONLY its BEGIN/COMMIT envelope, retaining the DO.
    const sql = readFileSync(forward, 'utf8').replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\n$/, '')
    await db.exec('SAVEPOINT forward_attempt')
    try { await db.exec(sql); await db.exec('RELEASE SAVEPOINT forward_attempt'); return {} }
    catch (error) { await db.exec('ROLLBACK TO SAVEPOINT forward_attempt; RELEASE SAVEPOINT forward_attempt'); return { error: error as Error } }
  }
  it('recognized successor replay preserves full catalog/OID/owner/ACL/config and both complete bodies', async () => {
    const before = await bodies(), metadata = await catalog(), canonicalDefinition = (await db.query<{definition: string}>(`SELECT pg_get_functiondef('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure) definition`)).rows[0].definition
    expect((await forwardInSavepoint()).error).toBeUndefined()
    expect(await bodies()).toEqual(before)
    expect(await catalog()).toEqual(metadata)
    expect(metadata).toEqual(predecessorCatalog)
    expect((await db.query<{definition: string}>(`SELECT pg_get_functiondef('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure) definition`)).rows[0].definition).toBe(canonicalDefinition)
  })
  it('recognized predecessor/successor mixture installs only the predecessor without changing metadata', async () => {
    const expected = await bodies(), metadata = await catalog()
    await db.exec(immutableLegacyFunction('public.gridex_finalize_supplier_switch_activation'))
    expect(await endpointBodyHashes()).toEqual([legacySources[0].oldHash, legacySources[1].newHash])
    expect((await forwardInSavepoint()).error).toBeUndefined()
    expect(await bodies()).toEqual(expected)
    expect(await catalog()).toEqual(metadata)
  })
  it('unknown second body prevents replacement of the recognized first predecessor', async () => {
    for (const origin of legacySources) await db.exec(immutableLegacyFunction(origin.name))
    expect(await endpointBodyHashes()).toEqual(legacySources.map(value => value.oldHash))
    const current = (await db.query<{definition: string}>(`SELECT pg_get_functiondef($1::regprocedure) definition`, [signatures[1]])).rows[0].definition
    const needle = 'supplier_switch_finalize_requires_accepted_z04'
    expect(current.split(needle)).toHaveLength(2)
    const unknown = current.replace(needle, 'finite_unknown_predecessor')
    expect(unknown).not.toBe(current)
    await db.exec(unknown)
    const unknownHashes = await endpointBodyHashes()
    expect(unknownHashes[0]).toBe(legacySources[0].oldHash)
    expect(unknownHashes[1]).not.toBe(legacySources[1].oldHash)
    expect(unknownHashes[1]).not.toBe(legacySources[1].newHash)
    const before = await bodies(), metadata = await catalog()
    expect((await forwardInSavepoint()).error?.message).toBe('z04_legacy_activation_predecessor_unrecognized')
    expect(await bodies()).toEqual(before)
    expect(await catalog()).toEqual(metadata)
  })
})
