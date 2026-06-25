#!/usr/bin/env node
// Batch 3 regression: Application Reference is policy-driven, route cannot override.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const resolver = read('lib/ediel/core/applicationReferenceResolver.ts')
const policy = read('lib/ediel/intent/applicationReferencePolicy.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')

// Resolver no longer lets the route profile override policy
assert(!/const routeValue = input\.routeProfile\?\.applicationReference[\s\S]*if \(routeValue\) return routeValue/.test(resolver), 'resolver no longer returns route profile application reference unconditionally')
assert(resolver.includes('export function validateRouteDeclaredApplicationReference'), 'resolver exposes route-declared validation (declare, not override)')

// Policy module
assert(policy.includes('export function validateApplicationReferencePolicy'), 'application reference policy exposes validateApplicationReferencePolicy')
assert(policy.includes('route_application_reference_mismatch'), 'policy blocks route/appref mismatch')
assert(policy.includes('application_reference_mismatch'), 'policy blocks provided/appref mismatch')
assert(policy.includes('correlatedApplicationReference') && policy.includes("family === 'APERAK'"), 'policy correlates APERAK/CONTRL application reference')
assert(policy.includes('evaluateApplicationReferenceGuard'), 'policy reuses canonical PRODAT DDQ/DGI guard')

// Intent validation enforces application reference policy
assert(engine.includes('validateApplicationReferencePolicy') && engine.includes('application_reference_policy'), 'intent validation enforces application reference policy')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 3 Application Reference policy regression passed.')
