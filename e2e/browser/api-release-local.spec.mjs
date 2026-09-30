import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { runConfiguredCustomerRead } from '../../scripts/tenantservice/customer-api-reference.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
// Pin each run to the committed active artifact and require its paired frozen
// release. A later root-owned release does not require editing this proof.
const version = JSON.parse(readFileSync(resolve(root, 'docs/openapi/website-integration-v1.json'), 'utf8')).info.version
const localOrigin = 'http://127.0.0.1:3000'
const productionOrigin = 'https://app.gridex.se'
const contracts = [
  { key: 'website', name: 'website-integration-v1' },
  { key: 'customer_portal', name: 'customer-portal-v1' },
]
const read = path => readFileSync(resolve(root, path))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const etag = bytes => `"${createHash('sha256').update(bytes).digest('base64url')}"`
const releaseRoot = resolve(root, 'docs/openapi/releases')
const routeRoot = resolve(root, 'app/api/v1/openapi')
const releaseVersions = readdirSync(releaseRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
const routeVersions = readdirSync(routeRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(entry.name))
  .map(entry => entry.name).sort()
const paired = releaseVersions.flatMap(release => contracts.map(contract => ({
  ...contract, version: release,
  file: `docs/openapi/releases/${release}/${contract.name}.json`,
  route: `/api/v1/openapi/${release}/${contract.name}.json`,
})))

// Public HTTP proof against the actual local Next server, without a fake route,
// fixture API, module mock or hosted target. This is not interactive UI proof.
test.skip(Boolean(process.env.GRIDEX_E2E_BROWSER_BASE_URL), 'Requires the existing disposable local Next server configuration.')
test.describe.configure({ retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test.beforeEach(async ({ baseURL }) => {
  expect(baseURL).toBe(localOrigin)
  expect(version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
})

async function jsonDocument(request, path) {
  expect(path).toMatch(/^\/api\/v1\/openapi\//)
  const response = await request.get(path, { maxRedirects: 0, timeout: 45_000 })
  expect(response.status(), path).toBe(200)
  expect(new URL(response.url()).origin).toBe(localOrigin)
  expect(response.headers()['content-type']).toMatch(/^application\/json\b/)
  const bytes = await response.body()
  expect(response.headers().etag).toBe(etag(bytes))
  return { response, bytes, document: JSON.parse(bytes.toString('utf8')) }
}

function localManifestPath(value, expectedPath) {
  const url = new URL(value)
  expect(url.origin).toBe(productionOrigin)
  expect(url.search).toBe('')
  expect(url.hash).toBe('')
  expect(url.pathname).toBe(expectedPath)
  // Inspect canonical manifest metadata, but request its path on localhost.
  // A manifest URL can never authorize an external request in this proof.
  return url.pathname
}

test('actual active manifest, canonical and immutable HTTP bytes equal the exact release artifacts', async ({ request }) => {
  test.setTimeout(180_000)
  const { response: manifestResponse, document: manifest } = await jsonDocument(request, '/api/v1/openapi/release-manifest.json')
  expect(manifestResponse.headers()['cache-control']).toContain('no-store')
  for (const field of ['release_version', 'website_openapi_version', 'customer_portal_openapi_version',
    'runtime_contract_version', 'guide_version', 'minimum_tenant_integration_version']) {
    expect(manifest[field], field).toBe(version)
  }
  expect(Object.keys(manifest.specifications).sort()).toEqual(contracts.map(contract => contract.key).sort())
  const evidence = []
  for (const contract of contracts) {
    const release = manifest.specifications[contract.key]
    const expectedBytes = read(`docs/openapi/releases/${version}/${contract.name}.json`)
    expect(read(`docs/openapi/${contract.name}.json`).equals(expectedBytes), `${contract.name} current/release input bytes`).toBe(true)
    expect(release.contract_name).toBe(contract.name)
    expect(release.contract_version).toBe(version)
    const canonicalPath = localManifestPath(release.url, `/api/v1/openapi/${contract.name}.json`)
    const immutablePath = localManifestPath(release.immutable_url, `/api/v1/openapi/${version}/${contract.name}.json`)
    const canonical = await jsonDocument(request, canonicalPath)
    const immutable = await jsonDocument(request, immutablePath)
    for (const target of [canonical, immutable]) {
      expect(target.document.info.version).toBe(version)
      expect(target.document['x-contract-schema-version']).toBe(version)
      expect(target.response.headers()['x-gridex-contract-version']).toBe(version)
      expect.soft(sha256(target.bytes), `${target.response.url()} exact artifact SHA256`).toBe(sha256(expectedBytes))
      expect.soft(target.bytes.equals(expectedBytes), `${target.response.url()} exact artifact bytes`).toBe(true)
    }
    expect(canonical.response.headers()['cache-control']).toContain('no-store')
    expect(immutable.response.headers()['cache-control']).toContain('immutable')
    expect(immutable.response.headers()['cache-control']).toContain('max-age=31536000')
    expect(canonical.bytes.equals(immutable.bytes), `${contract.name} active/immutable HTTP bytes`).toBe(true)
    expect.soft(release.sha256, `${contract.name} manifest SHA256 of immutable artifact`).toBe(sha256(expectedBytes))
    expect(release.sha256).toBe(sha256(canonical.bytes))
    const cached = await request.get(immutablePath, { headers: { 'if-none-match': immutable.response.headers().etag }, maxRedirects: 0 })
    expect(cached.status()).toBe(304)
    expect((await cached.body()).length).toBe(0)
    evidence.push({ contract: contract.key, artifact_sha256: sha256(expectedBytes),
      canonical_sha256: sha256(canonical.bytes), immutable_sha256: sha256(immutable.bytes), manifest_sha256: release.sha256 })
  }
  console.log(`API_RELEASE_ACTIVE_HTTP_EVIDENCE ${JSON.stringify(evidence)}`)
  if (test.info().errors.length === 0) console.log('API_RELEASE_ACTIVE_HTTP_PASS exact_artifacts=true canonical_immutable_manifest=true etag_304=true')
})

test('every actual paired historical OpenAPI route serves its frozen artifact bytes', async ({ request }) => {
  test.setTimeout(300_000)
  expect(routeVersions).toEqual(releaseVersions)
  const issues = [], evidence = []
  for (const contract of paired) {
    expect(existsSync(resolve(root, contract.file)), contract.file).toBe(true)
    expect(existsSync(resolve(routeRoot, contract.version, `${contract.name}.json/route.ts`)), contract.route).toBe(true)
    const expectedBytes = read(contract.file)
    const served = await jsonDocument(request, contract.route)
    expect(served.document.info.version, contract.route).toBe(contract.version)
    expect(served.response.headers()['cache-control'], contract.route).toContain('immutable')
    const record = { path: contract.route, artifact_sha256: sha256(expectedBytes), served_sha256: sha256(served.bytes),
      exact_bytes: served.bytes.equals(expectedBytes) }
    evidence.push(record)
    if (!record.exact_bytes) issues.push(record)
    expect(sha256(read(contract.file)), `${contract.file} frozen file remains unchanged`).toBe(record.artifact_sha256)
  }
  console.log(`API_RELEASE_HISTORICAL_HTTP_EVIDENCE ${JSON.stringify({ paired_routes: paired.length, mismatches: issues.length, records: evidence })}`)
  expect(issues, 'Actual immutable HTTP must preserve every frozen artifact, without normalizing historical metadata at serving time.').toEqual([])
  console.log(`API_RELEASE_HISTORICAL_HTTP_PASS paired_routes=${paired.length} exact_artifacts=true frozen_inputs_unchanged=true`)
})

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
function operations(document) {
  return Object.entries(document.paths).flatMap(([path, item]) => Object.keys(item)
    .filter(method => methods.has(method)).map(method => `${method.toUpperCase()} ${path}`))
}
function unescapeHtml(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) =>
    String.fromCodePoint(code.startsWith('x') ? parseInt(code.slice(1), 16) : Number(code)))
    .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim()
}
function renderedEndpointRows(html, id) {
  const section = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1]
  expect(section, `actual guide section ${id}`).toBeDefined()
  const body = section.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1]
  expect(body, `actual guide endpoint table ${id}`).toBeDefined()
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match => {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => unescapeHtml(cell[1]))
    expect(cells).toHaveLength(4)
    return `${cells[0]} ${cells[1]}`
  }).sort()
}

test('the actual served guide and active reference-client resources match the served release operations', async ({ request }) => {
  test.setTimeout(180_000)
  const website = await jsonDocument(request, '/api/v1/openapi/website-integration-v1.json')
  const portal = await jsonDocument(request, '/api/v1/openapi/customer-portal-v1.json')
  const response = await request.get('/developers/customer-portal-api', { maxRedirects: 0, timeout: 45_000 })
  expect(response.status()).toBe(200)
  expect(new URL(response.url()).origin).toBe(localOrigin)
  expect(response.headers()['content-type']).toContain('text/html')
  const html = await response.text()
  expect(unescapeHtml(html)).toContain(`Gridex Developers · API contract ${version}`)
  for (const contract of contracts) {
    expect(html).toContain(`href="${productionOrigin}/api/v1/openapi/${contract.name}.json"`)
  }
  const all = [...new Set([...operations(website.document), ...operations(portal.document)])]
  const customerResource = path => path.startsWith('/api/v1/customer/') || path.startsWith('/api/v1/customer-portal/')
  const active = all.filter(operation => !operation.includes('/openapi/2026-'))
  const expectedPortal = active.filter(operation => customerResource(operation.slice(operation.indexOf(' ') + 1))).sort()
  const expectedWebsite = active.filter(operation => {
    const path = operation.slice(operation.indexOf(' ') + 1)
    return !customerResource(path) && !path.includes('/diagnostics') && path !== '/api/v1/contracts'
  }).sort()
  const renderedPortal = renderedEndpointRows(html, 'customer-portal')
  const renderedWebsite = renderedEndpointRows(html, 'endpoints')
  expect.soft(renderedPortal).toEqual(expectedPortal)
  expect.soft(renderedWebsite).toEqual(expectedWebsite)
  expect(html).toContain('scripts/tenantservice/customer-api-reference.mjs')
  const clientSource = read('scripts/tenantservice/customer-api-reference.mjs').toString('utf8')
  // Inventory the callable/exported client and its journey, excluding the
  // synthetic server implementation. Normalize only parameter names, while
  // retaining the full resource shape (invoice detail, messages, attachments).
  const runnableClient = clientSource.slice(0, clientSource.indexOf('async function syntheticServer('))
    + clientSource.slice(clientSource.indexOf('export async function runCustomerSupportReference('))
  const resourceShape = path => path.replace(/\{[^}]+\}/g, '{reference}')
  const clientPaths = [...new Set([...runnableClient.matchAll(/(['"`])(\/api\/v1\/customer\/[^'"`\r\n]*)\1/g)]
    .map(match => match[2].split('?')[0].replace(/\$\{[^}]+\}/g, '{reference}'))
    .filter(path => path !== '/api/v1/customer/'))].sort()
  expect(clientPaths.length).toBeGreaterThanOrEqual(12)
  for (const path of clientPaths) {
    expect(Object.keys(portal.document.paths).some(documentPath => resourceShape(documentPath) === resourceShape(path)),
      `served OpenAPI contains active reference client resource ${path}`).toBe(true)
    expect.soft(renderedPortal.some(operation => resourceShape(operation.slice(operation.indexOf(' ') + 1)) === resourceShape(path)),
      `actual guide contains active reference client resource ${path}`).toBe(true)
  }
  console.log(`API_RELEASE_GUIDE_CLIENT_HTTP_EVIDENCE ${JSON.stringify({ version,
    rendered_portal: renderedPortal, expected_portal: expectedPortal,
    rendered_website: renderedWebsite, expected_website: expectedWebsite, client_resource_paths: clientPaths,
    actual_rendered_guide: true, client_authenticated_journey_not_claimed: true })}`)
  if (test.info().errors.length === 0) console.log(`API_RELEASE_GUIDE_CLIENT_HTTP_PASS version=${version} portal_operations=${expectedPortal.length} website_operations=${expectedWebsite.length} client_resource_paths=${clientPaths.length} actual_rendered_guide=true client_authenticated_journey_not_claimed=true`)
})

test('the existing configured reference client observes a real local runtime rejection and its release envelope', async ({ baseURL, request }) => {
  test.setTimeout(180_000)
  const portal = await jsonDocument(request, '/api/v1/openapi/customer-portal-v1.json')
  expect(portal.document.paths['/api/v1/customer/me'].get.responses['401']).toBeDefined()
  const actions = []
  const result = await runConfiguredCustomerRead({ baseUrl: baseURL,
    // Deliberately malformed synthetic credential reaches the real pre-DB
    // guard. No enrolled customer, external issuer or fake server is created.
    apiKey: 'synthetic malformed credential', customerNumber: 'SYNTHETIC-UNENROLLED',
    signAssertion: async action => { actions.push(action); return 'synthetic-untrusted-assertion' },
  })
  expect(actions).toEqual(['GET /api/v1/customer/me'])
  expect(result).toMatchObject({ status: 401, resultCount: 0, contractVersion: version, errorCode: 'malformed_authorization' })
  expect(result.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  console.log('API_RELEASE_REFERENCE_CLIENT_RUNTIME_HTTP_PASS source=actual_client server=actual_local_next status=401 error=malformed_authorization release_envelope=true authenticated_journey_not_claimed=true')
})
