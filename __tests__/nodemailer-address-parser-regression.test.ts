import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('parses hostile free-text recipient headers without blocking normal email composition', () => {
  // GHSA-v53p-9fqp-m79j: run the real dependency in a bounded subprocess so
  // the old quadratic parser cannot stall the test runner's event loop.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict')
    const parse = require('nodemailer/lib/addressparser')
    const hostile = ' >' + '>[x][x]'.repeat(40000)
    assert.equal(parse(hostile).some(entry => entry.address), false)
    assert.deepEqual(parse('Gridex <sender@example.invalid>, recipient@example.invalid'), [
      { address: 'sender@example.invalid', name: 'Gridex' },
      { address: 'recipient@example.invalid', name: '' },
    ])
  `], { timeout: 5000, encoding: 'utf8' })

  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
}, 10000)
