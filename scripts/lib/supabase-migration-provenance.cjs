const { createHash } = require('node:crypto')
const { lstatSync, readdirSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const algorithm = 'gridex-supabase-replay-source-v2'
const requiredReplayInputs = [
  'scripts/gridex-aud-003-clean-replay.sh',
  'scripts/gridex-aud-003-foundation-order.json',
  'scripts/gridex-aud-003-legacy-foundation.json',
  'scripts/gridex-aud-003-main-ledger.json',
  'scripts/gridex-aud-003-noncanonical-artifacts.json',
  'scripts/gridex-aud-003-schema-fingerprint.sql',
  'scripts/migration-history-manifest.json',
  'scripts/sql/ediel-retention-replay-role-diagnostic.sql',
  'scripts/sql/gridex-local-storage-owner-bootstrap.sql',
  'scripts/sql/gridex-replay-refresh-runtime-readiness.sql',
  'supabase/config.toml',
]
const captureTooling = [
  '.github/workflows/staff-api-schema-capture.yml',
  'scripts/apply-supabase-types-nullability-overrides.cjs',
  'scripts/gridex-schema-snapshot.cjs',
  'scripts/lib/supabase-migration-provenance.cjs',
  'scripts/sql/gridex-db-parity-introspect.sql',
]
const optionalReplayInputs = [
  'scripts/gridex-aud-003-legacy-foundation.additions.json',
  'scripts/migration-history-manifest.additions.json',
  'scripts/migration-history-manifest.runtime.additions.json',
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fileDigest(file, label, optional = false) {
  const stat = lstatSync(file, { throwIfNoEntry: !optional })
  if (stat === undefined && optional) return null
  if (!stat.isFile()) throw new Error('Supabase migration source is not a regular file: ' + label)
  return sha256(readFileSync(file))
}

// The official replay temporarily holds the checkout's .sql inputs outside
// their working directory. Keep their repository labels during that hold.
function directoryInputs(directory, label, kind) {
  if (!lstatSync(directory).isDirectory()) {
    throw new Error('Supabase migration source is not a regular directory: ' + label)
  }
  return readdirSync(directory)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => {
      const path = label + '/' + name
      return [kind, path, fileDigest(join(directory, name), path)]
    })
}

function collectMigrationSource(root, heldMigrationDirectory) {
  const migrations = directoryInputs(heldMigrationDirectory ?? join(root, 'supabase/migrations'), 'supabase/migrations', 'migration')
  if (migrations.length === 0) throw new Error('Supabase migration source contains no migrations')
  const bootstrap = directoryInputs(join(root, 'supabase/bootstrap'), 'supabase/bootstrap', 'bootstrap')
  const policy = [
    ...requiredReplayInputs.map(name => ['replay-policy', name, fileDigest(join(root, name), name)]),
    ...optionalReplayInputs.map(name => ['replay-policy', name, fileDigest(join(root, name), name, true)]),
  ]
  // Classifying legacy sources, replacing them with bootstraps and ordering
  // execution are all controlled by the hashed replay policy and executor.
  const writers = captureTooling.map(name => ['capture-tool', name, fileDigest(join(root, name), name)])
  const scriptName = 'db:schema:snapshot'
  const packageCommand = 'package.json#scripts.' + scriptName
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
  const snapshotScript = scripts?.[scriptName]
  if (typeof snapshotScript !== 'string' || snapshotScript.trim() === '') {
    throw new Error('Supabase capture input missing: ' + packageCommand)
  }
  const lifecycle = [scripts['pre' + scriptName] ?? null, snapshotScript, scripts['post' + scriptName] ?? null]
  writers.push(['capture-command', packageCommand, sha256(JSON.stringify(lifecycle))])
  const entries = [...migrations, ...bootstrap, ...policy, ...writers]
  return {
    algorithm,
    count: entries.length,
    sha256: sha256(JSON.stringify([algorithm, entries])),
  }
}

function matchesMigrationSource(current, captured) {
  return captured?.algorithm === current.algorithm &&
    captured.count === current.count &&
    captured.sha256 === current.sha256
}

module.exports = { collectMigrationSource, matchesMigrationSource }
if (require.main === module) {
  process.stdout.write(JSON.stringify(collectMigrationSource(resolve(__dirname, '../..'), process.argv[2])) + '\n')
}
