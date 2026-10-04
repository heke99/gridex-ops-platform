import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// Owned disposable clean replay only. Both native sessions see a synthetic
// cohort. Its rows remain until stack destruction; its unused API client is
// revoked by the actual lifecycle/catalog trigger path exercised below.
const DATABASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const roleCatalogFixture = readFileSync(new URL('./sql/staff-native-role-catalog-fixture.sql', import.meta.url), 'utf8')
type SqlResult = { code: number | null; output: string; error: string }

function nativeSession(input: string, applicationName: string, hold = false) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') {
    throw new Error('staff_user_concurrency_owned_local_stack_required')
  }
  const child = spawn('psql', [DATABASE, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, PGAPPNAME: applicationName, PGCONNECT_TIMEOUT: '3' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = '', error = '', finished = false
  let heldResolve: (pid: number) => void = () => undefined
  let heldReject: (error: Error) => void = () => undefined
  const held = hold ? new Promise<number>((resolve, reject) => {
    heldResolve = resolve
    heldReject = reject
  }) : Promise.resolve(0)
  const timeout = setTimeout(() => {
    child.kill('SIGTERM')
    heldReject(new Error(`staff_native_session_timeout:${applicationName}`))
  }, 20_000)
  const done = new Promise<SqlResult>((resolve, reject) => {
    // SQL errors close psql while an input write may still be buffered. Its
    // exit status/stderr remain the authoritative failure, including EPIPE.
    child.stdin.on('error', () => undefined)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const marker = /STAFF_RACE_HELD:(\d+)/.exec(output)
      if (marker) heldResolve(Number(marker[1]))
    })
    child.stderr.on('data', (chunk: string) => { error += chunk })
    child.on('error', (cause: Error) => {
      finished = true
      clearTimeout(timeout)
      heldReject(cause)
      reject(cause)
    })
    child.on('close', (code: number | null) => {
      finished = true
      clearTimeout(timeout)
      if (hold && !output.includes('STAFF_RACE_HELD:')) heldReject(new Error(error || 'staff_native_holder_not_ready'))
      resolve({ code, output: output.trim(), error })
    })
  })
  // Always observe an early process failure, including before the holder marker.
  void done.catch(() => undefined)
  if (hold) child.stdin.write(`${input}\n`)
  else child.stdin.end(input)
  return { child, held, done, get finished() { return finished } }
}

async function sql(input: string) {
  const result = await nativeSession(input, `staff-race-observer-${randomUUID()}`).done
  assert.equal(result.code, 0, result.error)
  return result.output
}

async function observeActorBarrier(applicationName: string, holderPid: number) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const blocked = await sql(`SELECT EXISTS(SELECT FROM pg_stat_activity
      WHERE application_name='${applicationName}' AND wait_event_type='Lock'
        AND ${holderPid}=ANY(pg_blocking_pids(pid)));`)
    if (blocked === 't') return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('Staff command never waited after acquiring its company lock at the actor barrier')
}

it.each(['first_write', 'cached_replay'] as const)(
  'native real client revocation completes and denies a waiting staff %s',
  async mode => {
    const f = { company: randomUUID(), actor: randomUUID(), target: randomUUID(), client: randomUUID() }
    const key = `staff-client-race:${randomUUID()}`
    const command = `SELECT public.canonical_change_tenant_user_access('${JSON.stringify({
      company_id: f.company, actor_user_id: f.actor, user_id: f.target,
      action: 'upsert', staff_operation: 'change_role', role_key: 'operations_agent', membership_role: 'operations',
      channel: 'staff_api', api_client_id: f.client, idempotency_key: key, reason: 'Synthetic client revocation race',
    })}'::jsonb);`
    const revokerName = `staff-client-revoker-${randomUUID()}`
    const staffName = `staff-client-writer-${randomUUID()}`
    let revoker: ReturnType<typeof nativeSession> | undefined
    let staff: ReturnType<typeof nativeSession> | undefined
    let seeded = false
    try {
      await sql(`BEGIN;
        ${roleCatalogFixture}
        INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
        VALUES ${[f.actor, f.target].map(id => `('${id}','authenticated','authenticated','${id}@example.invalid',now(),'{}','{}',now(),now(),false,false)`).join(',')};
        INSERT INTO public.user_profiles(id,email,user_status)
        VALUES ${[f.actor, f.target].map(id => `('${id}','${id}@example.invalid','active')`).join(',')}
        ON CONFLICT(id) DO UPDATE SET user_status='active';
        INSERT INTO public.companies(id,name,status,is_active) VALUES('${f.company}','Synthetic staff client lock order','active',true);
        INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active,accepted_at)
        VALUES('${f.company}','${f.actor}','company_admin','company_admin','active',true,now()),
          ('${f.company}','${f.target}','support','customer_service_agent','active',true,now());
        DO $$DECLARE admin_role uuid;support_role uuid;BEGIN
          SELECT id INTO admin_role FROM public.roles WHERE coalesce(key,name)='company_admin' ORDER BY created_at,id LIMIT 1;
          SELECT id INTO support_role FROM public.roles WHERE coalesce(key,name)='customer_service_agent' ORDER BY created_at,id LIMIT 1;
          IF admin_role IS NULL OR support_role IS NULL THEN RAISE EXCEPTION 'staff_client_race_roles_missing'; END IF;
          INSERT INTO public.user_roles(company_id,user_id,role,role_id,status,is_active)
          VALUES('${f.company}','${f.actor}','company_admin',admin_role,'active',true),
            ('${f.company}','${f.target}','customer_service_agent',support_role,'active',true);
        END$$;
        INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
        VALUES('${f.client}','${f.company}','Synthetic unused client lock race','${f.client}','synthetic-no-real-key',ARRAY['staff_users.write'],'active');
        ${mode === 'cached_replay' ? command : ''}
        COMMIT;`)
      seeded = true
      const publicationBefore = Number(await sql(`SELECT count(*) FROM public.domain_events
        WHERE company_id='${f.company}' AND event_type='contracts.publication.changed';`))
      // This profile lock is solely a scheduling barrier, acquired in the
      // revoker session without changing the actor. The real staff command must
      // acquire its company lock before it waits here; no RPC body is stubbed.
      revoker = nativeSession(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='10s';
        SELECT id FROM public.user_profiles WHERE id='${f.actor}' FOR UPDATE;
        SELECT 'STAFF_RACE_HELD:'||pg_backend_pid();`, revokerName, true)
      const revokerPid = await revoker.held
      staff = nativeSession(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='10s';
        ${command} COMMIT;`, staffName)
      await observeActorBarrier(staffName, revokerPid)
      // Actual UPDATE fires the production catalog-revision trigger and its
      // company FK KEY SHARE while the staff transaction holds the company.
      revoker.child.stdin.end(`UPDATE public.integration_api_clients SET status='revoked',revoked_at=clock_timestamp()
        WHERE id='${f.client}'; COMMIT;`)
      const revocation = await revoker.done
      assert.equal(revocation.code, 0, revocation.error)
      const denied = await staff.done
      assert.notEqual(denied.code, 0, 'Revoked client unexpectedly completed a staff command or replay')
      assert.match(denied.error, /staff_permission_denied/)
      assert.doesNotMatch(denied.error, /deadlock detected|lock timeout|statement timeout/)
      const retained = await sql(`SELECT json_build_object(
        'receipts',(SELECT count(*) FROM public.canonical_command_results WHERE company_id='${f.company}'),
        'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id='${f.company}' AND action='STAFF_CHANGE_ROLE'),
        'role',(SELECT role_key FROM public.company_memberships WHERE company_id='${f.company}' AND user_id='${f.target}'),
        'revoked',(SELECT status='revoked' AND revoked_at IS NOT NULL FROM public.integration_api_clients WHERE id='${f.client}'),
        'publication_events',(SELECT count(*) FROM public.domain_events WHERE company_id='${f.company}' AND event_type='contracts.publication.changed'))::text;`)
      const result = JSON.parse(retained) as { receipts: number; audits: number; role: string; revoked: boolean; publication_events: number }
      expect(result).toMatchObject({
        receipts: mode === 'cached_replay' ? 1 : 0,
        audits: mode === 'cached_replay' ? 1 : 0,
        role: mode === 'cached_replay' ? 'operations_agent' : 'customer_service_agent',
        revoked: true,
      })
      expect(result.publication_events).toBe(publicationBefore + 2)
    } finally {
      if (revoker && !revoker.finished) revoker.child.stdin.end('ROLLBACK;')
      if (staff && !staff.finished) staff.child.kill('SIGTERM')
      if (revoker) await revoker.done.catch(() => undefined)
      if (staff) await staff.done.catch(() => undefined)
      if (seeded) await sql(`UPDATE public.integration_api_clients SET status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id='${f.client}';`)
    }
  }, 40_000,
)
