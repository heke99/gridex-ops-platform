import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const database = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function requireDisposableReplay() {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
      JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('site_commands_disposable_ci_replay_required')
  }
}
function raw(statement: string) {
  requireDisposableReplay()
  return execFileSync('psql', [database, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', timeout: 30_000 }).trim()
}
function sql<T>(statement: string): T { return JSON.parse(raw(statement)) as T }
function connection(name: string) {
  requireDisposableReplay()
  const child = spawn('psql', [`${database}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? -1)) })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
}
function fixture() {
  const company = randomUUID(), customer = randomUUID(), site = randomUUID(), actor = randomUUID(), session = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},'Synthetic site concurrency','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(`${actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(`${actor}@example.invalid`)},'Synthetic site actor','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(session)},${quote(actor)},now(),now(),now()+interval '1 hour');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(company)},${quote(actor)},'support','active',now(),'support',true,now(),'support');
    INSERT INTO public.permissions(key,name) VALUES('sites.write','Synthetic site command permission'),('customers.write','Synthetic customer command permission') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
      SELECT ${quote(actor)},${quote(company)},id,key,CASE key WHEN 'sites.write' THEN 'allow' ELSE 'deny' END FROM public.permissions WHERE key IN ('sites.write','customers.write');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
      VALUES(${quote(customer)},${quote(company)},${quote(customer)},'Synthetic site customer','private');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status,facility_id,street,postal_code,city,country)
      VALUES(${quote(site)},${quote(company)},${quote(customer)},'Synthetic site','draft','735999999999999999','Original 1','12345','Teststad','SE'); SELECT to_jsonb(true);`)
  return { company, customer, site, actor, session }
}
type Fixture = ReturnType<typeof fixture>
type Result = { companyId: string; customerId: string; siteId: string; revision: number; changed: boolean; replayed: boolean }
function call(f: Fixture, key: string, patch: Record<string, unknown> = {}) {
  const normalized = 'testgatan 1||12345|teststad|se'
  return `public.gridex_save_customer_site_v1(${quote(JSON.stringify({ companyId: f.company, customerId: f.customer, siteId: f.site,
    actorUserId: f.actor, sessionId: f.session, reason: 'Synthetic concurrent site correction', expectedRevision: 0, idempotencyKey: key, siteFlowType: 'switch',
    changes: { site_name: 'Synthetic site', facility_id: '735999999999999999', site_type: 'consumption', status: 'draft', move_in_date: null,
      annual_consumption_kwh: 1200, current_supplier_name: null, current_supplier_org_number: null,
      street: 'Testgatan 1', care_of: null, postal_code: '12345', city: 'Teststad', country: 'SE',
      moved_from_street: null, moved_from_postal_code: null, moved_from_city: null, moved_from_supplier_name: null, internal_notes: null, ...patch },
    addressHints: { claimedGridOwnerId: null, claimedPriceAreaCode: 'SE3' },
    candidate: { street: 'Testgatan 1', postal_code: '12345', city: 'Teststad', country: 'SE', care_of: null, apartment_number: null,
      complete: true, normalized, address_hash: createHash('sha256').update(normalized).digest('hex') },
  }))}::jsonb)`
}
function snapshot(f: Fixture) {
  return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(f.customer)}),
    'sites',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.customer_sites s WHERE customer_id=${quote(f.customer)}),
    'addresses',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.customer_addresses a WHERE customer_id=${quote(f.customer)}),
    'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.customer_site_address_history h WHERE customer_id=${quote(f.customer)}),
    'conflicts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customer_site_address_conflicts c WHERE customer_id=${quote(f.customer)}),
    'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.canonical_command_results c WHERE company_id=${quote(f.company)}),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.canonical_audit_events a WHERE company_id=${quote(f.company)}),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.canonical_domain_events e WHERE company_id=${quote(f.company)}),
    'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.canonical_event_outbox o WHERE company_id=${quote(f.company)}),
    'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.customer_data_tasks t WHERE customer_id=${quote(f.customer)}),
    'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM public.customer_operation_jobs j WHERE customer_id=${quote(f.customer)}),
    'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.customer_operation_request_snapshots s WHERE customer_id=${quote(f.customer)}));`)
}
function waits(name: string) {
  return sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'));`)
}
function stop(...connections: ReturnType<typeof connection>[]) {
  for (const item of connections) if (item.child.exitCode === null) item.child.kill('SIGTERM')
}

describe.sequential('actual site command concurrency and current authority', () => {
  for (const mode of ['identical', 'changed-payload', 'stale-revision'] as const) it(`serializes ${mode} commands across two actual connections`, async () => {
    const f = fixture(), key = `site-native-${mode}-key`, first = connection(`site_first_${randomUUID()}`)
    const secondName = `site_second_${randomUUID()}`, second = connection(secondName)
    try {
      first.child.stdin.write(`BEGIN; SELECT id FROM public.customers WHERE id=${quote(f.customer)} FOR UPDATE;
        \\echo SITE_CUSTOMER_LOCKED
      `)
      await until(() => first.output().stdout.includes('SITE_CUSTOMER_LOCKED'), 'site_first_customer_lock_missing')
      second.child.stdin.end(`SET ROLE service_role; SELECT ${call(f, mode === 'stale-revision' ? `${key}-second` : key,
        mode === 'changed-payload' ? { site_name: 'Changed concurrent payload' } : {})};\n`)
      await until(() => waits(secondName), 'site_second_connection_did_not_wait')
      first.child.stdin.end(`SET LOCAL ROLE service_role; SELECT ${call(f, key)}; COMMIT;\n`)
      expect(await first.exited).toBe(0)
      if (mode === 'identical') {
        expect(await second.exited).toBe(0)
        const result = JSON.parse(first.output().stdout.split('\n').find((line) => line.startsWith('{'))!) as Result
        expect(JSON.parse(second.output().stdout.trim())).toEqual({ ...result, replayed: true })
      } else {
        expect(await second.exited).not.toBe(0)
        expect(second.output().stderr).toContain(mode === 'changed-payload' ? 'site_idempotency_conflict' : 'site_revision_conflict')
      }
      expect(sql(`SELECT jsonb_build_object('commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(f.company)} AND command_type='customer.site.save.v1'),
        'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(f.company)} AND event_type='CUSTOMER_SITE_COMMAND'),
        'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(f.company)} AND topic='customer.site.saved'),
        'jobs',(SELECT count(*) FROM public.customer_operation_jobs WHERE customer_site_id=${quote(f.site)}));`)).toEqual({ commands: 1, audit: 1, outbox: 1, jobs: 1 })
      console.log(`SITE_COMMAND_CONCURRENCY_NATIVE_PASS sessions=2 mode=${mode} command=1 audit=1 intent=1`)
    } finally { stop(first, second) }
  })

  for (const stage of ['site', 'completed-result'] as const) it(`denies expiry after a real ${stage} lock wait without effects`, async () => {
    const f = fixture(), key = `site-native-expiry-${stage}`, statement = call(f, key)
    if (stage === 'completed-result') expect(sql<Result>(`SET ROLE service_role; SELECT ${statement};`)).toMatchObject({ replayed: false })
    const before = snapshot(f), owner = connection(`site_expiry_owner_${randomUUID()}`)
    const commandName = `site_expiry_command_${randomUUID()}`, command = connection(commandName)
    try {
      owner.child.stdin.write(`BEGIN; ${stage === 'site' ? `SELECT id FROM public.customer_sites WHERE id=${quote(f.site)} FOR UPDATE;`
        : `SELECT id FROM public.canonical_command_results WHERE company_id=${quote(f.company)} AND command_type='customer.site.save.v1' FOR UPDATE;`}
        \\echo SITE_RESOURCE_LOCKED
      `)
      await until(() => owner.output().stdout.includes('SITE_RESOURCE_LOCKED'), 'site_expiry_owner_lock_missing')
      sql(`UPDATE auth.sessions SET not_after=clock_timestamp()+interval '3 seconds' WHERE id=${quote(f.session)}; SELECT to_jsonb(true);`)
      command.child.stdin.end(`SET ROLE service_role; SELECT ${statement};\n`)
      await until(() => waits(commandName), 'site_expiry_command_did_not_wait')
      await until(() => sql<boolean>(`SELECT to_jsonb(not_after<=clock_timestamp()) FROM auth.sessions WHERE id=${quote(f.session)};`), 'site_expiry_clock_did_not_elapse')
      owner.child.stdin.end('COMMIT;\n')
      expect(await owner.exited).toBe(0); expect(await command.exited).not.toBe(0)
      expect(command.output().stderr).toContain('site_actor_forbidden')
      expect(snapshot(f)).toEqual(before)
      console.log(`SITE_COMMAND_EXPIRY_WAIT_NATIVE_PASS sessions=2 stage=${stage} effects_unchanged=true`)
    } finally { stop(owner, command) }
  })

  it('serializes actual permission revocation until commit and rejects the completed replay', async () => {
    const f = fixture(), statement = call(f, 'site-native-permission-revoke-key')
    const first = connection(`site_permission_first_${randomUUID()}`), revokeName = `site_permission_revoke_${randomUUID()}`, revoker = connection(revokeName)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT ${statement};
        \\echo SITE_AUTHORITY_LOCKED
      `)
      await until(() => first.output().stdout.includes('SITE_AUTHORITY_LOCKED'), 'site_authority_command_did_not_finish')
      revoker.child.stdin.end(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${quote(f.actor)} AND company_id=${quote(f.company)};\n`)
      await until(() => waits(revokeName), 'site_permission_revocation_committed_before_command')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited).toBe(0); expect(await revoker.exited).toBe(0)
      const beforeReplay = snapshot(f)
      let observed = ''
      try { raw(`SET ROLE service_role; SELECT ${statement};`) } catch (error) { observed = String((error as { stderr?: string | Buffer }).stderr ?? '') }
      expect(observed).toContain('site_actor_forbidden'); expect(snapshot(f)).toEqual(beforeReplay)
      console.log('SITE_COMMAND_PERMISSION_REVOKE_NATIVE_PASS sessions=2 revoke_waits_until_commit=true replay_denied=true effects_unchanged=true')
    } finally { stop(first, revoker) }
  })
})
