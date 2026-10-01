// Derivative of the existing canonical source authority, not a second role table.
// Regenerate only into a NEW forward migration. --check verifies an existing
// immutable publication against the current source catalog without rewriting it.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const argv = process.argv.slice(2)
const option = name => argv[argv.indexOf(name) + 1]
const root = path.resolve(argv.includes('--repo-root') ? option('--repo-root') : path.join(__dirname, '..'))
const target = path.resolve(option('--migration'))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const inputs = {}; const cache = new Map()
function load(file) {
  if (!path.extname(file)) file += '.ts'
  if (cache.has(file)) return cache.get(file).exports
  if (!file.startsWith(root + path.sep)) throw new Error('Source projection must stay inside the repository')
  const source = fs.readFileSync(file, 'utf8'); inputs[path.relative(root, file)] = hash(source)
  const module = { exports: {} }; cache.set(file, module)
  if (path.extname(file) === '.json') {
    // TypeScript's resolveJsonModule emits a default import while ordinary
    // require retains the JSON value. Supply both through its __esModule
    // interop contract without transpiling JSON as TypeScript source.
    const value = JSON.parse(source)
    module.exports = { __esModule: true, default: value }
    return module.exports
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const localRequire = name => {
    if (name.startsWith('@/')) return load(path.join(root, name.slice(2)))
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name))
    throw new Error(`Canonical projection unexpectedly requires a runtime service: ${name}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
  return module.exports
}
const authority = load(path.join(root, 'lib/ediel/rulebook/canonicalEdielFacade.ts'))
const rows = authority.canonicalBusinessSemanticsCatalog().filter(row => ['PRODAT', 'UTILTS'].includes(row.family)).map(row => ({
  family: row.family, code: row.code, subtype: row.subtype, transactionReasonCode: row.transactionReasonCode,
  senderRoles: [...row.senderRoles], direction: row.direction,
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const manifest = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))
const edition = { sourceVersion: hash(JSON.stringify(manifest)), inputManifest: manifest, catalog: rows }
const literal = JSON.stringify(edition).replaceAll("'", "''")
const block = `-- BEGIN CANONICAL SOURCE PROJECTION\nINSERT INTO gridex_ediel_readiness.source_editions(source_version,input_manifest,catalog)\nSELECT value->>'sourceVersion',value->'inputManifest',value->'catalog' FROM (SELECT '${literal}'::jsonb value) edition;\n-- END CANONICAL SOURCE PROJECTION`
const content = fs.readFileSync(target, 'utf8')
if (argv.includes('--check')) {
  const publishedLiteral = content.match(/-- BEGIN CANONICAL SOURCE PROJECTION[\s\S]*?FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)?.[1]
  if (!publishedLiteral) throw new Error('Published canonical projection unavailable')
  const published = JSON.parse(publishedLiteral.replaceAll("''", "'"))
  if (hash(JSON.stringify(published.inputManifest)) !== published.sourceVersion) throw new Error('Published source input provenance hash mismatch')
  if (JSON.stringify(published.catalog) !== JSON.stringify(rows)) throw new Error('Readiness source projection differs from the current canonical catalog; publish a new forward edition')
  const changedInputs = Object.keys(manifest).filter(file => published.inputManifest[file] !== manifest[file]).length
  console.log(`Canonical readiness projection: ${rows.length} current own scopes match; immutable publication input provenance valid; ${changedInputs} source files changed since publication without changing projected scope values`)
} else {
  const marker = '-- CANONICAL SOURCE PROJECTION PLACEHOLDER'
  if (!content.includes(marker)) throw new Error('New migration projection placeholder missing; never rewrite a published edition')
  fs.writeFileSync(target, content.replace(marker, block))
  console.log(`Generated ${rows.length} canonical readiness scopes; actual source version ${edition.sourceVersion}`)
}
