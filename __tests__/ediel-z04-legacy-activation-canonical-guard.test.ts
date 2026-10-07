// Bounded producer regression for AT-Z04L-SUPPLIER / AT-Z04LK-SUPPLIER.
// This is not whole acceptance or a tagged native proof. Real captured endpoint
// bodies execute on selected captured columns; auth/storage/graph IO is finite.
// A synthetic legacy accepted status is an adversarial input, NEVER an immutable
// confirmation, accepted transport receipt, legal profile or market authority.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
const forward = resolve('supabase/migrations/20261007210437_ediel_z04_legacy_activation_canonical_guard.sql')
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const company = id(1), actor = id(2), customer = id(3), request = id(4)
const site = id(5), point = id(6), source = id(7), outsider = id(8)
let db: PGlite

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
]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA gridex_bilateral_prodat; CREATE SCHEMA gridex_received_sources;
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
    await db.exec(capturedFunction(name))
  }
  // On the first RED this file is absent. A later claimed forward is tested on
  // these same actual predecessor bodies; canonical activation is never mocked.
  if (existsSync(forward)) await db.exec(readFileSync(forward, 'utf8'))
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
