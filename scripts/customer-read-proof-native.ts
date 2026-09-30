/** Helpers for synthetic data in the existing disposable CI replay. No reset. */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createServer } from 'node:net'
import { PostgrestClient } from '@supabase/postgrest-js'
const legacyReadClient = (url: string, schema: string) => new PostgrestClient(url, { schema, retry: false, timeout: 10_000 })
export type LegacyReadClient = ReturnType<typeof legacyReadClient>
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { supabaseService } from '@/lib/supabase/service'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'
import { encodePortalCursor } from '@/lib/customer-portal/keysetPagination'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
export function proofSql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('disposable_local_only')
  try {
    const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
      input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return JSON.parse(output) as T
  } catch {
    // psql errors can include seeded credentials or complete assertions. Keep
    // the original details inside the disposable runner, never its test log.
    throw new Error('customer_api_proof_database_failed')
  }
}
export function fixturePath(env: string): string {
  const path = resolve(process.env[env] ?? '')
  if (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) {
    throw new Error('customer_api_fixture_must_stay_in_runner_temp')
  }
  return path
}
export function saveFixture(env: string, fixture: unknown) {
  writeFileSync(fixturePath(env), JSON.stringify(fixture), { mode: 0o600 })
}
export function readFixture<T>(env: string): T {
  return JSON.parse(readFileSync(fixturePath(env), 'utf8')) as T
}
export function sourceSnapshot(table: string, companies: string[]): string {
  if (!['customer_legal_acceptances', 'normalized_metering_values', 'customer_notifications'].includes(table)) throw new Error('unknown_proof_source')
  return createHash('sha256').update(JSON.stringify(proofSql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)
    FROM public.${table} t WHERE company_id IN (${companies.map(quote).join(',')});`))).digest('hex')
}
export function proofReference(kind: string, companyId: string, id: string): string {
  return `${kind}_${createHash('sha256').update(`gridex-public-reference:v1:${companyId}:${kind}:${id}`).digest('base64url').slice(0, 32)}`
}
export type ReadProofCustomer = {
  companyId: string; customerId: string; tag: string; userId: string; clientId: string;
  key: string; assertion: string; postAssertion: string; expected: Array<Record<string, unknown>>;
}
export type ReadProofFixture = {
  companies: string[]; customers: ReadProofCustomer[]; trust: Record<string, unknown>; sourceHash: string;
  wrongActionAssertion: string; wrongCustomerAssertion: string; noScopeKey: string; noScopeAssertion: string;
  foreignResourceCursor: string;
  proofIssuer: string; proofSigningKey: Record<string, unknown>; noScopeClientId: string;
}
export async function seedReadActors(kind: string, path: string, scopes: string[]): Promise<ReadProofFixture> {
  const companyA = randomUUID(), companyB = randomUUID()
  const customers = [
    { companyId: companyA, customerId: randomUUID(), tag: 'A1' },
    { companyId: companyA, customerId: randomUUID(), tag: 'A2' },
    { companyId: companyB, customerId: randomUUID(), tag: 'B1' },
  ]
  proofSql(`INSERT INTO public.companies(id,name,status) VALUES
    (${quote(companyA)},${quote(`Synthetic ${kind} HTTP A`)},'active'),(${quote(companyB)},${quote(`Synthetic ${kind} HTTP B`)},'active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
    ${customers.map(c => `(${quote(c.customerId)},${quote(c.companyId)},${quote(`${kind}-${c.tag}-${c.customerId.slice(0, 8)}`)},'Synthetic API proof customer','private')`).join(',')};
    SELECT to_jsonb(count(*)) FROM public.customers WHERE company_id IN (${quote(companyA)},${quote(companyB)});`)
  const issuer = `https://identity.example.test/disposable-${kind}`
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...await exportJWK(publicKey), kid: `disposable-${kind}`, alg: 'RS256', use: 'sig' }
  const subjects: Record<string, string> = {}
  for (const c of customers) {
    const email = `${kind}-${c.customerId.slice(0, 8)}@example.invalid`
    const user = await supabaseService.auth.admin.createUser({ email, password: randomBytes(24).toString('base64url'), email_confirm: true })
    if (user.error || !user.data.user) throw new Error('customer_api_proof_auth_seed_failed')
    subjects[c.tag] = user.data.user.id
    proofSql(`INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      VALUES(${quote(c.companyId)},${quote(c.customerId)},${quote(user.data.user.id)},${quote(user.data.user.id)},'active',true,'owner',${quote(email)});
      SELECT to_jsonb(count(*)) FROM public.customer_portal_accounts WHERE customer_id=${quote(c.customerId)};`)
  }
  const trust: Record<string, unknown> = {}
  const clients: Array<{ id: string; companyId: string; key: string; tag: string }> = []
  // Each customer has its own client: scope/client revocation probes cannot affect siblings.
  for (const c of [...customers, { ...customers[0], tag: 'noScope' }]) {
    const id = randomUUID(), receiptId = randomUUID(), key = generateIntegrationApiToken()
    const clientScopes = c.tag === 'noScope' ? ['customer_profile.read'] : scopes
    const scopeSql = clientScopes.map(quote).join(',')
    proofSql(`INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status)
      VALUES(${quote(c.companyId)},'api_sales',true,'ready') ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
      INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,launch_ready,launch_blockers,metadata)
      VALUES(${quote(id)},${quote(c.companyId)},'Synthetic customer read client',${quote(key.keyPrefix)},${quote(key.secretHash)},'active',ARRAY[${scopeSql}]::text[],true,'[]'::jsonb,
        jsonb_build_object('provisioning_receipt_id',${quote(receiptId)}));
      INSERT INTO public.tenant_website_installation_receipts(id,company_id,api_client_id,environment,idempotency_key,state,scopes,receipt_sha256,completed_at)
      VALUES(${quote(receiptId)},${quote(c.companyId)},${quote(id)},'development',${quote(`synthetic-${kind}-${receiptId}`)},'completed',ARRAY[${scopeSql}]::text[],
        ${quote(createHash('sha256').update(receiptId).digest('hex'))},now()); SELECT to_jsonb(count(*)) FROM public.integration_api_clients WHERE id=${quote(id)};`)
    trust[id] = { issuer, audience: 'gridex-customer-portal', jwks: { keys: [jwk] },
      bindings: { [issuer]: Object.fromEntries(customers.filter(x => x.companyId === c.companyId).map(x => [subjects[x.tag], x.customerId])) } }
    clients.push({ id, companyId: c.companyId, key: key.token, tag: c.tag })
  }
  const sign = (client: typeof clients[number], c: typeof customers[number], action: string, customerId = c.customerId) =>
    new SignJWT({ company_id: client.companyId, api_client_id: client.id, customer_id: customerId, action })
      .setProtectedHeader({ alg: 'RS256', kid: `disposable-${kind}` }).setIssuer(issuer).setAudience('gridex-customer-portal')
      .setSubject(subjects[c.tag]).setIssuedAt().setExpirationTime('5m').sign(privateKey)
  const saved = await Promise.all(customers.map(async c => {
    const client = clients.find(x => x.tag === c.tag)!
    return { ...c, userId: subjects[c.tag], clientId: client.id, key: client.key,
      assertion: await sign(client, c, `GET ${path}`), postAssertion: await sign(client, c, `POST ${path}/read`), expected: [] }
  }))
  const noScope = clients.find(c => c.tag === 'noScope')!, a1 = clients.find(c => c.tag === 'A1')!
  return { companies: [companyA, companyB], customers: saved, trust, sourceHash: '',
    wrongActionAssertion: await sign(a1, customers[0], 'GET /api/v1/customer/me'),
    wrongCustomerAssertion: await sign(a1, customers[0], `GET ${path}`, customers[1].customerId),
    noScopeKey: noScope.key, noScopeAssertion: await sign(noScope, customers[0], `GET ${path}`),
    proofIssuer: issuer, proofSigningKey: await exportJWK(privateKey), noScopeClientId: noScope.id,
    foreignResourceCursor: encodePortalCursor({ companyId: companyA, customerId: customers[0].customerId,
      resource: 'foreign-proof-resource', tuple: { orderValue: '2026-09-30T10:00:00.123456Z', id: randomUUID() } }) }
}
export function assertLowRoleReadDenied(table: string, c: ReadProofCustomer): void {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('disposable_local_only')
  if (!['customer_legal_acceptances', 'normalized_metering_values', 'customer_notifications'].includes(table)) throw new Error('unknown_proof_source')
  for (const role of ['anon', 'authenticated']) {
    let count: number
    try {
      const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'], input: `BEGIN; SET LOCAL ROLE ${role};
        SET LOCAL request.jwt.claims = ${quote(JSON.stringify({ sub: c.userId, role }))};
        SELECT to_jsonb(count(*)) FROM public.${table} WHERE company_id=${quote(c.companyId)}; ROLLBACK;` })
      count = JSON.parse(output.trim()) as number
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (!/permission denied/.test(stderr)) throw new Error('low_role_read_probe_failed')
      continue
    }
    if (count !== 0) throw new Error(`customer_api_direct_${role}_read_exposed`)
  }
}

/** Real PostgreSQL/PostgREST against an exclusive old-shape schema. Public
 * migrations, shared rest configuration and source rows are never altered.
 * The disposable Supabase stack already has the pinned PostgREST image. */
export async function withLegacyReadDatabase<T>(kind: 'legal' | 'metering',
  run: (database: { schema: string; client: LegacyReadClient }) => Promise<T>,
  prepare: (schema: string) => void): Promise<T> {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.GRIDEX_NATIVE_STATUS) {
    throw new Error('legacy_read_disposable_stack_required')
  }
  const suffix = randomUUID().replaceAll('-', '')
  const schema = `customer_${kind}_read_legacy_${suffix}`
  const container = `gridex-${kind}-read-legacy-${suffix}`
  const executeDocker = (args: string[]) => {
    try { return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
    catch { throw new Error('legacy_read_postgrest_container_failed') }
  }
  const images = executeDocker(['ps', '--filter', 'name=supabase_rest_', '--format', '{{.Image}}']).split('\n').filter(Boolean)
  if (images.length !== 1) throw new Error('legacy_read_requires_one_disposable_postgrest_image')
  const port = await new Promise<number>((resolvePort, reject) => {
    const socket = createServer()
    socket.on('error', reject).listen(0, '127.0.0.1', () => {
      const address = socket.address()
      if (!address || typeof address === 'string') { socket.close(); reject(new Error('legacy_read_port_unavailable')); return }
      socket.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
  proofSql(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO service_role; SELECT to_jsonb(true);`)
  let started = false
  try {
    prepare(schema)
    executeDocker(['run', '--detach', '--rm', '--name', container, '--network', 'host',
      '--env', `PGRST_DB_URI=${DB}`, '--env', `PGRST_DB_SCHEMAS=${schema}`,
      '--env', 'PGRST_DB_ANON_ROLE=service_role', '--env', 'PGRST_SERVER_HOST=127.0.0.1', '--env', `PGRST_SERVER_PORT=${port}`, images[0]])
    started = true
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15_000
    let ready = false
    while (Date.now() < deadline) {
      try { ready = (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok } catch { ready = false }
      if (ready) break
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
    if (!ready) throw new Error('legacy_read_postgrest_not_ready')
    return await run({ schema, client: legacyReadClient(url, schema) })
  } finally {
    try { if (started) executeDocker(['rm', '--force', container]) }
    finally { proofSql(`DROP SCHEMA ${schema} CASCADE; SELECT to_jsonb(true);`) }
  }
}
