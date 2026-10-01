import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'

// Only the Next bundler marker is mocked. Commands, reads, Storage bytes and
// independent PostgreSQL transactions use the actual disposable migrated stack.
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { executeSupportCommand } from '@/lib/customer-operations/supportCommand'
import { intakeSupportAttachment, readSupportAttachments } from '@/lib/customer-cases/attachments'
import { readCustomerSupportPage } from '@/lib/customer-cases/customerRead'
import { publicReference } from '@/lib/integrations/publicReferences'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
      JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('support_continuation_disposable_ci_required')
  }
  try {
    return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
      { input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new Error('support_continuation_database_failed')
  }
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
function fixture() {
  const companyId = randomUUID(), customerId = randomUUID(), otherCustomerId = randomUUID()
  const userId = randomUUID(), otherUserId = randomUUID(), sessionA = randomUUID(), sessionB = randomUUID(), otherSession = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(companyId)},'Synthetic support continuation','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      SELECT u,'authenticated','authenticated',u::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
      FROM unnest(ARRAY[${quote(userId)}::uuid,${quote(otherUserId)}::uuid]) u;
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
      SELECT u,u::text||'@example.invalid','Synthetic support continuation owner','active'
      FROM unnest(ARRAY[${quote(userId)}::uuid,${quote(otherUserId)}::uuid]) u;
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES
      (${quote(sessionA)},${quote(userId)},now(),now(),clock_timestamp()+interval '1 hour'),
      (${quote(sessionB)},${quote(userId)},now(),now(),clock_timestamp()+interval '1 hour'),
      (${quote(otherSession)},${quote(otherUserId)},now(),now(),clock_timestamp()+interval '1 hour');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
      (${quote(customerId)},${quote(companyId)},${quote(customerId)},'Synthetic continuation owner','private'),
      (${quote(otherCustomerId)},${quote(companyId)},${quote(otherCustomerId)},'Synthetic other owner','private');
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email) VALUES
      (${quote(companyId)},${quote(customerId)},${quote(userId)},${quote(userId)},'active',true,'owner',${quote(`${userId}@example.invalid`)}),
      (${quote(companyId)},${quote(otherCustomerId)},${quote(otherUserId)},${quote(otherUserId)},'active',true,'owner',${quote(`${otherUserId}@example.invalid`)});
    SELECT to_jsonb(true);`)
  const context = { companyId, customerId, actor: { kind: 'portal' as const, userId, sessionId: sessionA } }
  return { ...context, context, sessionA, sessionB,
    otherContext: { companyId, customerId: otherCustomerId, actor: { kind: 'portal' as const, userId: otherUserId, sessionId: otherSession } } }
}
function command(f: ReturnType<typeof fixture>, sessionId: string) {
  return { companyId: f.companyId, customerId: f.customerId, mode: 'portal', channel: 'portal', actorUserId: f.actor.userId,
    sessionId, clientId: null, subject: null, operation: 'create', caseId: null, caseReference: null,
    expectedRevision: 0, idempotencyKey: 'support-continuation-concurrent-first-create',
    payload: { title: 'Synthetic concurrent first create', body: 'Exactly one original customer message' } }
}
function snapshot(f: ReturnType<typeof fixture>) {
  return sql(`SELECT jsonb_build_object(
    'cases',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_cases t WHERE company_id=${quote(f.companyId)}),
    'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_support_threads t WHERE company_id=${quote(f.companyId)}),
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_support_messages t WHERE company_id=${quote(f.companyId)}),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.canonical_command_results t WHERE company_id=${quote(f.companyId)}),
    'audits',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.canonical_audit_events t WHERE company_id=${quote(f.companyId)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.canonical_domain_events t WHERE company_id=${quote(f.companyId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.canonical_event_outbox t WHERE company_id=${quote(f.companyId)}),
    'attachments',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_support_attachments t WHERE company_id=${quote(f.companyId)}));`)
}
function connection(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', failed = false
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  // SQL errors can carry complete request bodies. Retain only the failure bit.
  child.stderr.on('data', () => { failed = true })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve(code ?? -1))
  })
  return { child, exited, output: () => stdout, failed: () => failed }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

it('serializes two first creates in separate transactions and live sessions into one logical case, then denies stale authority replay', async () => {
  const f = fixture(), suffix = randomUUID(), waiterName = `support-conc-waiter-${suffix}`
  const first = connection(`support-conc-first-${suffix}`), second = connection(waiterName)
  try {
    first.child.stdin.write(`SET client_min_messages=warning; BEGIN; SET LOCAL ROLE service_role;
      SELECT public.gridex_support_case_command_v1(${quote(JSON.stringify(command(f, f.sessionA)))}::jsonb);
      SELECT 'first-create-uncommitted';\n`)
    await until(() => first.output().includes('first-create-uncommitted'), 'support_continuation_first_create_not_held')
    second.child.stdin.end(`SET client_min_messages=warning; SET ROLE service_role;
      SELECT public.gridex_support_case_command_v1(${quote(JSON.stringify(command(f, f.sessionB)))}::jsonb);\n`)
    await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name=${quote(waiterName)} AND wait_event_type='Lock'));`), 'support_continuation_second_create_did_not_wait')
    first.child.stdin.end('COMMIT;\n')
    expect(await first.exited).toBe(0)
    expect(await second.exited).toBe(0)
    expect(first.failed() || second.failed()).toBe(false)
    const created = JSON.parse(first.output().split('\n').find(line => line.startsWith('{'))!) as { caseId: string; replayed: boolean; revision: number }
    const replayed = JSON.parse(second.output().trim()) as typeof created
    expect(created).toMatchObject({ revision: 1, replayed: false })
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(sql(`SELECT jsonb_build_object(
      'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${quote(f.companyId)}),
      'threads',(SELECT count(*) FROM public.customer_support_threads WHERE company_id=${quote(f.companyId)}),
      'messages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${quote(f.companyId)}),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(f.companyId)} AND command_type='customer.support.command.v1'),
      'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(f.companyId)} AND event_type='CUSTOMER_SUPPORT_COMMAND'),
      'events',(SELECT count(*) FROM public.canonical_domain_events WHERE company_id=${quote(f.companyId)} AND event_type='CUSTOMER_SUPPORT_MESSAGE'),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(f.companyId)} AND topic='customer.support.changed'));`))
      .toEqual({ cases: 1, threads: 1, messages: 1, commands: 1, audits: 1, events: 1, outbox: 1 })
    const candidate = { ...f.context, operation: 'create' as const, expectedRevision: 0,
      idempotencyKey: command(f, f.sessionA).idempotencyKey, payload: command(f, f.sessionA).payload }
    const before = snapshot(f)
    await expect(executeSupportCommand({ ...candidate, payload: { ...candidate.payload, body: 'Changed request' } }))
      .rejects.toMatchObject({ code: 'support_idempotency_conflict', status: 409 })
    sql(`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.sessionA)}; SELECT to_jsonb(true);`)
    await expect(executeSupportCommand(candidate)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
    sql(`DELETE FROM auth.sessions WHERE id=${quote(f.sessionB)}; SELECT to_jsonb(true);`)
    await expect(executeSupportCommand({ ...candidate, actor: { ...candidate.actor, sessionId: f.sessionB } }))
      .rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
    expect(snapshot(f)).toEqual(before)
    console.log('SUPPORT_CONTINUATION_CONCURRENT_NATIVE_PASS first_create_overlap=true postgres_sessions=2 live_portal_sessions=2 logical_case=1 commands=1 audits=1 messages=1 domain_events=1 outbox=1 changed_payload_conflict=true expired_and_revoked_replay_denied=true')
  } finally {
    first.child.kill('SIGTERM'); second.child.kill('SIGTERM')
  }
})

it('keeps actual untrusted bytes quarantined and private, denies a sibling customer reference and an expired protected read', async () => {
  const f = fixture()
  const created = await executeSupportCommand({ ...f.context, operation: 'create', expectedRevision: 0,
    idempotencyKey: 'support-continuation-quarantine-case', payload: { title: 'Synthetic quarantine case', body: 'Synthetic customer file intake' } })
  const reference = publicReference('case', f.companyId, created.caseId)!
  // Inert suspicious content exercises intake without executing it or treating
  // content inspection as a scanner verdict. Real malware detection stays open.
  const bytes = '<script>synthetic untrusted attachment content; never execute</script>\n'
  const candidate = { context: f.context, caseReference: reference, expectedRevision: 1,
    idempotencyKey: 'support-continuation-quarantine-file', file: new File([bytes], 'synthetic-untrusted.txt', { type: 'text/plain' }) }
  expect(await intakeSupportAttachment(candidate)).toMatchObject({ scan_status: 'quarantined', revision: 2, replayed: false })
  const attachment = sql<{ objectKey: string; sha256: string; scanStatus: string; uploadedAt: string }>(`SELECT jsonb_build_object(
    'objectKey',object_key,'sha256',content_sha256,'scanStatus',scan_status,'uploadedAt',uploaded_at)
    FROM public.customer_support_attachments WHERE company_id=${quote(f.companyId)} AND customer_id=${quote(f.customerId)};`)
  expect(attachment).toMatchObject({ sha256: createHash('sha256').update(bytes).digest('hex'), scanStatus: 'quarantined' })
  expect(attachment.uploadedAt).toEqual(expect.any(String))
  const stored = await supabaseService.storage.from('customer-support-quarantine').download(attachment.objectKey)
  expect(stored.error).toBeNull()
  expect(await stored.data!.text()).toBe(bytes)
  const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } })
  expect((await anonymous.storage.from('customer-support-quarantine').download(attachment.objectKey)).error).not.toBeNull()
  const own = await readSupportAttachments(f.context, { reference })
  expect(own.items).toHaveLength(1)
  expect(Object.keys(own.items[0]).sort()).toEqual(['attachment_reference', 'file_name', 'media_type', 'byte_size', 'scan_status', 'created_at'].sort())
  expect(own.items[0].scan_status).toBe('quarantined')
  const before = snapshot(f)
  await expect(readSupportAttachments(f.otherContext, { reference })).rejects.toMatchObject({ code: 'resource_not_found', status: 404 })
  await expect(intakeSupportAttachment({ ...candidate, context: f.otherContext, idempotencyKey: 'support-continuation-foreign-file' }))
    .rejects.toMatchObject({ code: 'resource_not_found', status: 404 })
  sql(`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(f.sessionA)}; SELECT to_jsonb(true);`)
  await expect(readSupportAttachments(f.context, { reference })).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(snapshot(f)).toEqual(before)
  console.log('SUPPORT_CONTINUATION_QUARANTINE_NATIVE_PASS actual_bytes=true untrusted_content=true scanner_unconfigured=true quarantined=true anonymous_download_denied=true public_projection_has_no_path=true sibling_reference_denied=true expired_protected_read_denied=true')
})

it('denies protected API reads and completed-command replay after the current API client mandate expires', async () => {
  const f = fixture(), clientId = randomUUID()
  sql(`INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,expires_at)
    VALUES(${quote(clientId)},${quote(f.companyId)},'Synthetic expiring support client',${quote(`continuation-${clientId.slice(0, 8)}`)},
      repeat('a',64),'active',ARRAY['customer_cases.read','customer_cases.write'],clock_timestamp()+interval '1 hour');
    SELECT to_jsonb(true);`)
  // The signature/exact-action HTTP boundary is covered by the separate existing
  // HTTP fixture. This native test exercises its current DB relationship policy.
  const context = { companyId: f.companyId, customerId: f.customerId,
    actor: { kind: 'api' as const, clientId, subject: f.actor.userId } }
  const candidate = { ...context, operation: 'create' as const, expectedRevision: 0,
    idempotencyKey: 'support-continuation-expiring-client', payload: { title: 'Synthetic API expiry case', body: 'Synthetic API message' } }
  await executeSupportCommand(candidate)
  expect((await readCustomerSupportPage(context)).items).toHaveLength(1)
  const before = snapshot(f)
  sql(`UPDATE public.integration_api_clients SET expires_at=clock_timestamp()-interval '1 second'
    WHERE id=${quote(clientId)}; SELECT to_jsonb(true);`)
  await expect(readCustomerSupportPage(context)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  await expect(executeSupportCommand(candidate)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(snapshot(f)).toEqual(before)
  console.log('SUPPORT_CONTINUATION_EXPIRED_CLIENT_NATIVE_PASS current_client_expiry=true protected_read_denied=true completed_command_replay_denied=true no_partial_effect=true real_phone_mandate_unconfigured=true')
})
