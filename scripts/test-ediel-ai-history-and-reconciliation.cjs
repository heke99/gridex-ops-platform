// masterplan: SC-066
// Supported ordinary execution of the existing finite actual SQL consumer;
// the legal/network owner substitutes remain declared by that script.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')

test('AI reconciliation opens investigations and preserves every protected masterdata row', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-ai-reconciliation-embedded-check.mjs')], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, PGLITE_MODULE_URL: pathToFileURL(require.resolve('@electric-sql/pglite')).href },
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, `${run.stdout || ''}\n${run.stderr || ''}`)
  assert.match(run.stdout, /six whole masterdata tables unchanged, open review-required investigation provenance/)
})
