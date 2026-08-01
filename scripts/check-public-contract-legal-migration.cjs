#!/usr/bin/env node
const fs = require('node:fs')

const migrationPath =
  'supabase/migrations/20260801003000_public_contract_runtime_openapi_legal_parity.sql'
const sql = fs.readFileSync(migrationPath, 'utf8')
const failures = []

function requirePattern(pattern, message) {
  if (!pattern.test(sql)) failures.push(message)
}

function rejectPattern(pattern, message) {
  if (pattern.test(sql)) failures.push(message)
}

requirePattern(
  /gridex_publication_legal_snapshot_json_v1\s*\(\s*p_company_id uuid,\s*p_legal_bundle_version_id uuid\s*\)/i,
  'Canonical legal snapshot helper must take the exact company and bundle-version IDs.',
)
requirePattern(
  /where bundle\.id=p_legal_bundle_version_id[\s\S]*bundle\.company_id=p_company_id[\s\S]*bundle\.locked_at is not null/i,
  'Legal snapshot lookup must use the exact company-owned locked bundle relation.',
)
requirePattern(
  /'legal_bundle_version_id',bundle\.id/i,
  'Top-level legal snapshot must expose legal_bundle_version_id.',
)
requirePattern(
  /'legal_bundle_version_id',document\.legal_bundle_version_id/i,
  'Every legal module row must expose legal_bundle_version_id.',
)
requirePattern(
  /gridex_list_external_api_contracts[\s\S]*'legal',public\.gridex_publication_legal_snapshot_json_v1/i,
  'The external API RPC must include canonical legal data.',
)
requirePattern(
  /gridex_preview_public_contract_legal_backfill_v1/i,
  'A read-only legal backfill preview function is required.',
)
requirePattern(
  /gridex_apply_public_contract_legal_backfill_v1/i,
  'An idempotent legal backfill function is required.',
)
for (const counter of [
  'scanned',
  'already_valid',
  'backfilled',
  'ambiguous',
  'missing_source',
  'blocked',
  'failed',
]) {
  requirePattern(
    new RegExp(`'${counter}'\\s*,`, 'i'),
    `Backfill result must report ${counter}.`,
  )
}
requirePattern(
  /'derivation_method',candidate\.derivation_method/i,
  'Backfill audit metadata must record the derivation method.',
)
requirePattern(
  /'commercial_values_changed',false/i,
  'Backfill audit metadata must prove commercial values are unchanged.',
)
requirePattern(
  /content_sha256=v_after_hash/i,
  'Backfill must recompute the publication content checksum.',
)
requirePattern(
  /p_dry_run boolean default true/i,
  'Backfill must default to dry-run mode.',
)
requirePattern(
  /exact_locked_bundle_relation/i,
  'Backfill must identify its exact immutable source relation.',
)
requirePattern(
  /revoke all on function[\s\S]*grant execute on function[\s\S]*to service_role/i,
  'Backfill functions must be restricted to service_role.',
)

// The bundle source may never be guessed by ordering versions and taking one.
rejectPattern(
  /from public\.legal_bundle_versions[\s\S]{0,500}order by[\s\S]{0,200}limit\s+1/i,
  'Migration must never select the first/latest legal bundle version.',
)
rejectPattern(
  /max\s*\(\s*(?:bundle\.)?(?:id|published_at|created_at)\s*\)/i,
  'Migration must never infer a bundle version with max().',
)
rejectPattern(
  /min\s*\(\s*(?:bundle\.)?id\s*\)/i,
  'Migration must never infer a bundle version with min(uuid).',
)

if (failures.length) {
  console.error(`Public-contract legal migration check failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Public-contract legal migration check passed.')
