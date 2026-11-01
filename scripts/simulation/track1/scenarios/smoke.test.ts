// Infrastructure observations only: no campaign fixtures, tenants, writes,
// mail, mocks, backup claim or canonical scenario PASS attribution.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const helper = fileURLToPath(new URL('../../runtime/assigned_backend.py', import.meta.url))
const assignment = process.env.TRACK1_ASSIGNMENT_FILE

function observe(observation: 'database_auth' | 'app_health' | 'storage') {
  if (!assignment || !path.isAbsolute(assignment)) throw new Error('explicit private prepared assignment required')
  if (process.env.TRACK1_RUNTIME_HELPER !== helper) throw new Error('reviewed runtime helper identity required')
  return JSON.parse(execFileSync('python3', [helper, 'observe', '--assignment', assignment, '--observation', observation], {
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
  })) as { ok: boolean; httpStatus?: number }
}

describe('assigned T1 infrastructure smoke', () => {
  it('T1SMOKE.01 observes the assigned PostgreSQL identity and real Auth endpoint', () => {
    expect(observe('database_auth')).toEqual({ ok: true })
  })
  it('T1SMOKE.02 observes the owned app and rejects unauthenticated health success', () => {
    const result = observe('app_health')
    expect(result.ok).toBe(true)
    expect([401, 503]).toContain(result.httpStatus)
  })
  it('T1SMOKE.03 reads the assigned Storage bucket list without mutating objects', () => {
    expect(observe('storage')).toEqual({ ok: true })
  })
})
