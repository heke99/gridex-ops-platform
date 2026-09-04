#!/usr/bin/env node
/**
 * GRIDEX OPS master remediation plan, Fas 3 (§6) — canonical schema artifacts.
 *
 * Produces the two artifacts the plan derives from a clean replay:
 *
 *   schema.sql              normalized structure-only dump (§6.1)
 *   schema.fingerprint.json stable per-section fingerprint (§6.2)
 *
 * The fingerprint is computed from the same introspection document the parity
 * engine compares, so both tools agree on what "the schema" means. It covers
 * relations, columns, enums, constraints, indexes, functions, triggers,
 * policies, grants, RLS state and extensions — not a hand-picked table list.
 *
 * Usage:
 *   node scripts/gridex-schema-snapshot.cjs --url <postgres-url> --mode write
 *   node scripts/gridex-schema-snapshot.cjs --url <postgres-url> --mode check
 */

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const INTROSPECT_SQL = join(ROOT, 'scripts/sql/gridex-db-parity-introspect.sql')

function fail(message, code = 2) {
  console.error(`db:schema:snapshot: ${message}`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[token.slice(2)] = 'true'
    else {
      args[token.slice(2)] = next
      i += 1
    }
  }
  return args
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: process.env,
  })
  if (result.error?.code === 'ENOENT') fail(`${command} was not found`, 127)
  if (result.error) fail(`could not start ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${label} failed:\n${(result.stderr || '').trim()}`)
  return result.stdout
}

const RESTRICT_TOKEN = 'gridex_canonical_schema_snapshot'

/**
 * Two things in a plain pg_dump vary between runs of the same schema and carry
 * no schema information:
 *
 *   - the header banner naming the server and pg_dump versions, which differs
 *     between a CI shadow and any other machine;
 *   - the \restrict / \unrestrict psql guard tokens, which pg_dump randomizes
 *     on every invocation.
 *
 * The banner lines are dropped. The guard tokens are rewritten to one fixed
 * value rather than removed, so the artifact stays byte-stable and still a
 * valid psql script.
 */
function normalizeDump(dump) {
  return `${dump
    .split('\n')
    .filter((line) => !/^-- Dumped (from database version|by pg_dump version)/.test(line))
    .map((line) => line.replace(/^\\(restrict|unrestrict)\s+\S+$/, `\\$1 ${RESTRICT_TOKEN}`))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function buildFingerprint(introspection, schemas) {
  const sections = {}
  for (const name of Object.keys(introspection).sort()) {
    const rows = introspection[name] ?? []
    sections[name] = { count: rows.length, sha256: sha256(canonicalJson(rows)) }
  }
  return {
    algorithm: 'sha256/canonical-json/v1',
    schemas,
    sections,
    sha256: sha256(canonicalJson(sections)),
  }
}

/**
 * pg_dump refuses to dump a server newer than itself, and Debian's pg_wrapper
 * does not reliably pick the newest installed major. Allow an explicit binary
 * so the caller can name the one that matches the server.
 */
const PG_DUMP = process.env.GRIDEX_PG_DUMP || 'pg_dump'

function generate(url, schemas) {
  const dump = normalizeDump(
    run(
      PG_DUMP,
      [
        url,
        '--schema-only',
        '--no-owner',
        '--no-tablespaces',
        ...schemas.flatMap((schema) => ['--schema', schema]),
      ],
      `${PG_DUMP} (schema dump)`,
    ),
  )
  const introspection = JSON.parse(
    run(
      'psql',
      [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `schemas={${schemas.join(',')}}`, '-f', INTROSPECT_SQL],
      'schema introspection',
    ),
  )
  return { dump, fingerprint: buildFingerprint(introspection, schemas) }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.mode || 'write'
  if (mode !== 'write' && mode !== 'check') fail(`unknown --mode "${mode}" (write|check)`)

  const url = args.url || process.env.GRIDEX_SCHEMA_SNAPSHOT_URL || process.env.DATABASE_URL
  if (!url) fail('missing --url (or GRIDEX_SCHEMA_SNAPSHOT_URL / DATABASE_URL)')
  if (!/^postgres(?:ql)?:\/\//i.test(url)) fail('--url must be a postgresql:// or postgres:// URL')

  const schemas = String(args.schemas || process.env.GRIDEX_SCHEMA_SNAPSHOT_SCHEMAS || 'public')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const schema of schemas) {
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema)) fail(`invalid schema name "${schema}"`)
  }

  const outDir = resolve(args['out-dir'] || join(ROOT, 'supabase'))
  const dumpPath = join(outDir, 'schema.sql')
  const fingerprintPath = join(outDir, 'schema.fingerprint.json')

  const { dump, fingerprint } = generate(url, schemas)
  const fingerprintText = `${JSON.stringify(fingerprint, null, 2)}\n`

  if (mode === 'write') {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(dumpPath, dump)
    writeFileSync(fingerprintPath, fingerprintText)
    console.log(`wrote ${dumpPath}`)
    console.log(`wrote ${fingerprintPath}`)
    console.log(`schema fingerprint ${fingerprint.sha256}`)
    return
  }

  if (!existsSync(dumpPath) || !existsSync(fingerprintPath)) {
    // A missing baseline is not parity. Say so and fail rather than pass by
    // default (plan §1.4).
    fail(
      `no committed baseline in ${outDir}. Generate one from a clean replay ` +
        'with --mode write and commit both artifacts.',
    )
  }

  const failures = []
  if (readFileSync(dumpPath, 'utf8') !== dump) failures.push(`${dumpPath} differs from the database`)

  const committed = JSON.parse(readFileSync(fingerprintPath, 'utf8'))
  if (committed.sha256 !== fingerprint.sha256) {
    failures.push(`schema fingerprint differs: committed ${committed.sha256}, actual ${fingerprint.sha256}`)
    for (const name of Object.keys(fingerprint.sections)) {
      const before = committed.sections?.[name]
      const after = fingerprint.sections[name]
      if (!before) failures.push(`  section ${name} is missing from the committed fingerprint`)
      else if (before.sha256 !== after.sha256) {
        failures.push(`  section ${name} differs (committed ${before.count} rows, actual ${after.count})`)
      }
    }
  }

  if (failures.length > 0) {
    console.error('schema snapshot check failed:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  console.log(`schema snapshot verified (${fingerprint.sha256})`)
}

main()
