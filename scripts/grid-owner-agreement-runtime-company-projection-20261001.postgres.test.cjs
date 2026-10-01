/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS PostgreSQL proof; no production module/browser bundle. */
// Source-derived company INSERT business core, not Supabase/native/Auth proof.
// Eight actual company INSERT triggers and their helper closure execute. The
// child tables use canonical base DDL/unique keys, without their trigger/RLS/ACL
// graph. No company/account/session or application source is changed.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const root = resolve(__dirname, '..')
const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
const native = readFileSync(resolve(root, 'scripts/grid-owner-agreement-runtime-20261001.native.test.ts'), 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const quiet = '22222222-2222-4222-8222-222222222222'
const tables = ['companies', 'company_capabilities', 'ediel_production_state', 'spot_price_sources',
  'company_market_price_sources', 'platform_default_legal_templates', 'legal_text_versions', 'legal_bundles',
  'legal_bundle_items', 'tenant_legal_profiles']
const definitions = new Map()
for (const match of schema.matchAll(/CREATE FUNCTION public\.(\w+)\([^\n]*/g)) {
  const start = match.index
  const tail = schema.slice(start)
  const opening = /\bAS\s+(\$\w*\$)/.exec(tail)
  assert.ok(opening, 'canonical function body required')
  const after = opening.index + opening[0].length
  const end = tail.indexOf(opening[1] + ';', after)
  assert.ok(end >= after, 'canonical function terminator required')
  const definition = tail.slice(0, end + opening[1].length + 1)
  definitions.set(match[1], [...definitions.get(match[1]) ?? [], definition])
}
function functionClosure(names) {
  const found = new Set(), order = []
  const visit = name => {
    if (found.has(name)) return
    found.add(name)
    const items = definitions.get(name)
    assert.ok(items, `canonical helper absent: ${name}`)
    for (const definition of items) {
      for (const call of definition.matchAll(/public\.(\w+)\(/g)) {
        if (call[1] !== name && definitions.has(call[1])) visit(call[1])
      }
    }
    order.push(...items)
  }
  names.forEach(visit)
  return order.join('\n')
}
function tableDefinition(name) {
  const definition = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(definition, `canonical company core table absent: ${name}`)
  return definition
}
const companyInsertTriggers = [...schema.matchAll(/^CREATE TRIGGER [^\n]* ON public\.companies [^\n]*;/gm)]
  .map(match => match[0]).filter(definition => /(?:BEFORE|AFTER) INSERT/.test(definition))
assert.equal(companyInsertTriggers.length, 8)
const triggerFunctions = companyInsertTriggers.map(definition => /FUNCTION public\.(\w+)\(/.exec(definition)[1])
function structuralKeys() {
  const names = new Set(tables)
  const statements = []
  for (const match of schema.matchAll(/ALTER TABLE ONLY public\.(\w+)\n\s+ADD CONSTRAINT [^;]+;/g)) {
    if (names.has(match[1]) && /(?:PRIMARY KEY|UNIQUE) \(/.test(match[0])) statements.push(match[0])
  }
  for (const match of schema.matchAll(/^CREATE UNIQUE INDEX [^\n]* ON public\.(\w+) [^\n]*;/gm)) {
    if (names.has(match[1])) statements.push(match[0])
  }
  return statements.join('\n')
}
function actualSeed() {
  const source = ts.createSourceFile('native.ts', native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let template
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'sql' && node.arguments[0]?.getText(source).startsWith('`INSERT INTO public.companies(id,name,status)')) template = node.arguments[0].getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(template, 'actual runtime company seed required')
  const statement = new Function('quote', 'f', 'ids', `return ${template}`)
    (value => `'${value.replaceAll("'", "''")}'`, { company, quiet, owner: company, quietOwner: quiet },
      { customer: company, contract: company, underlay: company, invoice: company, line: company })
  const end = statement.indexOf(';')
  assert.ok(end > 0)
  return statement.slice(0, end + 1)
}
async function fixture(options = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec("CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; SET check_function_bodies=false;")
    await db.exec(functionClosure(['gridex_normalize_org_number', 'gridex_new_external_tenant_reference']))
    await db.exec(tables.map(tableDefinition).join('\n'))
    await db.exec(structuralKeys())
    await db.exec(functionClosure(triggerFunctions))
    await db.exec(companyInsertTriggers.filter(definition => !options.omitProjection || !definition.includes('companies_lifecycle_status_projection ')).join('\n'))
    // Real child-effect paths are nonempty: defaults copy published legal
    // templates, seed capability rows, legal profiles and a market-price source.
    await db.exec("INSERT INTO public.spot_price_sources(source_key,source_name) VALUES('synthetic_source','Synthetic never contacted source'); INSERT INTO public.platform_default_legal_templates(type,version,title,body,status) SELECT type,'synthetic1','Synthetic legal template','Synthetic no customer legal text','published' FROM unnest(ARRAY['terms','privacy_policy','withdrawal','price_terms','power_of_attorney']) type;")
    await db.exec(actualSeed())
    const rows = (await db.query("SELECT id,name,status,lifecycle_status,is_active,archived_at FROM public.companies ORDER BY id")).rows
    const companyOptions = (await db.query("SELECT id,name FROM public.companies WHERE status='active' AND lifecycle_status='active' AND is_active=true AND archived_at IS NULL ORDER BY name")).rows
    const children = (await db.query("SELECT (SELECT count(*)::int FROM public.company_capabilities) capabilities,(SELECT count(*)::int FROM public.legal_text_versions) legal_texts,(SELECT count(*)::int FROM public.legal_bundles) legal_bundles,(SELECT count(*)::int FROM public.legal_bundle_items) legal_items,(SELECT count(*)::int FROM public.tenant_legal_profiles) legal_profiles,(SELECT count(*)::int FROM public.company_market_price_sources) price_sources")).rows[0]
    return { rows, options: companyOptions, children, triggerCount: companyInsertTriggers.length, company, quiet }
  } finally { await db.close() }
}
module.exports = { fixture }
if (require.main === module) {
  test('actual eight company INSERT triggers preserve runtime seed company option eligibility and nonempty canonical child writes', async () => {
    const result = await fixture()
    assert.equal(result.triggerCount, 8)
    assert.deepEqual(result.rows.map(row => ({ status: row.status, lifecycle: row.lifecycle_status, active: row.is_active, archived: row.archived_at })),
      [{ status: 'active', lifecycle: 'active', active: true, archived: null }, { status: 'active', lifecycle: 'active', active: true, archived: null }])
    assert.equal(result.options.length, 2)
    assert.ok(result.options.some(row => row.id === company))
    assert.deepEqual(result.children, { capabilities: 20, legal_texts: 10, legal_bundles: 2, legal_items: 10, legal_profiles: 2, price_sources: 2 })
  })
  test('explicit missing-projection mutation excludes the fixture companies and is not the captured CI stack', async () => {
    const result = await fixture({ omitProjection: true })
    assert.deepEqual(result.rows.map(row => row.lifecycle_status), ['creating', 'creating'])
    assert.deepEqual(result.options, [])
  })
}
