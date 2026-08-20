#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const budgets = require('../quality/performance-budgets.json').stagingSlo
const profiles = {
  smoke: ['e2e/k6/platform-smoke.js', 'http_req_duration', 'http_req_failed'],
  load: ['e2e/k6/platform-load.js', 'http_req_duration', 'http_req_failed'],
  spike: ['e2e/k6/platform-spike.js', 'http_req_duration', 'http_req_failed'],
  soak: ['e2e/k6/platform-soak.js', 'http_req_duration', 'http_req_failed'],
  etagFull: ['e2e/k6/public-contract-cache.js', 'contract_feed_full_duration', 'http_req_failed'],
  etag304: ['e2e/k6/public-contract-cache.js', 'contract_feed_not_modified_duration', 'contract_feed_conditional_miss'],
}
const violations = []

for (const [profile, [file, durationMetric, failureMetric]] of Object.entries(profiles)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const slo = budgets[profile]
  for (const threshold of [
    `${durationMetric}: ['p(95)<${slo.p95Milliseconds}', 'p(99)<${slo.p99Milliseconds}']`,
    `${failureMetric}: ['rate<${slo.maximumFailureRate}']`,
  ]) {
    if (!source.includes(threshold)) violations.push(`${profile} is missing canonical threshold ${threshold}`)
  }
}

if (violations.length > 0) {
  console.error(`Performance SLO contract failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`)
  process.exit(1)
}

console.log('Performance SLO contract passed for smoke, load, spike, soak and ETag full/304 profiles.')
