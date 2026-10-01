import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(resolve(root, path))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tag = bytes => '"' + createHash('sha256').update(bytes).digest('base64url') + '"'
const version = '2026-10-01.1'
const baseline = JSON.parse(read('scripts/support-staff-api-release-20261001.historical.json'))
const contracts = [['website', 'website-integration-v1'], ['customer_portal', 'customer-portal-v1']]
const path = '/api/v1/customer/cases/{reference}/messages'

// Only anonymous public release/guide HTTP. No Auth, credentials, protected
// route, role/privilege, database, provider, scanner or hosted target exercise.
async function document(request, path) {
  const response = await request.get(path, { timeout: 60_000, maxRedirects: 0 })
  expect(new URL(response.url()).origin).toBe('http://127.0.0.1:3004')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toMatch(/^application\/json\b/)
  const bytes = await response.body()
  expect(response.headers().etag).toBe(tag(bytes))
  return { response, bytes, json: JSON.parse(bytes.toString('utf8')) }
}

test('actual local Next active manifest and paired canonical/immutable bytes, headers and nullable staff schema agree', async ({ request }) => {
  const manifest = await document(request, '/api/v1/openapi/release-manifest.json')
  expect(manifest.json.release_version).toBe(version)
  expect(manifest.response.headers()['cache-control']).toContain('no-store')
  for (const [key, name] of contracts) {
    const expected = read(`docs/openapi/releases/${version}/${name}.json`)
    expect(read(`docs/openapi/${name}.json`).equals(expected)).toBe(true)
    const canonical = await document(request, `/api/v1/openapi/${name}.json`)
    const immutable = await document(request, `/api/v1/openapi/${version}/${name}.json`)
    for (const result of [canonical, immutable]) {
      expect(result.bytes.equals(expected)).toBe(true)
      expect(result.json.info.version).toBe(version)
      expect(result.response.headers()['x-gridex-contract-version']).toBe(version)
    }
    expect(canonical.response.headers()['cache-control']).toContain('no-store')
    expect(immutable.response.headers()['cache-control']).toContain('immutable')
    expect(manifest.json.specifications[key].sha256).toBe(sha(expected))
    const cached = await request.get(`/api/v1/openapi/${version}/${name}.json`, { headers: { 'if-none-match': tag(expected) } })
    expect(cached.status()).toBe(304); expect((await cached.body()).length).toBe(0)
    if (key === 'customer_portal') {
      const schema = canonical.json.components.schemas.CustomerSupportMessage
      expect(schema.required).toContain('author_reference')
      expect(schema.properties.author_reference.type).toEqual(['string', 'null'])
      expect(schema.properties.author_reference.pattern).toBe('^support_staff_[A-Za-z0-9_-]{32}$')
      expect(canonical.json.paths[path].get.responses['200']).toBeDefined()
    }
  }
  console.log('SUPPORT_STAFF_RELEASE_PUBLIC_HTTP_PASS active_pair=2 exact_bytes=true headers_etag_304=true schema_required_nullable=true')
})

test('every52 prior immutable artifact/source route and actual Next served body remains byte exact', async ({ request }) => {
  expect(baseline.oldReleaseJson).toBe(52); expect(baseline.oldRoutes).toBe(52)
  for (const record of baseline.files) expect(sha(read(record.path)), record.path).toBe(record.sha256)
  for (const record of baseline.files.filter(row => row.path.endsWith('.json'))) {
    const expected = read(record.path)
    const served = await document(request, '/api/v1/openapi/' + record.path.split('/').slice(-2).join('/'))
    expect(served.bytes.equals(expected), record.path).toBe(true)
    expect(sha(served.bytes), record.path).toBe(record.sha256)
    expect(served.response.headers()['cache-control']).toContain('immutable')
  }
  console.log('SUPPORT_STAFF_RELEASE_HISTORICAL_HTTP_PASS prior_json=52 prior_route_sources=52 historical_served_bytes=52 unchanged=true')
})

test('actual rendered developer guide carries the current nullable attribution and all existing reference resource paths', async ({ request }) => {
  const response = await request.get('/developers/customer-portal-api', { timeout: 60_000, maxRedirects: 0 })
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html.replace(/<[^>]*>/g, '')).toContain('API contract ' + version)
  expect(html).toContain('author_reference'); expect(html).toContain('support_staff_')
  expect(html).toContain('readSupportMessageAuthorReference')
  expect(html).toContain('JSON null')
  const portal = await document(request, '/api/v1/openapi/customer-portal-v1.json')
  const client = read('scripts/tenantservice/customer-api-reference.mjs').toString('utf8')
  const runnable = client.slice(0, client.indexOf('async function syntheticServer(')) + client.slice(client.indexOf('export async function runCustomerSupportReference('))
  const normalize = value => value.replace(/\{[^}]+\}/g, '{reference}')
  const resources = [...new Set([...runnable.matchAll(/(['"`])(\/api\/v1\/customer\/[^'"`\r\n]*)\1/g)]
    .map(row => row[2].split('?')[0].replace(/\$\{[^}]+\}/g, '{reference}'))
    .filter(row => row !== '/api/v1/customer/'))]
  expect(resources.length).toBeGreaterThanOrEqual(12)
  for (const resource of resources) {
    expect(Object.keys(portal.json.paths).some(row => normalize(row) === normalize(resource)), resource).toBe(true)
  }
  console.log(`SUPPORT_STAFF_RELEASE_GUIDE_HTTP_PASS version=${version} author_reference=true current_reference_resources=${resources.length}`)
})
