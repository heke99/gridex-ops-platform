import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'

// This test commits a separate synthetic cohort so both native sessions can see it.
// Its rows remain until the owned clean-replay stack is destroyed. No table,
// trigger or audit record is changed for cleanup; only its unused client is revoked.
const DATABASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
type Operation = 'disable' | 'change_role'
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

async function observeCompanyLock(applicationName: string, holderPid: number) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const blocked = await sql(`SELECT EXISTS(SELECT FROM pg_stat_activity
      WHERE application_name='${applicationName}' AND wait_event_type='Lock'
        AND ${holderPid}=ANY(pg_blocking_pids(pid)));`)
    if (blocked === 't') return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('Second native command never waited for the first company transaction')
}

it.each(['disable', 'change_role'] as const)(
  'native simultaneous %s commands serialize and preserve the last administrator',
  async (operation: Operation) => {
    const f = { company: randomUUID(), actor: randomUUID(), adminA: randomUUID(), adminB: randomUUID(), client: randomUUID() }
    const keyA = `staff-race:${randomUUID()}:a`, keyB = `staff-race:${randomUUID()}:b`
    const appA = `staff-race-a-${randomUUID()}`, appB = `staff-race-b-${randomUUID()}`
    const command = (target: string, key: string) => `SELECT public.canonical_change_tenant_user_access('${JSON.stringify({
      company_id: f.company, actor_user_id: f.actor, user_id: target,
      action: operation === 'disable' ? 'disable' : 'upsert', staff_operation: operation,
      ...(operation === 'change_role' ? { role_key: 'customer_service_agent', membership_role: 'support' } : {}),
      channel: 'staff_api', api_client_id: f.client, idempotency_key: key, reason: 'Synthetic simultaneous staff command',
    })}'::jsonb);`
    let holder: ReturnType<typeof nativeSession> | undefined
    let follower: ReturnType<typeof nativeSession> | undefined
    let seeded = false
    try {
      await sql(`BEGIN;
        INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
        VALUES ${[f.actor, f.adminA, f.adminB].map(id => `('${id}','authenticated','authenticated','${id}@example.invalid',now(),'{}','{}',now(),now(),false,false)`).join(',')};
        INSERT INTO public.user_profiles(id,email,user_status)
        VALUES ${[f.actor, f.adminA, f.adminB].map(id => `('${id}','${id}@example.invalid','active')`).join(',')}
        ON CONFLICT(id) DO UPDATE SET user_status='active';
        INSERT INTO public.companies(id,name,status) VALUES('${f.company}','Synthetic staff concurrency','active');
        INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active,accepted_at)
        VALUES('${f.company}','${f.actor}','support','customer_service_agent','active',true,now()),
          ('${f.company}','${f.adminA}','company_admin','company_admin','active',true,now()),
          ('${f.company}','${f.adminB}','company_admin','company_admin','active',true,now());
        DO $$DECLARE admin_role uuid;support_role uuid;BEGIN
          SELECT id INTO admin_role FROM public.roles WHERE coalesce(key,name)='company_admin' ORDER BY created_at,id LIMIT 1;
          SELECT id INTO support_role FROM public.roles WHERE coalesce(key,name)='customer_service_agent' ORDER BY created_at,id LIMIT 1;
          IF admin_role IS NULL OR support_role IS NULL THEN RAISE EXCEPTION 'staff_concurrency_role_fixture_missing'; END IF;
          INSERT INTO public.user_roles(company_id,user_id,role,role_id,status,is_active)
          VALUES('${f.company}','${f.actor}','customer_service_agent',support_role,'active',true),
            ('${f.company}','${f.adminA}','company_admin',admin_role,'active',true),
            ('${f.company}','${f.adminB}','company_admin',admin_role,'active',true);
        END$$;
        INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
        VALUES('${f.company}','${f.actor}','users.write','allow','active',true);
        INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
        VALUES('${f.client}','${f.company}','Synthetic unused concurrency client','${f.client}','synthetic-no-real-key',ARRAY['staff_users.write'],'active');
        DO $$BEGIN
          IF NOT ('users.write'=ANY(public.gridex_staff_actor_permissions_v1('${f.company}','${f.actor}',false)))
            OR (SELECT count(*) FROM public.company_memberships WHERE company_id='${f.company}' AND membership_role IN('owner','admin','company_admin') AND status='active' AND is_active)<>2
            OR EXISTS(SELECT FROM public.company_memberships WHERE company_id='${f.company}' AND user_id='${f.actor}' AND membership_role IN('owner','admin','company_admin'))
          THEN RAISE EXCEPTION 'staff_concurrency_actor_fixture_invalid'; END IF;
        END$$;
        COMMIT;`)
      seeded = true
      holder = nativeSession(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='10s';
        ${command(f.adminA, keyA)} SELECT 'STAFF_RACE_HELD:'||pg_backend_pid();`, appA, true)
      const holderPid = await holder.held
      follower = nativeSession(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='10s';
        ${command(f.adminB, keyB)} COMMIT;`, appB)
      // Observe a real blocked second backend before allowing the first commit.
      // This would fail if the guard merely counted an unlocked snapshot.
      await observeCompanyLock(appB, holderPid)
      holder.child.stdin.end('COMMIT;\n')
      const [successful, rejected] = await Promise.all([holder.done, follower.done])
      expect(successful.code, successful.error).toBe(0)
      expect(rejected.code).not.toBe(0)
      expect(rejected.error).toMatch(/staff_last_admin_required/)
      const firstResult = JSON.parse(successful.output.split('\n')[0])
      expect(firstResult).toMatchObject({ user_id: f.adminA,
        status: operation === 'disable' ? 'disabled' : 'active',
        role_key: operation === 'disable' ? 'company_admin' : 'customer_service_agent' })
      expect(JSON.parse(await sql(command(f.adminA, keyA)))).toEqual(firstResult)
      const state = JSON.parse(await sql(`SELECT jsonb_build_object(
        'admins',(SELECT count(*) FROM public.company_memberships WHERE company_id='${f.company}' AND status='active' AND is_active AND membership_role IN('owner','admin','company_admin')),
        'remainingAdmin',(SELECT count(*) FROM public.company_memberships WHERE company_id='${f.company}' AND user_id='${f.adminB}' AND status='active' AND is_active AND role_key='company_admin'),
        'durableAudits',(SELECT count(*) FROM public.audit_logs WHERE company_id='${f.company}' AND action='STAFF_${operation.toUpperCase()}' AND entity_id='${f.adminA}' AND actor_user_id='${f.actor}' AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'='${f.client}'),
        'totalOperationAudits',(SELECT count(*) FROM public.audit_logs WHERE company_id='${f.company}' AND action='STAFF_${operation.toUpperCase()}'),
        'failedAudits',(SELECT count(*) FROM public.audit_logs WHERE company_id='${f.company}' AND action='STAFF_${operation.toUpperCase()}' AND entity_id='${f.adminB}'),
        'successfulCache',(SELECT count(*) FROM public.canonical_command_results WHERE company_id='${f.company}' AND command_type='tenant.user_access.change' AND idempotency_key='${keyA}'),
        'failedCache',(SELECT count(*) FROM public.canonical_command_results WHERE company_id='${f.company}' AND command_type='tenant.user_access.change' AND idempotency_key='${keyB}'));`))
      expect(state).toEqual({ admins: 1, remainingAdmin: 1, durableAudits: 1, totalOperationAudits: 1, failedAudits: 0, successfulCache: 1, failedCache: 0 })
    } finally {
      if (follower && !follower.finished) follower.child.kill('SIGTERM')
      if (holder && !holder.finished && !holder.child.stdin.writableEnded) holder.child.stdin.end('ROLLBACK;\n')
      await Promise.allSettled([holder?.done, follower?.done].filter((result): result is Promise<SqlResult> => Boolean(result)))
      if (seeded) await sql(`UPDATE public.integration_api_clients SET status='revoked',revoked_at=now(),revoke_reason='Synthetic concurrency fixture finished'
        WHERE id='${f.client}' AND company_id='${f.company}';`)
    }
  }, 30_000,
)
