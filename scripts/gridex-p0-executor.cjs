#!/usr/bin/env node
'use strict'

// Validate mappings and optionally run deterministic support gates. Browser
// paths are metadata: this executor does not attest browser or journey outcomes.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })

const projectText = fs.readFileSync(path.join(root, 'PROJECT_E2E.yaml'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'e2e/p0-executors.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageScripts = pkg.scripts || {}

const p0Ids = [...projectText.matchAll(/^\s*- id:\s*(GRIDEX-P0-\d+)\s*$/gm)].map((match) => match[1])
const uniqueP0 = [...new Set(p0Ids)]
const mappedIds = Object.keys(manifest.scenarios || {})
const issues = []

for (const id of uniqueP0) {
  const entry = manifest.scenarios?.[id]
  if (!entry) {
    issues.push(`${id} is required by PROJECT_E2E.yaml but has no executor mapping.`)
    continue
  }
  const gates = Array.isArray(entry.npm_scripts) ? entry.npm_scripts : []
  if (gates.length === 0) issues.push(`${id} has no deterministic npm gate.`)
  for (const script of gates) {
    if (!Object.prototype.hasOwnProperty.call(packageScripts, script)) {
      issues.push(`${id} references missing package.json script: ${script}`)
    }
  }
  for (const file of Array.isArray(entry.browser_specs) ? entry.browser_specs : []) {
    if (!fs.existsSync(path.join(root, file))) issues.push(`${id} references missing browser spec: ${file}`)
  }
}

for (const id of mappedIds) {
  if (!uniqueP0.includes(id)) issues.push(`${id} is mapped but is not a P0 scenario in PROJECT_E2E.yaml.`)
}

if (new Set(mappedIds).size !== mappedIds.length) issues.push('P0 executor manifest contains duplicate scenario IDs.')

const requested = process.argv.find((value) => value.startsWith('--scenario='))?.split('=')[1] || null
const runAll = process.argv.includes('--all')
const shouldExecute = Boolean(requested || runAll)
const selected = requested ? [requested] : runAll ? uniqueP0 : []
const scenarioResults = []

if (requested && !manifest.scenarios?.[requested]) issues.push(`Unknown requested P0 scenario: ${requested}`)

if (issues.length === 0 && shouldExecute) {
  for (const id of selected) {
    const entry = manifest.scenarios[id]
    const gateResults = []
    let supportStatus = 'passed'
    for (const script of entry.npm_scripts) {
      const started = Date.now()
      const child = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      })
      const status = child.status === 0 && !child.error && !child.signal ? 'passed' : 'failed'
      gateResults.push({ script, status, exit_code: status === 'passed' ? 0 : child.status || 1, duration_ms: Date.now() - started })
      if (status === 'failed') {
        supportStatus = 'failed'
        break
      }
    }
    scenarioResults.push({
      id,
      status: supportStatus === 'failed' ? 'failed' : 'not_verified',
      deterministic_support_status: supportStatus,
      browser_boundary_status: 'not_executed',
      full_journey_status: 'not_verified',
      deterministic_gates: gateResults,
      browser_specs: entry.browser_specs,
    })
    if (supportStatus === 'failed') break
  }
}

const mappingStatus = issues.length === 0 ? 'passed' : 'failed'
const supportStatus = scenarioResults.some((row) => row.deterministic_support_status === 'failed')
  ? 'failed' : scenarioResults.length ? 'passed' : 'not_executed'
const executed = new Set(scenarioResults.map((row) => row.id))
const evidence = {
  schema_version: 2,
  evidence_scope: 'mapping_and_deterministic_support',
  generated_at: new Date().toISOString(),
  commit_sha: process.env.GITHUB_SHA || null,
  contract: 'PROJECT_E2E.yaml',
  required_p0: uniqueP0,
  mapped_p0: mappedIds,
  // Retain this field for mapping-validation consumers of schema v1.
  validation_status: mappingStatus,
  mapping_validation_status: mappingStatus,
  deterministic_support_status: supportStatus,
  browser_boundary_status: 'not_executed',
  full_journey_status: 'not_verified',
  issues,
  execution_requested: shouldExecute,
  requested_scenarios: selected,
  unexecuted_scenarios: selected.filter((id) => !executed.has(id)),
  scenarios: scenarioResults,
}
fs.writeFileSync(path.join(artifactDir, 'gridex-p0-executor-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)

if (issues.length > 0) {
  console.error(`P0 executor contract failed:\n- ${issues.join('\n- ')}`)
  process.exit(1)
}
if (supportStatus === 'failed') {
  console.error('One or more deterministic P0 support gates failed.')
  process.exit(1)
}
const supportSummary = shouldExecute ? `deterministic support passed for ${scenarioResults.length} selected scenarios` : 'deterministic support not executed'
console.log(`Gridex P0 mapping validated for ${uniqueP0.length} required scenarios; ${supportSummary}; browser and full journey evidence not verified.`)
