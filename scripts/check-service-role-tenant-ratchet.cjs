/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * F-15 ratchet.
 *
 * The application runs on `service_role`, which holds `rolbypassrls`, so every
 * restrictive RLS policy is inert for application traffic. Tenant isolation rests
 * on each individual query remembering `.eq('company_id', …)`.
 *
 * Moving 444 files at once is not a reviewable change. This ratchet freezes the
 * problem instead: the count of direct `supabaseService.from(` call sites may fall
 * but never rise. New code uses `tenantDb(companyId)` from lib/supabase/tenantDb.
 *
 * Update the baseline downward with: node scripts/check-service-role-tenant-ratchet.cjs --update
 */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const baselinePath = path.join(root, 'scripts', 'service-role-tenant-ratchet.json')
const roots = ['app', 'lib']
const pattern = /supabaseService\s*\.\s*from\s*\(/g

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(full, files)
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

const perFile = {}
let total = 0

for (const dir of roots) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) continue
  for (const file of walk(abs)) {
    const source = fs.readFileSync(file, 'utf8')
    const matches = source.match(pattern)
    if (!matches) continue
    const rel = path.relative(root, file)
    perFile[rel] = matches.length
    total += matches.length
  }
}

const fileCount = Object.keys(perFile).length

if (process.argv.includes('--update')) {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ callSites: total, files: fileCount, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
  )
  console.log(`Baseline updated: ${total} call sites across ${fileCount} files.`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error(
    `Missing baseline ${path.relative(root, baselinePath)}. Create it with --update.`,
  )
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

if (total > baseline.callSites) {
  const grown = Object.entries(perFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => `  ${count.toString().padStart(4)}  ${file}`)
    .join('\n')

  console.error(
    [
      `Service-role ratchet failed: ${total} direct supabaseService.from( call sites, baseline is ${baseline.callSites}.`,
      '',
      'service_role bypasses RLS, so each of these carries tenant isolation on its own.',
      'Use tenantDb(companyId) from lib/supabase/tenantDb for new tenant-scoped queries,',
      'or tenantDb(companyId).unscoped() when the path is deliberately cross-tenant.',
      '',
      'Heaviest files:',
      grown,
    ].join('\n'),
  )
  process.exit(1)
}

if (total < baseline.callSites) {
  console.log(
    `Service-role ratchet: ${total} call sites, down from ${baseline.callSites}. Run with --update to lock in the improvement.`,
  )
  process.exit(0)
}

console.log(`Service-role ratchet: ${total} call sites across ${fileCount} files, unchanged.`)
