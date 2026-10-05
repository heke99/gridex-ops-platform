import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('uses the authentic pure XML dependency while retaining fail-closed source I/O boundaries', () => {
  const output = execFileSync(process.execPath, ['--experimental-vm-modules', '-e', `
    const assert = require('node:assert/strict');
    const { createContext } = require('node:vm');
    const real = require('fast-xml-parser');
    const boundary = require('./scripts/helpers/ediel-source-manifest-vm.cjs');
    (async () => {
      const modules = new Map(), parent = { context: createContext({}) };
      const xml = boundary.sourceRuntimeBoundary('fast-xml-parser', modules, parent);
      await xml.link(() => { throw Error('unexpected XML import'); }); await xml.evaluate();
      assert.equal(xml.namespace.XMLParser, real.XMLParser);
      assert.equal(xml.namespace.XMLValidator, real.XMLValidator);
      assert.equal(xml.namespace.XMLValidator.validate('<message><code>Z04</code></message>'), true);
      assert.deepEqual(new xml.namespace.XMLParser().parse('<message><code>Z04</code></message>'), { message: { code: 'Z04' } });
      assert.notEqual(xml.namespace.XMLValidator.validate('<message>'), true);
      assert.equal(boundary.sourceRuntimeBoundary('unapproved-external-module', modules, parent), null);
      const util = boundary.sourceRuntimeBoundary('node:util', modules, parent);
      await util.link(() => { throw Error('unexpected util import'); }); await util.evaluate();
      assert.equal(util.namespace.isDeepStrictEqual, require('node:util').isDeepStrictEqual);
      assert.equal(util.namespace.isDeepStrictEqual({ own: ['source'] }, { own: ['source'] }), true);
      assert.equal(util.namespace.isDeepStrictEqual({ own: ['source'] }, { own: ['other'] }), false);
      boundary.assertNoSourceBoundaryAttempts();
      const files = boundary.sourceRuntimeBoundary('node:fs/promises', modules, parent);
      await files.link(() => { throw Error('unexpected file import'); }); await files.evaluate();
      assert.throws(() => files.namespace.writeFile('forbidden', 'value'), /Unexpected external operation/);
      assert.throws(() => boundary.assertNoSourceBoundaryAttempts(), /Source-only test attempted external/);
      process.stdout.write('authentic XML, malformed XML, unknown import, denied I/O and caught-attempt guard PASS');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: process.cwd(), encoding: 'utf8' })
  expect(output).toContain('caught-attempt guard PASS')
})
