import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('RenderGateway structured error serialization', () => {
  const gateway = readFileSync('lib/ediel/intent/renderGateway.ts', 'utf8')

  it('prefers PostgREST message/details/hint/code over object stringification', () => {
    expect(gateway).toContain('function structuredErrorMessage(error: unknown): string')
    expect(gateway).toContain('candidate.message')
    expect(gateway).toContain('candidate.details')
    expect(gateway).toContain('candidate.hint')
    expect(gateway).toContain('candidate.code')
    expect(gateway).toContain('const message = structuredErrorMessage(error)')
  })

  it('does not classify structured errors through String(error)', () => {
    expect(gateway).not.toContain(
      'const message = error instanceof Error ? error.message : String(error)',
    )
  })
})
