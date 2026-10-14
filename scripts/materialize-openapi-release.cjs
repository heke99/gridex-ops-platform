#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const specifications = [
  {
    contractName: 'website-integration-v1',
    currentPath: 'docs/openapi/website-integration-v1.json',
  },
  {
    contractName: 'customer-portal-v1',
    currentPath: 'docs/openapi/customer-portal-v1.json',
  },
  {
    currentPath: 'docs/openapi/staff-v1.json',
    contractName: 'staff-v1',
  },
]

function canonicalBytes(file) {
  const document = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  return {
    document,
    bytes: `${JSON.stringify(document, null, 2)}\n`,
  }
}

function writeImmutable(relativePath, content) {
  const absolutePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  if (fs.existsSync(absolutePath)) {
    const existing = fs.readFileSync(absolutePath, 'utf8')
    if (existing !== content) {
      throw new Error(
        `Refusing to mutate immutable OpenAPI release artifact: ${relativePath}`,
      )
    }
    return
  }
  fs.writeFileSync(absolutePath, content)
}

function routeSource({ version, contractName }) {
  const variableName =
    contractName === 'website-integration-v1'
      ? 'websiteIntegrationOpenApi'
      : contractName === 'customer-portal-v1' ? 'customerPortalOpenApi' : 'staffOpenApi'
  return `import { NextRequest } from 'next/server'\nimport ${variableName} from '@/docs/openapi/releases/${version}/${contractName}.json'\nimport { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'\n\nexport const runtime = 'nodejs'\nexport const dynamic = 'force-dynamic'\n\nexport async function GET(request: NextRequest) {\n  return openApiDocumentResponse(\n    request,\n    ${variableName},\n    'gridex-${contractName}-${version}.json',\n    { cacheControl: 'public, max-age=31536000, immutable' },\n  )\n}\n`
}

const prepared = specifications.map((specification) => {
  const current = canonicalBytes(specification.currentPath)
  const version = String(current.document.info?.version ?? '')
  const runtimeVersion = String(current.document['x-contract-schema-version'] ?? '')
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version) || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(runtimeVersion)) {
    throw new Error(`${specification.currentPath}: invalid documentation or runtime revision`)
  }
  return { specification, current, version, runtimeVersion }
})
if (new Set(prepared.map(entry => entry.version)).size !== 1 || new Set(prepared.map(entry => entry.runtimeVersion)).size !== 1) {
  throw new Error('All public OpenAPI documentation revisions and runtime schema revisions must independently match.')
}

const materialized = prepared.map(({ specification, current, version }) => {

  const releasePath =
    `docs/openapi/releases/${version}/${specification.contractName}.json`
  const routePath =
    `app/api/v1/openapi/${version}/${specification.contractName}.json/route.ts`
  writeImmutable(releasePath, current.bytes)
  writeImmutable(
    routePath,
    routeSource({ version, contractName: specification.contractName }),
  )

  return { version, releasePath, routePath }
})

if (new Set(materialized.map((entry) => entry.version)).size !== 1) {
  throw new Error('All public OpenAPI specification versions must match.')
}

console.log(
  `OpenAPI release ${materialized[0].version} materialized with immutable JSON and routes.`,
)
