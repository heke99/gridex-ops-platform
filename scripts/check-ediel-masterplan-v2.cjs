#!/usr/bin/env node
// Specification integrity is deliberately separate from implementation acceptance.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const base = path.join(root, 'docs/ediel/masterplan-v2')
const read = (name) => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifest = read('package_manifest.json')
for (const item of manifest.files) {
  const target = path.resolve(base, item.path)
  assert(target.startsWith(base + path.sep), 'Manifest path must stay inside specification')
  const bytes = fs.readFileSync(target)
  assert.equal(bytes.length, item.bytes, `Original size changed: ${item.path}`)
  assert.equal(digest(bytes), item.sha256, `Original hash changed: ${item.path}`)
}

const rules = read('registers/rules.json')
const contracts = read('registers/acceptance_tests.json')
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'quality/audits/ediel-masterplan-v2/coverage.json'), 'utf8'))
assert.equal(ledger.spec_sha256, digest(fs.readFileSync(path.join(base, 'MASTERMASTERPLAN_v2.md'))))
const exactIds = (expected, actual, label) => {
  assert.equal(new Set(actual.map((row) => row.id)).size, actual.length, `${label}: duplicate IDs`)
  assert.deepEqual(actual.map((row) => row.id).sort(), expected.map((row) => row.id).sort(), `${label}: missing or extra IDs`)
}
exactIds(rules, ledger.rules, 'Rules')
exactIds(contracts, ledger.acceptance_contracts, 'Acceptance contracts')
for (const row of ledger.rules) {
  assert.equal(row.acceptance_id, rules.find((rule) => rule.id === row.id).test_id)
  assert(['NOT_VERIFIED', 'PARTIAL', 'VERIFIED', 'BLOCKED'].includes(row.status))
}
for (const row of ledger.acceptance_contracts) {
  assert(['NOT_EXECUTED', 'PARTIAL', 'PASSED', 'FAILED', 'BLOCKED'].includes(row.status))
}
for (const row of [...ledger.rules, ...ledger.acceptance_contracts]) {
  assert(Array.isArray(row.evidence), `${row.id}: evidence must be an array`)
  if (!['NOT_VERIFIED', 'NOT_EXECUTED'].includes(row.status)) {
    assert(row.evidence.length > 0, `${row.id}: status requires recorded evidence`)
  }
  for (const evidence of row.evidence) {
    const target = path.resolve(root, evidence)
    assert(target.startsWith(root + path.sep) && fs.statSync(target).isFile(), `${row.id}: missing evidence file`)
  }
}
assert(contracts.every((row) => row.execution_status === 'Inte körd mot systemet' && !row.evidence), 'Keep original acceptance contracts immutable')
console.log(JSON.stringify({
  scope: 'specification integrity and evidence references only',
  originalFiles: manifest.files.length,
  rules: rules.length,
  acceptanceContracts: contracts.length,
  applicationConformanceAsserted: false,
  productionReadinessAsserted: false,
}))
