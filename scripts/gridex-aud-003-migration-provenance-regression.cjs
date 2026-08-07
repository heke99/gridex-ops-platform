const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const supabaseDir = path.join(root, 'supabase');
const migrationsDir = path.join(supabaseDir, 'migrations');
const planPath = path.join(__dirname, 'gridex-aud-003-legacy-foundation.json');
const planAdditionsPath = path.join(__dirname, 'gridex-aud-003-legacy-foundation.additions.json');
const manifestPath = path.join(__dirname, 'migration-history-manifest.json');
const additionsPath = path.join(__dirname, 'migration-history-manifest.additions.json');
const contractPath = path.join(root, 'docs', 'migration-provenance.md');
const runbookPath = path.join(root, 'docs', 'production-runbook.md');
const replayPath = path.join(__dirname, 'gridex-aud-003-clean-replay.sh');

function fail(message) {
  console.error(`[GRIDEX-AUD-003] ${message}`);
  process.exit(1);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function supabasePath(relativePath) {
  return path.join(supabaseDir, relativePath);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const planAdditions = fs.existsSync(planAdditionsPath)
  ? JSON.parse(fs.readFileSync(planAdditionsPath, 'utf8'))
  : { foundation: [], derivedBootstrap: {} };
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const additions = fs.existsSync(additionsPath)
  ? JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
  : { files: {} };
const pinnedFiles = { ...(manifest.files || {}), ...(additions.files || {}) };
const contract = fs.readFileSync(contractPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');
const replay = fs.readFileSync(replayPath, 'utf8');

const foundation = [...plan.foundation, ...(planAdditions.foundation || [])];
const derivedBootstrap = { ...(plan.derivedBootstrap || {}), ...(planAdditions.derivedBootstrap || {}) };
const bootstrapOrder = [...foundation, ...plan.controlledReconciliation];
const expectedBootstrapInputCount = plan.expectedBootstrapInputCount + (planAdditions.foundation || []).length;
if (bootstrapOrder.length !== expectedBootstrapInputCount) {
  fail(`expected ${expectedBootstrapInputCount} documented bootstrap inputs, found ${bootstrapOrder.length}`);
}
if (new Set(bootstrapOrder).size !== bootstrapOrder.length) {
  fail('bootstrap order contains duplicate paths');
}

for (const relativePath of bootstrapOrder) {
  const filePath = supabasePath(relativePath);
  if (!fs.existsSync(filePath)) fail(`missing bootstrap input: ${relativePath}`);

  const derived = derivedBootstrap[relativePath];
  if (derived) {
    const actualArtifactHash = sha256(filePath);
    if (actualArtifactHash !== derived.artifactSha256) {
      fail(`derived bootstrap drift for ${relativePath}: expected ${derived.artifactSha256}, got ${actualArtifactHash}`);
    }
    const sourcePath = supabasePath(derived.source);
    if (!fs.existsSync(sourcePath)) fail(`missing derived bootstrap source: ${derived.source}`);
    const sourceName = path.basename(derived.source);
    const expectedSourceHash = pinnedFiles[sourceName];
    if (!expectedSourceHash) fail(`derived bootstrap source is not checksum-pinned: ${sourceName}`);
    const actualSourceHash = sha256(sourcePath);
    if (actualSourceHash !== expectedSourceHash) {
      fail(`source checksum drift for ${sourceName}: expected ${expectedSourceHash}, got ${actualSourceHash}`);
    }
  } else {
    const migrationName = path.basename(relativePath);
    const expected = pinnedFiles[migrationName];
    if (!expected) fail(`historical migration is not checksum-pinned: ${migrationName}`);
    const actual = sha256(filePath);
    if (actual !== expected) {
      fail(`checksum drift for ${migrationName}: expected ${expected}, got ${actual}`);
    }
  }

  const contractToken = `\`${relativePath}\``;
  const basenameToken = `\`${path.basename(relativePath)}\``;
  if (!contract.includes(contractToken) && !contract.includes(basenameToken)) {
    fail(`migration provenance contract no longer documents bootstrap input: ${relativePath}`);
  }
}

const operationJobsBootstrap = 'bootstrap/20260618_customer_operation_jobs_foundation.sql';
const workflowsBootstrap = 'bootstrap/20260618_customer_application_workflows_foundation.sql';
const continuationBootstrap = 'bootstrap/20260724_customer_application_continuation_schema_foundation.sql';
for (const token of [operationJobsBootstrap, workflowsBootstrap, continuationBootstrap]) {
  if (!replay.includes(token)) fail(`clean replay no longer includes ${token}`);
}
if (replay.indexOf(operationJobsBootstrap) > replay.indexOf(workflowsBootstrap)) {
  fail('customer operation jobs foundation must run before customer application workflows');
}
if (replay.indexOf(operationJobsBootstrap) > replay.indexOf(continuationBootstrap)) {
  fail('customer operation jobs foundation must run before application continuation schema');
}
const operationJobsSql = fs.readFileSync(supabasePath(operationJobsBootstrap), 'utf8');
if (!/create\s+table\s+if\s+not\s+exists\s+public\.customer_operation_jobs\s*\(/i.test(operationJobsSql)) {
  fail(`${operationJobsBootstrap} no longer creates public.customer_operation_jobs`);
}
if (/gridex_claim_customer_operation_jobs/i.test(operationJobsSql)) {
  fail(`${operationJobsBootstrap} must not replay worker RPC behavior`);
}

const corePath = supabasePath(plan.foundation[0]);
const core = fs.readFileSync(corePath, 'utf8');
if (!/create\s+table\s+if\s+not\s+exists\s+public\.companies\s*\(/i.test(core)) {
  fail(`${plan.foundation[0]} no longer creates public.companies`);
}
if (!/Kör först|run first|apply.*before/i.test(core)) {
  fail(`${plan.foundation[0]} no longer carries explicit first-step bootstrap provenance`);
}

const meteringBootstrap = 'bootstrap/20260520_metering_permissions_foundation.sql';
const edielRules = 'migrations/ediel_rules.sql';
if (plan.foundation.indexOf(meteringBootstrap) < 0 || plan.foundation.indexOf(edielRules) < 0) {
  fail('metering bootstrap and ediel_rules.sql must both be explicit bootstrap inputs');
}
if (plan.foundation.indexOf(meteringBootstrap) > plan.foundation.indexOf(edielRules)) {
  fail('metering permissions bootstrap must run before ediel_rules.sql');
}
const meteringSql = fs.readFileSync(supabasePath(meteringBootstrap), 'utf8');
if (!/create\s+table\s+if\s+not\s+exists\s+public\.metering_permissions\s*\(/i.test(meteringSql)) {
  fail(`${meteringBootstrap} no longer creates public.metering_permissions`);
}
if (/billing_export_(runs|run_items)/i.test(meteringSql)) {
  fail(`${meteringBootstrap} must not replay unrelated billing export schema`);
}
const sourceRel = derivedBootstrap[meteringBootstrap].source;
const sourceSql = fs.readFileSync(supabasePath(sourceRel), 'utf8');
if (!/create\s+table\s+if\s+not\s+exists\s+public\.metering_permissions\s*\(/i.test(sourceSql)) {
  fail(`derived source ${sourceRel} no longer contains public.metering_permissions DDL`);
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

if (!contract.includes(plan.firstTrackedRemoteVersion)) {
  fail('migration provenance contract does not pin the current remote ledger boundary');
}
if (!/before.*14-digit|före.*14-siffrig|before.*timestamped|före.*timestamp/i.test(runbook)) {
  fail('production runbook no longer states that the historical bootstrap precedes canonical migrations');
}
if (!plan.rules.legacyFilesRemainImmutable || !plan.rules.doNotRenameLegacyFiles || !plan.rules.doNotEditRemoteLedgerDirectly) {
  fail('provenance safety rules were weakened');
}

console.log(JSON.stringify({
  finding: 'GRIDEX-AUD-003',
  status: 'PASS',
  bootstrap_input_count: bootstrapOrder.length,
  foundation_input_count: foundation.length,
  controlled_reconciliation_input_count: plan.controlledReconciliation.length,
  derived_bootstrap_count: Object.keys(derivedBootstrap).length,
  timestamped_file_count: timestamped.length,
  earliest_repo_timestamped_version: earliestRepoVersion,
  tracked_remote_ledger_start: plan.firstTrackedRemoteVersion,
  timestamped_files_before_remote_ledger: preLedger,
}, null, 2));