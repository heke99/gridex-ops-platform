import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Only the Next.js bundler marker is stubbed. The graph, service adapter,
// PostgREST queries and database command/authority paths are all real.
vi.mock('server-only', () => ({}))
import { createEdielPortalTestCustomerGraph } from '@/lib/ediel/portalTestCustomer'
import { supabaseService } from '@/lib/supabase/service'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
      JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('ediel_portal_graph_disposable_ci_only')
  }
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
function denied(command: string, code: string) {
  let observed = ''
  try { raw(command) } catch (error) { observed = String((error as { stderr?: string | Buffer }).stderr ?? '') }
  expect(observed).toContain(code)
}
const companyA = randomUUID(), companyB = randomUUID()
const permissions = ['masterdata.write', 'switching.write', 'communication.write']
type Actor = { userId: string; sessionId: string }
let actor: Actor
function makeActor(): Actor {
  const userId = randomUUID(), sessionId = randomUUID()
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES(${quote(userId)},'authenticated','authenticated',${quote(`${userId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
    VALUES(${quote(userId)},${quote(`${userId}@example.invalid`)},'Synthetic Ediel graph actor','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
    VALUES(${quote(sessionId)},${quote(userId)},now(),now(),clock_timestamp()+interval '1 hour');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
    VALUES(${quote(companyA)},${quote(userId)},'support','active',now(),'support',true,now(),'support'),
      (${quote(companyB)},${quote(userId)},'viewer','active',now(),'viewer',true,now(),'viewer');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${quote(userId)},${quote(companyA)},id,key FROM public.permissions
      WHERE key IN ('masterdata.write','switching.write','communication.write'); SELECT to_jsonb(true);`)
  return { userId, sessionId }
}
function input(companyId = companyA, user = actor) {
  return { companyId, actorUserId: user.userId, actorSessionId: user.sessionId,
    testSuite: 'PRODAT' as const, roleCode: 'supplier' as const, testCaseCode: '1.1.1',
    agreementStartDateTime: '202610010000', powerOfAttorneyReference: 'synthetic-ediel-graph-reference',
    customerPersonalNumber: '199001010000', customerName: 'Synthetic native Ediel customer',
    customerEmail: 'ediel-native@example.invalid', customerAddress: 'Registered test street 1',
    customerPostalCode: '12345', customerCity: 'Stockholm', customerCountry: 'SE',
    billingRecipientAddress: 'Billing test street 2', billingRecipientPostalCode: '54321',
    billingRecipientCity: 'Lund', billingRecipientCountry: 'SE', facilityId: '735999999999999999',
    gridAreaId: 'SYN', siteAddress: 'Facility test street 3', sitePostalCode: '12345', siteCity: 'Stockholm', siteCountry: 'SE' }
}
function snapshot(companyId: string) {
  return sql<Record<string, unknown>>(`SELECT jsonb_build_object(
    'customers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customers t WHERE company_id=${quote(companyId)}),
    'addresses',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_addresses t WHERE company_id=${quote(companyId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_sites t WHERE company_id=${quote(companyId)}),
    'meters',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.metering_points t WHERE company_id=${quote(companyId)}),
    'owners',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.grid_owners t WHERE company_id=${quote(companyId)}),
    'routes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.communication_routes t WHERE company_id=${quote(companyId)}),
    'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ediel_route_profiles t WHERE company_id=${quote(companyId)}),
    'switches',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.supplier_switch_requests t WHERE company_id=${quote(companyId)}),
    'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_contacts t WHERE company_id=${quote(companyId)}),
    'poas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.powers_of_attorney t WHERE company_id=${quote(companyId)}),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.canonical_command_results t WHERE company_id=${quote(companyId)}),
    'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${quote(companyId)}));`)
}
function preflight(companyId = companyA, user = actor) {
  return sql<boolean>(`SET ROLE service_role; SELECT to_jsonb(public.gridex_ediel_portal_test_graph_access_v1(
    ${quote(companyId)},${quote(user.userId)},${quote(user.sessionId)}));`)
}
function connection(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve(code ?? -1))
  })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe.sequential('native Ediel portal selected-company/current-session address integration', () => {
  beforeAll(() => {
    sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(companyA)},'Synthetic Ediel graph A','active'),
      (${quote(companyB)},'Synthetic Ediel graph B','active');
      INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic masterdata write'),
      ('switching.write','Synthetic switching write'),('communication.write','Synthetic communication write')
      ON CONFLICT(key) DO NOTHING; SELECT to_jsonb(true);`)
    actor = makeActor()
  })

  it('persists two command-owned book rows, preserves facility behavior and reuses the same addresses', async () => {
    expect(preflight()).toBe(true)
    const result = await createEdielPortalTestCustomerGraph(supabaseService, input())
    const after = snapshot(companyA)
    const addresses = after.addresses as Array<Record<string, unknown>>
    expect(addresses.filter(row => row.type !== 'facility').map(row => [row.type, row.street_1, row.city]).sort()).toEqual([
      ['billing', 'Billing test street 2', 'Lund'], ['registered', 'Registered test street 1', 'Stockholm'],
    ])
    expect((after.customers as Array<Record<string, unknown>>)[0]).toMatchObject({ id: result.customerId, address_book_revision: 2 })
    expect((after.sites as Array<Record<string, unknown>>)[0]).toMatchObject({ id: result.siteId, street: 'Facility test street 3' })
    expect((after.results as Array<Record<string, unknown>>).filter(row => row.command_type === 'customer.address.book.change.v1')).toHaveLength(2)
    expect(after.messages).toBe(0)
    const repeated = await createEdielPortalTestCustomerGraph(supabaseService, input())
    expect(repeated.customerId).toBe(result.customerId)
    const repeatedState = snapshot(companyA)
    expect(repeatedState.addresses).toEqual(after.addresses)
    expect((repeatedState.customers as Array<Record<string, unknown>>)[0].address_book_revision).toBe(2)
    expect(repeatedState.results).toEqual(after.results)
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_GRAPH_PASS registered_billing=true facility_preserved=true current_session=true revision=true reuse=true market_messages=0')
  })

  it('denies an A-writer/B-reader target before any graph DML', async () => {
    const before = snapshot(companyB)
    expect(preflight(companyB)).toBe(false)
    await expect(createEdielPortalTestCustomerGraph(supabaseService, input(companyB))).rejects.toThrow('ediel_portal_test_graph_forbidden')
    expect(snapshot(companyB)).toEqual(before)
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_TARGET_PASS other_tenant_permissions_denied=true zero_graph_dml=true')
  })

  it('denies revoked and expired sessions before any graph DML', async () => {
    for (const change of ['revoked', 'expired']) {
      const user = makeActor()
      sql(change === 'revoked' ? `DELETE FROM auth.sessions WHERE id=${quote(user.sessionId)}; SELECT to_jsonb(true);`
        : `UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(user.sessionId)}; SELECT to_jsonb(true);`)
      const before = snapshot(companyA)
      expect(preflight(companyA, user)).toBe(false)
      await expect(createEdielPortalTestCustomerGraph(supabaseService, input(companyA, user))).rejects.toThrow('ediel_portal_test_graph_forbidden')
      expect(snapshot(companyA)).toEqual(before)
    }
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_SESSION_PASS revoked=true expired=true zero_graph_dml=true')
  })

  it('requires each target-company permission and active membership', async () => {
    for (const permission of permissions) {
      const user = makeActor()
      sql(`DELETE FROM public.user_permissions WHERE user_id=${quote(user.userId)} AND company_id=${quote(companyA)}
        AND permission_key=${quote(permission)}; SELECT to_jsonb(true);`)
      const before = snapshot(companyA)
      expect(preflight(companyA, user)).toBe(false)
      await expect(createEdielPortalTestCustomerGraph(supabaseService, input(companyA, user))).rejects.toThrow('ediel_portal_test_graph_forbidden')
      expect(snapshot(companyA)).toEqual(before)
    }
    const user = makeActor()
    sql(`UPDATE public.company_memberships SET is_active=false
      WHERE user_id=${quote(user.userId)} AND company_id=${quote(companyA)}; SELECT to_jsonb(true);`)
    expect(preflight(companyA, user)).toBe(false)
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_AUTHORITY_PASS all3=true membership=true')
  })

  it('rechecks session expiry after a real current-permission lock wait', async () => {
    const user = makeActor(), suffix = randomUUID(), waiterName = `ediel-portal-waiter-${suffix}`
    const before = snapshot(companyA)
    const blocker = connection(`ediel-portal-blocker-${suffix}`)
    const waiter = connection(waiterName)
    try {
      blocker.child.stdin.write(`BEGIN; SELECT id FROM public.user_permissions WHERE user_id=${quote(user.userId)}
        AND company_id=${quote(companyA)} ORDER BY id FOR UPDATE; SELECT 'permission-held';\n`)
      await until(() => blocker.output().stdout.includes('permission-held'), 'ediel_portal_permission_lock_not_acquired')
      sql(`UPDATE auth.sessions SET not_after=clock_timestamp()+interval '2 seconds'
        WHERE id=${quote(user.sessionId)}; SELECT to_jsonb(true);`)
      waiter.child.stdin.end(`SET ROLE service_role; SELECT to_jsonb(public.gridex_ediel_portal_test_graph_access_v1(
        ${quote(companyA)},${quote(user.userId)},${quote(user.sessionId)}));\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name=${quote(waiterName)} AND wait_event_type='Lock'));`), 'ediel_portal_preflight_did_not_wait')
      await until(() => sql<boolean>(`SELECT to_jsonb(not_after<clock_timestamp()) FROM auth.sessions
        WHERE id=${quote(user.sessionId)};`), 'ediel_portal_session_did_not_expire')
      blocker.child.stdin.end('COMMIT;\n')
      expect(await blocker.exited).toBe(0)
      expect(await waiter.exited).toBe(0)
      expect(waiter.output().stdout.trim()).toBe('false')
      expect(snapshot(companyA)).toEqual(before)
    } finally {
      blocker.child.kill('SIGTERM'); waiter.child.kill('SIGTERM')
    }
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_LOCK_CLOCK_PASS real_permission_wait=true expired_session_denied=true zero_graph_dml=true')
  })

  it('preserves direct-book DML denial and preflight RPC ACLs', () => {
    const customerId = (snapshot(companyA).customers as Array<{ id: string }>)[0].id
    denied(`SET ROLE service_role; INSERT INTO public.customer_addresses(company_id,customer_id,type,street_1)
      VALUES(${quote(companyA)},${quote(customerId)},'registered','Unmarked legacy insertion');`, 'address_book_command_required')
    for (const role of ['anon', 'authenticated']) {
      expect(sql<boolean>(`SELECT to_jsonb(has_function_privilege(${quote(role)},
        'public.gridex_ediel_portal_test_graph_access_v1(uuid,uuid,uuid)','EXECUTE'));`)).toBe(false)
      denied(`SET ROLE ${role}; SELECT public.gridex_ediel_portal_test_graph_access_v1(
        ${quote(companyA)},${quote(actor.userId)},${quote(actor.sessionId)});`, 'permission denied')
    }
    expect(sql<boolean>(`SELECT to_jsonb(has_table_privilege('service_role','auth.sessions','SELECT'));`)).toBe(false)
    console.log('EDIEL_PORTAL_ADDRESS_NATIVE_FENCES_PASS unmarked_book_denied=true service_only_preflight=true')
  })
})
