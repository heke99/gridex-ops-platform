#!/usr/bin/env node
'use strict'

// Maps Ediel masterplan v2 rule cards and acceptance contracts to the tests
// that assert them, runs those tests and reports which IDs are ready for
// approval in quality/audits/ediel-masterplan-v2/coverage.json.
//
// Tag a test file (__tests__/**/*.test.ts or scripts/test-ediel-*.cjs) with a comment line (IDs from the frozen
// registers, comma or space separated):
//   // masterplan: P-04, AT-P-04, SC-024
//
// Usage:
//   node scripts/ediel-masterplan-test-coverage.cjs          report only
//   node scripts/ediel-masterplan-test-coverage.cjs --check  fail if an
//     approved ID (VERIFIED/PASSED) has no tagged test, or a tagged test fails
//
// The script never changes coverage.json. Approval stays a reviewed edit in
// the same PR as the code and tests, after every expected and prohibited
// effect of the ID has an asserting test.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const coveragePath = path.join(root, 'quality/audits/ediel-masterplan-v2/coverage.json')
const TAG = /^\s*\/\/\s*masterplan:\s*(.+)$/gm
const check = process.argv.includes('--check')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'))
const known = new Map()
for (const row of coverage.rules) known.set(row.id, row)
for (const row of coverage.acceptance_contracts) known.set(row.id, row)

const filesById = new Map()
const unknownTags = []
const nodeScripts = fs.readdirSync(path.join(root, 'scripts'))
  .filter((name) => /^test-ediel-.*\.cjs$/.test(name))
  .map((name) => path.join(root, 'scripts', name))
for (const file of [...walk(path.join(root, '__tests__')), ...nodeScripts]) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(TAG)) {
    for (const id of match[1].split(/[\s,]+/).filter(Boolean)) {
      const rel = path.relative(root, file)
      if (!known.has(id)) {
        unknownTags.push(`${rel}: ${id}`)
        continue
      }
      if (!filesById.has(id)) filesById.set(id, new Set())
      filesById.get(id).add(rel)
    }
  }
}

const allTagged = [...new Set([...filesById.values()].flatMap((set) => [...set]))]
const taggedFiles = allTagged.filter((file) => file.endsWith('.test.ts'))
const failedFiles = new Set()
// scripts/test-ediel-*.cjs run under node:test as in CI.
for (const file of allTagged.filter((f) => f.endsWith('.cjs'))) {
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', file], { cwd: root, encoding: 'utf8' })
  if (run.status !== 0) failedFiles.add(file)
}
if (taggedFiles.length) {
  const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', ...taggedFiles], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  let report
  try {
    report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')))
  } catch {
    console.error('Could not read the vitest JSON report.')
    console.error(run.stderr.slice(-2000))
    process.exit(1)
  }
  for (const result of report.testResults) {
    if (result.status !== 'passed') failedFiles.add(path.relative(root, result.name))
  }
}

const approved = new Set(['VERIFIED', 'PASSED'])
const rows = [...known.values()].map((row) => {
  const files = [...(filesById.get(row.id) ?? [])].sort()
  const failing = files.filter((file) => failedFiles.has(file))
  let readiness = 'untagged'
  if (files.length) readiness = failing.length ? 'tagged_failing' : 'tagged_green'
  return { id: row.id, status: row.status, readiness, files, failing }
})

const problems = []
for (const tag of unknownTags) problems.push(`unknown masterplan ID tag ${tag}`)
for (const row of rows) {
  if (approved.has(row.status) && row.readiness === 'untagged') problems.push(`${row.id} is ${row.status} but no test is tagged with it`)
  if (row.failing.length) problems.push(`${row.id}: tagged test failing: ${row.failing.join(', ')}`)
}

const count = (pred) => rows.filter(pred).length
console.log(`Masterplan IDs: ${rows.length}; approved ${count((r) => approved.has(r.status))}; tagged green ${count((r) => r.readiness === 'tagged_green')}; tagged failing ${count((r) => r.readiness === 'tagged_failing')}; untagged ${count((r) => r.readiness === 'untagged')}`)
const candidates = rows.filter((r) => r.readiness === 'tagged_green' && !approved.has(r.status))
if (candidates.length) {
  console.log('Tagged green, not yet approved (review every expected/prohibited effect before approving):')
  for (const r of candidates) console.log(`  ${r.id}  ${r.files.join(', ')}`)
}
if (problems.length) {
  console.log('Problems:')
  for (const p of problems) console.log(`  ${p}`)
}
if (check && problems.length) process.exit(1)
