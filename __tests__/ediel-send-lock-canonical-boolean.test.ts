import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Ediel send lock canonical semantics', () => {
  const source = readFileSync('lib/ediel/outbox/sendOutboxItem.ts', 'utf8')

  it('uses the canonical non-null locked boolean as the lock authority', () => {
    expect(source).toContain('const locked = row.locked === true')
    expect(source).toContain('return locked && !expired')
  })

  it('does not let legacy status=active override canonical locked=false', () => {
    const lockFunction = source.slice(source.indexOf('function lockIsActive'), source.indexOf('async function assertNoActiveSendLock'))
    expect(lockFunction).not.toContain("status === 'active'")
    expect(lockFunction).not.toContain('const status = clean(row.status)')
  })
})
