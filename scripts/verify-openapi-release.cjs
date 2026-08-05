#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')

const version = '2026-08-05.2'
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
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function exactBytes(path) {
  const document = JSON.parse(fs.readFileSync(path, 'utf8'))
  return `${JSON.stringify(document, null, 2)}\n`
}

async function verify() {
  for (const specification of specifications) {
    const body = exactBytes(specification.path)
    const document = JSON.parse(body)
    if (document.info.version !== version) {
      throw new Error(`${specification.key}: version mismatch`)
    }
    if (document['x-contract-schema-version'] !== version) {
      throw new Error(`${specification.key}: x-contract-schema-version mismatch`)
    }
    if (!/^[a-f0-9]{64}$/.test(sha256(body))) {
      throw new Error(`${specification.key}: invalid sha256`)
    }

    const releasePath =
      `docs/openapi/releases/${version}/${specification.contractName}.json`
    const routePath =
      `app/api/v1/openapi/${version}/${specification.contractName}.json/route.ts`
    if (!fs.existsSync(releasePath)) {
      throw new Error(`${specification.key}: missing immutable release artifact ${releasePath}`)
    }
    if (!fs.existsSync(routePath)) {
      throw new Error(`${specification.key}: missing immutable release route ${routePath}`)
    }
    const releaseBody = exactBytes(releasePath)
    if (releaseBody !== body) {
      throw new Error(
        `${specification.key}: immutable release artifact does not match current OpenAPI bytes`,
      )
    }
  }

  const registry = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
  for (const specification of specifications) {
    const route =
      `/api/v1/openapi/${version}/${specification.contractName}.json`
    if (!registry.includes(route)) {
      throw new Error(`${specification.key}: publicRouteRegistry missing ${route}`)
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
    `${baseUrl}/api/v1/openapi/release-manifest.json`,
  )
  if (!manifestResponse.ok) throw new Error('deployed manifest is unavailable')
  if (!manifestResponse.headers.get('content-type')?.includes('application/json')) {
    throw new Error('deployed manifest has the wrong content type')
  }
  const manifest = await manifestResponse.json()
  if (manifest.release_version !== version) {
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
  console.log(`Deployed OpenAPI release ${version} verified.`)
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
