const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')

// Compile the checked-in fixture and execute its three actual callbacks with
// only the child-process boundary controlled. No Auth, role, native agreement
// business function, Storage, provider or full-history schema is exercised.
const nativePath = resolve(__dirname, 'grid-owner-agreement-cleanup-20261001.native.test.ts')
const native = readFileSync(nativePath, 'utf8')
const helper = readFileSync(resolve(__dirname, 'customer-read-proof-native.ts'), 'utf8')
function compiled(source, requireModule, additions = '') {
  const compiledModule = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const context = vm.createContext({ module: compiledModule, exports: compiledModule.exports, require: requireModule, Buffer,
    process: { env: { CI: 'true', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' } } })
  new vm.Script(code + '\n' + additions).runInContext(context)
  return compiledModule.exports
}
const technical = compiled(readFileSync(resolve(__dirname, '../lib/logging/technicalError.ts'), 'utf8'), () => assert.fail('unexpected technical import'))
const diagnostic = compiled(readFileSync(resolve(__dirname, 'helpers/customer-proof-sqlstate-diagnostic-20261001.ts'), 'utf8'), name => {
  assert.equal(name, '@/lib/logging/technicalError')
  return technical
})
// Select exact actual declarations, avoiding unrelated real service imports.
const ast = ts.createSourceFile('helper.ts', helper, ts.ScriptTarget.Latest, true)
const declarations = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'proofSql' ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && ['API', 'DB', 'quote'].includes(declaration.name.text)))
assert.equal(declarations.length, 4, 'actual parser and three actual bindings required')
let stdout = '', childError = null, childCalls = []
const actualHelper = compiled("import { execFileSync } from 'node:child_process';\nimport { customerProofSqlFailure } from './diagnostic';\n" +
  declarations.map(node => node.getText(ast)).join('\n'), name => {
  if (name === './diagnostic') return diagnostic
  assert.equal(name, 'node:child_process')
  return { execFileSync(binary, args, options) {
    assert.equal(binary, 'psql')
    assert.deepEqual(Array.from(args), ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'])
    assert.equal(options.timeout, 30_000)
    childCalls.push(options.input)
    if (childError) throw childError
    return stdout
  } }
})
const captured = [], callbacks = []
const nativeModule = compiled(native, name => {
  if (name === 'node:crypto') return require(name)
  if (name === 'vitest') return { it(label, callback) { callbacks.push({ label, callback }) },
    expect(value) { return { toEqual(expected) { assert.deepEqual(JSON.parse(JSON.stringify(value)), JSON.parse(JSON.stringify(expected))) } } } }
  assert.equal(name, './customer-read-proof-native')
  return { quote: actualHelper.quote, proofSql(input) {
    captured.push(input)
    // This capture-only result allows each actual callback to reach its real
    // assertion. The independent SQL/parser tests below decide qualification.
    return { passed: true }
  } }
}, 'module.exports.fixtureForProtocol = fixture;')
assert.equal(callbacks.length, 3)
for (const { callback } of callbacks) callback()
assert.equal(captured.length, 3)
const f = nativeModule.fixtureForProtocol()
const foreign = f.seed.match(/FROM public\.grid_owners g WHERE id='([0-9a-f-]{36})'/)?.[1]
assert.ok(foreign, 'quiet owner must come from actual compiled seed')
const protectedNames = ['customers', 'customer_contracts', 'billing_underlays', 'customer_invoices',
  'invoice_export_items', 'ediel_messages', 'outbound_requests', 'tenant_email_outbox']
const seedProtocol = f.seed.slice(f.seed.indexOf('CREATE TEMP TABLE agreement_cleanup_protected'))
const finishProtocol = f.finish
const terminal = "SELECT jsonb_build_object('passed',true) AS proof_receipt;"
const prepared = captured[2].slice(captured[2].indexOf('SET LOCAL ROLE service_role;') + 'SET LOCAL ROLE service_role;'.length,
  captured[2].indexOf('RESET ROLE; UPDATE private.gridex_agreement_uploads_v1'))
let db
before(async () => {
  db = new PGlite()
  await db.exec(protectedNames.map(name => `CREATE TABLE public.${name}(id integer primary key, amount numeric, external_number bigint);
    INSERT INTO public.${name} VALUES(1,9007199254740992.01,9007199254740993);`).join('\n') +
    `CREATE TABLE public.grid_owners(id uuid primary key,name text); INSERT INTO public.grid_owners VALUES(${actualHelper.quote(foreign)},'Quiet protocol canary');
    CREATE TABLE public.protocol_command_calls(command jsonb);
    CREATE FUNCTION public.gridex_grid_owner_agreement_command_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql AS $stub$
      BEGIN INSERT INTO public.protocol_command_calls VALUES(command); RETURN jsonb_build_object('protocol_stub',true); END $stub$;`)
})
after(async () => { if (db) await db.close() })
async function transaction(body) {
  await db.exec('BEGIN;')
  try { return await body() } finally { await db.exec('ROLLBACK;') }
}
function rowOutput(results) {
  // psql -Atq emits each row, while DO/DDL/SET do not emit row values. Preserve
  // every result row rather than accepting a last-line or first-line shortcut.
  return results.flatMap(result => result.rows.map(row => Object.values(row).map(value =>
    typeof value === 'string' ? value : JSON.stringify(value)).join('|'))).join('\n') + '\n'
}
function parseOutput(output, command = 'controlled protocol input') {
  stdout = output; childError = null
  return JSON.parse(JSON.stringify(actualHelper.proofSql(command)))
}
function fingerprintSeed(input = seedProtocol) {
  return input.slice(0, input.indexOf("SELECT set_config('gridex.cleanup.native_command'") >= 0
    ? input.indexOf("SELECT set_config('gridex.cleanup.native_command'") : input.indexOf('DO $settings$'))
}
const configuration = seedProtocol.slice(fingerprintSeed().length)

test('all three actual compiled callbacks deliver real SQL separators and preserve the single receipt expectation', () => {
  for (const input of captured) {
    assert.ok(!input.includes(';\\n'), 'compiled SQL must not contain a literal backslash-n statement separator')
    assert.equal(input.split(terminal).length - 1, 1)
    assert.ok(input.startsWith('BEGIN;'))
    assert.ok(input.endsWith('ROLLBACK;'))
  }
})
test('actual protected INSERT map parses in PostgreSQL and stores exactly eight PG-side fingerprints', async () => {
  await transaction(async () => {
    await db.exec(fingerprintSeed())
    const rows = (await db.query('SELECT table_name,digest FROM agreement_cleanup_protected ORDER BY table_name')).rows
    assert.deepEqual(rows.map(row => row.table_name), [...protectedNames].sort())
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.digest)))
  })
})
test('actual protected finish map parses in PostgreSQL and produces the one real JSON receipt', async () => {
  await transaction(async () => {
    await db.exec(seedProtocol)
    const output = rowOutput(await db.exec(finishProtocol.replace(/ROLLBACK;\s*$/, '')))
    assert.deepEqual(parseOutput(output), { passed: true })
  })
})
test('actual seed configuration contributes no extra stdout while preserving both exact transaction-local values', async () => {
  await transaction(async () => {
    const result = await db.exec(configuration + terminal)
    assert.deepEqual(parseOutput(rowOutput(result)), { passed: true })
    const row = (await db.query("SELECT current_setting('gridex.cleanup.native_command')::jsonb AS command,current_setting('gridex.cleanup.quiet_owner_hash') AS hash")).rows[0]
    assert.deepEqual(row.command, JSON.parse(JSON.stringify(f.command)))
    assert.equal(row.hash, (await db.query(`SELECT encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') AS hash FROM public.grid_owners g WHERE id=${actualHelper.quote(foreign)}`)).rows[0].hash)
  })
})
test('third actual preparation executes its unchanged argument once without emitting a command row (protocol stub only)', async () => {
  await transaction(async () => {
    await db.exec(configuration)
    const result = await db.exec(prepared + terminal)
    assert.deepEqual(parseOutput(rowOutput(result)), { passed: true })
    const rows = (await db.query('SELECT command FROM public.protocol_command_calls')).rows
    assert.equal(rows.length, 1)
    // Same exact expression reads the prepared current transaction setting;
    // this protocol-only execution uses the actual fixture f's setting. The
    // complete callback SQL is separately captured without changing its UUIDs.
    assert.deepEqual(rows[0].command, JSON.parse(JSON.stringify(f.command)))
  })
})
test('actual shared parser rejects an additional unexpected JSON row instead of selecting a convenient receipt', () => {
  assert.throws(() => parseOutput('{"unexpected":true}\n{"passed":true}\n'), /stage=customer_sql sqlstate=UNKNOWN$/)
})
test('actual shared parser rejects both seed config result rows (isolated old SELECT regression)', async () => {
  await transaction(async () => {
    const oldConfiguration = configuration.replace(/^\s*DO \$settings\$ BEGIN\s*/, '')
      .replace(/\s*END \$settings\$;\s*$/, '').replaceAll('PERFORM set_config', 'SELECT set_config')
    const result = await db.exec(oldConfiguration + terminal)
    assert.equal(result.reduce((total, item) => total + item.rows.length, 0), 3)
    assert.throws(() => parseOutput(rowOutput(result)), /stage=customer_sql sqlstate=UNKNOWN$/)
  })
})
test('actual shared parser rejects the third old command output (same argument, protocol stub only)', async () => {
  await transaction(async () => {
    await db.exec(configuration)
    const oldPrepared = prepared.replace(/^\s*DO \$prepare\$ BEGIN\s*/, '')
      .replace(/\s*END \$prepare\$;\s*$/, '').replace('PERFORM public.', 'SELECT public.')
    const result = await db.exec(oldPrepared + terminal)
    assert.equal(result.reduce((total, item) => total + item.rows.length, 0), 2)
    assert.throws(() => parseOutput(rowOutput(result)), /stage=customer_sql sqlstate=UNKNOWN$/)
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.protocol_command_calls')).rows[0].count, 1)
  })
})
test('deliberately injected literal separator is rejected with 42601; it is absent from the actual fixture', async () => {
  await transaction(async () => {
    let failure
    try { await db.exec(fingerprintSeed().replace(';\nINSERT', ';\\nINSERT')) } catch (error) { failure = error }
    assert.equal(failure?.code, '42601')
    childError = Object.assign(new Error('controlled child failure'), { stderr: 'ERROR:  42601\n' })
    assert.throws(() => actualHelper.proofSql('controlled parser failure'), /stage=customer_sql sqlstate=42601$/)
    childError = null
  })
})
test('all eight actual PG-side protected checks reject a changed protected numeric or bigint row', async () => {
  for (const name of protectedNames) await transaction(async () => {
    await db.exec(seedProtocol)
    await db.exec(`UPDATE public.${name} SET amount=amount+0.01,external_number=external_number+1 WHERE id=1;`)
    await assert.rejects(db.exec(finishProtocol.replace(/ROLLBACK;\s*$/, '')), error => error.code === 'P0001' && error.message === 'cleanup_native_protected_graph_changed')
  })
})
test('actual quiet-owner fingerprint rejects a changed foreign row', async () => {
  await transaction(async () => {
    await db.exec(seedProtocol)
    await db.exec(`UPDATE public.grid_owners SET name='Changed foreign canary' WHERE id=${actualHelper.quote(foreign)};`)
    await assert.rejects(db.exec(finishProtocol.replace(/ROLLBACK;\s*$/, '')), error => error.code === 'P0001' && error.message === 'cleanup_native_foreign_changed')
  })
})
for (const [index, input] of captured.entries()) test(`actual callback ${index + 1} fixture/finish protocol preserves its fresh tuple and emits only its receipt`, async () => {
  await transaction(async () => {
    const seedStart = input.indexOf('CREATE TEMP TABLE agreement_cleanup_protected')
    const businessStart = input.indexOf('SET LOCAL ROLE service_role;')
    const finishStart = input.indexOf('RESET ROLE;\n    DO $protected$')
    assert.ok(seedStart > 0 && businessStart > seedStart && finishStart > businessStart)
    const actualSeed = input.slice(seedStart, businessStart)
    const actualFinish = input.slice(finishStart).replace(/ROLLBACK;\s*$/, '')
    const quietId = actualSeed.match(/FROM public\.grid_owners g WHERE id='([0-9a-f-]{36})'/)?.[1]
    const commandJson = actualSeed.match(/set_config\('gridex\.cleanup\.native_command','([^']*)',true\)/)?.[1]
    assert.ok(quietId && commandJson)
    await db.exec(`INSERT INTO public.grid_owners VALUES(${actualHelper.quote(quietId)},'Actual callback quiet canary');`)
    const output = rowOutput(await db.exec(actualSeed + actualFinish))
    assert.deepEqual(parseOutput(output, input), { passed: true })
    assert.equal(childCalls.at(-1), input, 'actual parser receives the unmodified complete callback input')
    assert.deepEqual((await db.query("SELECT current_setting('gridex.cleanup.native_command')::jsonb AS command")).rows[0].command, JSON.parse(commandJson))
    // Only the fixture fingerprint/configuration and final receipt regions ran
    // in PostgreSQL. The callback's business/authority body remains unexecuted.
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.protocol_command_calls')).rows[0].count, 0)
  })
})
