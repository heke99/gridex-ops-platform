import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
// Only the Next import marker is replaced. Native database, guarded commands,
// resource graph and local Auth remain actual implementations.
vi.mock('server-only', () => ({}))
import { changeCustomerContact } from '@/lib/customer-operations/contactCommand'
import { enqueueCustomerLifecycleNotification, notifyCustomerForLifecycleEvent } from '@/lib/customer-notifications/notificationOrchestrator'
import { fixturePath, proofReference, proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture } from './customer-read-proof-native'

const env = 'GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH'
type Customer = ReadProofFixture['customers'][number] & {
  customerNumber: string; contactId: string; email: string; baselineRevision: number; baselinePhone: string;
  notificationId: string; notificationReference: string;
}
type Fixture = Omit<ReadProofFixture, 'customers'> & { customers: Customer[]; opsSession: string; baseline: unknown }

const verifyAfterHttp = process.env.GRIDEX_REFERENCE_RUNTIME_VERIFY_AFTER_HTTP === '1'
const originalFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'http://127.0.0.1:54321') throw new Error('reference_runtime_external_sender_forbidden')
    return originalFetch(input, init)
  }) as typeof fetch
})
afterAll(() => { globalThis.fetch = originalFetch })

function snapshot(f: ReadProofFixture) {
  const ids = f.customers.map(c => quote(c.customerId)).join(',')
  return proofSql<Record<string, unknown>>(`SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(jsonb_build_object('id',id,'email',email,'phone',phone,'revision',contact_revision) ORDER BY id)
      FROM public.customers WHERE id IN (${ids})),
    'contacts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'customer',customer_id,'email',email,'phone',phone) ORDER BY id),'[]'::jsonb)
      FROM public.customer_contacts WHERE customer_id IN (${ids}) AND is_primary),
    'notifications',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'customer',customer_id,'status',status,'read_at',read_at) ORDER BY id),'[]'::jsonb)
      FROM public.customer_notifications WHERE customer_id IN (${ids})),
    'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId' IN (${ids})
      AND command_type='customer.contact.change.v1'),
    'contactAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id IN (${ids}) AND event_type='CUSTOMER_CONTACT_COMMAND'),
    'notificationAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id IN (${ids}) AND event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND'),
    'contactOutbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId' IN (${ids}) AND topic='customer.contact.changed'),
    'emailOutbox',(SELECT count(*) FROM public.tenant_email_outbox WHERE customer_id IN (${ids})));`)
}

it('seeds an independent real reference-client graph or verifies its committed HTTP effects', async () => {
    if (verifyAfterHttp) {
      const f = readFixture<Fixture>(env), state = snapshot(f), a1 = f.customers[0]
      const rows = proofSql<Array<{ customer: string; revision: number; phone: string; email: string; contactEmail: string; contactPhone: string }>>(`
        SELECT jsonb_agg(jsonb_build_object('customer',c.id,'revision',c.contact_revision,'phone',c.phone,'email',c.email,
          'contactEmail',p.email,'contactPhone',p.phone) ORDER BY c.id)
        FROM public.customers c JOIN public.customer_contacts p ON p.customer_id=c.id AND p.company_id=c.company_id AND p.is_primary
        WHERE c.id IN (${f.customers.map(c => quote(c.customerId)).join(',')});`)
      for (const c of f.customers) expect(rows.find(row => row.customer === c.customerId)).toEqual({
        customer: c.customerId, revision: c.baselineRevision + (c === a1 ? 2 : 0),
        phone: c === a1 ? '+46700006002' : c.baselinePhone, contactPhone: c === a1 ? '+46700006002' : c.baselinePhone,
        email: c.email, contactEmail: c.email,
      })
      const n = proofSql<Array<{ customer: string; status: string; read_at: string | null }>>(`
        SELECT jsonb_agg(jsonb_build_object('customer',customer_id,'status',status,'read_at',read_at) ORDER BY customer_id)
        FROM public.customer_notifications WHERE id IN (${f.customers.map(c => quote(c.notificationId)).join(',')});`)
      for (const c of f.customers) expect(n.find(row => row.customer === c.customerId)).toMatchObject({
        customer: c.customerId, status: c === a1 ? 'read' : 'unread', read_at: c === a1 ? expect.any(String) : null,
      })
      expect(state).toMatchObject({ commands: 3, contactAudits: 3, notificationAudits: 1, contactOutbox: 3, emailOutbox: 0 })
      expect(proofSql<{ accountActive: boolean; clientRevoked: boolean }>(`SELECT jsonb_build_object(
        'accountActive',(SELECT is_active FROM public.customer_portal_accounts WHERE company_id=${quote(a1.companyId)} AND customer_id=${quote(a1.customerId)} AND user_id=${quote(a1.userId)}),
        'clientRevoked',(SELECT revoked_at IS NOT NULL FROM public.integration_api_clients WHERE id=${quote(a1.clientId)}));`))
        .toEqual({ accountActive: false, clientRevoked: true })
      expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(a1.customerId)}
        AND route='/api/v1/customer/profile-update' AND status='completed';`)).toBe(2)
      expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(a1.customerId)}
        AND route='/api/v1/customer/notifications/read' AND status='completed';`)).toBe(1)
      console.log('CUSTOMER_REFERENCE_RUNTIME_POST_NATIVE_PASS actual_customers_contacts_notifications=true phone_effects=2 read_effect=1 replay_duplicates=0 preserved_email=true external_sender=0')
      return
    }

    const base = await seedReadActors('reference-runtime-20260930', '/api/v1/customer/notifications',
      ['customer_profile.read', 'customer_contact.write', 'customer_notifications.read', 'customer_notifications.write'])
    const customers: Customer[] = base.customers.map(c => {
      const contactId = randomUUID(), notificationId = randomUUID(), email = `reference-${c.tag.toLowerCase()}@example.invalid`
      proofSql(`UPDATE public.customers SET email=${quote(email)},phone='+46700006000' WHERE id=${quote(c.customerId)} AND company_id=${quote(c.companyId)};
        INSERT INTO public.customer_contacts(id,company_id,customer_id,type,is_primary,name,email,phone)
          VALUES(${quote(contactId)},${quote(c.companyId)},${quote(c.customerId)},'primary',true,'Synthetic reference contact',${quote(email)},'+46700006000');
        INSERT INTO public.customer_notifications(id,company_id,customer_id,type,title,message,status)
          VALUES(${quote(notificationId)},${quote(c.companyId)},${quote(c.customerId)},'info','Synthetic reference notification','Customer message','unread'); SELECT to_jsonb(true);`)
      const row = proofSql<{ customerNumber: string; baselineRevision: number; baselinePhone: string }>(`SELECT jsonb_build_object(
        'customerNumber',customer_number,'baselineRevision',contact_revision,'baselinePhone',phone) FROM public.customers WHERE id=${quote(c.customerId)};`)
      return { ...c, ...row, contactId, email, notificationId, notificationReference: proofReference('notification', c.companyId, notificationId) }
    })

    // Genuine current-session decision at the native command, including a
    // completed replay after expiry. The API issuer/session is a separate actor.
    const c = customers[1], opsSession = randomUUID()
    proofSql(`INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(${quote(opsSession)},${quote(c.userId)},now(),now(),now()+interval '1 hour');
      INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(c.userId)},${quote(c.email)},'Synthetic reference actor','active')
        ON CONFLICT(id) DO UPDATE SET user_status='active';
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
        VALUES(${quote(c.companyId)},${quote(c.userId)},'support','active',now(),'support',true,now(),'support');
      INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic reference contact permission') ON CONFLICT(key) DO NOTHING;
      INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
        SELECT ${quote(c.userId)},${quote(c.companyId)},id,key,'allow' FROM public.permissions WHERE key='masterdata.write'; SELECT to_jsonb(true);`)
    const command = { companyId: c.companyId, customerId: c.customerId, contactId: c.contactId,
      actor: { kind: 'ops' as const, userId: c.userId, sessionId: opsSession, reason: 'Synthetic current-session reference proof' },
      expectedRevision: c.baselineRevision, idempotencyKey: 'reference-current-session', changes: { phone: '+46700006999' } }
    await expect(changeCustomerContact(command)).resolves.toMatchObject({ changed: true, replayed: false, revision: c.baselineRevision + 1 })
    proofSql(`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=${quote(opsSession)}; SELECT to_jsonb(true);`)
    const beforeReplay = snapshot(base)
    await expect(changeCustomerContact(command)).rejects.toMatchObject({ status: 403 })
    expect(snapshot(base)).toEqual(beforeReplay)
    c.baselineRevision += 1; c.baselinePhone = '+46700006999'
    const f: Fixture = { ...base, customers, opsSession, baseline: snapshot(base) }
    saveFixture(env, f)
    expect(statSync(fixturePath(env)).mode & 0o777).toBe(0o600)
    console.log('CUSTOMER_REFERENCE_RUNTIME_SEED_NATIVE_PASS independent_customers=3 active_client_and_owner=true current_session_replay_expired_denied=true private_key_runner_temp_0600=true external_sender=0')
})

it.skipIf(verifyAfterHttp)('rejects an actual cross-customer lifecycle graph before enqueue or sender configuration', async () => {
  const f = readFixture<Fixture>(env), own = f.customers[0], other = f.customers[1], site = randomUUID()
  proofSql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status,street,postal_code,city,country)
    VALUES(${quote(site)},${quote(other.companyId)},${quote(other.customerId)},'Synthetic foreign notification site','draft','Testgatan 1','12345','Teststad','SE'); SELECT to_jsonb(true);`)
  const input = { companyId: own.companyId, customerId: own.customerId, siteId: site,
    eventType: 'supplier_switch.confirmed', sourceEventId: 'reference-runtime-wrong-customer' }
  await expect(enqueueCustomerLifecycleNotification(input)).resolves.toMatchObject({ queued: false, skippedReason: 'notification_resource_scope_mismatch' })
  await expect(notifyCustomerForLifecycleEvent(input)).resolves.toMatchObject({ queued: false, skippedReason: 'notification_resource_scope_mismatch' })
  expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_operation_jobs WHERE company_id=${quote(own.companyId)} AND job_type='dispatch_lifecycle_notification';`)).toBe(0)
  expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.communication_logs WHERE customer_id=${quote(own.customerId)};`)).toBe(0)
  expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.tenant_email_outbox WHERE customer_id=${quote(own.customerId)};`)).toBe(0)
  console.log('CUSTOMER_REFERENCE_LIFECYCLE_GRAPH_NATIVE_PASS actual_db_foreign_customer_site=denied notification_intent=0 communication=0 email_outbox=0 provider_entry=0')
})
