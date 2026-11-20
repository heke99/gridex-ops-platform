#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

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

function parseUrl(value, base) {
  return typeof value === 'string' && URL.canParse(value, base) ? new URL(value, base) : null
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

async function verify() {
  const args = process.argv.slice(2)
  const expectedCommit = args[1]
  if (args.length && (args.length !== 2 || args[0] !== '--deploy-proof' || !/^[a-f0-9]{40}$/.test(expectedCommit))) {
    throw new Error('Pass --deploy-proof with a full 40-character Git commit SHA.')
  }

  const expectedReleases = []
  for (const specification of specifications) {
    const body = exactBytes(specification.path)
    const document = JSON.parse(body)
    if (document.info.version !== version) {
      throw new Error(`${specification.key}: version mismatch`)
    }
    if (document['x-contract-schema-version'] !== runtimeContractVersion) {
      throw new Error(`${specification.key}: x-contract-schema-version mismatch`)
    }
    assertImmutableArtifacts(specification, body)
    expectedReleases.push({
      ...specification,
      checksum: sha256(body),
      servers: document.servers ?? [],
    })
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

  const configuredBaseUrl = process.env.GRIDEX_API_BASE_URL
  const proofOrigin = expectedCommit ? parseUrl(configuredBaseUrl) : null
  if (expectedCommit && (proofOrigin?.protocol !== 'https:' || proofOrigin.href !== `${proofOrigin.origin}/`)) {
    throw new Error('GRIDEX_API_BASE_URL must be an HTTPS origin for deployment proof.')
  }
  const baseUrl = proofOrigin?.origin ?? configuredBaseUrl?.replace(/\/$/, '')
  if (!baseUrl) {
    console.log(
      `Local release artifacts verified for ${version}; set GRIDEX_API_BASE_URL to verify deployed bytes.`,
    )
    return
  }

  const targetOrigin = proofOrigin?.origin ?? new URL(baseUrl).origin
  const manifestResponse = await fetch(
    `${baseUrl}/api/v1/openapi/release-manifest.json`,
    { redirect: 'error' },
  )
  if (!manifestResponse.ok) throw new Error('deployed manifest is unavailable')
  if (!manifestResponse.headers.get('content-type')?.includes('application/json')) {
    throw new Error('deployed manifest has the wrong content type')
  }
  const manifest = await manifestResponse.json()
  if (expectedCommit && manifest?.build_commit !== expectedCommit) {
    throw new Error('deployed manifest build commit mismatch')
  }
  if (manifest.release_version !== version || manifest.guide_version !== version || manifest.runtime_contract_version !== runtimeContractVersion) {
    throw new Error('deployed manifest version mismatch')
  }
  for (const specification of expectedReleases) {
    const release = manifest.specifications?.[specification.key]
    if (
      release?.contract_name !== specification.contractName ||
      release?.contract_version !== version
    ) {
      throw new Error(`${specification.key}: deployed contract metadata mismatch`)
    }
    if (release.sha256 !== specification.checksum) {
      throw new Error(`${specification.key}: deployed manifest sha256 mismatch`)
    }
    // Preview manifests use canonical public URLs. Bind the advertised paths
    // to this release and verify the bytes served by the configured deployment.
    const allowedOrigins = new Set([
      targetOrigin,
      ...specification.servers.map((server) => parseUrl(server.url, baseUrl)?.origin),
    ])
    for (const [field, label, releasePath] of [
      ['url', 'current', `/api/v1/openapi/${specification.contractName}.json`],
      ['immutable_url', 'immutable', `/api/v1/openapi/${version}/${specification.contractName}.json`],
    ]) {
      const advertisedUrl = parseUrl(release[field])
      if (
        !advertisedUrl ||
        !allowedOrigins.has(advertisedUrl.origin) ||
        advertisedUrl.pathname !== releasePath ||
        advertisedUrl.username || advertisedUrl.password || advertisedUrl.search || advertisedUrl.hash
      ) {
        throw new Error(`${specification.key}: deployed ${field} mismatch`)
      }
      const response = await fetch(`${baseUrl}${releasePath}`, { redirect: 'error' })
      if (!response.ok) throw new Error(`${specification.key}: deployed ${label} spec unavailable`)
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`${specification.key}: deployed ${label} spec has the wrong content type`)
      }
      const body = Buffer.from(await response.arrayBuffer())
      if (sha256(body) !== specification.checksum) {
        throw new Error(`${specification.key}: deployed ${label} sha256 mismatch`)
      }
    }
  }
  console.log(expectedCommit
    ? `Deployed OpenAPI release ${version} for commit ${expectedCommit} verified.`
    : `Deployed OpenAPI release ${version} verified.`)
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
