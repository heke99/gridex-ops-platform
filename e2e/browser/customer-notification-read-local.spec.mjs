import { test, expect } from '@playwright/test'
import { localProofEnabled, localProofFixture, localProofSql, proofQuote, proofGet, proofPost, proofHeaders, revokeReadProof, refreshProofAssertions } from '../helpers/customer-api-proof.mjs'
const enabled = localProofEnabled('GRIDEX_NOTIFICATION_READ_LOCAL_E2E', 'GRIDEX_NOTIFICATION_READ_FIXTURE_PATH')
test.skip(!enabled, 'Requires the disposable local notification database and signed Auth fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const f = enabled ? localProofFixture('GRIDEX_NOTIFICATION_READ_FIXTURE_PATH') : null
const listPath = '/api/v1/customer/notifications', path = `${listPath}/read`
const post = (request, c, refs, key) => proofPost(request, path, { headers: { ...proofHeaders(c, true), 'idempotency-key': key }, data: { notification_references: refs } })
async function rollbackThroughHttp(request, c, row) {
  const schema = `notification_http_${c.customerId.replaceAll('-', '')}`
  const trigger = `notification_http_${c.customerId.slice(0, 8)}_${row.target}`
  const key = `http-notification-rollback-${row.target}`
  const table = row.target === 'completion' ? 'customer_portal_write_idempotency' : 'canonical_audit_events'
  const condition = row.target === 'completion'
    ? `NEW.company_id=${proofQuote(c.companyId)}::uuid AND NEW.idempotency_key=${proofQuote(key)} AND NEW.status='completed'`
    : `NEW.company_id=${proofQuote(c.companyId)}::uuid AND NEW.event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND'
      AND NEW.aggregate_id=${proofQuote(c.customerId)}::uuid AND EXISTS(SELECT 1 FROM public.customer_portal_write_idempotency
        WHERE id=(NEW.metadata->>'claimId')::uuid AND idempotency_key=${proofQuote(key)})`
  const before = localProofSql(`SELECT jsonb_build_object('row',(SELECT to_jsonb(n) FROM public.customer_notifications n WHERE id=${proofQuote(row.id)}),
    'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${proofQuote(c.companyId)}),
    'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${proofQuote(c.companyId)}));`)
  try {
    localProofSql(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO service_role;
      CREATE FUNCTION ${schema}.fail() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF ${condition} THEN ${row.target === 'completion' ? 'RETURN NULL;' : "RAISE EXCEPTION 'synthetic_http_late_audit_failure';"} END IF; RETURN NEW; END; $fault$;
      REVOKE ALL ON FUNCTION ${schema}.fail() FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${schema}.fail() TO service_role;
      CREATE TRIGGER ${trigger} BEFORE ${row.target === 'completion' ? 'UPDATE' : 'INSERT'} ON public.${table}
        FOR EACH ROW EXECUTE FUNCTION ${schema}.fail(); SELECT to_jsonb(true);`)
    const failed = await post(request, c, [row.reference], key)
    expect(failed.status()).toBe(500)
    const error = await failed.json()
    expect(error.data).toBeUndefined()
    expect(JSON.stringify(error)).not.toMatch(/synthetic_http_late_audit_failure|notification_completion_failed|P0001|claimId/)
    const after = localProofSql(`SELECT jsonb_build_object('row',(SELECT to_jsonb(n) FROM public.customer_notifications n WHERE id=${proofQuote(row.id)}),
      'claims',(SELECT count(*) FROM public.customer_portal_write_idempotency WHERE company_id=${proofQuote(c.companyId)}),
      'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${proofQuote(c.companyId)}));`)
    expect(after).toEqual(before)
  } finally {
    localProofSql(`DROP TRIGGER IF EXISTS ${trigger} ON public.${table}; DROP SCHEMA IF EXISTS ${schema} CASCADE; SELECT to_jsonb(true);`)
  }
  const recovered = await post(request, c, [row.reference], key)
  expect(recovered.status()).toBe(200)
  const body = await recovered.json()
  expect(body.data).toMatchObject({ updated_count: 1, notification_references: [row.reference] })
  const replay = await post(request, c, [row.reference], key)
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data).toEqual(body.data)
}
test('real GET POST replay GET preserves first read time and denies mixed references and revoked replay', async ({ request }) => {
  test.setTimeout(120_000)
  await refreshProofAssertions(f, listPath)
  const [a1, a2, b1] = f.customers, [n1, n2, n3] = f.notifications
  const before = await proofGet(request, listPath, { headers: proofHeaders(a1) })
  expect(before.status()).toBe(200)
  const beforeRows = (await before.json()).data
  expect(beforeRows).toHaveLength(5)
  expect(beforeRows.find(r => r.notification_reference === n1.readReference).read_at).toBe(f.firstReadAt)
  for (const row of beforeRows) {
    expect(Object.keys(row).sort()).toEqual(['notification_reference', 'type', 'title', 'message', 'status', 'read_at', 'created_at'].sort())
    expect(row.notification_reference).toMatch(/^notification_[A-Za-z0-9_-]{32}$/)
  }
  expect(JSON.stringify(beforeRows)).not.toMatch(/must not project|metadata|company_id|customer_id|action_url/)
  const anonymous = await proofPost(request, path, { data: { notification_references: [n1.unreadReference] } })
  expect(anonymous.status()).toBe(401)
  for (const headers of [
    { authorization: `Bearer ${a1.key}` },
    { ...proofHeaders(a1, true), 'x-gridex-customer-assertion': f.wrongActionAssertion },
    { ...proofHeaders(a1, true), 'x-gridex-customer-assertion': b1.postAssertion },
    { authorization: `Bearer ${f.noScopeKey}`, 'x-gridex-customer-assertion': f.noScopeAssertion },
  ]) {
    const denied = await proofPost(request, path, { headers: { ...headers, 'idempotency-key': 'http-notification-denied' }, data: { notification_references: [n1.unreadReference] } })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).data).toBeUndefined()
  }
  const refs = [n1.unreadReference, n1.readReference]
  const responses = await Promise.all([post(request, a1, refs, 'http-notification-first'), post(request, a1, refs, 'http-notification-first')])
  for (const response of responses) expect(response.status()).toBe(200)
  const bodies = await Promise.all(responses.map(response => response.json()))
  expect(bodies[0].data).toEqual(bodies[1].data)
  expect(bodies[0].data).toMatchObject({ updated_count: 1, notification_references: refs })
  const replay = await post(request, a1, refs, 'http-notification-first')
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data).toEqual(bodies[0].data)
  const after = await proofGet(request, listPath, { headers: proofHeaders(a1) })
  expect(after.status()).toBe(200)
  const afterRows = (await after.json()).data
  expect(afterRows.find(r => r.notification_reference === n1.readReference).read_at).toBe(f.firstReadAt)
  const persistedReadAt = afterRows.find(r => r.notification_reference === n1.unreadReference).read_at
  expect(new Date(persistedReadAt).getTime()).toBe(new Date(bodies[0].data.read_at).getTime())
  const zero = await post(request, a1, refs, 'http-notification-zero')
  expect(zero.status()).toBe(200)
  expect((await zero.json()).data.updated_count).toBe(0)
  const unchanged = await proofGet(request, listPath, { headers: proofHeaders(a1) })
  expect(unchanged.status()).toBe(200)
  expect((await unchanged.json()).data).toEqual(afterRows)
  const conflict = await post(request, a1, [n1.readReference], 'http-notification-first')
  expect(conflict.status()).toBe(409)
  expect((await conflict.json()).error.code).toBe('idempotency_conflict')
  for (const foreign of [n2.untouchedReference, n3.untouchedReference]) {
    const mixed = await post(request, a1, [n1.untouchedReference, foreign], 'http-notification-mixed')
    expect(mixed.status()).toBe(404)
    expect((await mixed.json()).error.code).toBe('notification_reference_not_found')
    expect(localProofSql(`SELECT jsonb_build_object('status',status,'read_at',read_at) FROM public.customer_notifications WHERE id=${proofQuote(n1.untouchedId)};`))
      .toEqual({ status: 'unread', read_at: null })
  }
  for (const [status, code] of [['completed', null], ['failed', 'idempotency_previous_attempt_failed'], ['processing', 'idempotency_in_progress']]) {
    const legacy = await post(request, a1, [n1.readReference], `http-legacy-${status}`)
    expect(legacy.status()).toBe(status === 'completed' ? 200 : 409)
    const body = await legacy.json()
    if (code) expect(body.error.code).toBe(code)
    else expect(body.data).toEqual(f.legacyBody.data)
  }
  for (const row of f.rollbackRows) await rollbackThroughHttp(request, a1, row)
  for (const [c, n] of [[a2, n2], [b1, n3]]) {
    const saved = await post(request, c, [n.unreadReference], `http-notification-${c.tag}`)
    expect(saved.status()).toBe(200)
    expect((await saved.json()).data.updated_count).toBe(1)
  }
  await revokeReadProof(request, expect, listPath, f)
  for (const [c, key, submitted] of [[a1, 'http-notification-first', refs], [a1, 'http-legacy-completed', [n1.readReference]], [a2, 'http-notification-A2', [n2.unreadReference]], [b1, 'http-notification-B1', [n3.unreadReference]]]) {
    const denied = await post(request, c, submitted, key)
    expect([401, 403]).toContain(denied.status())
    expect((await denied.json()).data).toBeUndefined()
  }
  console.log('NOTIFICATION_READ_HTTP_NATIVE_PASS customers=3 doubleclick=true get_post_replay_get=true payload_conflict=true mixed_404=true first_read_microseconds=true legacy_claims=true late_completion_and_audit_rollback=true same_key_recovery=true current_replay_auth=true')
})
