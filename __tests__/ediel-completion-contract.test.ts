import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getCanonicalUtiltsProfile,
  resolveCanonicalUtiltsProfile,
} from '@/lib/ediel/rulebook/utiltsRulebook'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql',
)

describe('canonical UTILTS profile contract', () => {
  it('resolves the active E5SE5A profile with phase and role metadata', () => {
    const profile = resolveCanonicalUtiltsProfile({
      messageCode: 'E66',
      businessDate: '2026-04-01',
      version: 'E5SE5A',
    })

    expect(profile.messageCode).toBe('E66')
    expect(profile.phase).toBe('metering')
    expect(profile.allowedSenderRoles).toContain('grid_owner')
    expect(profile.allowedReceiverRoles).toContain('supplier')
  })

  it('keeps S06 fail-closed behind bilateral capability', () => {
    expect(getCanonicalUtiltsProfile('S06')?.bilateralCapabilityRequired).toBe(true)
  })

  it('rejects unsupported versions and pre-effective business dates', () => {
    expect(() => resolveCanonicalUtiltsProfile({
      messageCode: 'E66',
      businessDate: '2026-04-01',
      version: 'E5SE4',
    })).toThrow('utilts_profile_version_not_supported')

    expect(() => resolveCanonicalUtiltsProfile({
      messageCode: 'E66',
      businessDate: '2026-03-31',
      version: 'E5SE5A',
    })).toThrow('utilts_profile_not_effective')
  })
})

describe('Ediel completion migration compatibility', () => {
  it('creates market_process_policies before updating it', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const createPosition = migration.indexOf('create table if not exists public.market_process_policies')
    const updatePosition = migration.indexOf('update public.market_process_policies')

    expect(createPosition).toBeGreaterThan(-1)
    expect(updatePosition).toBeGreaterThan(createPosition)
    expect(migration).toContain('\"day_mode\":\"calendar_days\"')
  })
})
