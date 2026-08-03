/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const currentVersion = '2026-08-03.1'
const priorVersion = '2026-08-02.1'
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')

const website = readJson('docs/openapi/website-integration-v1.json')
const portal = readJson('docs/openapi/customer-portal-v1.json')

assert.equal(website.openapi, '3.1.0')
assert.equal(portal.openapi, '3.1.0')
assert.equal(website.info.version, currentVersion)
assert.equal(portal.info.version, currentVersion)

assert.equal(
  sha256(`docs/openapi/releases/${priorVersion}/website-integration-v1.json`),
  '971f0f4e00330971c92a37046f54fa7d27416a5b64932c7d37d7892b79691e7a',
  'prior website OpenAPI release bytes must remain immutable',
)
assert.equal(
  sha256(`docs/openapi/releases/${priorVersion}/customer-portal-v1.json`),
  '921daeb0c1bdfe4f4dc50cbbc3990defce8556bfe7cff0a88a0f4d96f4d6b779',
  'prior customer portal OpenAPI release bytes must remain immutable',
)

for (const document of [website, portal]) {
  const scheme = document.components?.securitySchemes?.legacyApiKeyAuth
  assert.equal(scheme?.type, 'apiKey')
  assert.equal(scheme?.in, 'header')
  assert.equal(scheme?.name, 'x-api-key')
  assert.equal(scheme?.deprecated, true)
  assert.equal(document['x-scope-aliases']?.['customer_portal.read']?.status, 'deprecated_legacy_alias')
  assert.equal(document['x-scope-aliases']?.['customer_portal.write']?.status, 'deprecated_legacy_alias')
}

const publicDocumentPaths = [
  '/api/v1/openapi/release-manifest.json',
  '/api/v1/openapi/website-integration-v1.json',
  '/api/v1/openapi/customer-portal-v1.json',
  `/api/v1/openapi/${priorVersion}/website-integration-v1.json`,
  `/api/v1/openapi/${priorVersion}/customer-portal-v1.json`,
  `/api/v1/openapi/${currentVersion}/website-integration-v1.json`,
  `/api/v1/openapi/${currentVersion}/customer-portal-v1.json`,
]
const staticHeaders = [
  'X-Gridex-Contract-Version',
  'X-Request-ID',
  'ETag',
  'Vary',
  'Cache-Control',
  'Content-Type',
  'Content-Disposition',
]
for (const document of [website, portal]) {
  for (const publicPath of publicDocumentPaths) {
    const operation = document.paths?.[publicPath]?.get
    if (!operation) continue
    assert.deepEqual(operation.security, [], `${publicPath} must be explicitly public`)
    assert.ok(operation.responses?.['200'])
    assert.ok(operation.responses?.['304'])
    for (const status of ['200', '304']) {
      const headers = operation.responses[status]?.headers ?? {}
      for (const name of staticHeaders) assert.ok(headers[name], `${publicPath} ${status} must document ${name}`)
      for (const name of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
        assert.equal(headers[name], undefined, `${publicPath} ${status} must not promise ${name}`)
      }
    }
  }
}

assert.equal(website.paths['/webhooks/contracts.publication.changed'], undefined)
const webhook = website.webhooks?.contractsPublicationChanged?.post
assert.ok(webhook, 'contracts.publication.changed must be modeled with top-level OpenAPI webhooks')
assert.deepEqual(webhook.security, [])
assert.deepEqual(Object.keys(webhook.responses ?? {}), ['2XX'])
assert.deepEqual(webhook.responses['2XX'].headers, undefined)
const webhookHeaders = new Set((webhook.parameters ?? []).map((item) => item.name))
for (const name of ['X-Gridex-Event-Id', 'X-Gridex-Delivery-Id', 'X-Gridex-Timestamp', 'X-Gridex-Signature']) {
  assert.ok(webhookHeaders.has(name), `webhook must require ${name}`)
}

const manifestOperation = website.paths['/api/v1/openapi/release-manifest.json'].get
assert.deepEqual(manifestOperation.security, [])

const responseRuntime = read('lib/integrations/openApiResponse.ts')
assert.match(responseRuntime, /randomUUID/)
assert.match(responseRuntime, /'X-Request-ID': requestId/)
assert.match(responseRuntime, /ETag: etag/)
assert.match(responseRuntime, /status: 304/)
assert.doesNotMatch(responseRuntime, /X-RateLimit-Limit/)

for (const spec of ['website-integration-v1', 'customer-portal-v1']) {
  const oldRoute = read(`app/api/v1/openapi/${priorVersion}/${spec}.json/route.ts`)
  const newRoute = read(`app/api/v1/openapi/${currentVersion}/${spec}.json/route.ts`)
  assert.match(oldRoute, new RegExp(`docs/openapi/releases/${priorVersion}/${spec}\\.json`))
  assert.match(newRoute, new RegExp(`docs/openapi/${spec}\\.json`))
}

const schemaMigration = read('supabase/migrations/20260803100040_public_contract_snapshot_shared_schema.sql')
const snapshotRpcMigration = read('supabase/migrations/20260803100130_public_contract_snapshot_shared_rpc.sql')
const hardeningV1 = read('supabase/migrations/20260803131558_external_api_contract_database_hardening_v1.sql')
const hardeningV2 = read('supabase/migrations/20260803131922_external_api_contract_database_hardening_v2.sql')
assert.match(schemaMigration, /create table if not exists public\.website_public_contract_snapshots/)
assert.match(schemaMigration, /alter table public\.website_public_contract_snapshots enable row level security/)
assert.match(schemaMigration, /revoke all on public\.website_public_contract_snapshots from public, anon, authenticated/)
assert.match(snapshotRpcMigration, /create function public\.store_website_public_contract_snapshot/)
assert.match(snapshotRpcMigration, /PUBLIC_CONTRACT_SNAPSHOT_CACHE_KEY_TENANT_CONFLICT/)
assert.match(snapshotRpcMigration, /to service_role/)
assert.match(hardeningV1, /gridex_contract_platform_readiness_internal_v1/)
assert.match(hardeningV1, /revoke all on function public\.gridex_contract_platform_readiness_internal_v1\(uuid\)/)
assert.match(hardeningV2, /gridex_can_read_company\(p_company_id\)/)
assert.match(hardeningV2, /auth\.jwt\(\) ->> 'role'/)
assert.doesNotMatch(hardeningV2, /session_user/)

console.log(`External API contract corrections verified for ${currentVersion}.`)
