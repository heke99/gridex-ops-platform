#!/usr/bin/env node
const fs = require('node:fs')
const { artifacts, sha256 } = require('./lib/staff-openapi-artifacts.cjs')
const { validateSchema } = require('./lib/openapi-schema-validator.cjs')

const expected = artifacts(process.cwd())
const failures = []
const draft = process.argv.includes('--draft')
for (const [file, content] of Object.entries(expected.files)) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) failures.push(`Stale generated staff artifact: ${file}`)
}
const archived = `docs/openapi/releases/${expected.meta.version}/${expected.meta.name}.json`
if (!draft && (!fs.existsSync(archived) || fs.readFileSync(archived, 'utf8') !== expected.documentBytes)) failures.push(`Missing or different immutable staff artifact: ${archived}`)
const immutableRoute = `app${expected.meta.immutablePath}/route.ts`
if (!draft && (!fs.existsSync(immutableRoute) || !fs.readFileSync(immutableRoute, 'utf8').includes(`@/${archived}`))) failures.push(`Missing or incorrectly pinned immutable staff route: ${immutableRoute}`)
const spec = expected.document
function inspect(value, location) {
  if (!value || typeof value !== 'object') return
  if (value.$ref) {
    if (!value.$ref.startsWith('#/components/schemas/') || !spec.components.schemas[value.$ref.split('/').at(-1)]) failures.push(`Unresolved local staff schema at ${location}: ${value.$ref}`)
  }
  if (value.required && value.properties) for (const field of value.required) if (!value.properties[field]) failures.push(`Required staff field has no schema: ${location}.${field}`)
  for (const [key, item] of Object.entries(value)) inspect(item, `${location}.${key}`)
}
inspect(spec, 'OpenAPI')
for (const [path, item] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(item)) {
  if (operation['x-staff-authentication'] === 'dual' && (operation.security.length !== 1 || !('integrationBearerAuth' in operation.security[0]) || !('staffAuthorization' in operation.security[0]))) failures.push(`Staff AND authentication not documented: ${method.toUpperCase()} ${path}`)
  for (const [type, content] of Object.entries(operation.requestBody?.content ?? {})) {
    if (type !== 'multipart/form-data' && content.example === undefined) failures.push(`Missing request example: ${method} ${path}`)
    if (content.example !== undefined) failures.push(...validateSchema(spec, content.example, content.schema, `${method} ${path} request example`))
  }
  for (const [status, response] of Object.entries(operation.responses)) for (const [type, content] of Object.entries(response.content ?? {})) {
    if (type === 'application/json' && content.schema.$ref && content.example === undefined) failures.push(`Missing response example: ${method} ${path} ${status}`)
    if (content.example !== undefined) failures.push(...validateSchema(spec, content.example, content.schema, `${method} ${path} ${status} example`))
  }
}
failures.push(...validateSchema(spec, expected.manifest, spec.components.schemas.StaffReleaseManifest, 'staff release manifest'))
if (expected.manifest.specification.sha256 !== sha256(expected.documentBytes)) failures.push('Staff manifest fingerprint differs from document bytes')
for (const [name, digest] of [
  ['website-integration-v1', '10fb2f3051f112990fe4ef63ffa18b24ee5d9b5203b1f4429a2a3d88675c43be'],
  ['customer-portal-v1', '442ee521e2286a3364de082cce50b68be3085db7855caf151a8999005b790503'],
]) {
  for (const file of [`docs/openapi/${name}.json`, `docs/openapi/releases/2026-10-02.4/${name}.json`]) if (sha256(fs.readFileSync(file, 'utf8')) !== digest) failures.push(`Legacy .4 bytes changed: ${file}`)
}
if (failures.length) throw new Error(failures.join('\n'))
console.log(`Staff ${expected.meta.version} schema/examples/runtime inventory and independent release verified (${Object.keys(spec.paths).length} paths); legacy .4 bytes unchanged.`)
