#!/usr/bin/env node
const fs = require('node:fs')

const migrationName = '20260819112000_tenant_api_checkout_delivery_performance.sql'
const migrationSha256 = '15d5fb56f21f384c4208cb8252f419a04ae1e7e18ec1ec730b35709512e81b5a'

const additionsPath = 'scripts/migration-history-manifest.additions.json'
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
additions.files = additions.files ?? {}
additions.files[migrationName] = migrationSha256
const sortedFiles = Object.fromEntries(Object.entries(additions.files).sort(([a], [b]) => a.localeCompare(b)))
fs.writeFileSync(additionsPath, `${JSON.stringify({ ...additions, files: sortedFiles }, null, 2)}\n`)

const typesManifestPath = 'scripts/supabase-types-manifest.json'
const typesManifest = JSON.parse(fs.readFileSync(typesManifestPath, 'utf8'))
typesManifest.generated_at = '2026-08-19T11:20:00.000Z'
typesManifest.latest_migration = migrationName
fs.writeFileSync(typesManifestPath, `${JSON.stringify(typesManifest, null, 2)}\n`)

console.log('Tenant API migration/type manifests updated.')
