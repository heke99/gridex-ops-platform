import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256, serializeBillingConfigurationSnapshot } from '@/lib/billing/billingConfigurationSnapshot'
const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql(command: string) { return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 15_000 }).trim() }
function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? -1)) })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 75)) }
}
it.each(['ops', 'api'] as const)('T18 %s billing expires during a real late-audit wait and rolls back every command effect', async (mode) => {
  if (!process.env.GRIDEX_NATIVE_STATUS || process.env.CI !== 'true') throw new Error('disposable_ci_replay_only')
  const company = randomUUID(), actor = randomUUID(), actorSession = randomUUID(), customer = randomUUID()
  const client = randomUUID(), contract = randomUUID(), underlay = randomUUID(), key = `billing-late-audit-${randomUUID()}`
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},'Synthetic billing expiry tenant','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(`${actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(${quote(actorSession)},${quote(actor)},now(),now());
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(`${actor}@example.invalid`)},'Billing expiry actor','active');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(company)},${quote(actor)},'viewer','active',now(),'viewer',true,now(),'viewer');
    INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic billing write') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(actor)},${quote(company)},id,key FROM public.permissions WHERE key='masterdata.write';
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone,invoice_email,billing_profile)
      VALUES(${quote(customer)},${quote(company)},${quote(customer)},'Synthetic billing expiry customer','private','Synthetic','Billing',
        'contact@example.invalid','+4600000000','before@example.invalid',
        '{"recipient":"Billing Expiry Customer","distributionMethod":"email","email":"before@example.invalid","country":"SE"}');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(contract)},${quote(company)},${quote(customer)},'draft');
    INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status)
      VALUES(${quote(underlay)},${quote(company)},${quote(customer)},${quote(contract)},${quote(contract)},2026,9,'pending');
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
      VALUES(${quote(client)},${quote(company)},'Synthetic billing expiry API',${quote(`expiry-${client.slice(0, 8)}`)},repeat('a',64),'active',array['customer_billing.write']);
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      VALUES(${quote(company)},${quote(customer)},${quote(actor)},${quote(actor)},'active',true,'owner',${quote(`${actor}@example.invalid`)});`)
  const command = {
    companyId: company, customerId: customer, mode, expectedRevision: 0, idempotencyKey: key,
    changes: { email: 'after@example.invalid', country: 'NO' },
    ...(mode === 'ops' ? { actorUserId: actor, sessionId: actorSession, reason: 'Synthetic expiry after audit wait' } : { clientId: client, subject: actor }),
  }
  const capture = () => JSON.parse(sql(`SELECT jsonb_build_object(
    'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(customer)}),
    'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customer_contracts c WHERE company_id=${quote(company)}),'[]'),
    'underlays',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.billing_underlays b WHERE company_id=${quote(company)}),'[]'),
    'completions',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customer_portal_completions c WHERE company_id=${quote(company)}),'[]'),
    'claims',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customer_portal_write_idempotency c WHERE company_id=${quote(company)}),'[]'),
    'results',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.canonical_command_results c WHERE company_id=${quote(company)}),'[]'),
    'audits',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.canonical_audit_events c WHERE company_id=${quote(company)}),'[]'),
    'events',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.canonical_domain_events c WHERE company_id=${quote(company)}),'[]'),
    'outbox',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.canonical_event_outbox c WHERE company_id=${quote(company)}),'[]'));`))
  const before = capture()
  const blockerName = `billing_audit_blocker_${company}`, writerName = `billing_clock_edit_${company}`
  const blocker = session(blockerName), writer = session(writerName)
  try {
    // The sole blocker is an uncommitted audit unique key. It does not lock the
    // customer/session, so reaching this wait proves all earlier guards ran.
    blocker.child.stdin.write(`BEGIN; INSERT INTO public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key)
      VALUES(${quote(company)},'CUSTOMER_BILLING_PROFILE_COMMAND','customer',${quote(customer)},1,${quote(actor)},'Synthetic audit blocker',${quote(key)});
\\echo BILLING_AUDIT_KEY_BLOCKED\n`)
    await until(() => blocker.output().stdout.includes('BILLING_AUDIT_KEY_BLOCKED'), 'billing_audit_blocker_not_ready')
    const expiryTable = mode === 'ops' ? 'auth.sessions' : 'public.integration_api_clients'
    const expiryColumn = mode === 'ops' ? 'not_after' : 'expires_at'
    const expiryId = mode === 'ops' ? actorSession : client
    sql(`UPDATE ${expiryTable} SET ${expiryColumn}=clock_timestamp()+interval '6 seconds' WHERE id=${quote(expiryId)};`)
    writer.child.stdin.end(`SET ROLE service_role; SELECT public.gridex_change_customer_billing_profile_v1(${quote(JSON.stringify(command))}::jsonb);\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity b ON b.application_name=${quote(blockerName)}
      WHERE w.application_name=${quote(writerName)} AND w.wait_event_type='Lock' AND b.pid=ANY(pg_blocking_pids(w.pid)));`) === 't', 'billing_command_did_not_reach_late_audit_wait')
    await until(() => sql(`SELECT ${expiryColumn}<=clock_timestamp() FROM ${expiryTable} WHERE id=${quote(expiryId)};`) === 't', 'billing_authority_clock_did_not_expire')
    blocker.child.stdin.end('ROLLBACK;\n')
    expect(await blocker.exited).toBe(0)
    expect(await writer.exited).not.toBe(0)
    expect(writer.output().stderr).toContain(mode === 'ops' ? 'billing_profile_actor_forbidden' : 'billing_profile_delegation_forbidden')
    expect(capture()).toEqual(before)
    console.log(`BILLING_LATE_AUDIT_CLOCK_NATIVE_PASS mode=${mode} sessions=2 expired=true effects=0`)
  } finally {
    for (const worker of [blocker, writer]) if (worker.child.exitCode === null) worker.child.kill('SIGTERM')
  }
})

it('T18 real sessions serialize profile and invoice locks without mixed revisions; same-key replay returns once', async () => {
  if (!process.env.GRIDEX_NATIVE_STATUS || process.env.CI !== 'true') throw new Error('disposable_ci_replay_only')
  const company = randomUUID(), actor = randomUUID(), actorSession = randomUUID(), customer = randomUUID(), contract = randomUUID(), underlay = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},'Synthetic billing race tenant','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(`${actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(${quote(actorSession)},${quote(actor)},now(),now());
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(`${actor}@example.invalid`)},'Billing race actor','active');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(company)},${quote(actor)},'company_admin','active',now(),'company_admin',true,now(),'company_admin');
    INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic billing write') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(actor)},${quote(company)},id,key FROM public.permissions WHERE key='masterdata.write';
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone,invoice_email,billing_profile)
      VALUES(${quote(customer)},${quote(company)},${quote(customer)},'Synthetic billing race customer','private','Synthetic','Billing','contact@example.invalid','+4600000000','before@example.invalid',
        '{"recipient":"Billing Race Customer","distributionMethod":"email","email":"before@example.invalid","country":"SE"}');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(contract)},${quote(company)},${quote(customer)},'draft');
    INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status)
      VALUES(${quote(underlay)},${quote(company)},${quote(customer)},${quote(contract)},${quote(contract)},2026,9,'pending');`)
  const change = (revision: number, email: string, key: string) => `SELECT public.gridex_change_customer_billing_profile_v1(${quote(JSON.stringify({
    companyId: company, customerId: customer, mode: 'ops', actorUserId: actor, sessionId: actorSession,
    reason: 'Synthetic profile lock race', expectedRevision: revision, idempotencyKey: key, changes: { email },
  }))}::jsonb);`
  const snapshot = (revision: number, email: string) => ({ schema: 'billing_configuration_v2', company_id: company,
    customer_id: customer, contract_id: contract, effective_billing_profile: resolveEffectiveBillingProfile({
      companyId: company, customerId: customer, customer: { id: customer, company_id: company, billing_profile_revision: revision,
        billing_profile: { recipient: 'Billing Race Customer', distributionMethod: 'email', email, country: 'SE' } },
      contract: { id: contract, company_id: company, customer_id: customer, billing_profile_override: {}, billing_profile_override_revision: 0 },
    }) })
  const lock = (revision: number, email: string) => {
    const value = snapshot(revision, email)
    const serialized = serializeBillingConfigurationSnapshot(value)
    return `SELECT public.gridex_lock_billing_configuration_v2(${quote(company)},${quote(underlay)},${revision},0,${quote(serialized)}::jsonb,${quote(billingConfigurationSnapshotSha256(value))},${quote(serialized)});`
  }
  const edit = session(`billing_edit_${company}`), staleLock = session(`billing_stale_${company}`)
  const lockFirst = session(`billing_lock_${company}`), waitingEdit = session(`billing_waiting_${company}`)
  const firstReplay = session(`billing_replay1_${company}`), secondReplay = session(`billing_replay2_${company}`)
  const firstWrite = session(`billing_write1_${company}`), secondWrite = session(`billing_write2_${company}`)
  const revokeGrant = session(`billing_revoke_${company}`), revokedReplay = session(`billing_revoked_replay_${company}`)
  try {
    edit.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT id FROM public.customers WHERE id=${quote(customer)} FOR UPDATE;\n\\echo BILLING_EDIT_LOCKED\n`)
    await until(() => edit.output().stdout.includes('BILLING_EDIT_LOCKED'), 'billing_edit_did_not_lock')
    staleLock.child.stdin.end(`SET ROLE service_role; ${lock(0, 'before@example.invalid')}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`billing_stale_${company}`)} AND wait_event_type='Lock');`) === 't', 'snapshot_did_not_wait_on_customer')
    edit.child.stdin.end(`${change(0, 'after@example.invalid', 'billing-race-edit-first')} COMMIT;\n`)
    expect(await edit.exited).toBe(0); expect(await staleLock.exited).not.toBe(0)
    expect(staleLock.output().stderr).toContain('billing_profile_revision_conflict')
    expect(sql(`SELECT billing_configuration_snapshot IS NULL FROM public.billing_underlays WHERE id=${quote(underlay)};`)).toBe('t')
    lockFirst.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${lock(1, 'after@example.invalid')}\n\\echo BILLING_SNAPSHOT_LOCKED\n`)
    await until(() => lockFirst.output().stdout.includes('BILLING_SNAPSHOT_LOCKED'), 'billing_snapshot_did_not_lock')
    waitingEdit.child.stdin.end(`SET ROLE service_role; ${change(1, 'next@example.invalid', 'billing-race-edit-after-lock')}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`billing_waiting_${company}`)} AND wait_event_type='Lock');`) === 't', 'profile_did_not_wait_on_snapshot')
    lockFirst.child.stdin.end('COMMIT;\n')
    expect(await lockFirst.exited).toBe(0); expect(await waitingEdit.exited).toBe(0)
    expect(JSON.parse(sql(`SELECT billing_configuration_snapshot FROM public.billing_underlays WHERE id=${quote(underlay)};`))).toEqual(snapshot(1, 'after@example.invalid'))
    expect(sql(`SELECT billing_configuration_snapshot_sha256 FROM public.billing_underlays WHERE id=${quote(underlay)};`)).toBe(billingConfigurationSnapshotSha256(snapshot(1, 'after@example.invalid')))
    const sameCommand = change(2, 'replayed@example.invalid', 'billing-race-same-key')
    firstReplay.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT id FROM public.customers WHERE id=${quote(customer)} FOR UPDATE;\n\\echo BILLING_REPLAY_LOCKED\n`)
    await until(() => firstReplay.output().stdout.includes('BILLING_REPLAY_LOCKED'), 'samekey_first_did_not_lock')
    secondReplay.child.stdin.end(`SET ROLE service_role; ${sameCommand}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`billing_replay2_${company}`)} AND wait_event_type='Lock');`) === 't', 'samekey_second_did_not_wait')
    firstReplay.child.stdin.end(`${sameCommand} COMMIT;\n`)
    expect(await firstReplay.exited).toBe(0); expect(await secondReplay.exited).toBe(0)
    expect(secondReplay.output().stdout).toContain('"replayed": true')
    expect(sql(`SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(company)} AND idempotency_key='billing-race-same-key';`)).toBe('1')
    expect(sql(`SELECT billing_profile_revision FROM public.customers WHERE id=${quote(customer)};`)).toBe('3')
    firstWrite.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT id FROM public.customers WHERE id=${quote(customer)} FOR UPDATE;\n\\echo BILLING_FIRST_WRITE_LOCKED\n`)
    await until(() => firstWrite.output().stdout.includes('BILLING_FIRST_WRITE_LOCKED'), 'differentkey_first_did_not_lock')
    secondWrite.child.stdin.end(`SET ROLE service_role; ${change(3, 'second@example.invalid', 'billing-race-second-write')}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`billing_write2_${company}`)} AND wait_event_type='Lock');`) === 't', 'differentkey_second_did_not_wait')
    firstWrite.child.stdin.end(`${change(3, 'first@example.invalid', 'billing-race-first-write')} COMMIT;\n`)
    expect(await firstWrite.exited).toBe(0); expect(await secondWrite.exited).not.toBe(0)
    expect(secondWrite.output().stderr).toContain('billing_profile_revision_conflict')
    expect(sql(`SELECT billing_profile_revision FROM public.customers WHERE id=${quote(customer)};`)).toBe('4')
    expect(sql(`SELECT billing_profile->>'email' FROM public.customers WHERE id=${quote(customer)};`)).toBe('first@example.invalid')
    expect(sql(`SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(company)} AND idempotency_key='billing-race-second-write';`)).toBe('0')
    revokeGrant.child.stdin.write(`BEGIN; DELETE FROM public.user_permissions WHERE user_id=${quote(actor)} AND company_id=${quote(company)};\n\\echo BILLING_GRANT_REVOKE_LOCKED\n`)
    await until(() => revokeGrant.output().stdout.includes('BILLING_GRANT_REVOKE_LOCKED'), 'grant_revoke_did_not_lock')
    revokedReplay.child.stdin.end(`SET ROLE service_role; ${sameCommand}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`billing_revoked_replay_${company}`)} AND wait_event_type='Lock');`) === 't', 'replay_did_not_wait_on_grant_revoke')
    revokeGrant.child.stdin.end('COMMIT;\n')
    expect(await revokeGrant.exited).toBe(0); expect(await revokedReplay.exited).not.toBe(0)
    expect(revokedReplay.output().stderr).toContain('billing_profile_actor_forbidden')
    expect(sql(`SELECT billing_profile_revision FROM public.customers WHERE id=${quote(customer)};`)).toBe('4')
  } finally {
    for (const worker of [edit, staleLock, lockFirst, waitingEdit, firstReplay, secondReplay, firstWrite, secondWrite, revokeGrant, revokedReplay]) if (worker.child.exitCode === null) worker.child.kill('SIGTERM')
  }
})
