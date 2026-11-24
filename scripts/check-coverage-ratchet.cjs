#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const summaryPath = path.join(root, 'coverage', 'coverage-summary.json')
const baselinePath = path.join(root, 'config', 'coverage-baseline.json')
if (!fs.existsSync(summaryPath)) {
  console.error('Coverage ratchet requires coverage/coverage-summary.json. Run npm run test:coverage first.')
  process.exit(2)
}
if (!fs.existsSync(baselinePath)) {
  console.error('Coverage ratchet requires config/coverage-baseline.json with a measured repository baseline.')
  process.exit(2)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const metrics = ['lines', 'branches', 'functions', 'statements']
const failures = []
const observed = {}
function isCoveragePercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100
}
for (const metric of metrics) {
  const current = summary?.[metric]?.pct
  const floor = baseline?.[metric]
  observed[metric] = current
  if (!isCoveragePercentage(current) || !isCoveragePercentage(floor)) {
    failures.push(`${metric}: current and baseline percentages must be numbers between 0 and 100`)
    continue
  }
  if (current + 1e-9 < floor) failures.push(`${metric}: ${current}% is below measured baseline ${floor}%`)
}

console.log(JSON.stringify({ baseline, observed }, null, 2))
if (failures.length > 0) {
  console.error(`Coverage ratchet failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('Coverage ratchet passed; no tracked coverage metric regressed below baseline.')
