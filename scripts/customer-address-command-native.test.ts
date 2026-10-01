import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

// This suite is exclusively for the CI-created disposable replay stack. It
// never resets a stack or selects credentials/hosts from application env files.
const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function raw(command: string) {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
      JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('address_native_disposable_ci_only')
  }
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql<T>(command: string): T { return JSON.parse(raw(command)) as T }
function denied(statement: string, code: string) {
  let observed = ''
  try { raw(statement) } catch (error) { observed = String((error as { stderr?: string | Buffer }).stderr ?? '') }
  expect(observed).toContain(code)
}
const companyA = randomUUID(), companyB = randomUUID()
type Actor = { userId: string; sessionId: string }
type Customer = { companyId: string; customerId: string; siteId: string }
type Result = { companyId: string; customerId: string; addressId: string; revision: number; changed: boolean; replayed: boolean }
let actor: Actor
const changes = { type: 'registered', street_1: 'Synthetic street 1', street_2: 'c/o Synthetic', postal_code: '12345',
  city: 'Stockholm', country: 'SE', municipality: 'Stockholm', moved_in_at: '2026-09-01', moved_out_at: null, is_active: true }
function makeActor(lifetime = "interval '1 hour'"): Actor {
  const userId = randomUUID(), sessionId = randomUUID()
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES(${quote(userId)},'authenticated','authenticated',${quote(`${userId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
    VALUES(${quote(userId)},${quote(`${userId}@example.invalid`)},'Synthetic address actor','active');
    INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
    VALUES(${quote(sessionId)},${quote(userId)},now(),now(),clock_timestamp()+${lifetime});
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
    VALUES(${quote(companyA)},${quote(userId)},'support','active',now(),'support',true,now(),'support');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${quote(userId)},${quote(companyA)},id,key FROM public.permissions WHERE key='masterdata.write'; SELECT to_jsonb(true);`)
  return { userId, sessionId }
}
function makeCustomer(companyId = companyA): Customer {
  const customerId = randomUUID(), siteId = randomUUID()
  sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,preferred_language,metadata,email,phone)
    VALUES(${quote(customerId)},${quote(companyId)},${quote(customerId)},'Synthetic address customer','private','sv','{"preserved":"customer"}',
      'customer@example.invalid','0700000000');
    INSERT INTO public.customer_sites(id,company_id,customer_id,facility_reference,street,postal_code,city,country,metadata)
    VALUES(${quote(siteId)},${quote(companyId)},${quote(customerId)},${quote(`synthetic_${siteId}`)},'Synthetic facility 1','54321','Malmö','SE','{"preserved":"facility"}');
    SELECT to_jsonb(true);`)
  return { companyId, customerId, siteId }
}
function command(c: Customer, key: string, revision = 0, addressId: string | null = null,
    fields: Record<string, unknown> = changes, user = actor, extra: Record<string, unknown> = {}) {
  return `public.gridex_change_customer_address_book_v1(${quote(JSON.stringify({ companyId: c.companyId, customerId: c.customerId,
    addressId, actorUserId: user.userId, sessionId: user.sessionId, reason: 'Synthetic authorized address correction',
    expectedRevision: revision, idempotencyKey: key, changes: fields, ...extra }))}::jsonb)`
}
function run(c: Customer, key: string, revision = 0, addressId: string | null = null,
    fields: Record<string, unknown> = changes, user = actor) {
  return sql<Result>(`SET ROLE service_role; SELECT ${command(c, key, revision, addressId, fields, user)};`)
}
function snapshotQuery(c: Customer) {
  return `SELECT jsonb_build_object(
    'customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.id=${quote(c.customerId)}),
    'addresses',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.customer_addresses a WHERE a.customer_id=${quote(c.customerId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_sites s WHERE s.customer_id=${quote(c.customerId)}),
    'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.customer_contacts x WHERE x.customer_id=${quote(c.customerId)}),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.canonical_command_results r
      WHERE r.company_id=${quote(c.companyId)} AND r.command_type='customer.address.book.change.v1' AND r.request_payload->>'customerId'=${quote(c.customerId)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.canonical_domain_events e WHERE e.aggregate_id=${quote(c.customerId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.canonical_event_outbox o
      WHERE o.company_id=${quote(c.companyId)} AND o.payload->>'customerId'=${quote(c.customerId)}),
    'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.canonical_audit_events a WHERE a.aggregate_id=${quote(c.customerId)}));`
}
type Snapshot = { customer: { address_book_revision: number; email: string; phone: string; metadata: unknown }; addresses: Array<Record<string, unknown>>;
  sites: unknown[]; contacts: unknown[]; results: unknown[]; events: unknown[]; outbox: unknown[]; audit: unknown[] }
const snapshot = (c: Customer) => sql<Snapshot>(snapshotQuery(c))
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
    await new Promise(resolve => setTimeout(resolve, 75))
  }
}
function waiting(name: string) {
  return sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
    WHERE application_name=${quote(name)} AND wait_event_type='Lock'));`)
}

describe.sequential('actual OPS customer address-book command', () => {
  beforeAll(() => {
    sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(companyA)},'Synthetic address A','active'),
      (${quote(companyB)},'Synthetic address B','active');
      INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic masterdata write') ON CONFLICT(key) DO NOTHING;
      SELECT to_jsonb(true);`)
    actor = makeActor()
  })

  it('persists every editable field with one revision/result/audit/outbox and replays the same creation exactly', () => {
    const c = makeCustomer(), before = snapshot(c), result = run(c, 'address-native-creation-key')
    expect(result).toMatchObject({ companyId: c.companyId, customerId: c.customerId, revision: 1, changed: true, replayed: false })
    expect(run(c, 'address-native-creation-key')).toEqual({ ...result, replayed: true })
    const after = snapshot(c)
    expect(after.addresses).toHaveLength(1)
    expect(after.addresses[0]).toMatchObject({ ...changes, id: result.addressId, company_id: c.companyId, customer_id: c.customerId,
      created_by: actor.userId, updated_by: actor.userId })
    expect(after.customer).toMatchObject({ address_book_revision: 1, email: 'customer@example.invalid', phone: '0700000000', metadata: { preserved: 'customer' } })
    expect(after.sites).toEqual(before.sites)
    expect(after.contacts).toEqual(before.contacts)
    for (const rows of [after.results, after.events, after.outbox, after.audit]) expect(rows).toHaveLength(1)
    const unchanged = run(c, 'address-native-noop-key', 1, result.addressId)
    expect(unchanged).toEqual({ ...result, changed: false })
    expect(run(c, 'address-native-noop-key', 1, result.addressId)).toEqual({ ...unchanged, replayed: true })
    const final = snapshot(c)
    expect(final.addresses).toEqual(after.addresses)
    expect(final.customer.address_book_revision).toBe(1)
    expect(final.results).toHaveLength(2); expect(final.audit).toHaveLength(2)
    expect(final.events).toHaveLength(1); expect(final.outbox).toHaveLength(1)
    console.log('CUSTOMER_ADDRESS_NATIVE_ATOMIC_PASS fields=true revision=true replay=true noop=true facility_contact_preserved=true')
  })

  it('denies a different payload/key selection/session and stale replay without any second effect', () => {
    const c = makeCustomer(), result = run(c, 'address-native-replay-key'), after = snapshot(c)
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-replay-key', 0, null, { ...changes, city: 'Göteborg' })};`, 'address_book_idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-replay-key', 0, result.addressId)};`, 'address_book_idempotency_conflict')
    const newSession = randomUUID()
    sql(`INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(newSession)},${quote(actor.userId)},now(),now(),now()+interval '1 hour'); SELECT to_jsonb(true);`)
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-replay-key', 0, null, changes, { ...actor, sessionId: newSession })};`, 'address_book_idempotency_conflict')
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-stale-write', 0, result.addressId, { ...changes, city: 'Göteborg' })};`, 'address_book_revision_conflict')
    expect(snapshot(c)).toEqual(after)
    expect(run(c, 'address-native-next-key', 1, result.addressId, { ...changes, city: 'Göteborg' })).toMatchObject({ revision: 2 })
    const updated = snapshot(c)
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-replay-key')};`, 'address_book_revision_conflict')
    expect(snapshot(c)).toEqual(updated)
    console.log('CUSTOMER_ADDRESS_NATIVE_REPLAY_PASS exact_key=true payload_selection_session_conflict=true stale_revision_denied=true')
  })

  it('denies another customer/tenant and facility selection, while facility mirrors use their separate revision', () => {
    const c = makeCustomer(), other = makeCustomer(), foreign = makeCustomer(companyB), facilityId = randomUUID()
    const result = run(other, 'address-native-other-customer-key')
    sql(`INSERT INTO public.customer_addresses(id,company_id,customer_id,type,street_1,city,metadata)
      VALUES(${quote(facilityId)},${quote(c.companyId)},${quote(c.customerId)},'facility','Synthetic facility 1','Malmö',
      jsonb_build_object('customer_site_id',${quote(c.siteId)})); SELECT to_jsonb(true);`)
    const before = snapshot(c)
    expect(before.customer.address_book_revision).toBe(0)
    for (const selected of [result.addressId, facilityId]) denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-wrong-selection-key', 0, selected)};`, 'address_book_selection_conflict')
    denied(`SET ROLE service_role; SELECT ${command({ ...c, companyId: companyB }, 'address-native-wrong-tenant-key')};`, 'address_customer_unavailable')
    denied(`SET ROLE service_role; SELECT ${command(foreign, 'address-native-foreign-customer-key')};`, 'address_actor_forbidden')
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-facility-field-key', 0, null, { ...changes, type: 'facility' })};`, 'invalid_customer_address')
    expect(snapshot(c)).toEqual(before)
    console.log('CUSTOMER_ADDRESS_NATIVE_OWNERSHIP_PASS tenant=true customer=true selected_address=true facility_separate=true')
  })

  it('validates raw service SQL independently of the TypeScript adapter and leaves no partial state', () => {
    const c = makeCustomer(), before = snapshot(c)
    for (const fields of [ { ...changes, street_1: '' }, { ...changes, country: 'se' }, { ...changes, moved_in_at: '2026-02-30' },
      { ...changes, moved_out_at: '2026-08-31' }, { ...changes, invoice_email: 'billing@example.invalid' },
      { ...changes, company_id: companyB }, { ...changes, is_active: 'true' } ]) {
      denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-invalid-fields-key', 0, null, fields)};`, 'invalid_customer_address')
    }
    for (const extra of [{ verified: true }, { expectedRevision: -1 }, { expectedRevision: '0' },
      { sessionId: null }, { addressId: 'invalid-address' }, { actorUserId: 'invalid-actor' }]) {
      denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-invalid-command-key', 0, null, changes, actor, extra)};`, 'invalid_address_command')
    }
    expect(snapshot(c)).toEqual(before)
    console.log('CUSTOMER_ADDRESS_NATIVE_VALIDATION_PASS raw_sql=true no_partial_effect=true domain_fields_rejected=true')
  })

  it('checks live session, actor, membership, permission, customer and tenant before fresh writes and replay', () => {
    const c = makeCustomer(), result = run(c, 'address-native-authority-key'), before = snapshot(c)
    for (const [mutation, code] of [
      [`DELETE FROM auth.sessions WHERE id=${quote(actor.sessionId)};`, 'address_actor_forbidden'],
      [`UPDATE public.user_profiles SET user_status='inactive' WHERE id=${quote(actor.userId)};`, 'address_actor_forbidden'],
      [`UPDATE public.company_memberships SET is_active=false WHERE user_id=${quote(actor.userId)} AND company_id=${quote(c.companyId)};`, 'address_actor_forbidden'],
      [`DELETE FROM public.user_permissions WHERE user_id=${quote(actor.userId)} AND company_id=${quote(c.companyId)};`, 'address_actor_forbidden'],
      [`UPDATE public.customers SET status='archived',archived_at=now() WHERE id=${quote(c.customerId)};`, 'address_customer_unavailable'],
      [`UPDATE public.companies SET is_active=false WHERE id=${quote(c.companyId)};`, 'address_tenant_unavailable'],
    ]) {
      expect(sql<boolean>(`BEGIN; ${mutation} SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${command(c, 'address-native-authority-key')}; RAISE EXCEPTION 'revoked_replay_allowed';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>${quote(code)} THEN RAISE; END IF; END;
        BEGIN PERFORM ${command(c, 'address-native-revoked-fresh-key', 1, result.addressId)}; RAISE EXCEPTION 'revoked_fresh_allowed';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>${quote(code)} THEN RAISE; END IF; END;
        END $proof$; RESET ROLE; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
      expect(snapshot(c)).toEqual(before)
    }
    const otherActor = makeActor()
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-wrong-session-owner', 1, result.addressId, changes, { ...actor, sessionId: otherActor.sessionId })};`, 'address_actor_forbidden')
    console.log('CUSTOMER_ADDRESS_NATIVE_AUTHORITY_PASS fresh_and_replay=true current_session_permission_membership_customer_tenant=true')
  })

  it('rolls back address, customer revision, result and outbox on late audit or outbox failure', () => {
    const c = makeCustomer(), before = snapshot(c)
    for (const table of ['canonical_audit_events', 'canonical_event_outbox']) {
      expect(sql<Snapshot>(`BEGIN; CREATE FUNCTION pg_temp.address_book_fail() RETURNS trigger LANGUAGE plpgsql AS $fail$
        BEGIN RAISE EXCEPTION 'synthetic_late_address_failure'; END $fail$;
        CREATE TRIGGER address_book_native_fail BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.address_book_fail();
        SET LOCAL ROLE service_role; DO $proof$ BEGIN
        BEGIN PERFORM ${command(c, 'address-native-rollback-key')}; RAISE EXCEPTION 'late_failure_did_not_rollback';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'synthetic_late_address_failure' THEN RAISE; END IF; END;
        END $proof$; RESET ROLE; ${snapshotQuery(c)} ROLLBACK;`)).toEqual(before)
      expect(snapshot(c)).toEqual(before)
    }
    expect(run(c, 'address-native-rollback-key')).toMatchObject({ revision: 1, replayed: false })
    console.log('CUSTOMER_ADDRESS_NATIVE_ROLLBACK_PASS late_audit=true late_outbox=true no_revision_result_or_partial_address=true retry=true')
  })

  it('closes client grants and prevents legacy service writers or caller-assigned revisions', () => {
    const c = makeCustomer(), result = run(c, 'address-native-legacy-boundary-key'), before = snapshot(c)
    for (const role of ['anon', 'authenticated']) {
      denied(`SET ROLE ${role}; SELECT ${command(c, 'address-native-low-role-key')};`, 'permission denied')
      denied(`SET ROLE ${role}; UPDATE public.customer_addresses SET city='Forged' WHERE id=${quote(result.addressId)};`, 'permission denied')
      expect(sql<boolean>(`SELECT to_jsonb(has_table_privilege(${quote(role)},'public.customer_addresses','INSERT')
        OR has_table_privilege(${quote(role)},'public.customer_addresses','UPDATE') OR has_table_privilege(${quote(role)},'public.customer_addresses','DELETE'));`)).toBe(false)
      expect(sql<boolean>(`BEGIN; GRANT EXECUTE ON FUNCTION public.gridex_change_customer_address_book_v1(jsonb) TO ${role}; SET LOCAL ROLE ${role};
        DO $proof$ BEGIN BEGIN PERFORM ${command(c, 'address-native-restored-grant-key')}; RAISE EXCEPTION 'restored_grant_bypass';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'address_service_required' THEN RAISE; END IF; END; END $proof$;
        RESET ROLE; SELECT to_jsonb(true); ROLLBACK;`)).toBe(true)
    }
    denied(`SET ROLE service_role; UPDATE public.customer_addresses SET city='Legacy' WHERE id=${quote(result.addressId)};`, 'address_book_command_required')
    denied(`SET ROLE service_role; INSERT INTO public.customer_addresses(company_id,customer_id,type,street_1)
      VALUES(${quote(c.companyId)},${quote(c.customerId)},'registered','Legacy');`, 'address_book_command_required')
    denied(`SET ROLE service_role; DELETE FROM public.customer_addresses WHERE id=${quote(result.addressId)};`, 'address_book_command_required')
    sql(`SET ROLE service_role; UPDATE public.customers SET address_book_revision=999 WHERE id=${quote(c.customerId)}; SELECT to_jsonb(true);`)
    expect(snapshot(c).customer.address_book_revision).toBe(1)
    expect(snapshot(c).addresses).toEqual(before.addresses)
    // A trusted maintenance writer still advances the book version, so it
    // cannot silently overwrite an editor's loaded snapshot.
    sql(`UPDATE public.customer_addresses SET city='Trusted maintenance' WHERE id=${quote(result.addressId)}; SELECT to_jsonb(true);`)
    expect(snapshot(c).customer.address_book_revision).toBe(2)
    denied(`SET ROLE service_role; SELECT ${command(c, 'address-native-maintenance-stale-key', 1, result.addressId)};`, 'address_book_revision_conflict')
    console.log('CUSTOMER_ADDRESS_NATIVE_LEGACY_PASS client_dml_rpc_denied=true service_split_writer_denied=true revision_not_assignable=true trusted_writer_advances=true')
  })

  it('serializes simultaneous identical creation and competing stale edits', async () => {
    const c = makeCustomer(), blocker = connection(`address-blocker-${randomUUID()}`)
    const names = [`address-repeat-${randomUUID()}`, `address-repeat-${randomUUID()}`], writers = names.map(connection)
    try {
      blocker.child.stdin.write(`BEGIN; SELECT address_book_revision FROM public.customers WHERE id=${quote(c.customerId)} FOR UPDATE;`)
      await until(() => blocker.output().stdout.includes('0'), 'customer_lock_not_held')
      for (const writer of writers) writer.child.stdin.end(`SET ROLE service_role; SELECT ${command(c, 'address-native-concurrent-create-key')};`)
      await until(() => names.every(waiting), 'address_creation_writers_not_waiting')
      blocker.child.stdin.end('COMMIT;')
      expect(await blocker.exited).toBe(0)
      expect(await Promise.all(writers.map(writer => writer.exited))).toEqual([0, 0])
      const results = writers.map(writer => JSON.parse(writer.output().stdout.trim()) as Result)
      expect(results[0].addressId).toBe(results[1].addressId)
      expect(results.map(result => result.replayed).sort()).toEqual([false, true])
      const racers = [connection(`address-edit-${randomUUID()}`), connection(`address-edit-${randomUUID()}`)]
      try {
        racers.forEach((writer, index) => writer.child.stdin.end(`SET ROLE service_role; SELECT ${command(c,
          `address-native-race-edit-${index}`, 1, results[0].addressId, { ...changes, city: index ? 'Göteborg' : 'Uppsala' })};`))
        const exits = await Promise.all(racers.map(writer => writer.exited))
        expect(exits.filter(code => code === 0)).toHaveLength(1)
        expect(racers.find((_, index) => exits[index] !== 0)?.output().stderr).toContain('address_book_revision_conflict')
      } finally { racers.forEach(writer => writer.child.kill('SIGTERM')) }
      const after = snapshot(c)
      expect(after.addresses).toHaveLength(1); expect(after.customer.address_book_revision).toBe(2)
      for (const rows of [after.results, after.events, after.outbox, after.audit]) expect(rows).toHaveLength(2)
      console.log('CUSTOMER_ADDRESS_NATIVE_CONCURRENCY_PASS identical_creation_one_effect=true competing_edit_one_success=true')
    } finally { blocker.child.kill('SIGTERM'); writers.forEach(writer => writer.child.kill('SIGTERM')) }
  })

  it('rechecks permission after a blocking grant revocation commits', async () => {
    const c = makeCustomer(), user = makeActor(), before = snapshot(c), blocker = connection(`address-permission-${randomUUID()}`)
    const name = `address-permission-writer-${randomUUID()}`, writer = connection(name)
    try {
      blocker.child.stdin.write(`BEGIN; DELETE FROM public.user_permissions WHERE user_id=${quote(user.userId)} AND company_id=${quote(c.companyId)}; SELECT 'permission_locked';`)
      await until(() => blocker.output().stdout.includes('permission_locked'), 'permission_lock_not_held')
      writer.child.stdin.end(`SET ROLE service_role; SELECT ${command(c, 'address-native-permission-wait-key', 0, null, changes, user)};`)
      await until(() => waiting(name), 'permission_writer_not_waiting')
      blocker.child.stdin.end('COMMIT;'); expect(await blocker.exited).toBe(0)
      expect(await writer.exited).not.toBe(0)
      expect(writer.output().stderr).toContain('address_actor_forbidden')
      expect(snapshot(c)).toEqual(before)
      console.log('CUSTOMER_ADDRESS_NATIVE_PERMISSION_WAIT_PASS revoked_after_lock_wait=true no_effect=true')
    } finally { blocker.child.kill('SIGTERM'); writer.child.kill('SIGTERM') }
  })

  it('rolls back if the live session expires during a late audit lock wait', async () => {
    const c = makeCustomer(), user = makeActor("interval '3 seconds'"), before = snapshot(c)
    const blocker = connection(`address-audit-${randomUUID()}`), name = `address-expiry-writer-${randomUUID()}`, writer = connection(name)
    try {
      blocker.child.stdin.write("BEGIN; LOCK TABLE public.canonical_audit_events IN ACCESS EXCLUSIVE MODE; SELECT 'audit_locked';")
      await until(() => blocker.output().stdout.includes('audit_locked'), 'audit_lock_not_held')
      writer.child.stdin.end(`SET ROLE service_role; SELECT ${command(c, 'address-native-session-expiry-key', 0, null, changes, user)};`)
      await until(() => waiting(name), 'audit_writer_not_waiting')
      await until(() => sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=not_after) FROM auth.sessions WHERE id=${quote(user.sessionId)};`), 'session_did_not_expire')
      blocker.child.stdin.end('COMMIT;'); expect(await blocker.exited).toBe(0)
      expect(await writer.exited).not.toBe(0)
      expect(writer.output().stderr).toContain('address_actor_forbidden')
      expect(snapshot(c)).toEqual(before)
      console.log('CUSTOMER_ADDRESS_NATIVE_CLOCK_WAIT_PASS expired_after_late_audit_wait=true complete_rollback=true')
    } finally { blocker.child.kill('SIGTERM'); writer.child.kill('SIGTERM') }
  })
})
