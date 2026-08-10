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
const foundationOrderPath = path.join(__dirname, 'gridex-aud-003-foundation-order.json');
const noncanonicalPath = path.join(__dirname, 'gridex-aud-003-noncanonical-artifacts.json');
const ledgerPath = path.join(__dirname, 'gridex-aud-003-main-ledger.json');
const contractPath = path.join(root, 'docs', 'migration-provenance.md');
const runbookPath = path.join(root, 'docs', 'production-runbook.md');
const replayPath = path.join(__dirname, 'gridex-aud-003-clean-replay.sh');
const fingerprintPath = path.join(__dirname, 'gridex-aud-003-schema-fingerprint.sql');

function fail(message) {
  console.error(`[GRIDEX-REM-002] ${message}`);
  process.exit(1);
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function readJson(filePath, fallback) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}
function verifiedLiveSchemaEvidence(meta) {
  return meta.sourceKind === 'verified_live_schema' &&
    Boolean(meta.projectId) &&
    Boolean(meta.capturedAt) &&
    Array.isArray(meta.signatures) &&
    meta.signatures.length > 0;
}

const manifest = readJson(manifestPath, { files: {} });
const manifestAdditions = readJson(manifestAdditionsPath, { files: {} });
const pinned = { ...(manifest.files || {}), ...(manifestAdditions.files || {}) };
const foundationPlan = readJson(foundationPath, { foundation: [], derivedBootstrap: {} });
const foundationAdditions = readJson(foundationAdditionsPath, { foundation: [], derivedBootstrap: {}, interleaved: [] });
const foundationOrder = readJson(foundationOrderPath, { foundation: [] });
const foundation = [...(foundationPlan.foundation || []), ...(foundationAdditions.foundation || [])];
const orderedFoundation = foundationOrder.foundation || [];
const derived = { ...(foundationPlan.derivedBootstrap || {}), ...(foundationAdditions.derivedBootstrap || {}) };
const interleaved = foundationAdditions.interleaved || [];
const noncanonical = readJson(noncanonicalPath, { artifacts: [] });
const ledger = readJson(ledgerPath, { entries: [] });
const contract = fs.readFileSync(contractPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');
const replay = fs.readFileSync(replayPath, 'utf8');

if (!orderedFoundation.length) fail('foundation order is empty');
if (new Set(orderedFoundation).size !== orderedFoundation.length) fail('foundation order contains duplicate paths');
if (JSON.stringify([...orderedFoundation].sort()) !== JSON.stringify([...foundation].sort())) {
  fail('foundation order does not exactly match declared foundation inputs');
}

let derivedCount = 0;
for (const rel of orderedFoundation) {
  const filePath = path.join(supabaseDir, rel);
  if (!fs.existsSync(filePath)) fail(`missing foundation input: ${rel}`);
  const meta = derived[rel];
  if (meta) {
    derivedCount += 1;
    if (!meta.artifactSha256 || sha256(filePath) !== meta.artifactSha256) fail(`derived bootstrap checksum drift: ${rel}`);
    if (!verifiedLiveSchemaEvidence(meta)) {
      const sourcePath = path.join(supabaseDir, meta.source || '');
      if (!meta.source || !fs.existsSync(sourcePath)) fail(`derived bootstrap source missing: ${rel}`);
      const expected = pinned[path.basename(sourcePath)];
      if (!expected || sha256(sourcePath) !== expected) fail(`derived bootstrap source checksum drift: ${meta.source}`);
    }
  } else {
    const expected = pinned[path.basename(filePath)];
    if (!expected || sha256(filePath) !== expected) fail(`foundation source checksum drift: ${rel}`);
  }
}

for (const item of interleaved) {
  const rel = item.path || '';
  const after = String(item.afterLedgerVersion || '');
  const before = String(item.beforeLedgerVersion || '');
  if (!/^\d{14}$/.test(after) || !/^\d{14}$/.test(before) || after >= before) fail(`invalid interleaved boundary: ${rel}`);
  if (orderedFoundation.includes(rel)) fail(`interleaved artifact overlaps foundation: ${rel}`);
  const meta = derived[rel];
  const filePath = path.join(supabaseDir, rel);
  if (!meta || !fs.existsSync(filePath) || sha256(filePath) !== meta.artifactSha256) fail(`interleaved bootstrap drift: ${rel}`);
  if (!verifiedLiveSchemaEvidence(meta)) {
    const sourcePath = path.join(supabaseDir, meta.source || '');
    const expected = pinned[path.basename(sourcePath)];
    if (!meta.source || !fs.existsSync(sourcePath) || !expected || sha256(sourcePath) !== expected) fail(`interleaved source drift: ${rel}`);
  }
}

const timestamped = fs.readdirSync(migrationsDir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
if (!timestamped.length) fail('no timestamped migrations found');
for (const name of timestamped) {
  const expected = pinned[name];
  if (!expected) fail(`timestamped migration is not checksum-pinned: ${name}`);
  if (sha256(path.join(migrationsDir, name)) !== expected) fail(`timestamped migration checksum drift: ${name}`);
}

const noncanonicalArtifacts = noncanonical.artifacts || [];
if (!noncanonicalArtifacts.length) fail('noncanonical artifact contract is empty');
const noncanonicalPaths = new Set();
for (const item of noncanonicalArtifacts) {
  const rel = item.path || '';
  const name = path.basename(rel);
  if (noncanonicalPaths.has(rel)) fail(`duplicate noncanonical artifact: ${rel}`);
  noncanonicalPaths.add(rel);
  if (!rel.startsWith('migrations/') || item.status !== 'merged_repository_artifact_not_deployed') fail(`invalid noncanonical classification: ${rel}`);
  if (!item.reason || !(item.evidence || []).length || !/^[0-9a-f]{64}$/.test(item.sha256 || '')) fail(`incomplete noncanonical evidence: ${rel}`);
  const sourcePath = path.join(supabaseDir, rel);
  if (!fs.existsSync(sourcePath)) fail(`noncanonical artifact missing: ${rel}`);
  if (sha256(sourcePath) !== item.sha256 || pinned[name] !== item.sha256) fail(`noncanonical checksum mismatch: ${rel}`);
  if (orderedFoundation.includes(rel)) fail(`noncanonical artifact overlaps foundation: ${rel}`);
}

const collisionVersions = new Map();
for (const name of timestamped) {
  const version = name.slice(0, 14);
  collisionVersions.set(version, [...(collisionVersions.get(version) || []), name]);
}
const actualCollisions = [...collisionVersions.entries()].filter(([, names]) => names.length > 1);
const allowed = manifest.allowedLegacyCollisions || {};
for (const [version, names] of actualCollisions) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...(allowed[version] || [])].sort())) fail(`unapproved legacy version collision ${version}: ${names.join(', ')}`);
}

for (const requiredRef of [
  'gridex-aud-003-legacy-foundation.json',
  'gridex-aud-003-legacy-foundation.additions.json',
  'gridex-aud-003-foundation-order.json',
  'gridex-aud-003-noncanonical-artifacts.json',
  'migration-history-manifest.json',
  'migration-history-manifest.additions.json',
  'gridex-aud-003-main-ledger.json',
  'gridex-aud-003-schema-fingerprint.sql',
]) {
  if (!replay.includes(requiredRef)) fail(`clean replay lost required provenance input: ${requiredRef}`);
}
if (!replay.includes("files.sort(key=lambda p:p.name)")) fail('clean replay lost deterministic timestamped ordering');
if (!replay.includes('excluded') || !replay.includes('noncanonical')) fail('clean replay lost explicit noncanonical exclusion handling');
if (!replay.includes('interleaved_paths')) fail('clean replay lost interleaved bootstrap handling');
if (!replay.includes('supabase db push --local --include-all --yes')) fail('clean replay no longer lets Supabase CLI own ledger replay');
if (/insert\s+into\s+supabase_migrations|update\s+supabase_migrations|delete\s+from\s+supabase_migrations/i.test(replay)) fail('clean replay directly mutates the Supabase migration ledger');
if (!fs.existsSync(fingerprintPath)) fail('schema fingerprint query is missing');
if (!/EXPECTED_FINGERPRINT="[0-9a-f]{64}"/.test(replay) || !replay.includes('ACTUAL_FINGERPRINT')) fail('clean replay lost exact schema fingerprint gate');

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
if (!/(no manual|never manually|inte manuellt)/i.test(contract) || !/(ledger|schema_migrations)/i.test(contract)) fail('migration provenance contract no longer documents the no-manual-ledger rule');
if (!/noncanonical/i.test(contract) || !contract.includes('20260530123000')) fail('migration provenance contract lost the explicit noncanonical decision');
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
  finding: 'GRIDEX-REM-002',
  status: 'STATIC_PROVENANCE_PASS',
  replay_model: 'verified_foundation_plus_hash_bound_noncanonical_reconciliation_plus_remaining_history_plus_cli_owned_dev_ledger',
  foundation_input_count: orderedFoundation.length,
  derived_bootstrap_count: derivedCount,
  interleaved_bootstrap_count: interleaved.length,
  noncanonical_artifact_count: noncanonicalArtifacts.length,
  timestamped_file_count: timestamped.length,
  compact_dev_ledger_start: firstLedgerVersion,
  compact_dev_ledger_rows: entries.length,
}, null, 2));
