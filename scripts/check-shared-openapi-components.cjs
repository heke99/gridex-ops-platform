#!/usr/bin/env node
const fs = require('node:fs')
const website = JSON.parse(fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
const portal = JSON.parse(fs.readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
const staff = JSON.parse(fs.readFileSync('docs/openapi/staff-v1.json', 'utf8'))
const failures = []
if (Object.keys(staff.paths ?? {}).some(path => !path.startsWith('/api/v1/staff/') && !path.startsWith('/api/v1/openapi/'))) failures.push('staff-v1.json must contain only staff operations and public OpenAPI documents.')
for (const document of [website, portal]) {
  if (Object.keys(document.paths ?? {}).some(path => path.startsWith('/api/v1/staff/'))) failures.push('Staff business operations belong only to staff-v1.json.')
}
if (Object.keys(portal.paths ?? {}).some((path) => path.startsWith('/api/v1/website/'))) {
  failures.push('customer-portal-v1.json must not contain website checkout routes.')
}
if (!website.paths?.['/api/v1/website/market-price/current']) {
  failures.push('website-integration-v1.json must contain current market-price route.')
}
if (portal.components?.schemas?.MarketReference) {
  failures.push('MarketReference belongs to website integration and must not be duplicated in the customer portal spec.')
}
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('OpenAPI responsibility boundaries OK.')
