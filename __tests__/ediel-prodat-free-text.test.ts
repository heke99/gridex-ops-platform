import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

it('preserves the source-qualified FTX scopes, inbound response and outbound send contract', () => {
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', '--test',
    path.resolve(process.cwd(), 'scripts/test-ediel-prodat-free-text.cjs'),
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const report = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  expect(result.error, report).toBeUndefined()
  expect(result.signal, report).toBeNull()
  expect(result.status, report).toBe(0)
  const executed = Number(/^# tests (\d+)\r?$/m.exec(report)?.[1] ?? '0')
  const passed = Number(/^# pass (\d+)\r?$/m.exec(report)?.[1] ?? '0')
  expect(executed, report).toBeGreaterThan(0)
  expect(passed, report).toBe(executed)
  expect(report).toMatch(/# fail 0(?:\r?\n|$)/)
  expect(report).toMatch(/# skipped 0(?:\r?\n|$)/)
  expect(report).toMatch(/# cancelled 0(?:\r?\n|$)/)
  expect(report).toMatch(/# todo 0(?:\r?\n|$)/)
}, 35_000)
