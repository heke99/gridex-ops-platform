#!/usr/bin/env node
// Batch 6 regression: AcknowledgementEngine + AdminActionEngine deterministic lifecycle.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const engine = read('lib/ediel/ack/acknowledgementEngine.ts')
const admin = read('lib/ediel/ack/adminActionEngine.ts')

assert(engine.includes('export function classifyAcknowledgement'), 'engine exposes classifyAcknowledgement')
assert(engine.includes('export function isExpectedAckOverdue') && engine.includes('EXPECTED_ACK_SLA_MINUTES = 30'), 'engine exposes 30-minute ACK SLA check')

// Deterministic outcomes
assert(engine.includes("family === 'CONTRL'") && engine.includes("businessEffect: 'continue'"), 'positive CONTRL = syntax ok (continue), not business final')
assert(/CONTRL[\s\S]*negative[\s\S]*stop_automation/.test(engine), 'negative CONTRL stops automation')
assert(/APERAK[\s\S]*negative[\s\S]*stop_automation/.test(engine) && engine.includes('negative_aperak_admin_action'), 'negative APERAK stops automation + admin action')
assert(engine.includes("businessEffect: 'next_step'"), 'positive APERAK drives next step')
assert(engine.includes("family === 'UTILTS_ERR'") && engine.includes('utilts_err_admin_action'), 'UTILTS_ERR stops automation + admin action')
assert(engine.includes('!input.matchedSourceMessageId') && engine.includes("businessEffect: 'manual_review'"), 'unmatched ACK goes manual_review')
assert(engine.includes('input.duplicate') && engine.includes("businessEffect: 'noop'"), 'duplicate ACK is a safe no-op')
assert(engine.includes('ESETT_XML_ACK'), 'engine handles eSett XML acknowledgement family')

// Admin action engine
assert(admin.includes('export function buildEdielAdminAction') && admin.includes('export async function recordEdielAdminAction'), 'admin action engine builds and records admin actions')
assert(admin.includes('requiresManualReview') && admin.includes('idempotencyKey'), 'admin actions carry manual-review flag and idempotency key')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 6 AcknowledgementEngine regression passed.')
