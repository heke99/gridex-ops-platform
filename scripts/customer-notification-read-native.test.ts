import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

// This suite executes the real migrated command through distinct psql
// transactions. It is not a mock and never selects a hosted database.
const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const route = '/api/v1/customer/notifications/read'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const companyA = randomUUID(), companyB = randomUUID()
const clientA = randomUUID(), clientA2 = randomUUID(), clientB = randomUUID()
const customers = [
  { companyId: companyA, customerId: randomUUID(), clientId: clientA, subject: randomUUID() },
  { companyId: companyA, customerId: randomUUID(), clientId: clientA, subject: randomUUID() },
  { companyId: companyB, customerId: randomUUID(), clientId: clientB, subject: randomUUID() },
]
type Customer = typeof customers[number]
type Result = { statusCode: number; body: { data: { updated_count: number; notification_references: string[]; read_at: string } }; replayed: boolean }
const fixtureNotifications = customers.map(customer => ({ ...customer, unread: randomUUID(), read: randomUUID() }))
const firstReadAt = '2026-09-29T11:00:00.123456+00:00'

function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('notification_read_disposable_local_only')
  }
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 60_000,
  }).trim()
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
function reference(companyId: string, id: string) { return publicReference('notification', companyId, id)! }
function command(customer: Customer, key: string, references: string[], changes: Record<string, unknown> = {}) {
  return `public.gridex_mark_customer_notifications_read_v1(${quote(JSON.stringify({
    companyId: customer.companyId, customerId: customer.customerId, clientId: customer.clientId,
    subject: customer.subject, idempotencyKey: key, notificationReferences: references, ...changes,
  }))}::jsonb)`
}
function execute(customer: Customer, key: string, references: string[], changes: Record<string, unknown> = {}) {
  return sql<Result>(`SET ROLE service_role; SELECT ${command(customer, key, references, changes)};`)
}
function error(commandSql: string, expected: string) {
  let observed = ''
  try { raw(commandSql) } catch (failure) {
    observed = String((failure as { stderr?: Buffer | string }).stderr ?? '')
  }
  expect(observed).toContain(expected)
}
function requestHash(references: string[]) {
  return createHash('sha256').update(JSON.stringify({ notification_references: references })).digest('hex')
}
function lateFailure(key: string, target: 'completion' | 'audit') {
  const own = fixtureNotifications[0]
  const id = randomUUID()
  const ref = reference(own.companyId, id)
  sql(`INSERT INTO public.customer_notifications(id,company_id,customer_id,title,status)
    VALUES(${quote(id)},${quote(own.companyId)},${quote(own.customerId)},'Synthetic rollback','unread');
    SELECT to_jsonb(true);`)
  const trigger = target === 'completion'
    ? `CREATE FUNCTION pg_temp.notification_read_fail() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN IF NEW.idempotency_key=${quote(key)} AND NEW.status='completed' THEN RETURN NULL; END IF; RETURN NEW; END; $fn$;
       CREATE TRIGGER notification_read_fixture_fail BEFORE UPDATE ON public.customer_portal_write_idempotency
         FOR EACH ROW EXECUTE FUNCTION pg_temp.notification_read_fail();`
    : `CREATE FUNCTION pg_temp.notification_read_fail() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN IF NEW.event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND' AND NEW.aggregate_id=${quote(own.customerId)}::uuid
           THEN RAISE EXCEPTION 'fixture_late_audit_failure'; END IF; RETURN NEW; END; $fn$;
       CREATE TRIGGER notification_read_fixture_fail BEFORE INSERT ON public.canonical_audit_events
         FOR EACH ROW EXECUTE FUNCTION pg_temp.notification_read_fail();`
  const expected = target === 'completion' ? 'notification_completion_failed' : 'fixture_late_audit_failure'
  const observation = sql<{ status: string; read_at: string | null; claims: number; audits: number }>(`
    BEGIN;
    CREATE TEMP TABLE notification_read_fixture_guard(marker boolean);
    ${trigger}
    SET LOCAL ROLE service_role;
    DO $proof$ BEGIN
      BEGIN
        PERFORM ${command(own, key, [ref])};
        RAISE EXCEPTION 'expected_late_failure_not_observed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> ${quote(expected)} THEN RAISE; END IF;
      END;
    END; $proof$;
    RESET ROLE;
    SELECT jsonb_build_object(
      'status',(SELECT status FROM public.customer_notifications WHERE id=${quote(id)}),
      'read_at',(SELECT read_at FROM public.customer_notifications WHERE id=${quote(id)}),
      'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(own.companyId)} AND idempotency_key=${quote(key)}),
      'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE metadata->>'requestHash'=${quote(requestHash([ref]))})
    );
    ROLLBACK;
  `)
  expect(observation).toEqual({ status: 'unread', read_at: null, claims: 0, audits: 0 })
  expect(execute(own, key, [ref])).toMatchObject({ replayed: false, statusCode: 200, body: { data: { updated_count: 1 } } })
}

describe.sequential('notification mark-read actual database boundary', () => {
  beforeAll(() => {
    sql(`
      INSERT INTO public.companies(id,name,status) VALUES
        (${quote(companyA)},'Synthetic notification native A','active'),(${quote(companyB)},'Synthetic notification native B','active');
      INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
        ${customers.map(c => `(${quote(c.customerId)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic notification customer','private')`).join(',')};
      INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES
        ${customers.map(c => `(${quote(c.subject)},'authenticated','authenticated',${quote(`${c.subject}@example.invalid`)},now(),'{}','{}',now(),now(),false,false)`).join(',')};
      INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role) VALUES
        ${customers.map(c => `(${quote(c.companyId)},${quote(c.customerId)},${quote(c.subject)},${quote(c.subject)},'active',true,'owner')`).join(',')};
      INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes) VALUES
        ${[[clientA, companyA], [clientA2, companyA], [clientB, companyB]].map(([id, company]) =>
          `(${quote(id)},${quote(company)},'Synthetic notification native client',${quote(`ntf_${id.slice(0, 12)}`)},${quote(createHash('sha256').update(id).digest('hex'))},'active',ARRAY['customer_notifications.write'])`).join(',')};
      INSERT INTO public.customer_notifications(id,company_id,customer_id,title,status,read_at) VALUES
        ${fixtureNotifications.flatMap(c => [
          `(${quote(c.unread)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic unread','unread',NULL)`,
          `(${quote(c.read)},${quote(c.companyId)},${quote(c.customerId)},'Synthetic read','read',${quote(firstReadAt)})`,
        ]).join(',')};
      SELECT to_jsonb(true);
    `)
  })

  it('preserves historical and new reference bytes and compact ordered request hashes', () => {
    const references = fixtureNotifications.flatMap(c => [reference(c.companyId, c.read), reference(c.companyId, c.unread)])
    const stored = sql<Array<{ id: string; company_id: string; notification_reference: string }>>(`SELECT jsonb_agg(to_jsonb(n)) FROM
      (SELECT id,company_id,notification_reference FROM public.customer_notifications WHERE company_id IN (${quote(companyA)},${quote(companyB)})) n;`)
    expect(stored).toHaveLength(6)
    for (const row of stored) expect(row.notification_reference).toBe(reference(row.company_id, row.id))
    const own = fixtureNotifications[0]
    const ordered = [reference(own.companyId, own.read), reference(own.companyId, own.unread)]
    const result = execute(own, 'native-ordered-reference-hash', ordered)
    expect(result.body.data.notification_references).toEqual(ordered)
    expect(sql<string>(`SELECT to_jsonb(request_hash) FROM public.customer_portal_write_idempotency
      WHERE company_id=${quote(own.companyId)} AND idempotency_key='native-ordered-reference-hash';`)).toBe(requestHash(ordered))
    expect(requestHash(ordered)).not.toBe(requestHash([...ordered].reverse()))
    expect(new Set(references).size).toBe(6)
    console.log('NOTIFICATION_REFERENCE_HASH_NATIVE_PASS stored=6 ordered_compact_hash=true')
  })

  it('replays a single logical result, preserves first read time and tenant/client/customer namespaces', () => {
    const own = fixtureNotifications[0]
    const references = [reference(own.companyId, own.read), reference(own.companyId, own.unread)]
    const first = execute(own, 'native-ordered-reference-hash', references)
    expect(first.replayed).toBe(true)
    expect(first.body.data.updated_count).toBe(1)
    expect(first.body.data.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(execute(own, 'native-ordered-reference-hash', references)).toEqual(first)
    error(`SET ROLE service_role; SELECT ${command(own, 'native-ordered-reference-hash', [...references].reverse())};`, 'idempotency_conflict')
    expect(execute(own, 'native-new-read-zero-count', references).body.data.updated_count).toBe(0)
    expect(sql<string>(`SELECT to_jsonb(read_at) FROM public.customer_notifications WHERE id=${quote(own.read)};`)).toBe(firstReadAt)
    for (const c of fixtureNotifications.slice(1)) {
      expect(execute(c, 'native-ordered-reference-hash', [reference(c.companyId, c.unread)]).body.data.updated_count).toBe(1)
    }
    expect(execute({ ...own, clientId: clientA2 }, 'native-ordered-reference-hash', references).replayed).toBe(false)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency
      WHERE company_id IN (${quote(companyA)},${quote(companyB)}) AND idempotency_key='native-ordered-reference-hash';`)).toBe(4)
    console.log('NOTIFICATION_IDEMPOTENCY_NATIVE_PASS replay=true changed_payload_conflict=true namespaces=4 first_read_preserved=true')
  })

  it('rejects mixed own/foreign references neutrally before any partial mutation or claim', () => {
    const own = fixtureNotifications[0], other = fixtureNotifications[1], foreign = fixtureNotifications[2]
    const id = randomUUID(), ref = reference(own.companyId, id)
    sql(`INSERT INTO public.customer_notifications(id,company_id,customer_id,title) VALUES
      (${quote(id)},${quote(own.companyId)},${quote(own.customerId)},'Synthetic mixed request'); SELECT to_jsonb(true);`)
    for (const c of [other, foreign]) {
      error(`SET ROLE service_role; SELECT ${command(own, 'native-mixed-foreign-references', [ref, reference(c.companyId, c.unread)])};`, 'notification_reference_not_found')
    }
    expect(sql<{ status: string; claims: number }>(`SELECT jsonb_build_object(
      'status',(SELECT status FROM public.customer_notifications WHERE id=${quote(id)}),
      'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${quote(own.companyId)} AND idempotency_key='native-mixed-foreign-references'));`))
      .toEqual({ status: 'unread', claims: 0 })
    console.log('NOTIFICATION_OWNERSHIP_NATIVE_PASS neutral_not_found=true partial_mutation=false')
  })

  it('returns completed legacy responses exactly and retains safe failed/processing conflicts', () => {
    const own = fixtureNotifications[0], ref = `notification_${'L'.repeat(32)}`
    const body = { data: { updated_count: 9, notification_references: [ref], read_at: '2026-06-30T12:00:00.000Z' } }
    for (const status of ['completed', 'failed', 'processing']) {
      sql(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status,response_status,response_body)
        VALUES(${quote(own.companyId)},${quote(own.clientId)},${quote(own.customerId)},${quote(route)},${quote(`native-legacy-${status}`)},${quote(requestHash([ref]))},${quote(status)},200,${quote(JSON.stringify(body))}::jsonb); SELECT to_jsonb(true);`)
    }
    expect(execute(own, 'native-legacy-completed', [ref])).toEqual({ statusCode: 200, body, replayed: true })
    error(`SET ROLE service_role; SELECT ${command(own, 'native-legacy-failed', [ref])};`, 'idempotency_previous_attempt_failed')
    error(`SET ROLE service_role; SELECT ${command(own, 'native-legacy-processing', [ref])};`, 'idempotency_in_progress')
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_audit_events WHERE aggregate_id=${quote(own.customerId)}
      AND metadata->>'requestHash'=${quote(requestHash([ref]))};`)).toBe(0)
    console.log('NOTIFICATION_LEGACY_NATIVE_PASS completed_exact=true failed_processing_safe=true')
  })

  it('rolls back notification, claim and audit on late completion/audit faults, then permits the same new key', () => {
    lateFailure('native-late-completion-rollback', 'completion')
    lateFailure('native-late-audit-rollback', 'audit')
    console.log('NOTIFICATION_ROLLBACK_NATIVE_PASS late_completion=true late_audit=true same_key_after_rollback=true')
  })

  it('blocks replay after account/client/scope/identity/tenant revocation and rejects direct unprivileged RPC', () => {
    const own = fixtureNotifications[0]
    const references = [reference(own.companyId, own.read), reference(own.companyId, own.unread)]
    for (const [mutation, denial] of [
      [`UPDATE public.customer_portal_accounts SET is_active=false WHERE company_id=${quote(own.companyId)} AND customer_id=${quote(own.customerId)};`, 'notification_delegation_forbidden'],
      [`UPDATE public.customer_portal_accounts SET role='viewer' WHERE company_id=${quote(own.companyId)} AND customer_id=${quote(own.customerId)};`, 'notification_delegation_forbidden'],
      [`UPDATE public.customer_portal_accounts SET role='billing' WHERE company_id=${quote(own.companyId)} AND customer_id=${quote(own.customerId)};`, 'notification_delegation_forbidden'],
      [`UPDATE public.integration_api_clients SET revoked_at=now() WHERE id=${quote(own.clientId)};`, 'notification_delegation_forbidden'],
      [`UPDATE public.integration_api_clients SET scopes=ARRAY['customer_notifications.read'] WHERE id=${quote(own.clientId)};`, 'notification_delegation_forbidden'],
      [`INSERT INTO public.customer_portal_identities(company_id,customer_id,auth_user_id,customer_portal_user_id,status,provider) VALUES(${quote(own.companyId)},${quote(own.customerId)},${quote(own.subject)},${quote(own.subject)},'disabled','notification-native');`, 'notification_delegation_forbidden'],
      [`UPDATE public.companies SET is_active=false WHERE id=${quote(own.companyId)};`, 'notification_tenant_unavailable'],
    ]) {
      const observed = sql<boolean>(`BEGIN; ${mutation} SET LOCAL ROLE service_role;
        DO $proof$ BEGIN
          BEGIN PERFORM ${command(own, 'native-ordered-reference-hash', references)};
            RAISE EXCEPTION 'revoked_replay_was_not_blocked';
          EXCEPTION WHEN OTHERS THEN IF SQLERRM<>${quote(denial)} THEN RAISE; END IF; END;
          BEGIN PERFORM ${command(own, 'native-revoked-fresh-write', references)};
            RAISE EXCEPTION 'revoked_fresh_write_was_not_blocked';
          EXCEPTION WHEN OTHERS THEN IF SQLERRM<>${quote(denial)} THEN RAISE; END IF; END;
          IF EXISTS(SELECT 1 FROM public.customer_portal_write_idempotency
            WHERE company_id=${quote(own.companyId)} AND idempotency_key='native-revoked-fresh-write')
          THEN RAISE EXCEPTION 'revoked_fresh_write_left_claim'; END IF;
        END; $proof$; SELECT to_jsonb(true); ROLLBACK;`)
      expect(observed).toBe(true)
    }
    for (const role of ['anon', 'authenticated']) {
      error(`SET ROLE ${role}; SELECT ${command(own, 'native-ordered-reference-hash', references)};`, 'permission denied for function gridex_mark_customer_notifications_read_v1')
    }
    error(`SET ROLE service_role; SELECT ${command(own, 'native-malicious-command-flag', references, { verified: true })};`, 'invalid_notification_command')
    expect(execute(own, 'native-ordered-reference-hash', references).replayed).toBe(true)
    console.log('NOTIFICATION_AUTH_NATIVE_PASS account_client_scope_identity_tenant_replay_denied=true viewer_billing_replay_denied=true anon_authenticated_denied=true')
  })

  it('uses the canonical reference index with a large history and rejects generated reference spoofing', () => {
    const own = fixtureNotifications[0]
    sql(`INSERT INTO public.customer_notifications(company_id,customer_id,title)
      SELECT ${quote(own.companyId)},${quote(own.customerId)},'Synthetic indexed history' FROM generate_series(1,25000);
      ANALYZE public.customer_notifications; SELECT to_jsonb(true);`)
    const plan = sql<unknown>(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM public.customer_notifications
      WHERE company_id=${quote(own.companyId)} AND customer_id=${quote(own.customerId)}
        AND notification_reference=ANY(ARRAY[${quote(reference(own.companyId, own.read))}]::text[]);`)
    expect(JSON.stringify(plan)).toContain('customer_notifications_company_customer_reference_uidx')
    error(`INSERT INTO public.customer_notifications(company_id,customer_id,title,notification_reference)
      VALUES(${quote(own.companyId)},${quote(own.customerId)},'Synthetic spoof',${quote(`notification_${'X'.repeat(32)}`)});`, 'cannot insert a non-DEFAULT value into column "notification_reference"')
    console.log('NOTIFICATION_INDEX_NATIVE_PASS history=25000 canonical_index=true reference_spoof_denied=true')
  })
})
