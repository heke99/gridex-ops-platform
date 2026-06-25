#!/usr/bin/env node
// Batch 8 regression: AI/BI import is reconciliation, never masterdata auto-overwrite.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const engine = read('lib/ediel/aiBiImportEngine.ts')
const recon = read('lib/ediel/aiBiReconciliation.ts')
const migration = read('supabase/migrations/20260625120000_ai_bi_reconciliation_approval_audit.sql')

// Import engine writes ONLY reconciliation tables, never masterdata
assert(engine.includes("from('ai_list_imports')") && engine.includes("from('ai_list_import_rows')") && engine.includes("from('ai_list_discrepancies')"), 'import engine creates reconciliation runs/rows/discrepancies')
for (const table of ['customer_sites', 'metering_points', 'contracts', 'customer_contracts', 'supplier_switch_requests']) {
  const writesTable = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,80}\\.(update|upsert|insert)`).test(engine)
  assert(!writesTable, `import engine never writes ${table}`)
}

// Reconciliation module guards + approval workflow
assert(recon.includes('AI_BI_PROTECTED_MASTERDATA_TABLES'), 'reconciliation defines protected masterdata tables')
assert(recon.includes('export function assertAiBiNeverOverwritesMasterdata'), 'reconciliation exposes no-auto-overwrite guard')
assert(recon.includes('export async function approveAiBiDiscrepancy'), 'reconciliation exposes admin approval workflow')
assert(recon.includes('resolved_by') && recon.includes('resolved_at') && recon.includes('resolution'), 'approval workflow writes an audit trail')
assert(recon.includes("decision === 'rejected'") && recon.includes("status"), 'approval records accept/reject decision')

// Retention / GDPR metadata
assert(engine.includes('retention_until') && engine.includes('gdpr_basis'), 'import saves retention/GDPR metadata')
assert(engine.includes('masterdataAutoOverwrite: false') && engine.includes('reconciliationOnly: true'), 'import metadata documents reconciliation-only, no auto-overwrite')

// Migration adds approval/audit/retention columns idempotently and additively
assert(migration.includes('add column if not exists resolution') && migration.includes('add column if not exists resolved_by'), 'migration adds discrepancy approval/audit columns')
assert(migration.includes('add column if not exists retention_until') && migration.includes('add column if not exists gdpr_basis'), 'migration adds retention/GDPR columns')
assert(migration.includes('alter table if exists') && !/drop table/i.test(migration), 'migration is additive, idempotent and non-destructive')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 8 AI/BI reconciliation regression passed.')
