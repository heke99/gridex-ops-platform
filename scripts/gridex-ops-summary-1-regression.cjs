#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process')
const result = spawnSync(process.execPath, ['scripts/gridex-canonical-fixed-area-flow-regression.cjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
