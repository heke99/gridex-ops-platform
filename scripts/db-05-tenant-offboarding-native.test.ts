// DB-05 (partial; not an approval of DB-05): native PostgreSQL behaviour of the canonical tenant close
// (canonical_transition_tenant_lifecycle) after clean replay. Proves the card's separation: operational wind-down and
// access revoke happen, unsettled billing blocks closure, and journal/customer history and personal fields are kept
// (no purge without a retention-class decision; no cascade delete afterwards). All writes roll back.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'

const psql = (sql: string) => execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8', timeout: 120000,
}).trim()

it('closes a tenant by winding down and revoking access while keeping history, and refuses while billing is unsettled', () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const [company, admin, outsider, member, customer, underlay, realTenant, realCustomer] = Array.from({ length: 8 }, () => randomUUID())
  const counts = `json_build_object(
      'status',(SELECT status FROM public.companies WHERE id='${company}'),
      'apiClient',(SELECT status FROM public.integration_api_clients WHERE company_id='${company}'),
      'webhook',(SELECT status FROM public.webhook_subscriptions WHERE company_id='${company}'),
      'portalIdentity',(SELECT status FROM public.customer_portal_identities WHERE company_id='${company}'),
      'sessions',(SELECT count(*) FROM auth.sessions WHERE user_id='${member}'),
      'customers',(SELECT count(*) FROM public.customers WHERE company_id='${company}'),
      'customerEmail',(SELECT email FROM public.customers WHERE id='${customer}'),
      'customerEvents',(SELECT count(*) FROM public.customer_events WHERE company_id='${company}'),
      'seededAudit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id='${company}' AND idempotency_key='db05-seed'),
      'transitionAudit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id='${company}' AND idempotency_key<>'db05-seed'))`
  const out = psql(`BEGIN;
    CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE r text; BEGIN EXECUTE q INTO r; RETURN coalesce(r,'ok'); EXCEPTION WHEN OTHERS THEN RETURN 'ERR '||SQLSTATE||':'||SQLERRM; END $f$;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('${admin}','db05-admin@example.invalid',now()),('${outsider}','db05-outsider@example.invalid',now()),('${member}','db05-member@example.invalid',now());
    INSERT INTO public.user_profiles(id,user_status) VALUES ('${admin}','active'),('${outsider}','active'),('${member}','active') ON CONFLICT (id) DO UPDATE SET user_status='active';
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES ('${admin}','super_admin',true);
    INSERT INTO public.companies(id,name,status) VALUES ('${company}','Synthetic offboarding','active');
    INSERT INTO public.company_memberships(company_id,user_id,status) VALUES ('${company}','${member}','active');
    INSERT INTO auth.sessions(id,user_id) VALUES (gen_random_uuid(),'${member}');
    INSERT INTO public.integration_api_clients(company_id,name,key_prefix,secret_hash,status) VALUES ('${company}','db05','db05pref','db05hash','active');
    INSERT INTO public.webhook_subscriptions(company_id,name,endpoint_url,status) VALUES ('${company}','db05','https://example.invalid/hook','active');
    INSERT INTO public.customer_portal_identities(company_id,status) VALUES ('${company}','active');
    INSERT INTO public.customers(id,company_id,email) VALUES ('${customer}','${company}','db05-customer@example.invalid');
    INSERT INTO public.customer_events(company_id,customer_id,event_type) VALUES ('${company}','${customer}','customer.created');
    INSERT INTO public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,idempotency_key) VALUES ('${company}','db05.seed','company','${company}','db05-seed');
    INSERT INTO public.billing_underlays(id,company_id,customer_id,status) VALUES ('${underlay}','${company}','${customer}','pending');
    SELECT json_build_object('before',${counts},
      'unauthorised',pg_temp.try($q$SELECT public.canonical_transition_tenant_lifecycle('${company}','closed',(SELECT lifecycle_state_version FROM public.companies WHERE id='${company}'),'db05','${outsider}','db05-outsider')::text$q$),
      'blocked',pg_temp.try($q$SELECT public.canonical_transition_tenant_lifecycle('${company}','closed',(SELECT lifecycle_state_version FROM public.companies WHERE id='${company}'),'db05','${admin}','db05-blocked')::text$q$));
    SELECT json_build_object('afterBlocked',${counts});
    SELECT json_build_object('settle',pg_temp.try($q$UPDATE public.billing_underlays SET status='cancelled' WHERE id='${underlay}' RETURNING status$q$));
    SELECT json_build_object('closed',pg_temp.try($q$SELECT public.canonical_transition_tenant_lifecycle('${company}','closed',(SELECT lifecycle_state_version FROM public.companies WHERE id='${company}'),'db05','${admin}','db05-close')::text$q$));
    SELECT json_build_object('afterClosed',${counts});
    SET LOCAL ROLE service_role;
    SELECT json_build_object('hardDeleteAfterClose',pg_temp.try($q$DELETE FROM public.companies WHERE id='${company}' RETURNING 'deleted'$q$));
    RESET ROLE;
    INSERT INTO public.companies(id,name,status) VALUES ('${realTenant}','Synthetic real tenant','active');
    INSERT INTO public.customers(id,company_id,is_test_data) VALUES ('${realCustomer}','${realTenant}',false);
    INSERT INTO public.customer_events(company_id,customer_id,event_type) VALUES ('${realTenant}','${realCustomer}','customer.created');
    INSERT INTO public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,idempotency_key) VALUES ('${realTenant}','db05.seed','company','${realTenant}','db05-real');
    SELECT json_build_object('toPendingDeletion',pg_temp.try($q$SELECT public.canonical_transition_tenant_lifecycle('${realTenant}','pending_deletion',(SELECT lifecycle_state_version FROM public.companies WHERE id='${realTenant}'),'db05','${admin}','db05-real-pending')::text$q$));
    SELECT json_build_object('toDisposable',pg_temp.try($q$SELECT public.canonical_transition_tenant_lifecycle('${realTenant}','deleted_test_only',(SELECT lifecycle_state_version FROM public.companies WHERE id='${realTenant}'),'db05','${admin}','db05-real-disposable')::text$q$));
    SET LOCAL ROLE service_role;
    SELECT json_build_object('realHardDelete',pg_temp.try($q$DELETE FROM public.companies WHERE id='${realTenant}' RETURNING 'deleted'$q$));
    RESET ROLE;
    SELECT json_build_object('realAfter',json_build_object('status',(SELECT status FROM public.companies WHERE id='${realTenant}'),
      'customers',(SELECT count(*) FROM public.customers WHERE company_id='${realTenant}'),
      'customerEvents',(SELECT count(*) FROM public.customer_events WHERE company_id='${realTenant}'),
      'seededAudit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id='${realTenant}' AND idempotency_key='db05-real')));
    ROLLBACK;`)
  const r = Object.assign({}, ...out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)))
  console.log(JSON.stringify({ kind: 'db05_tenant_offboarding_native', ...r }))
  const parse = (v: string) => (v.startsWith('ERR') ? v : JSON.parse(v))

  expect(r.before).toMatchObject({ status: 'active', apiClient: 'active', webhook: 'active', portalIdentity: 'active', sessions: 1 })
  // Wrong actor: no authority, nothing changes.
  expect(r.unauthorised).toMatch(/^ERR 42501:actor_not_authorized_for_tenant_lifecycle/)
  // Settlement obligation: unsettled billing blocks closure and nothing is wound down.
  expect(parse(r.blocked)).toMatchObject({ changed: false, code: 'tenant_closure_blocked' })
  expect(JSON.stringify(parse(r.blocked))).toContain('tenant_has_unsettled_billing')
  expect(r.afterBlocked).toEqual(r.before)
  expect(r.settle).toBe('cancelled')
  // Operational wind-down + access revoke.
  expect(parse(r.closed)).toMatchObject({ changed: true })
  expect(r.afterClosed).toMatchObject({ status: 'closed', apiClient: 'revoked', webhook: 'disabled', portalIdentity: 'disabled', sessions: 0 })
  // History and personal data are kept: closing is not a purge and not a cascade.
  expect(r.afterClosed).toMatchObject({ customers: 1, customerEmail: 'db05-customer@example.invalid', customerEvents: 1, seededAudit: 1 })
  expect(r.afterClosed.transitionAudit).toBeGreaterThan(r.before.transitionAudit)
  // A closed tenant still cannot be hard-deleted with its history (F-DB-05-01 guard).
  expect(r.hardDeleteAfterClose).toMatch(/^ERR 23001:company_hard_delete_blocked/)
  // Review finding: the canonical pending_deletion -> deleted_test_only path must not turn a real tenant disposable.
  expect(parse(r.toPendingDeletion)).toMatchObject({ changed: true })
  expect(r.toDisposable).toMatch(/^ERR 23001:company_disposable_retained_history/)
  expect(r.realHardDelete).toMatch(/^ERR 23001:company_hard_delete_blocked/)
  expect(r.realAfter).toEqual({ status: 'pending_deletion', customers: 1, customerEvents: 1, seededAudit: 1 })
}, 120000)
