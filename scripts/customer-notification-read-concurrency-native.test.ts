import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('notification_concurrency_disposable_local_only')
  }
  return JSON.parse(execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000,
  }).trim()) as T
}
function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? -1))
  })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 75))
  }
}
function fixture() {
  const companyId = randomUUID(), customerId = randomUUID(), clientId = randomUUID(), subject = randomUUID()
  const ids = [randomUUID(), randomUUID()]
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(companyId)},'Synthetic notification concurrency','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
      VALUES(${quote(customerId)},${quote(companyId)},${quote(customerId)},'Synthetic concurrency customer','private');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(subject)},'authenticated','authenticated',${quote(`${subject}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role)
      VALUES(${quote(companyId)},${quote(customerId)},${quote(subject)},${quote(subject)},'active',true,'owner');
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
      VALUES(${quote(clientId)},${quote(companyId)},'Synthetic concurrency client',${quote(`ntfc_${clientId.slice(0, 12)}`)},${quote(createHash('sha256').update(clientId).digest('hex'))},'active',ARRAY['customer_notifications.write']);
    INSERT INTO public.customer_notifications(id,company_id,customer_id,title) VALUES
      ${ids.map(id => `(${quote(id)},${quote(companyId)},${quote(customerId)},'Synthetic concurrent unread')`).join(',')};
    SELECT to_jsonb(true);`)
  const references = ids.map(id => publicReference('notification', companyId, id)!)
  const command = (key: string, refs = references) =>
    `SELECT public.gridex_mark_customer_notifications_read_v1(${quote(JSON.stringify({ companyId, customerId, clientId, subject,
      idempotencyKey: key, notificationReferences: refs }))}::jsonb);`
  return { companyId, customerId, clientId, ids, references, command }
}
function parsedResult(stdout: string) {
  const rows = stdout.split('\n').filter(row => row.startsWith('{'))
  expect(rows).toHaveLength(1)
  return JSON.parse(rows[0]) as { statusCode: number; body: { data: { updated_count: number; read_at: string } }; replayed: boolean }
}

describe.sequential('notification real concurrent transactions', () => {
  for (const { stage, replay } of [
    { stage: 'owner', replay: false }, { stage: 'owner', replay: true },
    { stage: 'notification', replay: false }, { stage: 'claim', replay: true },
  ] as const) it(`denies ${replay ? 'completed replay' : 'fresh execution'} if the client expires during a ${stage} lock wait`, async () => {
    const f = fixture(), key = 'native-notification-expiry-wait'
    if (replay) expect(sql(`SET ROLE service_role; ${f.command(key)}`)).toMatchObject({ replayed: false })
    const snapshot = `SELECT jsonb_build_object(
      'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM public.customer_notifications n WHERE company_id=${quote(f.companyId)}),
      'claims',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customer_portal_write_idempotency c WHERE company_id=${quote(f.companyId)}),
      'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.canonical_audit_events a WHERE company_id=${quote(f.companyId)}),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(f.companyId)}));`
    const before = sql(snapshot)
    const lock = stage === 'owner'
      ? `SELECT id FROM public.customer_portal_accounts WHERE customer_id=${quote(f.customerId)} FOR UPDATE;`
      : stage === 'notification'
        ? `SELECT id FROM public.customer_notifications WHERE id=${quote(f.ids[0])} FOR UPDATE;`
        : `SELECT id FROM public.customer_portal_write_idempotency WHERE company_id=${quote(f.companyId)} AND idempotency_key=${quote(key)} FOR UPDATE;`
    const blocker = session(`ntf_expiry_blocker_${randomUUID()}`), commandName = `ntf_expiry_command_${randomUUID()}`, command = session(commandName)
    try {
      blocker.child.stdin.write(`BEGIN; ${lock}\n\\echo NOTIFICATION_EXPIRY_LOCKED\n`)
      await until(() => blocker.output().stdout.includes('NOTIFICATION_EXPIRY_LOCKED'), 'notification_expiry_blocker_did_not_lock')
      sql(`UPDATE public.integration_api_clients SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=${quote(f.clientId)}; SELECT to_jsonb(true);`)
      command.child.stdin.end(`SET ROLE service_role; ${f.command(key)}\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name=${quote(commandName)} AND wait_event_type='Lock'));`), 'notification_expiry_command_did_not_wait')
      await until(() => sql<boolean>(`SELECT to_jsonb(expires_at<=clock_timestamp()) FROM public.integration_api_clients WHERE id=${quote(f.clientId)};`),
        'notification_expiry_clock_did_not_elapse')
      blocker.child.stdin.end('COMMIT;\n')
      expect(await blocker.exited).toBe(0)
      expect(await command.exited).not.toBe(0)
      expect(command.output().stderr).toContain('notification_delegation_forbidden')
      expect(sql(snapshot)).toEqual(before)
      console.log(`NOTIFICATION_API_EXPIRY_WAIT_NATIVE_PASS sessions=2 stage=${stage} completed_replay=${replay} expired_denied=true rows_claim_audit_unchanged=true`)
    } finally { for (const item of [blocker, command]) if (item.child.exitCode === null) item.child.kill('SIGTERM') }
  })

  for (const changedPayload of [false, true]) {
    it(changedPayload ? 'conflicts a changed concurrent payload without a second effect' : 'returns one persisted result for identical concurrent keys', async () => {
      const f = fixture()
      const firstName = `ntf_first_${randomUUID()}`, secondName = `ntf_second_${randomUUID()}`
      const first = session(firstName), second = session(secondName)
      const key = 'native-notification-concurrent-key'
      try {
        first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role;
          SELECT id FROM public.customers WHERE id=${quote(f.customerId)} FOR UPDATE;
          \\echo NOTIFICATION_CUSTOMER_LOCKED
        `)
        await until(() => first.output().stdout.includes('NOTIFICATION_CUSTOMER_LOCKED'), 'first_notification_session_did_not_lock_customer')
        second.child.stdin.end(`SET ROLE service_role; ${f.command(key, changedPayload ? [...f.references].reverse() : f.references)}\n`)
        await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE application_name=${quote(secondName)} AND wait_event_type='Lock'));`), 'second_notification_session_did_not_wait')
        first.child.stdin.end(`${f.command(key)} COMMIT;\n`)
        expect(await first.exited).toBe(0)
        const result = parsedResult(first.output().stdout)
        expect(result).toMatchObject({ statusCode: 200, replayed: false, body: { data: { updated_count: 2 } } })
        if (changedPayload) {
          expect(await second.exited).not.toBe(0)
          expect(second.output().stderr).toContain('idempotency_conflict')
        } else {
          expect(await second.exited).toBe(0)
          expect(parsedResult(second.output().stdout)).toEqual({ ...result, replayed: true })
        }
        expect(sql<{ claims: number; audits: number; read: number; readTimes: number }>(`SELECT jsonb_build_object(
          'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(f.companyId)} AND idempotency_key=${quote(key)}),
          'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(f.companyId)} AND event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND'),
          'read',(SELECT count(*) FROM public.customer_notifications WHERE company_id=${quote(f.companyId)} AND status='read'),
          'readTimes',(SELECT count(DISTINCT read_at) FROM public.customer_notifications WHERE company_id=${quote(f.companyId)}));`))
          .toEqual({ claims: 1, audits: 1, read: 2, readTimes: 1 })
        console.log(`NOTIFICATION_CONCURRENCY_NATIVE_PASS sessions=2 changed_payload=${changedPayload} claims=1 audits=1 effects=2`)
      } finally {
        for (const item of [first, second]) if (item.child.exitCode === null) item.child.kill('SIGTERM')
      }
    })
  }

  it('holds current client authorization against revocation until commit and blocks the next replay', async () => {
    const f = fixture()
    const first = session(`ntf_auth_${randomUUID()}`), revokeName = `ntf_revoke_${randomUUID()}`
    const revoker = session(revokeName)
    try {
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${f.command('native-notification-revocation-lock')}
        \\echo NOTIFICATION_COMMAND_AUTH_LOCKED
      `)
      await until(() => first.output().stdout.includes('NOTIFICATION_COMMAND_AUTH_LOCKED'), 'notification_command_did_not_hold_auth_lock')
      revoker.child.stdin.end(`UPDATE public.integration_api_clients SET revoked_at=now() WHERE id=${quote(f.clientId)};\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name=${quote(revokeName)} AND wait_event_type='Lock'));`), 'client_revocation_did_not_wait_on_current_auth_lock')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited).toBe(0)
      expect(await revoker.exited).toBe(0)
      const replay = session(`ntf_denied_${randomUUID()}`)
      try {
        replay.child.stdin.end(`SET ROLE service_role; ${f.command('native-notification-revocation-lock')}\n`)
        expect(await replay.exited).not.toBe(0)
        expect(replay.output().stderr).toContain('notification_delegation_forbidden')
      } finally { if (replay.child.exitCode === null) replay.child.kill('SIGTERM') }
      console.log('NOTIFICATION_REVOKE_LOCK_NATIVE_PASS client_lock=true revoke_then_replay_denied=true')
    } finally {
      for (const item of [first, revoker]) if (item.child.exitCode === null) item.child.kill('SIGTERM')
    }
  })
})
