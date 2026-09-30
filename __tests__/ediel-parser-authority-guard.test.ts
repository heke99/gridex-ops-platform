import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { scanParserAuthority } = require('../scripts/ediel-parser-authority-guard.cjs') as {
  scanParserAuthority: (root?: string) => string[]
}

const consumers = [
  'lib/ediel/core/edifactSegments.ts',
  'lib/ediel/rulebook/ruleProfileSelector.ts',
  'lib/ediel/classify.ts',
  'lib/inbound-mail/edielEmailParser.ts',
  'lib/ediel/inbound/productionInboundDecisionEngine.ts',
  'lib/ediel/utilts.ts',
]

function withConsumerFixture(run: (root: string, utilts: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gridex-parser-authority-'))
  try {
    for (const file of consumers) {
      const target = path.join(root, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(process.cwd(), file), target)
    }
    run(root, path.join(root, 'lib/ediel/utilts.ts'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('Ediel parser authority guard', () => {
  it('accepts the current lossless UTILTS consumer', () => {
    withConsumerFixture(root => expect(scanParserAuthority(root)).toEqual([]))
  })

  it('rejects replacing lossless components with the formerly required decoded-element parser', () => {
    withConsumerFixture((root, utilts) => {
      const source = fs.readFileSync(utilts, 'utf8')
      fs.writeFileSync(utilts, source.replaceAll(
        'segmentComposite(segment, 1, una)',
        'splitComposite(segment.elements[1], una)',
      ))
      expect(scanParserAuthority(root)).toContain(
        'lib/ediel/utilts.ts: must consume segmentComposite(segment, 1, una)',
      )
    })
  })

  it.each([
    ['splitComposite(segment.elements[1], una)', 'decoded-element composite parsing'],
    ['firstCompositeComponent(segment.elements[2], una)', 'decoded-element composite parsing'],
    ["segment.elements[1].split(':')", 'raw UTILTS delimiter splitting'],
    ['segment.raw.split(una.dataElementSeparator)', 'raw UTILTS delimiter splitting'],
    ["rawPayload.split(\"'\")", 'raw UTILTS delimiter splitting'],
  ])('rejects reintroduced %s while other lossless calls remain', (unsafeCall, label) => {
    withConsumerFixture((root, utilts) => {
      fs.appendFileSync(utilts, `\nconst unsafeComposite = ${unsafeCall}\n`)
      expect(scanParserAuthority(root)).toContain(
        `lib/ediel/utilts.ts: ${label} is forbidden; consume canonicalEdifactAst/edifactTokenizer instead`,
      )
    })
  })
})
