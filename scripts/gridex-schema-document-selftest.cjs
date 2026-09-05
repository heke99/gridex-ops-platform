const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gridex-schema-document-'))
const sections = ['schemas', 'relations', 'columns', 'enums', 'constraints', 'indexes',
  'functions', 'triggers', 'policies', 'relation_grants', 'function_grants', 'schema_grants', 'extensions']
const valid = Object.fromEntries(sections.map(name => [name, name === 'schemas' ? ['public'] : []]))
try {
  const fixture = path.join(temp, 'document.json')
  fs.writeFileSync(path.join(temp, 'psql'), `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(process.env.GRIDEX_TEST_DOCUMENT));\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(temp, 'pg_dump'), `#!${process.execPath}\nprocess.stdout.write('-- isolated test schema\\n');\n`, { mode: 0o755 })
  const env = { ...process.env, PATH: `${temp}${path.delimiter}${process.env.PATH}`,
    GRIDEX_TEST_DOCUMENT: fixture, GRIDEX_PG_DUMP: path.join(temp, 'pg_dump') }
  const run = (tool, document, mode = 'blocking') => {
    fs.writeFileSync(fixture, JSON.stringify(document))
    const args = tool === 'gridex-db-parity.cjs'
      ? ['--canonical', 'postgresql://fixture/canonical', '--target', 'postgresql://fixture/target', '--mode', mode, '--no-ignore']
      : ['--url', 'postgresql://fixture/canonical', '--mode', 'write', '--out-dir', path.join(temp, 'output')]
    return spawnSync(process.execPath, [path.join(__dirname, tool), ...args], { env, encoding: 'utf8' })
  }
  const malformed = [null, {}, [], { ...valid, schemas: [] }, { ...valid, schemas: ['other'] },
    { ...valid, schemas: ['public', 'public'] }, { ...valid, relations: [{}] }]
  for (const section of sections) {
    const missing = { ...valid }; delete missing[section]
    malformed.push(missing, { ...valid, [section]: null })
  }
  for (const tool of ['gridex-db-parity.cjs', 'gridex-schema-snapshot.cjs']) {
    const positive = run(tool, valid)
    assert.equal(positive.status, 0, `${tool}: valid empty schema rejected: ${positive.stderr}`)
    for (const document of malformed) {
      for (const mode of tool === 'gridex-db-parity.cjs' ? ['blocking', 'warning', 'report-only'] : ['write']) {
        const result = run(tool, document, mode)
        assert.notEqual(result.status, 0, `${tool}/${mode} accepted incomplete introspection: ${JSON.stringify(document)}`)
      }
    }
  }
  console.log('PASS: parity and snapshots reject incomplete introspection in every mode; valid empty schema accepted')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
