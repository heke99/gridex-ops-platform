// Pure filesystem/source-pin regression. Never executes SQL or native services.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const h = vi.hoisted(() => ({ sql: vi.fn(() => { throw new Error('native_sql_must_not_run') }) }))
vi.mock('@/scripts/helpers/ediel-normal-switch-native-fixture', () => ({ nativeSql: h.sql, literal: (v: unknown) => JSON.stringify(v) }))
import { readPoaCandidateMigration } from '@/scripts/helpers/ediel-poa-contract-trigger-profile.native'
const name = '20261028091248_allow_contract_signature_before_supply_start.sql'
const original = readFileSync(`supabase/migrations/${name}`)
let root: string, repositoryPath: string, replayOriginalAnchor: string, held: string
beforeEach(() => {
  vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), 'gridex-poa-source-'))
  mkdirSync(join(root, 'repo')); mkdirSync(join(root, 'hold'))
  repositoryPath = join(root, 'repo', name)
  replayOriginalAnchor = join(root, 'hold', '20260923180557_restore_customer_case_events_atomic_status.sql')
  held = join(root, 'hold', name)
  writeFileSync(replayOriginalAnchor, 'Synthetic path anchor only; never executed.')
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); expect(h.sql).not.toHaveBeenCalled() })
it('verifies the ordinary repository original against the unchanged candidate checksum', () => {
  writeFileSync(repositoryPath, original)
  expect(readPoaCandidateMigration({ repositoryPath })).toEqual(original)
})
it('uses the exact sibling original in the existing replay HOLD when the repository copy is absent', () => {
  writeFileSync(held, original)
  expect(readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor })).toEqual(original)
})
it('uses the replay anchor already exported by the existing ordinary native lane', () => {
  writeFileSync(held, original)
  vi.stubEnv('GRIDEX_EDIEL_CASE_RESTORATION_SQL', replayOriginalAnchor)
  expect(readPoaCandidateMigration({ repositoryPath })).toEqual(original)
})
it('rejects changed repository bytes instead of hiding them with a valid held copy', () => {
  writeFileSync(repositoryPath, Buffer.concat([original, Buffer.from('\nchanged')]))
  writeFileSync(held, original)
  expect(() => readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor })).toThrow('poa_candidate_source_changed')
})
it('rejects changed held bytes using the same exact source checksum', () => {
  writeFileSync(held, 'changed')
  expect(() => readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor })).toThrow('poa_candidate_source_changed')
})
it('fails closed when no replay original anchor exists', () => {
  expect(() => readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor: '' })).toThrow('poa_candidate_original_source_missing')
})
it('does not use a relative replay anchor', () => {
  writeFileSync(held, original)
  expect(() => readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor: 'hold/anchor.sql' })).toThrow('poa_candidate_original_source_missing')
})
it('does not hide a repository read error other than missing-file behind the held copy', () => {
  mkdirSync(repositoryPath); writeFileSync(held, original)
  expect(() => readPoaCandidateMigration({ repositoryPath, replayOriginalAnchor })).toThrow(/EISDIR/)
})
