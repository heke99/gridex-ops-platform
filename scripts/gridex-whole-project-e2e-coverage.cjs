#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })

const ignoredDirs = new Set(['.git', '.next', 'node_modules', 'e2e-artifacts', '.patch-backups'])
const allowedApiNamespaces = new Set([
  'admin',
  'cron',
  'ediel',
  'internal',
  'partner',
  'platform',
  'public',
  'v1',
  'webhooks',
])

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(absolute))
    else out.push(path.relative(root, absolute).replaceAll('\\', '/'))
  }
  return out
}

function gitChangedFiles() {
  const explicitBase = String(process.env.GRIDEX_E2E_DIFF_BASE || '').trim()
  const githubBase = String(process.env.GITHUB_BASE_REF || '').trim()
  const candidates = []
  if (explicitBase) candidates.push(`${explicitBase}...HEAD`)
  if (githubBase) candidates.push(`origin/${githubBase}...HEAD`, `${githubBase}...HEAD`)
  candidates.push('HEAD^...HEAD')

  for (const range of candidates) {
    const result = spawnSync('git', ['diff', '--name-only', range], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.status === 0) {
      return {
        available: true,
        range,
        files: String(result.stdout || '')
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      }
    }
  }
  return { available: false, range: null, files: [] }
}

const issues = []
const allFiles = walk(root)
const apiRoutes = allFiles.filter((file) => /^app\/api\/.+\/route\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(file))
const apiNamespaces = [...new Set(apiRoutes.map((file) => file.split('/')[2]))].sort()
const unknownApiNamespaces = apiNamespaces.filter((name) => !allowedApiNamespaces.has(name))

if (apiRoutes.length === 0) issues.push('No Next.js API route handlers were discovered under app/api.')
if (unknownApiNamespaces.length > 0) {
  issues.push(`Unclassified API namespace(s): ${unknownApiNamespaces.join(', ')}. Add an explicit E2E classification before release.`)
}

const migrationFiles = allFiles.filter((file) => /^supabase\/migrations\/.+\.sql$/.test(file))
if (migrationFiles.length === 0) issues.push('No Supabase migrations were discovered; database coverage cannot be certified.')
const duplicateMigrationNames = migrationFiles
  .map((file) => path.basename(file))
  .filter((name, index, names) => names.indexOf(name) !== index)
if (duplicateMigrationNames.length > 0) {
  issues.push(`Duplicate migration filename(s): ${[...new Set(duplicateMigrationNames)].join(', ')}`)
}

const orchestratorPath = path.join(root, 'scripts/gridex-full-production-e2e.cjs')
if (!fs.existsSync(orchestratorPath)) issues.push('Missing scripts/gridex-full-production-e2e.cjs.')
const orchestrator = fs.existsSync(orchestratorPath) ? fs.readFileSync(orchestratorPath, 'utf8') : ''
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageScripts = pkg.scripts || {}

const requiredCoverageTokens = {
  database: ['db:migrations:check', 'db:migrations:production-readiness'],
  tenant: ['tenant:multitenant:static', 'gridex:tenant-source-of-truth-regression'],
  contract: ['gridex:contract-lifecycle-repair-regression'],
  customer_intake: ['gridex:multitenant-website-application-flow-regression'],
  facility: ['gridex:z01-facility-preflight-regression'],
  ediel: ['gridex:ediel-intent-pipeline-full-regression'],
  metering: ['gridex:multi-metering-values-regression'],
  billing: ['gridex:multi-site-billing-underlay-regression'],
  customer_portal: ['gridex:customer-portal-multi-site-api-regression'],
  communications: ['gridex:communication-source-of-truth-regression'],
  api: ['api:error-boundaries', 'api:compatibility', 'api:runtime:parity'],
  security: ['security:rbac', 'security:audit-production'],
  release: ["npmStep('build'", "'build'"],
  real_customer: ['scripts/gridex-real-customer-e2e.mjs'],
}

for (const [domain, tokens] of Object.entries(requiredCoverageTokens)) {
  for (const token of tokens) {
    if (!orchestrator.includes(token)) issues.push(`E2E orchestrator is missing ${domain} coverage token: ${token}`)
  }
}

const npmScriptsReferenced = [
  ...orchestrator.matchAll(/npmStep\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'([^']+)'/g),
].map((match) => match[1])
for (const script of [...new Set(npmScriptsReferenced)]) {
  if (!Object.prototype.hasOwnProperty.call(packageScripts, script)) {
    issues.push(`Stale E2E reference: package.json script does not exist: ${script}`)
  }
}

const nodeFilesReferenced = [
  ...orchestrator.matchAll(/nodeStep\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'([^']+)'/g),
].map((match) => match[1])
for (const file of [...new Set(nodeFilesReferenced)]) {
  if (!fs.existsSync(path.join(root, file))) issues.push(`Stale E2E reference: node step file does not exist: ${file}`)
}

const openSourceToolingScript = 'scripts/gridex-open-source-e2e-tooling-regression.cjs'
const requiredOpenSourceFiles = [
  openSourceToolingScript,
  '.github/workflows/browser-quality-e2e.yml',
  'playwright.config.mjs',
  'e2e/browser/public.spec.mjs',
  'e2e/browser/authenticated.spec.mjs',
  'e2e/k6/platform-smoke.js',
  'scripts/install-browser-e2e-tooling.sh',
]
for (const file of requiredOpenSourceFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    issues.push(`Missing required open-source E2E layer file: ${file}`)
  }
}
if (fs.existsSync(path.join(root, openSourceToolingScript))) {
  const toolingCheck = spawnSync(process.execPath, [openSourceToolingScript], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  if (toolingCheck.status !== 0) {
    const detail = String(toolingCheck.stderr || toolingCheck.stdout || '').trim()
    issues.push(`Open-source E2E tooling contract failed${detail ? `: ${detail}` : '.'}`)
  }
}

const changed = gitChangedFiles()
const criticalChanges = changed.files.filter((file) =>
  file.startsWith('app/api/') ||
  file.startsWith('supabase/migrations/') ||
  file.startsWith('lib/') ||
  file.startsWith('scripts/gridex-') ||
  file.startsWith('e2e/') ||
  file.startsWith('.github/workflows/') ||
  file === 'playwright.config.mjs' ||
  file === 'package.json'
)

const newNamespaceChanges = criticalChanges
  .filter((file) => /^app\/api\/[^/]+\//.test(file))
  .map((file) => file.split('/')[2])
  .filter((namespace) => !allowedApiNamespaces.has(namespace))
if (newNamespaceChanges.length > 0) {
  issues.push(`Critical diff contains unclassified API namespace(s): ${[...new Set(newNamespaceChanges)].join(', ')}`)
}

const report = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  status: issues.length === 0 ? 'passed' : 'failed',
  inventory: {
    repository_files: allFiles.length,
    api_routes: apiRoutes.length,
    api_namespaces: apiNamespaces,
    migrations: migrationFiles.length,
    open_source_e2e_files: requiredOpenSourceFiles.length,
  },
  classification: {
    allowed_api_namespaces: [...allowedApiNamespaces].sort(),
    unknown_api_namespaces: unknownApiNamespaces,
  },
  references: {
    npm_scripts_checked: [...new Set(npmScriptsReferenced)].length,
    node_files_checked: [...new Set(nodeFilesReferenced)].length,
    open_source_e2e_contract: openSourceToolingScript,
  },
  diff: {
    available: changed.available,
    range: changed.range,
    critical_changed_files: criticalChanges,
  },
  issues,
}

fs.writeFileSync(
  path.join(artifactDir, 'gridex-whole-project-coverage.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)

if (issues.length > 0) {
  console.error('Gridex whole-project E2E coverage gate failed:')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log(`Gridex whole-project E2E coverage passed: ${apiRoutes.length} API routes across ${apiNamespaces.length} classified namespaces, ${migrationFiles.length} migrations, ${report.references.npm_scripts_checked} npm E2E scripts, ${report.references.node_files_checked} node E2E files and the pinned open-source browser/performance/security layer are wired.`)
if (!changed.available) console.log('Git diff inventory was unavailable in this checkout; static whole-repository coverage still passed.')
