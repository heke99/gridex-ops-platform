const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const suites = [
  'scripts/gridex-contract-tenant-lifecycle-regression.cjs',
  'scripts/gridex-multitenant-website-application-flow-regression.cjs',
  'scripts/gridex-website-application-ops-chain-regression.cjs',
  'scripts/gridex-customer-application-continuation-regression.cjs',
  'scripts/gridex-customer-application-review-regression.cjs',
  'scripts/gridex-website-api-power-of-attorney-regression.cjs',
  'scripts/gridex-quote-idempotency-multitenant-regression.cjs',
  'scripts/canonical-production-hardening-regression.cjs',
]

for (const relative of suites) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) {
    console.error(`Golden-path suite missing: ${relative}`)
    process.exit(1)
  }

  const result = spawnSync(process.execPath, [absolute], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' },
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    console.error(`Composed golden-path gate failed in ${relative}`)
    process.exit(result.status || 1)
  }
}

console.log(`Gridex composed golden-path regression passed (${suites.length}/${suites.length} suites)`)
