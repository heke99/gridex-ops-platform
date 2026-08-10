// Generated mechanical enumeration verifier for the Gridex OPS quality playbook.
import { readFileSync } from 'node:fs'

const portal = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
const website = JSON.parse(readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
const requirements = readFileSync('quality/REQUIREMENTS.md', 'utf8')
const manifest = JSON.parse(readFileSync('quality/requirements_manifest.json', 'utf8'))

const errors = []
const operationIds = []
for (const [documentName, document] of [['portal', portal], ['website', website]]) {
  const documentOperationIds = []
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation) continue
      const operationId = operation.operationId
      if (typeof operationId !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(operationId)) {
        errors.push(`${documentName} ${method.toUpperCase()} ${path}: invalid operationId ${String(operationId)}`)
      } else {
        operationIds.push(operationId)
        documentOperationIds.push(operationId)
      }
    }
  }
  const duplicateIds = documentOperationIds.filter(
    (value, index) => documentOperationIds.indexOf(value) !== index,
  )
  if (duplicateIds.length) {
    errors.push(`${documentName} duplicate operationIds: ${[...new Set(duplicateIds)].join(', ')}`)
  }
}

for (let point = 1; point <= 75; point += 1) {
  if (!requirements.includes(`| ${point} | REQ-`)) errors.push(`master point ${point} lacks traceability row`)
}

const allowedPatterns = new Set(['whitelist', 'parity', 'compensation'])
for (const requirement of manifest.records ?? []) {
  if (!/^REQ-\d{3}$/.test(requirement.id)) errors.push(`invalid requirement id: ${requirement.id}`)
  if (!allowedPatterns.has(requirement.pattern)) errors.push(`${requirement.id} lacks valid Pattern`)
  if (!requirements.includes(`### ${requirement.id}:`)) errors.push(`${requirement.id} missing narrative heading`)
  if (!requirements.includes(`- **Pattern:** ${requirement.pattern}`)) errors.push(`${requirement.id} Pattern differs between artifacts`)
}

console.log(JSON.stringify({
  checked_master_points: 75,
  checked_requirements: manifest.records?.length ?? 0,
  checked_operation_ids: operationIds.length,
  errors,
}, null, 2))

process.exitCode = errors.length ? 1 : 0
