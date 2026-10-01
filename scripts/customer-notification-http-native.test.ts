import { createHash, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { assertLowRoleReadDenied, proofReference, proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture } from './customer-read-proof-native'

const env = 'GRIDEX_NOTIFICATION_READ_FIXTURE_PATH'
const route = '/api/v1/customer/notifications/read'
type NotificationFixture = ReadProofFixture & { notifications: Array<{
  companyId: string; customerId: string; unreadId: string; readId: string; untouchedId: string;
  unreadReference: string; readReference: string; untouchedReference: string;
}>; firstReadAt: string; legacyBody: Record<string, unknown>; rollbackRows: Array<{ id: string; reference: string; target: string }> }
it('seeds real notification HTTP actors and verifies committed notification/claim/audit relationships', async () => {
  if (process.env.GRIDEX_NOTIFICATION_READ_VERIFY_AFTER_HTTP === '1') {
    const f = readFixture<NotificationFixture>(env)
    for (const [index, c] of f.customers.entries()) {
      const n = f.notifications[index]
      const rows = proofSql<Array<{ id: string; status: string; read_at: string | null }>>(`SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'read_at',read_at) ORDER BY id)
        FROM public.customer_notifications WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)};`)
      expect(rows).toHaveLength(index === 0 ? 5 : 3)
      expect(rows.find(r => r.id === n.readId)).toMatchObject({ status: 'read', read_at: f.firstReadAt })
      expect(rows.find(r => r.id === n.unreadId)?.status).toBe('read')
      expect(rows.find(r => r.id === n.untouchedId)).toMatchObject({ status: 'unread', read_at: null })
      const committed = proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency i
        JOIN public.canonical_audit_events a ON a.metadata->>'claimId'=i.id::text AND a.company_id=i.company_id AND a.aggregate_id=i.customer_id
        WHERE i.company_id=${quote(c.companyId)} AND i.api_client_id=${quote(c.clientId)} AND i.customer_id=${quote(c.customerId)}
          AND i.route=${quote(route)} AND i.status='completed' AND a.event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND';`)
      expect(committed).toBe(index === 0 ? 4 : 1)
    }
    expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency
      WHERE company_id=${quote(f.customers[0].companyId)} AND idempotency_key='http-notification-mixed';`)).toBe(0)
    for (const row of f.rollbackRows) expect(proofSql<{ status: string; read_at: string | null }>(`SELECT jsonb_build_object('status',status,'read_at',read_at)
      FROM public.customer_notifications WHERE id=${quote(row.id)};`)).toMatchObject({ status: 'read', read_at: expect.any(String) })
    expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM pg_namespace WHERE nspname=${quote(`notification_http_${f.customers[0].customerId.replaceAll('-', '')}`)};`)).toBe(0)
    console.log('NOTIFICATION_READ_HTTP_POST_NATIVE_PASS customers=3 completed_claims=6 audits=6 first_read_preserved=true mixed_404_untouched=true rollback_same_key_recovery=true')
    return
  }
  const f = await seedReadActors('notification-read', '/api/v1/customer/notifications', ['customer_notifications.read', 'customer_notifications.write'])
  const firstReadAt = '2026-09-29T11:00:00.123456+00:00'
  const notifications = f.customers.map(c => {
    const unreadId = randomUUID(), readId = randomUUID(), untouchedId = randomUUID()
    proofSql(`INSERT INTO public.customer_notifications(id,company_id,customer_id,type,title,message,status,read_at,metadata,created_at) VALUES
      (${quote(unreadId)},${quote(c.companyId)},${quote(c.customerId)},'info','Synthetic unread','Customer message','unread',NULL,'{"private":"must not project"}','2026-09-30 12:00:00+00'),
      (${quote(readId)},${quote(c.companyId)},${quote(c.customerId)},'info','Synthetic read','Customer message','read',${quote(firstReadAt)},'{}','2026-09-30 11:00:00+00'),
      (${quote(untouchedId)},${quote(c.companyId)},${quote(c.customerId)},'info','Synthetic untouched','Customer message','unread',NULL,'{}','2026-09-30 10:00:00+00');
      SELECT to_jsonb(count(*)) FROM public.customer_notifications WHERE customer_id=${quote(c.customerId)};`)
    assertLowRoleReadDenied('customer_notifications', c)
    return { companyId: c.companyId, customerId: c.customerId, unreadId, readId, untouchedId,
      unreadReference: proofReference('notification', c.companyId, unreadId), readReference: proofReference('notification', c.companyId, readId),
      untouchedReference: proofReference('notification', c.companyId, untouchedId) }
  })
  const a1 = f.customers[0], refs = [notifications[0].readReference]
  const rollbackRows = ['completion', 'audit'].map(target => {
    const id = randomUUID()
    proofSql(`INSERT INTO public.customer_notifications(id,company_id,customer_id,type,title,message,status,created_at)
      VALUES(${quote(id)},${quote(a1.companyId)},${quote(a1.customerId)},'info','Synthetic HTTP rollback','Customer message','unread','2026-09-30 09:00:00+00'); SELECT to_jsonb(true);`)
    return { id, reference: proofReference('notification', a1.companyId, id), target }
  })
  const hash = createHash('sha256').update(JSON.stringify({ notification_references: refs })).digest('hex')
  const legacyBody = { data: { updated_count: 0, notification_references: refs, read_at: '2026-09-29T11:00:00.123Z' } }
  for (const status of ['completed', 'failed', 'processing']) proofSql(`INSERT INTO public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,
    idempotency_key,request_hash,status,response_status,response_body) VALUES(${quote(a1.companyId)},${quote(a1.clientId)},${quote(a1.customerId)},${quote(route)},
      ${quote(`http-legacy-${status}`)},${quote(hash)},${quote(status)},${status === 'completed' ? '200' : 'NULL'},${status === 'completed' ? `${quote(JSON.stringify(legacyBody))}::jsonb` : 'NULL'});
    SELECT to_jsonb(count(*)) FROM public.customer_portal_write_idempotency WHERE customer_id=${quote(a1.customerId)};`)
  saveFixture(env, { ...f, notifications, firstReadAt, legacyBody, rollbackRows })
  console.log('NOTIFICATION_READ_HTTP_SEED_NATIVE_PASS customers=3 unread=true already_read=true legacy_completed_failed_processing=true late_fault_rows=2')
})
