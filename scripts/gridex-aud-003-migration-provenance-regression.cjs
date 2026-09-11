const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const supabaseDir = path.join(root, 'supabase');
const migrationsDir = path.join(supabaseDir, 'migrations');
const manifestPath = path.join(__dirname, 'migration-history-manifest.json');
const manifestAdditionsPath = path.join(__dirname, 'migration-history-manifest.additions.json');
const manifestRuntimeAdditionsPath = path.join(__dirname, 'migration-history-manifest.runtime.additions.json');
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
function assertLiveSchemaArtifactSyntax(filePath, rel) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (/\$[A-Za-z0-9_]*\$(?!;)[ \t]*\n[ \t]*(?:revoke|grant|create)\b/i.test(source)) {
    fail(`verified live-schema function is missing a statement terminator: ${rel}`);
  }
}

const manifest = readJson(manifestPath, { files: {} });
const manifestAdditions = readJson(manifestAdditionsPath, { files: {} });
const manifestRuntimeAdditions = readJson(manifestRuntimeAdditionsPath, { files: {} });
const pinned = { ...(manifest.files || {}), ...(manifestAdditions.files || {}), ...(manifestRuntimeAdditions.files || {}) };
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
    } else {
      assertLiveSchemaArtifactSyntax(filePath, rel);
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
  } else {
    assertLiveSchemaArtifactSyntax(filePath, rel);
  }
}

const timestamped = fs.readdirSync(migrationsDir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
if (!timestamped.length) fail('no timestamped migrations found');
for (const name of timestamped) {
  const expected = pinned[name];
  if (!expected) fail(`timestamped migration is not checksum-pinned: ${name}`);
  if (sha256(path.join(migrationsDir, name)) !== expected) fail(`timestamped migration checksum drift: ${name}`);
}

// Independent finite content pins: updating JSON cannot authorize new diagnostic SQL.
const reviewedDiagnostics = {
  "migrations/20260525_debug_batch_2j_verify_no_old_afshin_id.sql": "10874b4600763f89d7e0f1c9e4c3e1e57c9e5ea50928d1af97b9d43185ec0da9",
  "migrations/20260525_verify_company_user_provisioning_flow.sql": "b0e38917e7e5ec00310b0246f306ec4614808ed16964b6488c845b107ec7403f"
};
const reviewedOperationalRepairs = {
  "migrations/02_db2b_apply_superadmin_and_membership.sql": {
    "sha256": "64671e13a4390e0d464a24198cd6ad27a38908c9816e3c597dc5119afc95dbc4",
    "dependencies": [
      {
        "path": "migrations/20260611150000_launch_readiness_security_routes_stats.sql",
        "sha256": "3fa71292b07e4534dab13c1f2ef28574a0635fad17db736201f4eed23f6dd053"
      },
      {
        "path": "migrations/20260727040000_contract_security_energy_direction_api_completion.sql",
        "sha256": "c608cb8ca01792971c7dd3974b63138f8ec5d016b643eeff2f7d49f721a9867e"
      },
      {
        "path": "migrations/20260802170000_canonical_security_convergence.sql",
        "sha256": "e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a"
      }
    ]
  }
};
reviewedOperationalRepairs["migrations/02_db2_execute_controlled_reconciliation.sql"] = {
  "sha256": "fcdc75e660f157a58e742f64b3e8f7a1c6801565ef16023bd0c9a317982744c9",
  "dependencies": [
    {
      "path": "migrations/01_db2_full_view_preflight_schema_and_functions.sql",
      "sha256": "4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9"
    },
    {
      "path": "migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql",
      "sha256": "85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2"
    },
    {
      "path": "migrations/03_db1_backfill_functions_rls_reports_and_finish.sql",
      "sha256": "877e395df0050a36ec71298d279c72fb0e6cb13d8b90082277450012e196f169"
    },
    {
      "path": "migrations/20260522_db1_schema_repair_backfill_foundation.sql",
      "sha256": "aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73"
    },
    {
      "path": "migrations/20260612203000_company_customer_number_prefix_hardening.sql",
      "sha256": "39f6c82ca05f6876e347c58f2b60a24c358c9a72fe856e42d7474f03f9f66065"
    },
    {
      "path": "migrations/20260719120000_canonical_customer_number_assignment.sql",
      "sha256": "259817d0c2fb43e83478b78184fd3d41125636d527e1edd2801783009326fe1e"
    },
    {
      "path": "migrations/20260727040000_contract_security_energy_direction_api_completion.sql",
      "sha256": "c608cb8ca01792971c7dd3974b63138f8ec5d016b643eeff2f7d49f721a9867e"
    },
    {
      "path": "migrations/20260802170000_canonical_security_convergence.sql",
      "sha256": "e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a"
    },
    {
      "path": "migrations/20260816170000_partner_api_v1_canonical_surface_events.sql",
      "sha256": "1faa62377d47df7159ccf5440d4dbee44acd12860d440a19b80b643a4fcd6a4b"
    }
  ]
};
const noncanonicalArtifacts = noncanonical.artifacts || [];
if (!noncanonicalArtifacts.length) fail('noncanonical artifact contract is empty');
const selectedPaths = new Set([...orderedFoundation, ...interleaved.map((item) => item.path)]);
const selectedDerivedSources = new Set(
  [...selectedPaths].map((rel) => derived[rel]?.source).filter(Boolean)
);
const noncanonicalPaths = new Set();
for (const item of noncanonicalArtifacts) {
  const rel = item.path || '';
  const name = path.basename(rel);
  if (noncanonicalPaths.has(rel)) fail(`duplicate noncanonical artifact: ${rel}`);
  noncanonicalPaths.add(rel);
  if (!/^migrations\/[^/]+\.sql$/.test(rel) || !['merged_repository_artifact_not_deployed', 'historical_read_only_diagnostic', 'historical_operational_data_repair'].includes(item.status)) fail(`invalid noncanonical classification: ${rel}`);
  if (item.status === 'historical_read_only_diagnostic' && reviewedDiagnostics[rel] !== item.sha256) fail(`unreviewed diagnostic path or content hash: ${rel}`);
  if (item.status === 'historical_operational_data_repair') {
    const reviewed = reviewedOperationalRepairs[rel];
    if (!reviewed || reviewed.sha256 !== item.sha256) fail(`unreviewed operational repair path or content hash: ${rel}`);
    if (JSON.stringify(item.reviewedDependencies) !== JSON.stringify(reviewed.dependencies)) fail(`unreviewed operational repair dependency pins: ${rel}`);
    for (const dependency of reviewed.dependencies) {
      const dependencyPath = path.join(supabaseDir, dependency.path);
      if (!fs.existsSync(dependencyPath) || sha256(dependencyPath) !== dependency.sha256 || pinned[path.basename(dependency.path)] !== dependency.sha256) fail(`operational repair dependency missing or checksum drift: ${dependency.path}`);
    }
  }
  if (!item.reason || !(item.evidence || []).length || !/^[0-9a-f]{64}$/.test(item.sha256 || '')) fail(`incomplete noncanonical evidence: ${rel}`);
  const sourcePath = path.join(supabaseDir, rel);
  if (!fs.existsSync(sourcePath)) fail(`noncanonical artifact missing: ${rel}`);
  if (sha256(sourcePath) !== item.sha256 || pinned[name] !== item.sha256) fail(`noncanonical checksum mismatch: ${rel}`);
  if (selectedPaths.has(rel) || selectedDerivedSources.has(rel)) fail(`noncanonical artifact overlaps foundation/substitution: ${rel}`);
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
  'migration-history-manifest.runtime.additions.json',
  'gridex-aud-003-main-ledger.json',
  'gridex-aud-003-schema-fingerprint.sql',
]) {
  if (!replay.includes(requiredRef)) fail(`clean replay lost required provenance input: ${requiredRef}`);
}
if (!replay.includes("files.sort(key=lambda p:p.name)")) fail('clean replay lost deterministic timestamped ordering');
if (!replay.includes('excluded') || !replay.includes('noncanonical')) fail('clean replay lost explicit noncanonical exclusion handling');
if (!replay.includes('interleaved_paths')) fail('clean replay lost interleaved bootstrap handling');
// Native CLI ownership/genesis is intentionally unsupported until independently
// reviewed. The supported owned compatible mode cannot establish official-ledger
// provenance; keep this static result separate from the blocked full replay gate.
if (!replay.includes('unsupported replay target') || !replay.includes('NO ledger provenance') ||
    !replay.includes('--context') || !replay.includes('--require-full-effects') ||
    !replay.includes('--foundation "$FOUNDATION_EXEC" --hold "$HOLD"')) {
  fail('clean replay lost owned context, whole batch, completeness or NO-ledger boundary');
}
if (!replay.includes('--dedupe-prefix-proof') || !replay.includes('--repair-prefix-proof') || !replay.includes('--foundation-prefix-proof') ||
    replay.indexOf('--validate-foundation --foundation') > replay.indexOf('psql "$DB_URL" -X -q') ||
    !replay.includes('--validate-foundation --foundation')) {
  fail('named replay scopes must validate retained sources before bootstrap SQL');
}
const repairSources = [
  'migrations/20260525_debug_batch_2_rbac_tenant_alignment.sql',
  'migrations/20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql',
  'migrations/20260526_debug_batch_2_tenant_rbac_server_actions.sql',
  'migrations/20260910174947_canonical_user_rbac_repair_boundary.sql',
];
if (orderedFoundation.length !== 115 || JSON.stringify(orderedFoundation.slice(52, 56)) !== JSON.stringify(repairSources)) {
  fail('complete repair sources must occupy foundation53–56 exactly once');
}
if (orderedFoundation[56] !== 'migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql') {
  fail('complete H2 must occupy foundation57 exactly once');
}
if (replay.includes('supabase start')) fail('unsupported native CLI target may start a stack');
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
  replay_model: 'owned_compatible_diagnostic_whole_batch_no_ledger_provenance',
  native_cli_ledger_replay: 'BLOCKED_UNSUPPORTED',
  foundation_input_count: orderedFoundation.length,
  derived_bootstrap_count: derivedCount,
  interleaved_bootstrap_count: interleaved.length,
  noncanonical_artifact_count: noncanonicalArtifacts.length,
  timestamped_file_count: timestamped.length,
  compact_dev_ledger_start: firstLedgerVersion,
  compact_dev_ledger_rows: entries.length,
}, null, 2));
