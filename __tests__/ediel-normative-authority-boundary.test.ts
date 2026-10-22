import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { scanNormativeAuthority } = require('../scripts/ediel-normative-authority-guard.cjs') as {
  scanNormativeAuthority: (root?: string) => string[]
}

const u5Owner = 'lib/ediel/rulebook/utilts25A5.ts'
const validityViolation = (file: string) => `${file}: owns guide/version/effective-date literal outside validity authority/projection allowlist`
const u5Descriptor = `export const UTILTS_25_A_5_SOURCE = Object.freeze({
  guideRevision: '25-A-5',
  effectiveFrom: '2026-10-01',
})`

function scanFixture(files: Record<string, string>): string[] {
  const root = mkdtempSync(path.join(tmpdir(), 'gridex-normative-authority-'))
  try {
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(root, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, source)
    }
    return scanNormativeAuthority(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('Ediel normative authority boundary', () => {
  it('rejects duplicate matrices, legacy validators and unreviewed low-level rule imports', () => {
    expect(scanNormativeAuthority(process.cwd())).toEqual([])
  })

  it('accepts current Swedish U5 validity metadata at its exact reviewed source owner', () => {
    expect(scanFixture({ [u5Owner]: u5Descriptor })).toEqual([])
  })

  it('keeps the historical U4 validity owner registered', () => {
    expect(scanFixture({
      'lib/ediel/rulebook/utilts25A4.ts': `export const source = { guideRevision: '25-A-4', effectiveFrom: '2026-10-01' }`,
    })).toEqual([])
  })

  it.each([
    'app/api/copiedGuide.ts',
    'lib/ediel/rulebook/utilts25A5Copy.ts',
    'lib/ediel/rulebook/utilts25A6.ts',
  ])('rejects the same validity metadata outside its exact owner: %s', (file) => {
    expect(scanFixture({ [file]: u5Descriptor })).toEqual([validityViolation(file)])
  })

  it('allows ordinary runtime to project values through the canonical facade', () => {
    expect(scanFixture({
      'lib/operations/projectGuide.ts': `import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
export const projectGuide = (input: unknown) => resolveCanonicalEdielPolicy(input)`,
    })).toEqual([])
  })

  it('rejects an operational runtime import of the new U5 normative owner', () => {
    const file = 'lib/operations/directGuide.ts'
    const imported = '@/lib/ediel/rulebook/utilts25A5'
    expect(scanFixture({
      [file]: `import { UTILTS_25_A_5_SOURCE } from '${imported}'
export const currentGuide = UTILTS_25_A_5_SOURCE`,
    })).toEqual([
      `${file}: operational runtime imports normative authority ${imported}; consume canonicalEdielPolicy/canonical facade instead`,
    ])
  })

  it('allows the canonical engine to consume the new U5 source descriptor', () => {
    expect(scanFixture({
      'lib/ediel/rulebook/descriptorConsumer.ts': `import { UTILTS_25_A_5_SOURCE } from '@/lib/ediel/rulebook/utilts25A5'
export const descriptor = UTILTS_25_A_5_SOURCE`,
    })).toEqual([])
  })

  it('does not grant the U5 validity owner a hand-maintained message matrix', () => {
    expect(scanFixture({
      [u5Owner]: `export const UTILTS_CODES = ['S01', 'S02', 'S03', 'S04']`,
    })).toEqual([
      `${u5Owner}: hand-maintained Ediel code/profile matrix outside canonical allowlist (PRODAT=0, UTILTS=4)`,
    ])
  })

  it('does not grant the U5 validity owner an independent wire identifier constant', () => {
    expect(scanFixture({
      [u5Owner]: `export const UTILTS_ASSOCIATION = 'E5SE5A'`,
    })).toEqual([`${u5Owner}: owns E2SE6A/E5SE5A literal outside explicit allowlist`])
  })

  it('still rejects normative DB reads inside the registered U5 owner', () => {
    expect(scanFixture({
      [u5Owner]: `export const rows = database.from('ediel_business_deadline_rules')`,
    })).toEqual([
      `${u5Owner}: reads normative DB table ediel_business_deadline_rules; business deadlines are source-controlled canonical policy; DB rows are evidence only`,
    ])
  })

  it('still rejects legacy compatibility APIs inside the registered U5 owner', () => {
    expect(scanFixture({
      [u5Owner]: `export const mode = ackModeForProcess('S01')`,
    })).toEqual([`${u5Owner}: legacy ackModeForProcess compatibility API is forbidden`])
  })
})
