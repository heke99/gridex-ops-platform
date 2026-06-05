const fs = require('fs')
const path = require('path')

const root = process.cwd()
const registryPath = path.join(root, 'lib/ediel/rulebook/testCaseRuleRegistry.ts')
const migrationPath = path.join(root, 'supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql')
const pagePath = path.join(root, 'app/admin/ediel/certification/page.tsx')
const decisionPath = path.join(root, 'lib/ediel/decisionEngine.ts')

const required = [registryPath, migrationPath, pagePath, decisionPath]
const failures = []
for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`Missing file: ${path.relative(root, file)}`)
}

const registry = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : ''
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''
const decision = fs.existsSync(decisionPath) ? fs.readFileSync(decisionPath, 'utf8') : ''

const requiredCases = [
  'L1','L2','L3','L4','L5','L7',
  'UL1','UL2','UL3','UL4','UL6',
  'E3','E4','E5','E6','E7','E8','UE1','UE2',
]
for (const code of requiredCases) {
  if (!registry.includes(`'${code}'`)) failures.push(`Missing certification case ${code} in registry`)
  if (!migration.includes(`'${code}'`)) failures.push(`Missing certification case ${code} in migration`)
}

const approvedIds = ['388756','388764','388765','388766','388767','388809','388810','388811','388812','388813','388814','389178','389280','389301']
for (const id of approvedIds) {
  if (!registry.includes(id)) failures.push(`Missing approved portal id ${id} in registry`)
  if (!migration.includes(id)) failures.push(`Missing approved portal id ${id} in migration`)
}

if (!registry.includes('389303') || !registry.includes('failed')) failures.push('E7 389303 must be failed active target')
if (!decision.includes('findCertificationCase')) failures.push('decisionEngine must use certification registry rather than hardcoded UE-only logic')
if (decision.includes("['UE1', 'UE2'].includes(testCase)")) failures.push('decisionEngine still contains direct UE1/UE2 decision hardcode')

if (failures.length > 0) {
  console.error('Certification regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Certification regression ok')
