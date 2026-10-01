import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// Only the Next.js import marker is replaced. Database, producer, claim,
// consumer, audit, process-context and readiness implementations stay real.
vi.mock('server-only', () => ({}))
import { saveCustomerSiteCommand, type SiteCommandInput } from '@/lib/customer-operations/siteCommand'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'
import { processJob } from '@/lib/customer-operations/automation.part-3'
import { updateJob, type JobRow } from '@/lib/customer-operations/automation.part-1'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'

const database = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(statement: string): T {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
      JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('site_continuation_disposable_ci_replay_required')
  }
  try {
    return JSON.parse(execFileSync('psql', [database, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
      input: statement, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()) as T
  } catch { throw new Error('site_continuation_proof_database_failed') }
}
type Fixture = { company: string; customer: string; site: string; actor: string; session: string }
const companies: string[] = []
let forbiddenFetches = 0
const actualFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'http://127.0.0.1:54321') {
      forbiddenFetches += 1
      throw new Error('site_continuation_external_delivery_forbidden')
    }
    return actualFetch(input, init)
  }) as typeof fetch
})
afterAll(() => {
  globalThis.fetch = actualFetch
  if (companies.length) sql(`UPDATE public.customer_operation_jobs SET status='cancelled',locked_at=null,locked_by=null,lock_token=null
    WHERE company_id IN (${companies.map(quote).join(',')}) AND status IN ('queued','running','waiting_response'); SELECT to_jsonb(true);`)
})

function fixture(): Fixture {
  const f = { company: randomUUID(), customer: randomUUID(), site: randomUUID(), actor: randomUUID(), session: randomUUID() }
  companies.push(f.company)
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(f.company)},'Synthetic site continuation','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(f.actor)},'authenticated','authenticated',${quote(`${f.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(f.actor)},${quote(`${f.actor}@example.invalid`)},'Synthetic site actor','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(f.session)},${quote(f.actor)},now(),now(),now()+interval '1 hour');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(f.company)},${quote(f.actor)},'support','active',now(),'support',true,now(),'support');
    INSERT INTO public.permissions(key,name) VALUES('sites.write','Synthetic site permission'),('customers.write','Synthetic customer permission') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
      SELECT ${quote(f.actor)},${quote(f.company)},id,key,CASE key WHEN 'sites.write' THEN 'allow' ELSE 'deny' END FROM public.permissions WHERE key IN ('sites.write','customers.write');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
      VALUES(${quote(f.customer)},${quote(f.company)},${quote(f.customer)},'Synthetic continuation customer','private');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status,street,postal_code,city,country)
      VALUES(${quote(f.site)},${quote(f.company)},${quote(f.customer)},'Synthetic site','draft','Original 1','12345','Teststad','SE'); SELECT to_jsonb(true);`)
  return f
}
function command(f: Fixture, key: string, revision = 0): SiteCommandInput {
  return { companyId: f.company, customerId: f.customer, siteId: f.site,
    actor: { kind: 'ops', userId: f.actor, sessionId: f.session, reason: 'Synthetic site continuation proof' },
    expectedRevision: revision, idempotencyKey: key, siteFlowType: 'switch',
    changes: { site_name: 'Synthetic site', facility_id: null, site_type: 'consumption', status: 'draft', move_in_date: null,
      annual_consumption_kwh: 1200, current_supplier_name: null, current_supplier_org_number: null,
      street: 'Testgatan 1', care_of: null, postal_code: '12345', city: 'Teststad', country: 'SE',
      moved_from_street: null, moved_from_postal_code: null, moved_from_city: null, moved_from_supplier_name: null, internal_notes: null },
    addressHints: { claimedGridOwnerId: null, claimedPriceAreaCode: 'SE3' } }
}
function jobs(f: Fixture) {
  return sql<JobRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY created_at,id),'[]'::jsonb)
    FROM public.customer_operation_jobs j WHERE company_id=${quote(f.company)} AND customer_id=${quote(f.customer)};`)
}
function effects(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${quote(f.site)}),
    'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(f.company)} AND command_type='customer.site.save.v1'),
    'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(f.company)} AND event_type='CUSTOMER_SITE_COMMAND'),
    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) FROM public.customer_operation_jobs j WHERE company_id=${quote(f.company)}),
    'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.customer_operation_request_snapshots s WHERE company_id=${quote(f.company)}));`)
}
function deliveryCounts(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'customerInfo',(SELECT count(*) FROM public.customer_info_requests WHERE company_id=${quote(f.company)}),
    'gridOwnerRequests',(SELECT count(*) FROM public.grid_owner_data_requests WHERE company_id=${quote(f.company)}),
    'outboundRequests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${quote(f.company)}),
    'switchRequests',(SELECT count(*) FROM public.supplier_switch_requests WHERE company_id=${quote(f.company)}),
    'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${quote(f.company)}),
    'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${quote(f.company)}));`)
}
const noDelivery = { customerInfo: 0, gridOwnerRequests: 0, outboundRequests: 0, switchRequests: 0, messages: 0, outbox: 0 }

describe.sequential('site producer to actual safe job/readiness consumer', () => {
  it('compiles the literal production candidate guard and preserves complete/incomplete postal validation', () => {
    // Sourced clean replay holds migration files outside this checkout after
    // applying them. Inspect the exact installed owner, never a path fallback.
    const migration = sql<string>(`SELECT to_jsonb(pg_get_functiondef('public.gridex_save_customer_site_v1(jsonb)'::regprocedure));`)
    const start = migration.indexOf("  if not v_candidate ?& array['street','postal_code'")
    const ending = "then raise exception 'site_candidate_invalid' using errcode='22023'; end if;"
    const end = migration.indexOf(ending, start)
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
    // Compile and execute the actual PL/pgSQL IF block, not a duplicate test
    // expression or a source-substring assertion. The remaining command's
    // locks/authority/audit/effects are covered by the real RPC cases below.
    const guard = migration.slice(start, end + ending.length)
    const candidate = { street: 'Testgatan 1', postal_code: '12345', city: 'Teststad', country: 'SE', care_of: null,
      apartment_number: null, complete: true, normalized: 'synthetic', address_hash: 'synthetic' }
    const changes = { street: 'Testgatan 1', city: 'Teststad', country: 'SE', care_of: null, postal_code: '123 45' }
    const args = (patchCandidate: Record<string, unknown> = {}, patchChanges: Record<string, unknown> = {}) =>
      `${quote(JSON.stringify({ ...candidate, ...patchCandidate }))}::jsonb,${quote(JSON.stringify({ ...changes, ...patchChanges }))}::jsonb`
    expect(sql(`CREATE FUNCTION pg_temp.site_candidate_guard_probe(v_candidate jsonb,v_changes jsonb)
      RETURNS boolean LANGUAGE plpgsql AS $probe$
      DECLARE v_before record;
      BEGIN SELECT NULL::text apartment_number INTO v_before; ${guard} RETURN true; END;
      $probe$;
      CREATE FUNCTION pg_temp.site_candidate_guard_denied(candidate jsonb,changes jsonb)
      RETURNS boolean LANGUAGE plpgsql AS $denied$
      BEGIN PERFORM pg_temp.site_candidate_guard_probe(candidate,changes); RETURN false;
        EXCEPTION WHEN invalid_parameter_value THEN RETURN sqlerrm='site_candidate_invalid'; END;
      $denied$;
      SELECT jsonb_build_array(
        pg_temp.site_candidate_guard_probe(${args()}),
        pg_temp.site_candidate_guard_probe(${args({ postal_code: null, complete: false }, { postal_code: '1234' })}),
        pg_temp.site_candidate_guard_probe(${args({ postal_code: null, complete: false }, { postal_code: null })}),
        pg_temp.site_candidate_guard_denied(${args({}, { postal_code: '1234' })}),
        pg_temp.site_candidate_guard_denied(${args({ complete: false })}));`)).toEqual([true, true, true, true, true])
    console.log('SITE_CANDIDATE_POSTAL_PARSER_NATIVE_PASS actual_guard_compiled=true complete_incomplete_null_valid=true forged_mismatch_denied=true')
  })

  it.each(['completed', 'needs_review', 'failed', 'skipped', 'cancelled'])(
    'retains old %s job and commits a fresh customer-data intent/snapshot', async (status) => {
      const f = fixture(), old = randomUUID()
      sql(`INSERT INTO public.customer_operation_jobs(id,company_id,customer_id,customer_site_id,job_type,status,idempotency_key,created_by)
        VALUES(${quote(old)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},'request_customer_data',${quote(status)},
          ${quote(`customer-data:${f.customer}:${f.site}`)},${quote(f.actor)}); SELECT to_jsonb(true);`)
      const input = command(f, `site-continuation-terminal-${status}`)
      await expect(saveCustomerSiteCommand(input)).resolves.toMatchObject({ changed: true, replayed: false })
      const rows = jobs(f)
      expect(rows).toHaveLength(2)
      expect(rows.find(row => row.id === old)?.status).toBe(status)
      const queued = rows.find(row => row.status === 'queued')!
      expect(queued.id).not.toBe(old)
      expect(sql(`SELECT jsonb_build_object('job',customer_operation_job_id,'hash',site_address_hash,'site',customer_site_id)
        FROM public.customer_operation_request_snapshots WHERE company_id=${quote(f.company)};`)).toMatchObject({ job: queued.id, site: f.site, hash: expect.any(String) })
      const before = effects(f)
      await expect(saveCustomerSiteCommand(input)).resolves.toMatchObject({ replayed: true })
      expect(effects(f)).toEqual(before)
      expect(deliveryCounts(f)).toEqual(noDelivery)
      sql(`UPDATE public.customer_operation_jobs SET status='cancelled' WHERE id=${quote(queued.id)}; SELECT to_jsonb(true);`)
      console.log(`SITE_CONTINUATION_TERMINAL_NATIVE_PASS status=${status} old_preserved=true fresh_intent=1 replay_effects_unchanged=true`)
    },
  )

  it('claims the committed intent and persists the exact missing-contract readiness outcome without dispatch', async () => {
    const f = fixture(), input = command(f, 'site-continuation-worker-key')
    await saveCustomerSiteCommand(input)
    const [intent] = jobs(f)
    // Claim exactly this fixture first in the existing global queue. Only its
    // rows receive proof scheduling; no unrelated queue is paused or edited.
    sql(`UPDATE public.customer_operation_jobs SET priority=-32768,run_after=now()-interval '1 day' WHERE id=${quote(intent.id)}; SELECT to_jsonb(true);`)
    await expect(processCustomerOperationJobs({ workerId: 'synthetic-site-continuation-proof', limit: 1 }))
      .resolves.toMatchObject({ claimed: 1, needsReview: 1, completed: 0, failed: 0, errors: [] })
    const [processed] = jobs(f)
    expect(processed).toMatchObject({ id: intent.id, status: 'needs_review', attempts: 1, locked_at: null,
      result: { redirect: 'manual_facility_information_request', intake_state: 'needs_contract_or_poa',
        intake_next_action: 'review_blocker', grid_owner_information_request_id: null } })
    expect(sql(`SELECT jsonb_build_object('state',onboarding_status,'action',next_action) FROM public.customer_sites WHERE id=${quote(f.site)};`))
      .toEqual({ state: 'needs_contract_or_poa', action: 'review_blocker' })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_operation_events WHERE customer_operation_job_id=${quote(intent.id)}
      AND company_id=${quote(f.company)} AND customer_id=${quote(f.customer)} AND status='needs_review';`)).toBeGreaterThan(0)
    expect(deliveryCounts(f)).toEqual(noDelivery)
    expect(forbiddenFetches).toBe(0)
    console.log('SITE_CONTINUATION_WORKER_NATIVE_PASS producer=actual_rpc claim=actual_rpc consumer=actual_worker persisted=needs_review external_delivery=0')
  })

  it('reuses one active intent and blocks its stale snapshot rather than using the new address for an old request', async () => {
    const f = fixture(), first = await saveCustomerSiteCommand(command(f, 'site-continuation-first-key'))
    const [old] = jobs(f), changed = command(f, 'site-continuation-address-correction', first.revision)
    changed.changes.street = 'Testgatan 2'
    await saveCustomerSiteCommand(changed)
    expect(jobs(f)).toHaveLength(1)
    expect(jobs(f)[0].id).toBe(old.id)
    const outcome = await processJob(old)
    expect(outcome).toMatchObject({ status: 'needs_review', result: {
      stale_reason: 'site_address_changed_after_operation_started', action: 'refresh_site_address_and_restart_operation' } })
    await updateJob(old, { status: outcome.status, result: outcome.result, locked_at: null, locked_by: null, lock_token: null })
    expect(jobs(f)[0]).toMatchObject({ id: old.id, status: 'needs_review', result: outcome.result })
    const currentRevision = sql<number>(`SELECT to_jsonb(site_revision) FROM public.customer_sites WHERE id=${quote(f.site)};`)
    changed.expectedRevision = currentRevision; changed.idempotencyKey = 'site-continuation-explicit-restart'
    await saveCustomerSiteCommand(changed)
    expect(jobs(f)).toHaveLength(2)
    expect(jobs(f).filter(row => row.status === 'queued')).toHaveLength(1)
    expect(deliveryCounts(f)).toEqual(noDelivery)
    console.log('SITE_CONTINUATION_STALE_ACTIVE_NATIVE_PASS active_intents=1 stale_consumer=needs_review explicit_restart_intent=1 external_delivery=0')
  })

  it('denies wrong-resource/revoked-authority replay with identical persistence and gates actual supplier readiness', async () => {
    const f = fixture(), foreign = fixture(), input = command(f, 'site-continuation-authority-key')
    await saveCustomerSiteCommand(input)
    const before = effects(f)
    await expect(saveCustomerSiteCommand({ ...input, siteId: foreign.site })).rejects.toMatchObject({ code: 'site_resource_not_found', status: 404 })
    expect(effects(f)).toEqual(before)
    sql(`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.session)}; SELECT to_jsonb(true);`)
    await expect(saveCustomerSiteCommand(input)).rejects.toMatchObject({ code: 'site_actor_forbidden', status: 403 })
    expect(effects(f)).toEqual(before)
    const readiness = await checkSupplierSwitchReadiness({ companyId: f.company, customerId: f.customer, siteId: f.site })
    expect(readiness.ready).toBe(false)
    expect(readiness.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['contract_missing', 'power_of_attorney_missing', 'metering_point_missing']))
    expect(readiness.readinessSnapshot).toMatchObject({ company_id: f.company, customer_id: f.customer, site_id: f.site })
    const wrong = await checkSupplierSwitchReadiness({ companyId: f.company, customerId: f.customer, siteId: foreign.site })
    expect(wrong).toMatchObject({ ready: false, blockers: [{ code: 'site_not_found', source: 'input' }] })
    expect(deliveryCounts(f)).toEqual(noDelivery)
    expect(forbiddenFetches).toBe(0)
    console.log('SITE_CONTINUATION_AUTHORITY_READINESS_NATIVE_PASS wrong_site=denied revoked_replay=denied contract_poa_metering=blocked external_delivery=0')
  })
})
