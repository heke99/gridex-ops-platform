import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('local_only')
  const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000,
  }).trim()
  return JSON.parse(output) as T
}

async function actor(tag: string, company: string, keys: string[], membershipRole: string) {
  const email = `p2-contact-${tag}@example.invalid`
  const created = await supabaseService.auth.admin.createUser({
    email, password: process.env.GRIDEX_CONTACT_TEST_PASSWORD!, email_confirm: true,
  })
  if (created.error || !created.data.user) throw created.error ?? new Error('fixture_auth_user_missing')
  const userId = created.data.user.id
  const roleId = randomUUID()
  const roleKey = `p2_contact_${tag.replaceAll('-', '_')}`
  const permissions = keys.map(quote).join(',')
  sql(`
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
      VALUES(${quote(userId)},${quote(email)},'Synthetic contact actor','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope)
      VALUES(${quote(roleId)},${quote(roleKey)},'Synthetic contact role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at)
      VALUES(${quote(company)},${quote(userId)},${quote(membershipRole)},'active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
      VALUES(${quote(userId)},${quote(company)},${quote(roleId)},${quote(roleKey)},'active',true);
    INSERT INTO public.permissions(key,name,description,category)
      SELECT permission_keys.key,permission_keys.key,'Disposable contact fixture permission','test'
      FROM unnest(ARRAY[${permissions}]::text[]) AS permission_keys(key)
      ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key)
      SELECT ${quote(roleId)},${quote(roleKey)},id,key FROM public.permissions WHERE key IN (${permissions});
    SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE role_id=${quote(roleId)};
  `)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE role_id=${quote(roleId)}`)).toBe(keys.length)
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password: process.env.GRIDEX_CONTACT_TEST_PASSWORD! })
  expect(login.error).toBeNull()
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: company })
  expect(context.error).toBeNull()
  expect(context.data).toMatchObject({ authorized: true, selected_company_id: company })
  for (const key of keys) expect((context.data as { permissions: string[] }).permissions).toContain(key)
  return { userId, email }
}

it('uses real local Auth and verifies the browser/API contact result with native database reads', async () => {
  const temp = process.env.RUNNER_TEMP
  const fixturePath = resolve(process.env.GRIDEX_CONTACT_FIXTURE_PATH!)
  if (!temp || !fixturePath.startsWith(resolve(temp) + sep)) throw new Error('fixture_must_stay_in_runner_temp')
  if (process.env.GRIDEX_CONTACT_VERIFY_AFTER_BROWSER === '1') {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      companyA: string; companyB: string; customerA: string; customerB: string
      contactA: string; writerId: string; apiClientId: string; apiKey: string
    }
    const state = sql<{
      revision: number; email: string; phone: string; name: string; contactEmail: string
      contactPhone: string; audit: number; opsAudit: number; apiAudit: number
      domains: number; outbox: number; commands: number; completions: number
      otherPhone: string; otherRevision: number; contaminated: number
    }>(`SELECT jsonb_build_object(
      'revision',(SELECT contact_revision FROM public.customers WHERE id=${quote(fixture.customerA)} AND company_id=${quote(fixture.companyA)}),
      'email',(SELECT email FROM public.customers WHERE id=${quote(fixture.customerA)}),
      'phone',(SELECT phone FROM public.customers WHERE id=${quote(fixture.customerA)}),
      'name',(SELECT name FROM public.customer_contacts WHERE id=${quote(fixture.contactA)}),
      'contactEmail',(SELECT email FROM public.customer_contacts WHERE id=${quote(fixture.contactA)}),
      'contactPhone',(SELECT phone FROM public.customer_contacts WHERE id=${quote(fixture.contactA)}),
      'audit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(fixture.companyA)} AND aggregate_id=${quote(fixture.customerA)} AND event_type='CUSTOMER_CONTACT_COMMAND'),
      'opsAudit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(fixture.companyA)} AND aggregate_id=${quote(fixture.customerA)} AND event_type='CUSTOMER_CONTACT_COMMAND' AND actor_user_id=${quote(fixture.writerId)}),
      'apiAudit',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${quote(fixture.companyA)} AND aggregate_id=${quote(fixture.customerA)} AND event_type='CUSTOMER_CONTACT_COMMAND' AND actor_user_id IS NULL),
      'domains',(SELECT count(*) FROM public.canonical_domain_events WHERE company_id=${quote(fixture.companyA)} AND aggregate_id=${quote(fixture.customerA)} AND event_type='CUSTOMER_CONTACT_CHANGED'),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(fixture.companyA)} AND topic='customer.contact.changed'),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(fixture.companyA)} AND command_type='customer.contact.change.v1'),
      'completions',(SELECT count(*) FROM public.customer_portal_completions WHERE company_id=${quote(fixture.companyA)} AND api_client_id=${quote(fixture.apiClientId)} AND completion_type='profile_update'),
      'otherPhone',(SELECT phone FROM public.customers WHERE id=${quote(fixture.customerB)} AND company_id=${quote(fixture.companyB)}),
      'otherRevision',(SELECT contact_revision FROM public.customers WHERE id=${quote(fixture.customerB)}),
      'contaminated',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(fixture.companyB)} AND command_type='customer.contact.change.v1')
    )`)
    expect(state).toEqual({
      revision: 2, email: 'before@example.invalid', phone: '+46222222222',
      name: 'Synthetic Primary', contactEmail: 'before@example.invalid', contactPhone: '+46222222222',
      audit: 2, opsAudit: 1, apiAudit: 1, domains: 2, outbox: 2, commands: 2,
      completions: 1, otherPhone: '+4600000001', otherRevision: 0, contaminated: 0,
    })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_event_outbox o
      JOIN public.canonical_domain_events e ON e.id=o.domain_event_id AND e.company_id=o.company_id
      WHERE o.company_id=${quote(fixture.companyA)} AND e.aggregate_id=${quote(fixture.customerA)}
        AND o.topic='customer.contact.changed' AND e.aggregate_version IN (1,2)`)).toBe(2)
    console.log('P2_CONTACT_BROWSER_API_NATIVE_PASS')
    return
  }

  const companyA = randomUUID(), companyB = randomUUID()
  const customerA = randomUUID(), customerB = randomUUID(), contactA = randomUUID()
  const customerNumberA = `P2-A-${customerA.slice(0, 8).toUpperCase()}`
  const customerNumberB = `P2-B-${customerB.slice(0, 8).toUpperCase()}`
  sql(`
    INSERT INTO public.companies(id,name,status) VALUES
      (${quote(companyA)},'Synthetic browser contact A','active'),
      (${quote(companyB)},'Synthetic browser contact B','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone)
      VALUES(${quote(customerA)},${quote(companyA)},${quote(customerNumberA)},'Synthetic A','private','Synthetic','Customer','before@example.invalid','+4600000000'),
      (${quote(customerB)},${quote(companyB)},${quote(customerNumberB)},'Synthetic B','private','Other','Customer','other@example.invalid','+4600000001');
    INSERT INTO public.customer_contacts(id,company_id,customer_id,type,is_primary,name,email,phone)
      VALUES(${quote(contactA)},${quote(companyA)},${quote(customerA)},'primary',true,'Synthetic Primary','before@example.invalid','+4600000000');
    SELECT to_jsonb(count(*)) FROM public.customer_contacts WHERE id=${quote(contactA)};
  `)
  const writer = await actor(`writer-${customerA.slice(0, 8)}`, companyA,
    ['customers.read', 'masterdata.read', 'masterdata.write'], 'operations')
  const reader = await actor(`reader-${customerA.slice(0, 8)}`, companyA,
    ['customers.read', 'masterdata.read'], 'viewer')
  const foreignWriter = await actor(`foreign-${customerA.slice(0, 8)}`, companyB,
    ['customers.read', 'masterdata.read', 'masterdata.write'], 'operations')
  const portal = await supabaseService.auth.admin.createUser({
    email: `p2-contact-portal-${customerA.slice(0, 8)}@example.invalid`,
    password: process.env.GRIDEX_CONTACT_TEST_PASSWORD!, email_confirm: true,
  })
  if (portal.error || !portal.data.user) throw portal.error ?? new Error('fixture_portal_user_missing')
  const subject = portal.data.user.id
  const apiClientId = randomUUID()
  const receiptId = randomUUID()
  const apiKey = generateIntegrationApiToken()
  const receiptHash = createHash('sha256').update(`synthetic-contact-receipt:${receiptId}`).digest('hex')
  sql(`
    INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      VALUES(${quote(companyA)},${quote(customerA)},${quote(subject)},${quote(subject)},'active',true,'owner',${quote(`p2-contact-portal-${customerA.slice(0, 8)}@example.invalid`)});
    INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status)
      VALUES(${quote(companyA)},'api_sales',true,'ready')
      ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,launch_ready,launch_blockers,metadata)
      VALUES(${quote(apiClientId)},${quote(companyA)},'Synthetic contact HTTP client',${quote(apiKey.keyPrefix)},${quote(apiKey.secretHash)},'active',ARRAY['customer_contact.write','customer_profile.read'],true,'[]'::jsonb,
        jsonb_build_object('provisioning_receipt_id',${quote(receiptId)}));
    INSERT INTO public.tenant_website_installation_receipts(id,company_id,api_client_id,environment,idempotency_key,state,scopes,receipt_sha256,completed_at)
      VALUES(${quote(receiptId)},${quote(companyA)},${quote(apiClientId)},'development',${quote(`synthetic-contact-${receiptId}`)},'completed',
        ARRAY['customer_contact.write','customer_profile.read'],${quote(receiptHash)},now());
    SELECT to_jsonb(count(*)) FROM public.integration_api_clients WHERE id=${quote(apiClientId)};
  `)
  const apiReadiness = sql<{ auth_outcome: string; error_code: string | null }>(`
    SELECT jsonb_build_object('auth_outcome',auth_outcome,'error_code',error_code)
    FROM public.authenticate_integration_request_v1(
      ${quote(apiKey.keyPrefix)},${quote(apiKey.secretHash)},'/api/v1/customer/profile-update',
      ARRAY[]::text[],ARRAY['customer_contact.write']::text[],null,null,1,60);
  `)
  expect(apiReadiness).toEqual({ auth_outcome: 'allowed', error_code: null })
  const issuer = 'https://identity.example.test/disposable-contact'
  const audience = 'gridex-customer-portal'
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(publicKey)
  const trust = { [apiClientId]: {
    issuer, audience, jwks: { keys: [{ ...jwk, kid: 'disposable-contact', alg: 'RS256', use: 'sig' }] },
    bindings: { [issuer]: { [subject]: customerA } },
  } }
  const sign = (action: string, linkedCustomer = customerA) =>
    new SignJWT({ company_id: companyA, api_client_id: apiClientId, customer_id: linkedCustomer, action })
      .setProtectedHeader({ alg: 'RS256', kid: 'disposable-contact' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey)
  writeFileSync(fixturePath, JSON.stringify({
    companyA, companyB, customerA, customerB, customerNumberB, contactA, writerId: writer.userId,
    writerEmail: writer.email, readerEmail: reader.email, foreignWriterEmail: foreignWriter.email,
    apiClientId, apiKey: apiKey.token, trust,
    apiPostAssertion: await sign('POST /api/v1/customer/profile-update'),
    apiGetAssertion: await sign('GET /api/v1/customer/me'),
    wrongCustomerAssertion: await sign('POST /api/v1/customer/profile-update', customerB),
  }), { mode: 0o600 })
})
