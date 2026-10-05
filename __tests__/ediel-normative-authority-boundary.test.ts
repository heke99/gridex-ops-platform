import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { scanNormativeAuthority } = require('../scripts/ediel-normative-authority-guard.cjs') as {
  scanNormativeAuthority: (root?: string) => string[]
}

describe('Ediel normative authority boundary', () => {
  it('rejects duplicate matrices, legacy validators and unreviewed low-level rule imports', () => {
    expect(scanNormativeAuthority(process.cwd())).toEqual([])
  })
})
