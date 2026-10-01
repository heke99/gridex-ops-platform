import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { importJWK, SignJWT } from 'jose'

export function localProofEnabled(flag, fixtureEnv) {
  return process.env.CI === 'true' && process.env[flag] === '1'
    && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
    && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env[fixtureEnv])
}
export function localProofFixture(env) {
  const path = resolve(process.env[env] ?? '')
  if (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) throw new Error('customer_proof_fixture_path_invalid')
  return JSON.parse(readFileSync(path, 'utf8'))
}
export const proofHeaders = (customer, post = false) => ({ authorization: `Bearer ${customer.key}`,
  'x-gridex-customer-assertion': post ? customer.postAssertion : customer.assertion })
// Seeds may precede the Next build. Issue fresh short-lived assertions at the
// real HTTP boundary instead of weakening the runtime's five-minute age guard.
// The synthetic private key exists only in the mode-0600 RUNNER_TEMP fixture.
export async function refreshProofAssertions(f, path) {
  const key = await importJWK(f.proofSigningKey, 'RS256')
  const kid = f.trust[f.customers[0].clientId].jwks.keys[0].kid
  const sign = (c, clientId, action, customerId = c.customerId) => new SignJWT({ company_id: c.companyId,
    api_client_id: clientId, customer_id: customerId, action })
    .setProtectedHeader({ alg: 'RS256', kid }).setIssuer(f.proofIssuer).setAudience('gridex-customer-portal')
    .setSubject(c.userId).setIssuedAt().setExpirationTime('5m').sign(key)
  for (const c of f.customers) {
    c.assertion = await sign(c, c.clientId, `GET ${path}`)
    c.postAssertion = await sign(c, c.clientId, `POST ${path}/read`)
  }
  const a1 = f.customers[0]
  f.wrongActionAssertion = await sign(a1, a1.clientId, 'GET /api/v1/customer/me')
  f.wrongCustomerAssertion = await sign(a1, a1.clientId, `GET ${path}`, f.customers[1].customerId)
  f.noScopeAssertion = await sign(a1, f.noScopeClientId, `GET ${path}`)
}
export async function proofActionHeaders(f, c, method, path) {
  const key = await importJWK(f.proofSigningKey, 'RS256')
  const kid = f.trust[c.clientId].jwks.keys[0].kid
  const assertion = await new SignJWT({ company_id: c.companyId, api_client_id: c.clientId, customer_id: c.customerId,
    action: `${method} ${path}` }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(f.proofIssuer)
    .setAudience('gridex-customer-portal').setSubject(c.userId).setIssuedAt().setExpirationTime('5m').sign(key)
  return { authorization: `Bearer ${c.key}`, 'x-gridex-customer-assertion': assertion }
}
export async function proofGet(request, url, options) {
  try { return await request.get(url, options) } catch { throw new Error('customer_proof_http_get_failed') }
}
export async function proofPost(request, url, options) {
  try { return await request.post(url, options) } catch { throw new Error('customer_proof_http_post_failed') }
}
export const proofQuote = value => `'${String(value).replaceAll("'", "''")}'`
export function localProofSql(command) {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
    || process.env.GRIDEX_E2E_BROWSER_BASE_URL) throw new Error('customer_proof_disposable_stack_required')
  try {
    return JSON.parse(execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
      input: command, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim())
  } catch { throw new Error('customer_proof_database_check_failed') }
}
export async function readAllPages(request, expect, path, customer, fields, suffix = '') {
  const rows = []
  let cursor = null, firstCursor = null, pages = 0
  do {
    const url = `${path}?limit=1${suffix ? `&${suffix}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await proofGet(request, url, { headers: proofHeaders(customer) })
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    const body = await response.json()
    expect(body.contract_schema_version).toBe(response.headers()['x-gridex-contract-version'])
    expect(body.page).toMatchObject({ limit: 1, offset: 0, returned: body.data.length })
    expect(body.data.length).toBeLessThanOrEqual(1)
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(fields.slice().sort())
    const replayResponse = await proofGet(request, url, { headers: proofHeaders(customer) })
    expect(replayResponse.status()).toBe(200)
    const replay = await replayResponse.json()
    expect(replay.data).toEqual(body.data)
    const { next_cursor: nextCursor, ...pageMetadata } = body.page
    const { next_cursor: replayCursor, ...replayMetadata } = replay.page
    expect(replayMetadata).toEqual(pageMetadata)
    expect(replayCursor === null).toBe(nextCursor === null)
    // Authenticated cursors are freshly encrypted with a random IV. Verify
    // that both tokens reach the same continuation, not that their bytes match.
    if (nextCursor !== null) {
      const continuation = token => `${path}?limit=1${suffix ? `&${suffix}` : ''}&cursor=${encodeURIComponent(token)}`
      const firstNext = await proofGet(request, continuation(nextCursor), { headers: proofHeaders(customer) })
      const replayNext = await proofGet(request, continuation(replayCursor), { headers: proofHeaders(customer) })
      expect(firstNext.status()).toBe(200)
      expect(replayNext.status()).toBe(200)
      const firstNextBody = await firstNext.json(), replayNextBody = await replayNext.json()
      expect(replayNextBody.data).toEqual(firstNextBody.data)
      const { next_cursor: firstFollowing, ...firstFollowingMetadata } = firstNextBody.page
      const { next_cursor: replayFollowing, ...replayFollowingMetadata } = replayNextBody.page
      expect(replayFollowingMetadata).toEqual(firstFollowingMetadata)
      expect(replayFollowing === null).toBe(firstFollowing === null)
    }
    rows.push(...body.data)
    cursor = body.page.next_cursor
    if (pages === 0) firstCursor = cursor
    expect(body.page.has_more).toBe(cursor !== null)
    pages++
    expect(pages).toBeLessThanOrEqual(10)
  } while (cursor)
  return { rows, pages, firstCursor }
}
export async function readGuardProof(request, expect, path, f, firstCursor) {
  const [a1, a2, b1] = f.customers
  const anonymous = await proofGet(request, path)
  expect(anonymous.status()).toBe(401)
  for (const headers of [
    { authorization: `Bearer ${a1.key}` },
    { ...proofHeaders(a1), 'x-gridex-customer-assertion': f.wrongActionAssertion },
    { ...proofHeaders(a1), 'x-gridex-customer-assertion': f.wrongCustomerAssertion },
    { ...proofHeaders(a1), 'x-gridex-customer-assertion': b1.assertion },
    { ...proofHeaders(a1), 'x-gridex-customer-number': `forged-${a2.customerId}` },
    { authorization: `Bearer ${f.noScopeKey}`, 'x-gridex-customer-assertion': f.noScopeAssertion },
  ]) {
    const denied = await proofGet(request, path, { headers })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).data).toBeUndefined()
  }
  for (const c of [a2, b1]) {
    const foreign = await proofGet(request, `${path}?cursor=${encodeURIComponent(firstCursor)}`, { headers: proofHeaders(c) })
    expect(foreign.status()).toBe(400)
    expect((await foreign.json()).error.code).toBe('invalid_cursor')
  }
  for (const cursor of ['malformed', f.foreignResourceCursor, `${firstCursor[0] === 'A' ? 'B' : 'A'}${firstCursor.slice(1)}`]) {
    const denied = await proofGet(request, `${path}?cursor=${encodeURIComponent(cursor)}`, { headers: proofHeaders(a1) })
    expect(denied.status()).toBe(400)
    expect((await denied.json()).error.code).toBe('invalid_cursor')
  }
  for (const [query, limit] of [['', 50], ['?limit=0', 50], ['?limit=-1', 50], ['?limit=1.5', 50], ['?limit=invalid', 50], ['?limit=1000', 100]]) {
    const response = await proofGet(request, `${path}${query}`, { headers: proofHeaders(a1) })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.page.limit).toBe(limit)
    expect(body.data).toEqual(a1.expected)
  }
}
export async function revokeReadProof(request, expect, path, f) {
  const [a1, a2, b1] = f.customers
  localProofSql(`UPDATE public.customer_portal_accounts SET status='disabled',is_active=false
    WHERE company_id=${proofQuote(a1.companyId)} AND customer_id=${proofQuote(a1.customerId)} AND user_id=${proofQuote(a1.userId)};
    UPDATE public.integration_api_clients SET status='revoked' WHERE id=${proofQuote(a2.clientId)};
    UPDATE public.integration_api_clients SET scopes='{}'::text[] WHERE id=${proofQuote(b1.clientId)};
    SELECT to_jsonb(true);`)
  for (const c of f.customers) {
    const response = await proofGet(request, path, { headers: proofHeaders(c) })
    expect([401, 403]).toContain(response.status())
    expect((await response.json()).data).toBeUndefined()
  }
}
