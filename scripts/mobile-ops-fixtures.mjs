// Disposable loopback stack only. Never use against a hosted database.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash, generateKeyPairSync } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const directory = process.argv[2]
assert.ok(directory)
const origin = process.env.NEXT_PUBLIC_SUPABASE_URL
const db = new URL(process.env.DB_URL)
assert.equal(new URL(origin).origin, 'http://127.0.0.1:54321')
assert.equal(db.hostname, '127.0.0.1')
assert.equal(db.port, '54322')
assert.equal(db.pathname, '/postgres')
assert.equal(db.username, 'postgres')
await mkdir(directory, { recursive: true, mode: 0o700 })
if (process.argv.includes('--refresh')) {
  const path = join(directory, 'customers.json')
  const fixture = JSON.parse(await readFile(path, 'utf8'))
  for (const user of [...fixture.customers, fixture.unlinked]) {
    const session = await auth('token?grant_type=password', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, user.login)
    user.accessToken = session.access_token
    fixture.secrets.push(session.access_token)
  }
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 })
  console.log('Refreshed short-lived acceptance sessions after server startup')
  process.exit(0)
}
const company = randomUUID(), client = randomUUID(), receipt = randomUUID()
const run = 'E2E-' + randomUUID()
const apiKey = 'gdxp_' + randomBytes(4).toString('hex').slice(0, 7) + '.' + randomBytes(32).toString('base64url')
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const kid = randomUUID(), issuer = `gridex-tenant:${company}`, audience = `gridex-customer-api:${company}`
const jwk = { ...publicKey.export({ format: 'jwk' }), kid }
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
async function auth(path, key, body) {
  const response = await fetch(origin + '/auth/v1/' + path, {
    method: 'POST', headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  assert.ok(response.ok, 'Auth fixture ' + path.split('?')[0] + ': HTTP ' + response.status)
  return response.json()
}
const users = []
for (const label of ['A', 'B', 'unlinked']) {
  const login = { email: `${run}-${label}@example.invalid`, password: randomBytes(32).toString('base64url') }
  const user = await auth('admin/users', process.env.SUPABASE_SERVICE_ROLE_KEY, { ...login, email_confirm: true })
  const session = await auth('token?grant_type=password', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, login)
  assert.ok(user.email_confirmed_at && session.access_token)
  users.push({ label, userId: user.id, accessToken: session.access_token, login })
}
let sql = `BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},${quote(run)},'active');
INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,profile_key,scopes,launch_ready,launch_blockers,metadata)
VALUES(${quote(client)},${quote(company)},${quote(run)},${quote(apiKey.slice(0,12))},${quote(createHash('sha256').update(apiKey).digest('hex'))},'custom',ARRAY['customer_contracts.read','customer_sites.read','customer_invoices.read'],true,'[]',${json({ provisioning_receipt_id: receipt })});
INSERT INTO public.tenant_website_installation_receipts(id,company_id,api_client_id,idempotency_key,state,receipt_sha256,completed_at)
VALUES(${quote(receipt)},${quote(company)},${quote(client)},${quote(run)},'completed',${quote(createHash('sha256').update(run).digest('hex'))},now());
INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status) VALUES(${quote(company)},'api_sales',true,'ready')
ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
INSERT INTO public.tenant_customer_identity_providers(company_id,kind,display_name,issuer,audience,public_jwk,enforcement)
VALUES(${quote(company)},'tenant_key',${quote(run)},${quote(issuer)},${quote(audience)},${json(jwk)},'enforce');
-- Web's binding surface on this disposable OPS-only database. No device write grant.
CREATE TABLE public.customer_profiles(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, customer_number text UNIQUE, external_customer_id text UNIQUE);
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_profiles FROM anon, authenticated;
GRANT SELECT ON public.customer_profiles TO authenticated;
GRANT ALL ON public.customer_profiles TO service_role;
CREATE POLICY mobile_fixture_own_profile ON public.customer_profiles FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
`
const customers = []
for (const user of users.slice(0, 2)) {
  const customer = randomUUID(), contract = randomUUID(), site = randomUUID(), invoice = randomUUID()
  const number = run + '-' + user.label
  const references = { contracts: 'contract_' + randomBytes(24).toString('base64url'), sites: 'facility_' + randomBytes(24).toString('base64url'), invoices: 'invoice_' + createHash('sha256').update(`gridex-public-reference:v1:${company}:invoice:${invoice}`).digest('base64url').slice(0,32) }
  const display = { contracts: number + '-CONTRACT', sites: number + '-SITE', invoices: number + '-INVOICE' }
  sql += `
INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${quote(customer)},${quote(company)},${quote(number)},${quote(number)},'private');
INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,street,facility_reference) VALUES(${quote(site)},${quote(company)},${quote(customer)},${quote(display.sites)},${quote(display.sites)},${quote(references.sites)});
INSERT INTO public.customer_contracts(id,company_id,customer_id,customer_site_id,contract_name,customer_contract_reference) VALUES(${quote(contract)},${quote(company)},${quote(customer)},${quote(site)},${quote(display.contracts)},${quote(references.contracts)});
INSERT INTO public.customer_invoices(id,company_id,customer_id,invoice_reference,invoice_number,amount_inc_vat,status) VALUES(${quote(invoice)},${quote(company)},${quote(customer)},${quote(references.invoices)},${quote(display.invoices)},${user.label === 'A' ? 111 : 222},'issued');
SELECT public.gridex_approve_portal_claim_v1(${quote(company)},${quote(customer)},${quote(user.userId)},'{}','{}','{}');
INSERT INTO public.customer_portal_identities(company_id,customer_id,api_client_id,external_customer_id,customer_number,auth_user_id,customer_portal_user_id,status,match_strength)
VALUES(${quote(company)},${quote(customer)},${quote(client)},${quote(number)},${quote(number)},${quote(user.userId)},${quote(user.userId)},'active','strong');
INSERT INTO public.customer_profiles(user_id,customer_number,external_customer_id) VALUES(${quote(user.userId)},${quote(number)},${quote(number)});
`
  customers.push({ ...user, references, number, display })
}
sql += 'COMMIT;\nNOTIFY pgrst, \'reload schema\';\n'
const sqlPath = join(directory, 'fixtures.sql')
await writeFile(sqlPath, sql, { mode: 0o600 })
try { execFileSync('psql', [process.env.DB_URL, '-X', '-q', '-v', 'VERBOSITY=sqlstate', '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], { stdio: ['ignore', 'ignore', 'pipe'] }) }
catch (error) { throw new Error('Isolated SQL fixture setup failed: SQLSTATE ' + (String(error.stderr).match(/ERROR:\s+(\w{5})/)?.[1] ?? 'unknown')) }
const env = { GRIDEX_API_KEY: apiKey, GRIDEX_CUSTOMER_ASSERTION_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), GRIDEX_CUSTOMER_ASSERTION_KEY_ID: kid, GRIDEX_CUSTOMER_ASSERTION_ISSUER: issuer, GRIDEX_CUSTOMER_ASSERTION_AUDIENCE: audience, GRIDEX_CUSTOMER_ASSERTION_REQUIRED: 'true' }
await writeFile(join(directory, 'web.env'), Object.entries(env).map(([k,v]) => `export ${k}=${quote(v)}`).join('\n') + '\n', { mode: 0o600 })
await writeFile(join(directory, 'customers.json'), JSON.stringify({ companyId: company, clientId: client, customers, unlinked: users[2], secrets: [apiKey, process.env.SUPABASE_SERVICE_ROLE_KEY, ...users.map(u => u.accessToken)] }), { mode: 0o600 })
console.log('Created two isolated OPS customer graphs, three verified Auth users and ordinary service authentication')
