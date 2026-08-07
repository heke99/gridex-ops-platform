const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const supabaseDir = path.join(root, 'supabase');
const migrationsDir = path.join(supabaseDir, 'migrations');
const manifestPath = path.join(__dirname, 'migration-history-manifest.json');
const manifestAdditionsPath = path.join(__dirname, 'migration-history-manifest.additions.json');
const foundationPath = path.join(__dirname, 'gridex-aud-003-legacy-foundation.json');
const foundationAdditionsPath = path.join(__dirname, 'gridex-aud-003-legacy-foundation.additions.json');
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
function readJson(filePath, fallback) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

const manifest = readJson(manifestPath, { files: {} });
const manifestAdditions = readJson(manifestAdditionsPath, { files: {} });
const pinned = { ...(manifest.files || {}), ...(manifestAdditions.files || {}) };
const foundationPlan = readJson(foundationPath, { foundation: [], derivedBootstrap: {} });
const foundationAdditions = readJson(foundationAdditionsPath, { foundation: [], derivedBootstrap: {} });
const foundation = [...(foundationPlan.foundation || []), ...(foundationAdditions.foundation || [])];
const derived = { ...(foundationPlan.derivedBootstrap || {}), ...(foundationAdditions.derivedBootstrap || {}) };
const ledger = readJson(ledgerPath, { entries: [] });
const contract = fs.readFileSync(contractPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');
const replay = fs.readFileSync(replayPath, 'utf8');

if (!foundation.length) fail('foundation plan is empty');
if (new Set(foundation).size !== foundation.length) fail('foundation plan contains duplicate paths');

let derivedCount = 0;
for (const rel of foundation) {
  const filePath = path.join(supabaseDir, rel);
  if (!fs.existsSync(filePath)) fail(`missing foundation input: ${rel}`);
  const meta = derived[rel];
  if (meta) {
    derivedCount += 1;
    if (!meta.artifactSha256 || sha256(filePath) !== meta.artifactSha256) {
      fail(`derived bootstrap checksum drift: ${rel}`);
    }
    const sourcePath = path.join(supabaseDir, meta.source || '');
    if (!meta.source || !fs.existsSync(sourcePath)) fail(`derived bootstrap source missing: ${rel}`);
    const expected = pinned[path.basename(sourcePath)];
    if (!expected || sha256(sourcePath) !== expected) fail(`derived bootstrap source checksum drift: ${meta.source}`);
  } else {
    const expected = pinned[path.basename(filePath)];
    if (!expected || sha256(filePath) !== expected) fail(`foundation source checksum drift: ${rel}`);
  }
}

const timestamped = fs.readdirSync(migrationsDir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
if (!timestamped.length) fail('no timestamped migrations found');
for (const name of timestamped) {
  const expected = pinned[name];
  if (!expected) fail(`timestamped migration is not checksum-pinned: ${name}`);
  if (sha256(path.join(migrationsDir, name)) !== expected) fail(`timestamped migration checksum drift: ${name}`);
}

const collisionVersions = new Map();
for (const name of timestamped) {
  const version = name.slice(0, 14);
  collisionVersions.set(version, [...(collisionVersions.get(version) || []), name]);
}
const actualCollisions = [...collisionVersions.entries()].filter(([, names]) => names.length > 1);
const allowed = manifest.allowedLegacyCollisions || {};
for (const [version, names] of actualCollisions) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...(allowed[version] || [])].sort())) {
    fail(`unapproved legacy version collision ${version}: ${names.join(', ')}`);
  }
}

for (const requiredRef of [
  'gridex-aud-003-legacy-foundation.json',
  'gridex-aud-003-legacy-foundation.additions.json',
  'migration-history-manifest.json',
  'migration-history-manifest.additions.json',
  'gridex-aud-003-main-ledger.json',
  'gridex-aud-003-schema-fingerprint.sql',
]) {
  if (!replay.includes(requiredRef)) fail(`clean replay lost required provenance input: ${requiredRef}`);
}
if (!replay.includes('files.sort(key=lambda p:p.name)')) fail('clean replay lost deterministic timestamped ordering');
if (!replay.includes('skip_timestamp_names')) fail('clean replay lost explicit substitution/pre-execution exclusion');
if (!replay.includes('supabase db push --local --include-all --yes')) fail('clean replay no longer lets Supabase CLI own ledger replay');
if (/insert\s+into\s+supabase_migrations|update\s+supabase_migrations|delete\s+from\s+supabase_migrations/i.test(replay)) {
  fail('clean replay directly mutates the Supabase migration ledger');
}
if (!fs.existsSync(fingerprintPath)) fail('schema fingerprint query is missing');
if (!/EXPECTED_FINGERPRINT="[0-9a-f]{64}"/.test(replay) || !replay.includes('ACTUAL_FINGERPRINT')) {
  fail('clean replay lost exact schema fingerprint gate');
}

const entries = ledger.entries || [];
if (!entries.length) fail('official dev ledger snapshot is empty');
let last = '';
for (const entry of entries) {
  const version = String(entry.version || '');
  if (!/^\d{14}$/.test(version) || !entry.name) fail(`invalid official ledger entry: ${JSON.stringify(entry)}`);
  if (last && version <= last) fail(`official ledger is not strictly ordered: ${version} after ${last}`);
  last = version;
}
const firstLedgerVersion = String(entries[0].version);
if (!contract.includes(firstLedgerVersion)) fail('migration provenance contract does not pin compact ledger boundary');
if (!/(no manual|never manually|inte manuellt)/i.test(contract) || !/(ledger|schema_migrations)/i.test(contract)) {
  fail('migration provenance contract no longer documents the no-manual-ledger rule');
}
if (!/YYYYMMDDHHMMSS|timestamped/i.test(runbook)) fail('production runbook timestamped migration rule is missing');

for (const token of [
  'public.metering_permissions',
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
  replay_model: 'verified_foundation_substitutions_plus_remaining_history_plus_cli_owned_compact_ledger',
  foundation_input_count: foundation.length,
  derived_bootstrap_count: derivedCount,
  timestamped_file_count: timestamped.length,
  manifest_addition_count: Object.keys(manifestAdditions.files || {}).length,
  allowed_legacy_collision_count: actualCollisions.length,
  compact_dev_ledger_start: firstLedgerVersion,
  compact_dev_ledger_rows: entries.length,
}, null, 2));
