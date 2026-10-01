const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')

// Only trusted checked-in SQL fragments and fresh typed canaries run here.
// No native module, Auth schema, roles, service client or provider is executed.
const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const native = readFileSync(resolve(__dirname, 'customer-lifecycle-source-binding-20261001.native.test.ts'), 'utf8')
const fragment = pattern => {
  const matches = [...schema.matchAll(new RegExp(pattern, 'g'))]
  assert.equal(matches.length, 1, 'unique actual schema fragment required')
  return matches[0][0]
}
const table = name => fragment('CREATE TABLE public\\.' + name + ' \\([\\s\\S]*?\\n\\);')
const fn = name => fragment('CREATE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\n    AS \\$\\$[\\s\\S]*?\\$\\$;')
const constraint = (name, owner) => fragment('ALTER TABLE ONLY public\\.' + owner + '\\n    ADD CONSTRAINT ' + name + ' [^;]+;')
const trigger = name => fragment('CREATE TRIGGER ' + name + ' [^;]+;')
const tables = ['companies', 'platform_default_legal_templates', 'legal_text_versions', 'legal_bundles', 'legal_bundle_items']
const functions = ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference', 'gridex_seed_default_legal_package_for_company', 'gridex_seed_default_legal_package_after_company_insert', 'gridex_prevent_published_legal_text_mutation']
const constraints = [
  ['companies_pkey', 'companies'], ['platform_default_legal_templates_pkey', 'platform_default_legal_templates'],
  ['platform_default_legal_templates_type_version_uidx', 'platform_default_legal_templates'],
  ['legal_text_versions_pkey', 'legal_text_versions'], ['legal_text_versions_company_type_version_uidx', 'legal_text_versions'],
  ['legal_bundles_pkey', 'legal_bundles'], ['legal_bundle_items_pkey', 'legal_bundle_items'],
  ['legal_text_versions_company_id_fkey', 'legal_text_versions'], ['legal_bundles_company_id_fkey', 'legal_bundles'],
  ['legal_bundle_items_legal_bundle_id_fkey', 'legal_bundle_items'], ['legal_bundle_items_legal_text_version_id_fkey', 'legal_bundle_items'],
]
const fragments = [
  ...functions.slice(0, 2).map(fn), ...tables.map(table), ...constraints.map(([name, owner]) => constraint(name, owner)),
  ...functions.slice(2).map(fn), trigger('companies_seed_default_legal_package'), trigger('legal_text_versions_immutable_when_published'),
]
const guardLiteral = 'Published legal text versions cannot be deleted. Archive by publishing a new version instead.'
assert.ok(fn('gridex_prevent_published_legal_text_mutation').includes("raise exception '" + guardLiteral + "'"))
const id = n => 'ec100000-0000-4000-8000-' + String(n).padStart(12, '0')
const f = { company: id(1), quiet: id(2), customer: id(11), quietCustomer: id(12), contract: id(21), quietContract: id(22), caseId: id(31), fault: 'lifecycle_owned_core_fault' }
const quote = value => "'" + value.replaceAll("'", "''") + "'"

// Find the exact actual callback and its SQL calls; never evaluate its imports.
const ast = ts.createSourceFile('native.ts', native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let callback
function findCallback(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'afterEach') {
    assert.equal(callback, undefined, 'one actual afterEach required')
    callback = node.arguments[0]
  }
  ts.forEachChild(node, findCallback)
}
findCallback(ast)
assert.ok(callback && ts.isArrowFunction(callback))
const cleanupCalls = []
function renderTemplate(command, bound = f) {
  assert.ok(ts.isTemplateExpression(command) || ts.isNoSubstitutionTemplateLiteral(command), 'actual literal SQL template required')
  return new Function('f', 'quote', 'return ' + command.getText(ast))(bound, quote)
}
function findSql(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'proofSql') {
    const command = node.arguments[0], stage = node.arguments[1]
    assert.ok(ts.isTemplateExpression(command) || ts.isNoSubstitutionTemplateLiteral(command), 'actual cleanup literal template required')
    assert.ok(stage && ts.isStringLiteral(stage), 'closed actual cleanup stage required')
    cleanupCalls.push({ command: renderTemplate(command), stage: stage.text })
  }
  ts.forEachChild(node, findSql)
}
findSql(callback.body)
assert.ok(cleanupCalls.length >= 5)
const retainedFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'retainedCompanyLegalGraph')
let retainedTemplate, remainingExpected
if (retainedFunction) {
  const statement = retainedFunction.body.statements.find(ts.isReturnStatement)
  assert.ok(statement && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'proofSql')
  retainedTemplate = statement.expression.arguments[0]
}
function findExpected(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toEqual') {
    const expression = node.expression.expression
    if (ts.isCallExpression(expression) && expression.expression.getText(ast) === 'expect') {
      const checked = expression.arguments[0]
      if (checked && ts.isCallExpression(checked) && checked.expression.getText(ast) === 'proofSql'
        && checked.arguments[1]?.text === 'lifecycle_cleanup_companies' && ts.isObjectLiteralExpression(node.arguments[0])) {
        remainingExpected = new Function('return (' + node.arguments[0].getText(ast) + ')')()
      }
    }
  }
  ts.forEachChild(node, findExpected)
}
findExpected(callback.body)
const remainingCall = cleanupCalls.find(call => call.stage === 'lifecycle_cleanup_companies' && /^SELECT\s/i.test(call.command.trim()))
const oldDelete = `DELETE FROM public.companies WHERE id IN (${quote(f.company)},${quote(f.quiet)}); SELECT to_jsonb(true);`

async function exec(db, sql, stage = 'core') {
  try { return await db.exec(sql) } catch (error) {
    const code = /^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : 'unknown'
    throw Object.assign(new Error('lifecycle_owned_core_failed stage=' + stage + ' sqlstate=' + code), {
      code, matches_fixed_immutable_guard: error.message === guardLiteral,
    })
  }
}
const graphTables = [...tables, 'customers', 'customer_contracts', 'customer_cases', 'customer_lifecycle_decisions']
async function digest(db, names = graphTables, company = null) {
  const items = names.map(name => {
    const predicate = !company || name === 'platform_default_legal_templates' ? '' : name === 'companies'
      ? ` WHERE id=${quote(company)}` : name === 'legal_bundle_items'
        ? ` WHERE legal_bundle_id IN (SELECT id FROM public.legal_bundles WHERE company_id=${quote(company)})`
        : ` WHERE company_id=${quote(company)}`
    return `${quote(name)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.${name} t${predicate})`
  })
  const result = await exec(db, `SELECT encode(sha256(convert_to(jsonb_build_object(${items.join(',')})::text,'UTF8')),'hex') AS digest;`)
  return result.at(-1).rows[0].digest
}
async function fixture() {
  const db = new PGlite()
  try {
    await exec(db, fragments.join('\n'))
    await exec(db, `CREATE SCHEMA private;
      CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE);
      CREATE TABLE public.customer_contracts(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE);
      CREATE TABLE public.customer_cases(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,customer_contract_id uuid NOT NULL REFERENCES public.customer_contracts(id) ON DELETE CASCADE);
      CREATE TABLE public.customer_lifecycle_decisions(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,source_customer_case_id uuid REFERENCES public.customer_cases(id) ON DELETE CASCADE);
      INSERT INTO public.platform_default_legal_templates(type,version,title,body,status,published_at)
        SELECT kind,'controlled-v1','Controlled legal fixture','Controlled legal fixture','published',clock_timestamp()
        FROM unnest(ARRAY['terms','privacy_policy','withdrawal','price_terms','power_of_attorney'])kind;
      INSERT INTO public.companies(id,name,status) VALUES('${id(1)}','Owned cleanup A','active'),('${id(2)}','Owned cleanup B','active'),('${id(3)}','Foreign unchanged','active');
      INSERT INTO public.customers VALUES('${id(11)}','${id(1)}'),('${id(12)}','${id(2)}'),('${id(13)}','${id(3)}');
      INSERT INTO public.customer_contracts VALUES('${id(21)}','${id(1)}','${id(11)}'),('${id(22)}','${id(2)}','${id(12)}'),('${id(23)}','${id(3)}','${id(13)}');
      INSERT INTO public.customer_cases VALUES('${id(31)}','${id(1)}','${id(11)}','${id(21)}'),('${id(32)}','${id(3)}','${id(13)}','${id(23)}');
      INSERT INTO public.customer_lifecycle_decisions VALUES('${id(41)}','${id(1)}','${id(31)}'),('${id(42)}','${id(3)}','${id(32)}');`)
    const seeded = await exec(db, `SELECT company_id,count(*)::int AS count FROM public.legal_text_versions WHERE status='published' GROUP BY company_id ORDER BY company_id;`)
    assert.deepEqual(seeded.at(-1).rows.map(row => row.count), [5, 5, 5], 'actual seed trigger must complete rather than swallow a missing dependency')
    return db
  } catch (error) { await db.close(); throw error }
}
async function rejected(call) {
  try { await call() } catch (error) { return error }
  assert.fail('actual immutable failure required')
}
async function retainedGraph(db, bound = f) {
  assert.ok(retainedTemplate, 'actual native retained helper required')
  const result = await exec(db, renderTemplate(retainedTemplate, bound), 'retained_company_legal_graph')
  return result.at(-1).rows[0].jsonb_build_object
}
async function actualRemaining(db) {
  assert.ok(remainingCall, 'actual native readonly remaining-count SQL required')
  const result = await exec(db, remainingCall.command, remainingCall.stage)
  return result.at(-1).rows[0].jsonb_build_object
}

test('actual company INSERT seeds five published versions and a complete owned legal bundle', async () => {
  const db = await fixture()
  try {
    const result = await exec(db, 'SELECT (SELECT count(*)::int FROM public.legal_text_versions) AS texts,(SELECT count(*)::int FROM public.legal_bundles) AS bundles,(SELECT count(*)::int FROM public.legal_bundle_items) AS items;')
    assert.deepEqual(result.at(-1).rows[0], { texts: 15, bundles: 3, items: 15 })
  } finally { await db.close() }
})

test('exact published company cleanup reaches the actual immutable P0001 and changes no graph rows', async () => {
  const db = await fixture()
  try {
    const before = await digest(db)
    const error = await rejected(() => exec(db, oldDelete, 'lifecycle_cleanup_companies'))
    assert.equal(error.code, 'P0001')
    assert.equal(error.matches_fixed_immutable_guard, true)
    assert.equal(await digest(db), before)
  } finally { await db.close() }
})

test('actual current native cleanup succeeds with zero owned mutable rows and exact retained legal/parent graph', async () => {
  const db = await fixture()
  try {
    const legalBefore = await digest(db, tables)
    const foreignBefore = await digest(db, graphTables, id(3))
    const retainedBefore = await retainedGraph(db)
    for (const call of cleanupCalls) await exec(db, call.command, call.stage)
    const result = await exec(db, `SELECT (SELECT count(*)::int FROM public.companies WHERE id IN ('${id(1)}','${id(2)}')) AS parents,
      (SELECT count(*)::int FROM public.customers WHERE company_id IN ('${id(1)}','${id(2)}')) AS customers,
      (SELECT count(*)::int FROM public.customer_contracts WHERE company_id IN ('${id(1)}','${id(2)}')) AS contracts,
      (SELECT count(*)::int FROM public.customer_cases WHERE company_id IN ('${id(1)}','${id(2)}')) AS cases,
      (SELECT count(*)::int FROM public.customer_lifecycle_decisions WHERE company_id IN ('${id(1)}','${id(2)}')) AS decisions;`)
    assert.deepEqual(result.at(-1).rows[0], { parents: 2, customers: 0, contracts: 0, cases: 0, decisions: 0 })
    assert.deepEqual(await actualRemaining(db), remainingExpected)
    assert.deepEqual(await retainedGraph(db), retainedBefore)
    assert.equal(await digest(db, tables), legalBefore)
    assert.equal(await digest(db, graphTables, id(3)), foreignBefore)
  } finally { await db.close() }
})

test('published legal direct DELETE and content UPDATE guards remain installed and transactional', async () => {
  const db = await fixture()
  try {
    const before = await digest(db)
    const deletion = await rejected(() => exec(db, `DELETE FROM public.legal_text_versions WHERE company_id='${id(1)}';`, 'legal_delete_control'))
    assert.equal(deletion.code, 'P0001'); assert.equal(deletion.matches_fixed_immutable_guard, true)
    const update = await rejected(() => exec(db, `UPDATE public.legal_text_versions SET body='Controlled changed body' WHERE company_id='${id(1)}';`, 'legal_update_control'))
    assert.equal(update.code, 'P0001')
    assert.equal(await digest(db), before)
  } finally { await db.close() }
})

test('source extraction retains actual constraints, seed and immutability triggers without Auth/role execution', () => {
  assert.ok(fragments.some(sql => sql.includes('legal_text_versions_company_id_fkey') && sql.includes('ON DELETE CASCADE')))
  assert.ok(fragments.some(sql => sql.startsWith('CREATE TRIGGER companies_seed_default_legal_package AFTER INSERT')))
  assert.ok(fragments.some(sql => sql.startsWith('CREATE TRIGGER legal_text_versions_immutable_when_published BEFORE DELETE OR UPDATE')))
  assert.ok(!fragments.some(sql => /CREATE\s+(?:ROLE|SCHEMA\s+auth)|SET\s+(?:LOCAL\s+)?ROLE|REFERENCES auth\./i.test(sql)))
  assert.deepEqual(remainingExpected, { companies: 2, decisions: 0, cases: 0, contracts: 0, customers: 0 })
  assert.ok(cleanupCalls.every(call => !/DELETE FROM public\.companies/.test(call.command)))
  console.log('LIFECYCLE_CLEANUP_CORE_SOURCE_SHA256 ' + createHash('sha256').update(fragments.join('\n')).digest('hex'))
})

test('omitting the actual owned customer DELETE is rejected by the actual native remaining-count oracle', async () => {
  const db = await fixture()
  try {
    const before = await retainedGraph(db)
    for (const call of cleanupCalls.filter(call => call.stage !== 'lifecycle_cleanup_customers')) await exec(db, call.command, call.stage)
    const remaining = await actualRemaining(db)
    assert.equal(remaining.customers, 2)
    assert.throws(() => assert.deepEqual(remaining, remainingExpected), assert.AssertionError)
    assert.deepEqual(await retainedGraph(db), before)
  } finally { await db.close() }
})

test('a missing selected parent is detected by the actual readonly helper without deleting protected parents', async () => {
  const db = await fixture()
  try {
    const before = await retainedGraph(db)
    const missing = await retainedGraph(db, { ...f, company: id(999) })
    assert.notEqual(missing.companies, before.companies)
    assert.throws(() => assert.deepEqual(missing, before), assert.AssertionError)
    assert.deepEqual(await retainedGraph(db), before)
  } finally { await db.close() }
})

test('an allowed legal metadata change is detected by the actual full-row helper without changing published status', async () => {
  const db = await fixture()
  try {
    const before = await retainedGraph(db)
    await exec(db, `UPDATE public.legal_text_versions SET metadata=metadata||'{"controlled_metadata_change":true}'::jsonb WHERE company_id='${id(1)}';`, 'legal_metadata_control')
    const changed = await retainedGraph(db)
    assert.notEqual(changed.legalTexts, before.legalTexts)
    assert.throws(() => assert.deepEqual(changed, before), assert.AssertionError)
    const status = await exec(db, `SELECT count(*)::int AS count FROM public.legal_text_versions WHERE company_id='${id(1)}' AND status='published';`)
    assert.equal(status.at(-1).rows[0].count, 5)
    const guard = await rejected(() => exec(db, oldDelete, 'lifecycle_cleanup_companies'))
    assert.equal(guard.code, 'P0001'); assert.equal(guard.matches_fixed_immutable_guard, true)
  } finally { await db.close() }
})
