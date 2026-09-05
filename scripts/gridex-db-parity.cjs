#!/usr/bin/env node
/**
 * GRIDEX OPS master remediation plan, Fas 4 (§7) — database parity engine.
 *
 * Compares a canonical database (the shadow built by clean replay from the
 * versioned migration chain) against a target database, in BOTH directions:
 * objects present in canonical but missing live, and objects present live but
 * missing from canonical.
 *
 * The migration chain is the schema authority (plan §1.3). This engine never
 * mutates either database and never reads table data — structure only.
 *
 * Usage:
 *   node scripts/gridex-db-parity.cjs \
 *     --canonical postgresql://... --target postgresql://... [--mode blocking]
 *
 * Modes (plan §7.3): report-only (default) | warning | blocking.
 */

const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { validateSchemaDocument } = require('./gridex-schema-document.cjs')

const ROOT = resolve(__dirname, '..')
const INTROSPECT_SQL = join(ROOT, 'scripts/sql/gridex-db-parity-introspect.sql')
const DEFAULT_IGNORE = join(ROOT, 'scripts/gridex-db-parity-ignore.json')

const MODES = new Set(['report-only', 'warning', 'blocking'])

/**
 * Every comparable object kind. `key` builds the identity used for both-way
 * presence comparison; `compare` lists the attributes that must match when an
 * object exists on both sides.
 */
const SECTIONS = [
  {
    name: 'schemas',
    label: 'schema',
    key: (row) => String(row),
    compare: [],
  },
  {
    name: 'relations',
    label: 'relation',
    key: (r) => `${r.nspname}.${r.relname}`,
    compare: [
      'relkind',
      'relrowsecurity',
      'relforcerowsecurity',
      'view_definition',
      'partition_key',
    ],
  },
  {
    name: 'columns',
    label: 'column',
    key: (r) => `${r.nspname}.${r.relname}.${r.attname}`,
    compare: ['data_type', 'udt_name', 'is_nullable', 'column_default', 'identity', 'generated'],
  },
  {
    name: 'enums',
    label: 'enum value',
    key: (r) => `${r.nspname}.${r.typname}.${r.enumlabel}`,
    compare: ['enumsortorder'],
  },
  {
    name: 'constraints',
    label: 'constraint',
    key: (r) => `${r.nspname}.${r.relname}.${r.conname}`,
    compare: ['contype', 'definition', 'convalidated'],
  },
  {
    name: 'indexes',
    label: 'index',
    key: (r) => `${r.nspname}.${r.relname}.${r.indexname}`,
    compare: ['definition', 'indisunique', 'indisprimary'],
  },
  {
    name: 'functions',
    label: 'function',
    key: (r) => `${r.nspname}.${r.proname}(${r.identity_arguments})`,
    compare: ['arguments', 'return_type', 'security_definer', 'volatility', 'kind', 'body_md5'],
  },
  {
    name: 'triggers',
    label: 'trigger',
    key: (r) => `${r.nspname}.${r.relname}.${r.tgname}`,
    compare: ['definition', 'enabled'],
  },
  {
    name: 'policies',
    label: 'policy',
    key: (r) => `${r.nspname}.${r.relname}.${r.polname}`,
    compare: ['command', 'permissive', 'using_expression', 'check_expression', 'roles'],
  },
  {
    name: 'relation_grants',
    label: 'relation grant',
    key: (r) => `${r.nspname}.${r.relname} ${r.privilege_type} -> ${r.grantee}`,
    compare: [],
  },
  {
    name: 'function_grants',
    label: 'function grant',
    key: (r) => `${r.nspname}.${r.proname}(${r.identity_arguments}) ${r.privilege_type} -> ${r.grantee}`,
    compare: [],
  },
  {
    name: 'schema_grants',
    label: 'schema grant',
    key: (r) => `${r.nspname} ${r.privilege_type} -> ${r.grantee}`,
    compare: [],
  },
  {
    name: 'extensions',
    label: 'extension',
    key: (r) => r.extname,
    compare: ['extversion', 'nspname'],
  },
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
    } else {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[token.slice(2)] = 'true'
      } else {
        args[token.slice(2)] = next
        i += 1
      }
    }
  }
  return args
}

function fail(message, code = 2) {
  console.error(`db:parity: ${message}`)
  process.exit(code)
}

function assertPostgresUrl(url, label) {
  if (!url) {
    fail(
      `missing ${label} database URL. Pass --${label} or set ` +
        `GRIDEX_PARITY_${label.toUpperCase()}_URL.`,
    )
  }
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    fail(`${label} database URL must be a postgresql:// or postgres:// URL.`)
  }
  return url
}

function introspect(url, schemas, label) {
  const result = spawnSync(
    'psql',
    [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `schemas={${schemas.join(',')}}`, '-f', INTROSPECT_SQL],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: process.env },
  )
  if (result.error?.code === 'ENOENT') {
    fail('psql was not found. Install the PostgreSQL client and retry.', 127)
  }
  if (result.error) fail(`could not start psql for ${label}: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`introspection of the ${label} database failed:\n${(result.stderr || '').trim()}`)
  }
  try {
    return validateSchemaDocument(JSON.parse(result.stdout), schemas)
  } catch (error) {
    fail(`could not parse introspection output for ${label}: ${error.message}`)
  }
}

function indexRows(rows, section) {
  const map = new Map()
  for (const row of rows ?? []) {
    const key = section.key(row)
    // Grants and enum labels are naturally unique; a collision means the
    // introspection identity is too weak, which would silently hide drift.
    if (map.has(key)) {
      fail(`ambiguous ${section.label} identity "${key}" — parity cannot be trusted`)
    }
    map.set(key, row)
  }
  return map
}

function stableValue(value) {
  return Array.isArray(value) ? JSON.stringify(value) : String(value)
}

function loadIgnores(path) {
  if (!path) return []
  if (!existsSync(path)) {
    if (path !== DEFAULT_IGNORE) fail(`ignore file not found: ${path}`)
    return []
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`could not parse ignore file ${path}: ${error.message}`)
  }
  const entries = Array.isArray(parsed) ? parsed : parsed.ignores
  if (!Array.isArray(entries)) fail(`ignore file ${path} must contain an "ignores" array`)
  return entries.map((entry, position) => {
    if (!entry || typeof entry !== 'object') {
      fail(`ignore entry ${position} in ${path} must be an object`)
    }
    const { section, key, reason } = entry
    // An undocumented exception is how drift becomes permanent. Require both a
    // concrete target and a written reason (plan §36).
    if (!section || !key || !reason) {
      fail(`ignore entry ${position} in ${path} needs "section", "key" and "reason"`)
    }
    let pattern
    try {
      pattern = new RegExp(key)
    } catch (error) {
      fail(`ignore entry ${position} in ${path} has an invalid "key" regex: ${error.message}`)
    }
    return { section, pattern, reason }
  })
}

function compareSections(canonical, target) {
  const findings = []
  for (const section of SECTIONS) {
    const left = indexRows(canonical[section.name], section)
    const right = indexRows(target[section.name], section)

    for (const [key, row] of left) {
      if (!right.has(key)) {
        findings.push({ section: section.name, label: section.label, key, kind: 'missing_in_target' })
        continue
      }
      const other = right.get(key)
      for (const field of section.compare) {
        const a = stableValue(row[field])
        const b = stableValue(other[field])
        if (a !== b) {
          findings.push({
            section: section.name,
            label: section.label,
            key,
            kind: 'different',
            field,
            canonical: a,
            target: b,
          })
        }
      }
    }

    for (const key of right.keys()) {
      if (!left.has(key)) {
        findings.push({ section: section.name, label: section.label, key, kind: 'missing_in_canonical' })
      }
    }
  }
  return findings
}

function applyIgnores(findings, ignores) {
  const kept = []
  const ignored = []
  for (const finding of findings) {
    const rule = ignores.find(
      (candidate) => candidate.section === finding.section && candidate.pattern.test(finding.key),
    )
    if (rule) ignored.push({ ...finding, reason: rule.reason })
    else kept.push(finding)
  }
  return { kept, ignored }
}

const KIND_TEXT = {
  missing_in_target: 'in canonical, missing in target',
  missing_in_canonical: 'in target, missing in canonical',
  different: 'differs',
}

function describe(finding) {
  if (finding.kind === 'different') {
    return `${finding.label} ${finding.key}: ${finding.field} differs (canonical=${finding.canonical} target=${finding.target})`
  }
  return `${finding.label} ${finding.key}: ${KIND_TEXT[finding.kind]}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  const mode = args.mode || process.env.GRIDEX_PARITY_MODE || 'report-only'
  if (!MODES.has(mode)) {
    fail(`unknown --mode "${mode}". Expected one of: ${[...MODES].join(', ')}.`)
  }

  const schemas = String(
    args.schemas || process.env.GRIDEX_PARITY_SCHEMAS || 'public',
  )
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (schemas.length === 0) fail('at least one schema must be compared')
  for (const schema of schemas) {
    // The schema list is interpolated into a psql array literal.
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema)) {
      fail(`invalid schema name "${schema}"`)
    }
  }

  const canonicalUrl = assertPostgresUrl(
    args.canonical || process.env.GRIDEX_PARITY_CANONICAL_URL,
    'canonical',
  )
  const targetUrl = assertPostgresUrl(
    args.target ||
      process.env.GRIDEX_PARITY_TARGET_URL ||
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL,
    'target',
  )

  // --no-ignore compares against the raw schemas, so a CI gate cannot be
  // quietly widened by editing the exception contract.
  const ignores =
    args['no-ignore'] === 'true'
      ? []
      : loadIgnores(args.ignore || process.env.GRIDEX_PARITY_IGNORE || DEFAULT_IGNORE)

  const canonical = introspect(canonicalUrl, schemas, 'canonical')
  const target = introspect(targetUrl, schemas, 'target')

  const { kept, ignored } = applyIgnores(compareSections(canonical, target), ignores)

  console.log(`db:parity mode=${mode} schemas=${schemas.join(',')}`)

  const bySection = new Map()
  for (const finding of kept) {
    if (!bySection.has(finding.section)) bySection.set(finding.section, [])
    bySection.get(finding.section).push(finding)
  }
  for (const section of SECTIONS) {
    const rows = bySection.get(section.name)
    if (!rows?.length) continue
    console.log(`\n${section.name} (${rows.length})`)
    for (const finding of rows) console.log(`  - ${describe(finding)}`)
  }

  if (ignored.length > 0) {
    console.log(`\nignored by contract (${ignored.length})`)
    for (const finding of ignored) {
      console.log(`  - ${describe(finding)} [${finding.reason}]`)
    }
  }

  if (args.json) {
    const outputPath = resolve(args.json)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(
      outputPath,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          mode,
          schemas,
          findings: kept,
          ignored,
        },
        null,
        2,
      )}\n`,
    )
    console.log(`\nwrote ${outputPath}`)
  }

  if (kept.length === 0) {
    console.log('\nPASS: canonical and target schemas are identical for the compared object kinds.')
    return
  }

  const summary = `${kept.length} parity finding(s) across ${bySection.size} object kind(s)`
  if (mode === 'blocking') {
    console.error(`\nFAIL: ${summary}`)
    process.exit(1)
  }
  console.log(`\n${mode === 'warning' ? 'WARNING' : 'REPORT'}: ${summary}`)
}

main()
