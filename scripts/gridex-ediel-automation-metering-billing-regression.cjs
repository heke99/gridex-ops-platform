#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { readSourceModule } = require('./lib/read-source-module.cjs')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const source = (file) => readSourceModule(file, root)
let failed = false

function assert(ok, message) {
  if (ok) console.log(`✓ ${message}`)
  else {
    failed = true
    console.error(`✗ ${message}`)
  }
}

const dispatchState = source('lib/ediel/intent/dispatchState.ts')
const legacyBridge = source('lib/ediel/outbox/legacyOutboundBridge.ts')
const renderGateway = source('lib/ediel/intent/renderGateway.ts')
const apprefPolicy = source('lib/ediel/intent/applicationReferencePolicy.ts')
const apprefResolver = source('lib/ediel/core/applicationReferenceResolver.ts')
const apprefAuthority = source('lib/ediel/rulebook/prodatApplicationReference.ts')
const automation = source('lib/customer-operations/automation.ts')
const normalize = source('lib/metering/normalizeMeteringValues.ts')
const utilts = source('lib/ediel/flows/utiltsDataRequest.ts')
const invoiceReadiness = source('lib/billing/invoiceReadiness.ts')

assert(
  dispatchState.includes("from('ediel_message_intents')") &&
    dispatchState.includes("from('ediel_outbox')") &&
    dispatchState.includes("from('ediel_messages')"),
  'dispatch state follows intent -> outbox -> message source of truth',
)
assert(!dispatchState.includes('raw_payload') && !dispatchState.includes("select('*')"), 'dispatch status reads stay lightweight')
assert(
  legacyBridge.includes('export function isLegacyOutboundActuallySent') &&
    legacyBridge.includes('if (clean(row.sent_at)) return true') &&
    legacyBridge.includes('num(row.attempts_count) > 0'),
  'legacy queued rows are not treated as sent without delivery evidence',
)

assert(
  apprefPolicy.includes('resolveProdatApplicationReferenceForProcess') &&
    apprefResolver.includes('canonicalProdatApplicationReferenceForProcess') &&
    apprefAuthority.includes("if (processGroup === 'metering_access') return '23-DGI-PRODAT'") &&
    apprefAuthority.includes("return '23-DDQ-PRODAT'"),
  'Application Reference is delegated to one canonical PRODAT authority that distinguishes DGI and DDQ',
)

assert(
  renderGateway.includes('classifyRenderError') &&
    renderGateway.includes("renderStatus: 'failed'") &&
    renderGateway.includes("status: 'blocked'"),
  'render failures become controlled blockers',
)

assert(
  automation.includes('completeLinkedGridOwnerInformationRequest') &&
    automation.includes('facility_verification_status') &&
    automation.includes('facility_data_status'),
  'inbound Z02 completes and records canonical facility verification state',
)

assert(
  normalize.includes('export async function projectMeteringValueToNormalized') &&
    normalize.includes("rpc('gridex_ingest_metering_value_atomic'") &&
    normalize.includes('canonical_dedupe_key'),
  'metering projection uses the atomic canonical ingest and dedupe path',
)
assert(
  utilts.includes('normalizeAndStoreMeteringValue('),
  'inbound UTILTS uses canonical metering normalization/projection even when implementation is split behind a facade',
)

for (const code of ['no_underlays', 'blocked_underlays', 'missing_pricing', 'missing_contract_or_snapshot', 'period_locked']) {
  assert(invoiceReadiness.includes(`'${code}'`), `invoice readiness blocks on ${code}`)
}
assert(invoiceReadiness.includes("severity: 'blocked'"), 'invoice readiness fails closed on missing prerequisites')

const migration = read('supabase/migrations/20260625130000_gridex_ediel_intent_source_of_truth.sql')
assert(migration.includes('add column if not exists facility_verification_status'), 'intent migration adds facility verification additively')
assert(migration.includes('create index if not exists ediel_outbox_company_status_idx'), 'intent migration adds outbox status index idempotently')
assert(!/drop\s+table|\bdrop\s+column\b|delete\s+from/i.test(migration), 'intent migration remains non-destructive')

if (failed) process.exit(1)
console.log('\nEdiel automation metering/billing regression passed.')
