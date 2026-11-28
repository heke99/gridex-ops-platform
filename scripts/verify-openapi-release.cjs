#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')

const { currentDocumentationVersion: version, runtimeContractVersion } = require('./lib/current-api-contract.cjs')
const specifications = [
  {
    key: 'website',
    path: 'docs/openapi/website-integration-v1.json',
    contractName: 'website-integration-v1',
  },
  {
    key: 'customer_portal',
    path: 'docs/openapi/customer-portal-v1.json',
    contractName: 'customer-portal-v1',
  },
  {
    key: 'staff',
    path: 'docs/openapi/staff-v1.json',
    contractName: 'staff-v1',
  },
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function exactBytes(filePath) {
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return `${JSON.stringify(document, null, 2)}\n`
}

function assertImmutableArtifacts(specification, currentBytes) {
  const releasePath = path.join(
    'docs/openapi/releases',
    version,
    `${specification.contractName}.json`,
  )
  const routePath = path.join(
    'app/api/v1/openapi',
    version,
    `${specification.contractName}.json`,
    'route.ts',
  )

  if (!fs.existsSync(releasePath)) {
    throw new Error(
      `${specification.key}: missing immutable release artifact ${releasePath}`,
    )
  }
  if (!fs.existsSync(routePath)) {
    throw new Error(
      `${specification.key}: missing immutable OpenAPI route ${routePath}`,
    )
  }

  const releaseBytes = exactBytes(releasePath)
  if (releaseBytes !== currentBytes) {
    throw new Error(
      `${specification.key}: immutable release artifact diverges from current OpenAPI`,
    )
  }

  const routeSource = fs.readFileSync(routePath, 'utf8')
  if (!routeSource.includes(`docs/openapi/releases/${version}/${specification.contractName}.json`)) {
    throw new Error(
      `${specification.key}: immutable route does not import release ${version}`,
    )
  }
}

const manifestPath = '/api/v1/openapi/release-manifest.json'
const compatibilityPath = '/api/v1/openapi/legacy-compatibility.json'
const compatibilityLink = `<${compatibilityPath}>; rel="related"; type="application/json"`

function hasHeaderToken(response, header, token) {
  return response.headers.get(header)?.split(',').some(value => value.trim().toLowerCase() === token)
}

function assertCompatibilityDiscovery(response) {
  if (response.headers.get('link') !== compatibilityLink ||
      !hasHeaderToken(response, 'access-control-expose-headers', 'link')) {
    throw new Error('deployed release compatibility discovery mismatch')
  }
}

async function verifyDeployedCompatibility(baseUrl, registry, manifestResponse, manifest) {
  const declared = registry.includes(`path: '${compatibilityPath}'`)
  if (!declared) {
    if (manifestResponse.headers.get('link')?.includes(compatibilityPath)) {
      throw new Error('deployed release compatibility not registered')
    }
    return
  }

  assertCompatibilityDiscovery(manifestResponse)
  const companionResponse = await fetch(`${baseUrl}${compatibilityPath}`, { redirect: 'manual' })
  if (companionResponse.status !== 200 ||
      !companionResponse.headers.get('content-type')?.includes('application/json') ||
      !hasHeaderToken(companionResponse, 'cache-control', 'no-store')) {
    throw new Error('deployed release compatibility unavailable')
  }

  const body = await companionResponse.text()
  const current = JSON.parse(body)
  if (!/^[a-f0-9]{40}$/.test(manifest.build_commit) ||
      current?.build_commit !== manifest.build_commit ||
      current.release_version !== version ||
      current.runtime_contract_version !== runtimeContractVersion) {
    throw new Error('deployed release compatibility release identity mismatch')
  }
  const catalog = JSON.parse(fs.readFileSync('lib/integrations/legacyApiCompatibility.json', 'utf8'))
  const expected = {
    build_commit: manifest.build_commit,
    release_version: version,
    runtime_contract_version: runtimeContractVersion,
    legacy_compatibility: Object.values(catalog),
  }
  if (!isDeepStrictEqual(current, expected)) {
    throw new Error('deployed release compatibility catalog mismatch')
  }

  const manifestEtag = manifestResponse.headers.get('etag')
  const companionEtag = companionResponse.headers.get('etag')
  const bodyEtag = `"${crypto.createHash('sha256').update(body).digest('base64url')}"`
  if (!manifestEtag || companionEtag !== bodyEtag || manifestEtag === companionEtag) {
    throw new Error('deployed release compatibility ETag mismatch')
  }
  const [conditionalManifest, conditionalCompanion] = await Promise.all([
    fetch(`${baseUrl}${manifestPath}`, { headers: { 'If-None-Match': manifestEtag }, redirect: 'manual' }),
    fetch(`${baseUrl}${compatibilityPath}`, { headers: { 'If-None-Match': companionEtag }, redirect: 'manual' }),
  ])
  if (conditionalManifest.status !== 304 || conditionalManifest.headers.get('etag') !== manifestEtag ||
      conditionalCompanion.status !== 304 || conditionalCompanion.headers.get('etag') !== companionEtag) {
    throw new Error('deployed release compatibility conditional read mismatch')
  }
  assertCompatibilityDiscovery(conditionalManifest)
}

async function verify() {
  for (const specification of specifications) {
    const body = exactBytes(specification.path)
    const document = JSON.parse(body)
    if (document.info.version !== version) {
      throw new Error(`${specification.key}: version mismatch`)
    }
    if (document['x-contract-schema-version'] !== runtimeContractVersion) {
      throw new Error(`${specification.key}: x-contract-schema-version mismatch`)
    }
    if (!/^[a-f0-9]{64}$/.test(sha256(body))) {
      throw new Error(`${specification.key}: invalid sha256`)
    }
    assertImmutableArtifacts(specification, body)
  }

  const registry = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
  for (const specification of specifications) {
    const route =
      `/api/v1/openapi/${version}/${specification.contractName}.json`
    if (!registry.includes(route)) {
      throw new Error(
        `${specification.key}: publicRouteRegistry is missing ${route}`,
      )
    }
  }

  const baseUrl = process.env.GRIDEX_API_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) {
    console.log(
      `Local release artifacts verified for ${version}; set GRIDEX_API_BASE_URL to verify deployed bytes.`,
    )
    return
  }

  const manifestResponse = await fetch(
    `${baseUrl}${manifestPath}`,
  )
  if (!manifestResponse.ok) throw new Error('deployed manifest is unavailable')
  if (!manifestResponse.headers.get('content-type')?.includes('application/json')) {
    throw new Error('deployed manifest has the wrong content type')
  }
  const manifest = await manifestResponse.json()
  if (manifest.release_version !== version || manifest.guide_version !== version || manifest.runtime_contract_version !== runtimeContractVersion) {
    throw new Error('deployed manifest version mismatch')
  }
  for (const specification of specifications) {
    const release = manifest.specifications?.[specification.key]
    if (
      release?.contract_name !== specification.contractName ||
      release?.contract_version !== version
    ) {
      throw new Error(`${specification.key}: deployed contract metadata mismatch`)
    }
    const response = await fetch(release.url)
    if (!response.ok) throw new Error(`${specification.key}: deployed spec unavailable`)
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`${specification.key}: deployed spec has the wrong content type`)
    }
    const body = await response.text()
    if (sha256(body) !== release.sha256) {
      throw new Error(`${specification.key}: deployed sha256 mismatch`)
    }
  }
  await verifyDeployedCompatibility(baseUrl, registry, manifestResponse, manifest)
  console.log(`Deployed OpenAPI release ${version} verified.`)
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
