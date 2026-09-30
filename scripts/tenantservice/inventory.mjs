// Static discovery only. A row is a candidate, not evidence that an action works.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const output = join(root, 'quality/audits/tenantservice-api-ops-20260928')
const sourceDirs = ['app/admin', 'components/admin', 'components/tenant', 'components/customer']

function walk(dir) {
  try {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const name = `${dir}/${entry.name}`
      return entry.isDirectory() ? walk(name) : [name]
    })
  } catch { return [] }
}

function rowsFor(file, regex, kind, extra = {}) {
  const source = readFileSync(join(root, file), 'utf8')
  const rows = []
  const counts = new Map()
  for (const match of source.matchAll(regex)) {
    const label = match[1]
    const count = (counts.get(label) ?? 0) + 1
    counts.set(label, count)
    const line = source.slice(0, match.index).split('\n').length
    rows.push({
      id: `${kind.toUpperCase()}-${createHash('sha256').update(`${file}|${label}|${count}`).digest('hex').slice(0, 12)}`,
      file, line, kind: label,
      source_excerpt: source.slice(match.index, match.index + 180).replace(/\s+/g, ' ').trim(),
      status: 'STATIC_CANDIDATE',
      ...extra,
    })
  }
  return rows
}

const uiFiles = sourceDirs.flatMap(walk).filter((file) => file.endsWith('.tsx')).sort()
const pages = walk('app/admin').filter((file) => file.endsWith('/page.tsx')).sort().map((file) => ({
  file,
  route: `/${relative('app', file).replace(/\/page\.tsx$/, '')}`,
  group: file.split('/')[2] ?? 'root',
  status: 'STATIC_CANDIDATE',
}))
const ui = uiFiles.flatMap((file) => rowsFor(file, /<(button|Button|Link|a|form|input|select|textarea)\b/g, 'ui'))
const routes = walk('app/api').filter((file) => file.endsWith('/route.ts')).sort().flatMap((file) => {
  const source = readFileSync(join(root, file), 'utf8')
  const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1])
  return [{ file, methods, mutation_tokens: [...new Set([...source.matchAll(/\.(insert|update|upsert|delete|rpc)\s*\(/g)].map((match) => match[1]))], status: 'STATIC_CANDIDATE' }]
})
const serverActions = walk('app/admin').filter((file) => /(?:actions|actions\.part-\d+)\.ts$/.test(file)).sort().map((file) => ({
  file,
  exported_functions: [...readFileSync(join(root, file), 'utf8').matchAll(/export\s+async\s+function\s+([A-Za-z]\w*)/g)].map((match) => match[1]),
  status: 'STATIC_CANDIDATE',
}))
mkdirSync(output, { recursive: true })
const manifest = {
  generated_from: 'source tree at execution time',
  scope: sourceDirs,
  limitations: 'Regex discovery only; imported components outside listed directories, dynamic controls, role visibility, server effects and browser behavior require manual tracing.',
  counts: { pages: pages.length, uiCandidates: ui.length, apiRoutes: routes.length, serverActionFiles: serverActions.length },
  files: ['pages.jsonl', 'api-routes.jsonl', 'server-actions.jsonl', ...Array.from({ length: Math.ceil(ui.length / 1000) }, (_, index) => `ui-actions-${index + 1}.jsonl`)],
}
function writeRows(name, rows) {
  writeFileSync(join(output, name), rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
}
writeRows('pages.jsonl', pages)
writeRows('api-routes.jsonl', routes)
writeRows('server-actions.jsonl', serverActions)
for (let index = 0; index < ui.length; index += 1000) {
  writeRows(`ui-actions-${index / 1000 + 1}.jsonl`, ui.slice(index, index + 1000))
}
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(JSON.stringify(manifest.counts) + '\n')
