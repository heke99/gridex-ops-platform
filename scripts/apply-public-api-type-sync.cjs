#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const file = 'app/api/v1/website/public-contracts/route.ts'
const source = fs.readFileSync(file, 'utf8')
const from = '      tenantReference: tenant.tenant_reference,'
const to = '      organizationReference,'
if (source.includes(from)) {
  fs.writeFileSync(file, source.replaceAll(from, to))
  console.log(`${file}: synchronized ETag organizationReference call-site`)
} else if (source.includes(to)) {
  console.log(`${file}: already synchronized`)
} else {
  throw new Error(`${file}: expected public-contract ETag call-site not found`)
}
