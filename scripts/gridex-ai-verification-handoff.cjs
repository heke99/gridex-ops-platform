#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })
const outputName = 'ai-verification-handoff.json'
const secretKey = /(password|passwd|secret|token|cookie|authorization|bearer|api[_-]?key|service[_-]?role|private[_-]?key|certificate|credential)/i
const secretValue = /(Bearer\s+[A-Za-z0-9._~+\/-]+|sk[-_][A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gi

function sanitize(value, key = '') {
  if (secretKey.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  }
  if (typeof value === 'string') return value.replace(secretValue, '[REDACTED]')
  return value
}

const files = fs.readdirSync(artifactDir)
  .filter((name) => name.endsWith('.json') && name !== outputName)
  .sort()

const evidence = []
const failures = []
for (const name of files) {
  const fullPath = path.join(artifactDir, name)
  try {
    const parsed = sanitize(JSON.parse(fs.readFileSync(fullPath, 'utf8')))
    evidence.push({ file: name, data: parsed })
    const serialized = JSON.stringify(parsed)
    if (/"status":"failed"|"status":\s*"failed"|"validation_status":"failed"|"validation_status":\s*"failed"/i.test(serialized)) {
      failures.push({ file: name, summary: 'Deterministic evidence contains a failed status. Inspect this artifact for the first broken boundary.' })
    }
  } catch (error) {
    failures.push({ file: name, summary: `Evidence could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}` })
  }
}

const handoff = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit_sha: process.env.GITHUB_SHA || null,
  environment: process.env.GRIDEX_E2E_TARGET || process.env.VERCEL_ENV || process.env.NODE_ENV || null,
  ci_verdict_authority: 'deterministic-tests',
  ai_may_diagnose: true,
  ai_may_override_ci: false,
  instructions: 'Trace only failed deterministic evidence to the first broken browser/API/domain/database/async boundary. Never change expected behavior or security checks merely to make CI green.',
  failures,
  evidence,
}
fs.writeFileSync(path.join(artifactDir, outputName), `${JSON.stringify(handoff, null, 2)}\n`)
console.log(`Wrote sanitized AI verification handoff from ${evidence.length} JSON evidence files.`)
