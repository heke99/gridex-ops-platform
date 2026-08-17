import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const artifactDir = path.resolve(process.cwd(), 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })

export function fingerprint(value) {
  if (!value) return null
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

export function productionRunId() {
  const explicit = String(process.env.GRIDEX_E2E_RUN_ID || '').trim()
  return explicit || `prod-e2e-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

export function requireEnv(name, { allowEmpty = false } = {}) {
  const value = String(process.env[name] ?? '')
  if (!allowEmpty && !value.trim()) throw new Error(`Missing required production E2E secret: ${name}`)
  return value
}

export function writeEvidence(fileName, payload) {
  const safe = {
    schema_version: 1,
    ...payload,
  }
  fs.writeFileSync(path.join(artifactDir, fileName), `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 })
}

export function splitCustomerName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) throw new Error('GRIDEX_E2E_CUSTOMER_NAME must contain at least first and last name.')
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

export function safeUrlOrigin(value) {
  const parsed = new URL(value)
  return parsed.origin
}
