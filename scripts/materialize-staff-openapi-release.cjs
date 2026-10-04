#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { artifacts, mountedStaffOperations } = require('./lib/staff-openapi-artifacts.cjs')
const { contractDefinitions } = require('./lib/staff-openapi-contract.cjs')

const prepared = artifacts(process.cwd(), { releaseReady: true })
const mounted = mountedStaffOperations(process.cwd())
for (const operation of contractDefinitions(prepared.meta).filter(operation => operation.authentication !== 'public')) {
  if (!mounted.has(`${operation.method} ${operation.path}`)) throw new Error(`Cannot materialize staff release before implementation: ${operation.method} ${operation.path}`)
}
const directory = `docs/openapi/releases/${prepared.meta.version}`
const file = `${directory}/${prepared.meta.name}.json`
if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== prepared.documentBytes) throw new Error(`Refusing to mutate immutable staff release: ${file}`)
const routeDirectory = `app/api/v1/openapi/${prepared.meta.version}/${prepared.meta.name}.json`
const route = `import { NextRequest } from 'next/server'\nimport staffOpenApi from '@/${file}'\nimport { openApiDocumentResponse } from '@/lib/integrations/openApiResponse'\n\nexport const runtime = 'nodejs'\nexport const dynamic = 'force-dynamic'\n\nexport async function GET(request: NextRequest) {\n  return openApiDocumentResponse(request, staffOpenApi, 'gridex-${prepared.meta.name}-${prepared.meta.version}.json', { cacheControl: 'public, max-age=31536000, immutable' })\n}\n`
const routeFile = path.join(routeDirectory, 'route.ts')
if (fs.existsSync(routeFile) && fs.readFileSync(routeFile, 'utf8') !== route) throw new Error(`Refusing to mutate immutable staff route: ${routeFile}`)
for (const [generatedFile, content] of Object.entries(prepared.files)) {
  fs.mkdirSync(path.dirname(generatedFile), { recursive: true })
  fs.writeFileSync(generatedFile, content)
}
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(file, prepared.documentBytes)
fs.mkdirSync(routeDirectory, { recursive: true })
fs.writeFileSync(routeFile, route)
console.log(`Staff ${prepared.meta.version} immutable artifact and route materialized.`)
