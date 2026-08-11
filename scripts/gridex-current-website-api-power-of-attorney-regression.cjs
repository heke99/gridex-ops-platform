#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const legacyPath = path.join(root, 'scripts/gridex-website-api-power-of-attorney-regression.cjs')
let source = fs.readFileSync(legacyPath, 'utf8')

const oldBinding = "const src = read('lib/website/customerApplications.ts')"
const currentBinding = `const src = [
  'lib/website/customerApplications.ts',
  'lib/website/customerApplicationSchemas.ts',
  'lib/website/customerApplicationProcess.ts',
  'lib/website/customerApplicationPersistence.ts',
  'lib/website/customerApplicationCommunication.ts',
  'lib/website/customerApplicationLegal.ts',
  'lib/website/customerApplicationOnboarding.ts',
  'lib/website/customerApplicationRepair.ts',
  'lib/website/customerApplicationShared.ts',
].map(read).join('\\n')`

if (!source.includes(oldBinding)) {
  console.error('Current POA regression could not locate the legacy facade binding.')
  process.exit(1)
}

source = source.replace(oldBinding, currentBinding)

try {
  const run = new Function('require', 'process', 'console', source)
  run(require, process, console)
} catch (error) {
  console.error(error)
  process.exit(1)
}
