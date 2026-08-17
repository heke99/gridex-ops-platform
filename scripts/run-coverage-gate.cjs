#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'config', 'coverage-baseline.json'), 'utf8'))
const vitestCli = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
const args = [
  vitestCli,
  'run',
  '--coverage',
  '--coverage.reporter=text-summary',
  '--coverage.reporter=json',
  '--coverage.reporter=lcov',
  '--coverage.reportsDirectory=coverage',
  `--coverage.thresholds.statements=${baseline.statements}`,
  `--coverage.thresholds.branches=${baseline.branches}`,
  `--coverage.thresholds.functions=${baseline.functions}`,
  `--coverage.thresholds.lines=${baseline.lines}`,
]

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
