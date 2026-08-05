/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/migration-history-manifest.json'), 'utf8'))
const required = [
  '20260803100040_public_contract_snapshot_shared_schema.sql',
  '20260803100130_public_contract_snapshot_shared_rpc.sql',
  '20260803131558_external_api_contract_database_hardening_v1.sql',
  '20260803131922_external_api_contract_database_hardening_v2.sql',
  '20260805085617_api_contract_billing_tenant_hardening.sql',
]
for (const name of required) {
  const file = path.join(root, 'supabase/migrations', name)
  assert.ok(fs.existsSync(file), `${name} must exist`)
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  assert.equal(manifest.files?.[name], checksum, `${name} checksum must be registered`)
}
console.log('Database contract hardening migration checks passed.')
