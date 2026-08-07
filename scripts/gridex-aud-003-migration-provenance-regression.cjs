const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const manifestPath = path.join(__dirname, 'migration-history-manifest.json');
const additionsPath = path.join(__dirname, 'migration-history-manifest.additions.json');
const ledgerPath = path.join(__dirname, 'gridex-aud-003-main-ledger.json');
const contractPath = path.join(root, 'docs', 'migration-provenance.md');
const runbookPath = path.join(root, 'docs', 'production-runbook.md');
const replayPath = path.join(__dirname, 'gridex-aud-003-clean-replay.sh');
const fingerprintPath = path.join(__dirname, 'gridex-aud-003-schema-fingerprint.sql');

function fail(message) {
  console.error(`[GRIDEX-AUD-003] ${message}`);
  process.exit(1);
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const additions = fs.existsSync(additionsPath)
  ? JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
  : { files: {} };
const pinned = { ...(manifest.files || {}), ...(additions.files || {}) };
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const contract = fs.readFileSync(contractPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');
const replay = fs.readFileSync(replayPath, 'utf8');

const foundation = [
  '01_db1_schema_repair_core_helpers_and_canonical_tables.sql',
  '02_db1_operations_ediel_billing_dedupe_and_storage.sql',
  '03_db1_backfill_functions_rls_reports_and_finish.sql',
  'ediel_rules.sql',
  'Batch 1+2.sql',
  'batch 3.sql',
  'batch 4+5+6.sql',
];

for (const name of foundation) {
  const filePath = path.join(migrationsDir, name);
  if (!fs.existsSync(filePath)) fail(`missing runbook foundation file: ${name}`);
  if (!pinned[name]) fail(`runbook foundation file is not checksum-pinned: ${name}`);
  const actual = sha256(filePath);
  if (actual !== pinned[name]) fail(`foundation checksum drift for ${name}: ${actual} != ${pinned[name]}`);
  if (!replay.includes(name)) fail(`clean replay no longer applies runbook foundation file: ${name}`);
}

const timestamped = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
if (!timestamped.length) fail('no timestamped migrations found');
for (const name of timestamped) {
  if (!pinned[name]) fail(`timestamped migration is not checksum-pinned: ${name}`);
  const actual = sha256(path.join(migrationsDir, name));
  if (actual !== pinned[name]) fail(`timestamped migration checksum drift for ${name}: ${actual} != ${pinned[name]}`);
}

const collisionVersions = new Map();
for (const name of timestamped) {
  const version = name.slice(0, 14);
  const arr = collisionVersions.get(version) || [];
  arr.push(name);
  collisionVersions.set(version, arr);
}
const actualCollisions = [...collisionVersions.entries()].filter(([, names]) => names.length > 1);
const allowed = manifest.allowedLegacyCollisions || {};
for (const [version, names] of actualCollisions) {
  const expected = [...(allowed[version] || [])].sort();
  const actual = [...names].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`unapproved legacy version collision ${version}: ${actual.join(', ')}`);
  }
}

if (!/Then all `YYYYMMDDHHMMSS_\*\.sql` in order/i.test(runbook)) {
  fail('production runbook no longer requires all timestamped migrations in order');
}
if (!replay.includes("re.match(r'^\\d{14}_.+\\.sql$'")) {
  fail('clean replay no longer derives its timestamped plan from every 14-digit repository migration');
}
if (!replay.includes('files.sort(key=lambda p:p.name)')) {
  fail('clean replay no longer sorts timestamped migrations deterministically by full filename');
}
if (!replay.includes('psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"')) {
  fail('clean replay no longer fails closed while applying historical SQL');
}
if (!replay.includes('supabase db push --local --include-all --yes')) {
  fail('clean replay no longer lets Supabase CLI own the compact ledger replay');
}
if (/insert\s+into\s+supabase_migrations|update\s+supabase_migrations|delete\s+from\s+supabase_migrations/i.test(replay)) {
  fail('clean replay directly mutates the Supabase migration ledger');
}
if (!fs.existsSync(fingerprintPath)) fail('schema fingerprint query is missing');
if (!/EXPECTED_FINGERPRINT="[0-9a-f]{64}"/.test(replay)) {
  fail('clean replay does not pin an exact 64-character dev schema fingerprint');
}
if (!replay.includes('ACTUAL_FINGERPRINT')) {
  fail('clean replay no longer compares the reconstructed schema fingerprint');
}

const entries = ledger.entries || [];
if (!entries.length) fail('official dev ledger snapshot is empty');
let last = '';
for (const entry of entries) {
  const version = String(entry.version || '');
  if (!/^\d{14}$/.test(version)) fail(`invalid official ledger version: ${version}`);
  if (!entry.name) fail(`official ledger entry ${version} has no name`);
  if (last && version <= last) fail(`official ledger is not strictly ordered: ${version} after ${last}`);
  last = version;
}

const earliestRepoVersion = timestamped[0].slice(0, 14);
const firstLedgerVersion = String(entries[0].version);
if (earliestRepoVersion >= firstLedgerVersion) {
  fail(`expected repository timestamped history before compact ledger start ${firstLedgerVersion}`);
}
if (!contract.includes(firstLedgerVersion)) {
  fail('migration provenance contract does not pin the compact ledger boundary');
}
if (!/all.*timestamped|alla.*timestamp/i.test(contract)) {
  fail('migration provenance contract does not document full timestamped replay');
}
if (!/no manual|inte manuellt/i.test(contract) || !/ledger/i.test(contract)) {
  fail('migration provenance contract no longer documents the no-manual-ledger rule');
}

for (const token of [
  'public.price_plans',
  'public.price_plan_versions',
  'public.contract_price_options',
  'public.portfolio_monthly_settlements',
  'gridex_contract_platform_readiness_internal_v1',
]) {
  if (!replay.includes(token)) fail(`clean replay lost critical historical smoke gate: ${token}`);
}

console.log(JSON.stringify({
  finding: 'GRIDEX-AUD-003',
  status: 'PASS',
  replay_model: 'runbook_full_timestamped_history_plus_cli_owned_compact_ledger',
  foundation_input_count: foundation.length,
  timestamped_file_count: timestamped.length,
  manifest_addition_count: Object.keys(additions.files || {}).length,
  allowed_legacy_collision_count: actualCollisions.length,
  earliest_repo_timestamped_version: earliestRepoVersion,
  compact_dev_ledger_start: firstLedgerVersion,
  compact_dev_ledger_rows: entries.length,
}, null, 2));
