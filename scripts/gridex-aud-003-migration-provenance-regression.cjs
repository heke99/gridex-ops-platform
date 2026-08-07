const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const planPath = path.join(__dirname, 'gridex-aud-003-legacy-foundation.json');
const manifestPath = path.join(__dirname, 'migration-history-manifest.json');
const additionsPath = path.join(__dirname, 'migration-history-manifest.additions.json');
const runbookPath = path.join(root, 'docs', 'production-runbook.md');

function fail(message) {
  console.error(`[GRIDEX-AUD-003] ${message}`);
  process.exit(1);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const additions = fs.existsSync(additionsPath)
  ? JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
  : { files: {} };
const pinnedFiles = { ...(manifest.files || {}), ...(additions.files || {}) };
const runbook = fs.readFileSync(runbookPath, 'utf8');

const legacyOrder = [...plan.foundation, ...plan.controlledReconciliation];
if (legacyOrder.length !== 13) {
  fail(`expected exactly 13 documented legacy foundation/reconciliation files, found ${legacyOrder.length}`);
}
if (new Set(legacyOrder).size !== legacyOrder.length) {
  fail('legacy migration order contains duplicate file names');
}

for (const file of legacyOrder) {
  const filePath = path.join(migrationsDir, file);
  if (!fs.existsSync(filePath)) fail(`missing legacy migration: ${file}`);
  const expected = pinnedFiles[file];
  if (!expected) fail(`legacy migration is not checksum-pinned: ${file}`);
  const actual = sha256(filePath);
  if (actual !== expected) {
    fail(`checksum drift for ${file}: expected ${expected}, got ${actual}`);
  }
  if (!runbook.includes(`\`${file}\``)) {
    fail(`production runbook no longer documents legacy migration: ${file}`);
  }
}

const core = fs.readFileSync(path.join(migrationsDir, plan.foundation[0]), 'utf8');
if (!/create\s+table\s+if\s+not\s+exists\s+public\.companies\s*\(/i.test(core)) {
  fail(`${plan.foundation[0]} no longer creates public.companies`);
}
if (!/Kör först|run first|apply.*before/i.test(core)) {
  fail(`${plan.foundation[0]} no longer carries explicit first-step bootstrap provenance`);
}

const timestampedPattern = new RegExp(plan.rules.timestampedMigrationPattern);
const timestamped = fs.readdirSync(migrationsDir)
  .filter((name) => timestampedPattern.test(name))
  .sort();
if (timestamped.length === 0) fail('no canonical 14-digit timestamp migrations found');

const versions = timestamped.map((name) => name.slice(0, 14));
const earliestRepoVersion = versions[0];
if (earliestRepoVersion >= plan.firstTrackedRemoteVersion) {
  fail(`expected repository history before remote ledger start ${plan.firstTrackedRemoteVersion}, earliest repo version is ${earliestRepoVersion}`);
}

const preLedger = timestamped.filter((name) => name.slice(0, 14) < plan.firstTrackedRemoteVersion);
if (preLedger.length === 0) {
  fail('expected at least one timestamped repository migration before the current remote ledger start');
}

if (!/before.*timestamped|före.*timestamp/i.test(runbook)) {
  fail('production runbook no longer states that the legacy foundation precedes timestamped migrations');
}

console.log(JSON.stringify({
  finding: 'GRIDEX-AUD-003',
  status: 'PASS',
  legacy_file_count: legacyOrder.length,
  foundation_file_count: plan.foundation.length,
  controlled_reconciliation_file_count: plan.controlledReconciliation.length,
  timestamped_file_count: timestamped.length,
  earliest_repo_timestamped_version: earliestRepoVersion,
  tracked_remote_ledger_start: plan.firstTrackedRemoteVersion,
  timestamped_files_before_remote_ledger: preLedger,
}, null, 2));
