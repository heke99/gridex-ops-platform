import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getCanonicalUtiltsProfile,
  resolveCanonicalUtiltsProfile,
} from '@/lib/ediel/rulebook/utiltsRulebook'
import { resolveInboundIdentityRequirements } from '@/lib/ediel/inboundRequestAutomation'
import { EDIEL_INSTRUCTION_SPECS } from '@/lib/ediel/specRegistry'
import { getUtiltsMessageSupport } from '@/lib/ediel/utilts/utiltsMessageSupportRegistry'

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
    expect(profile).toMatchObject({
      guideVersion: '25-A-3',
      guideRevision: '3',
      associationAssignedCode: 'E5SE5A',
      effectiveFrom: '2025-06-01',
    })
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

    expect(resolveCanonicalUtiltsProfile({
      messageCode: 'E66',
      businessDate: '2025-06-01',
      version: 'E5SE5A',
    }).effectiveFrom).toBe('2025-06-01')

    expect(() => resolveCanonicalUtiltsProfile({
      messageCode: 'E66',
      businessDate: '2025-05-31',
      version: 'E5SE5A',
    })).toThrow('utilts_profile_not_effective')
  })

  it.each([
    ['S01', 'grid_area'],
    ['S03', 'grid_area'],
    ['S04', 'grid_area'],
    ['S05', 'grid_area'],
    ['E31', 'grid_area'],
  ] as const)('classifies %s as aggregate rather than metering-point data', (code, scope) => {
    const profile = getCanonicalUtiltsProfile(code)
    expect(profile?.scope).toBe(scope)
    expect(profile?.requiresMeteringPoint).toBe(false)
    expect(profile?.requiresGridArea).toBe(true)
  })

  it.each(['E72', 'E73', 'E74', 'S06'] as const)(
    'classifies %s as a request without fake quantity observations',
    (code) => {
      const profile = getCanonicalUtiltsProfile(code)
      expect(profile?.scope).toBe('request')
      expect(profile?.requiresQuantities).toBe(false)
    },
  )

  it('keeps request identity aligned to object versus aggregate semantics', () => {
    expect(getCanonicalUtiltsProfile('E72')).toMatchObject({
      requiresMeteringPoint: true,
      requiresGridArea: false,
    })
    expect(getCanonicalUtiltsProfile('E73')).toMatchObject({
      requiresMeteringPoint: true,
      requiresGridArea: false,
    })
    expect(getCanonicalUtiltsProfile('E74')).toMatchObject({
      requiresMeteringPoint: false,
      requiresGridArea: true,
    })
    expect(getCanonicalUtiltsProfile('S06')).toMatchObject({
      requiresMeteringPoint: false,
      requiresGridArea: true,
    })
  })

  it('classifies S07 as an object-level metering-point time series', () => {
    expect(getCanonicalUtiltsProfile('S07')).toMatchObject({
      scope: 'metering_point',
      requiresMeteringPoint: true,
      requiresGridArea: false,
    })
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

describe('inbound UTILTS identity requirements', () => {
  it('does not force a metering-point lookup for aggregate facts', () => {
    expect(resolveInboundIdentityRequirements({ family: 'UTILTS', code: 'E31' })).toEqual({
      requiresMeteringPoint: false,
      requiresGridArea: true,
    })
  })

  it('keeps object transactions scoped to a metering point', () => {
    expect(resolveInboundIdentityRequirements({ family: 'UTILTS', code: 'E66' })).toEqual({
      requiresMeteringPoint: true,
      requiresGridArea: true,
    })
  })

  it('does not force a metering point on aggregate requests', () => {
    expect(resolveInboundIdentityRequirements({ family: 'UTILTS', code: 'E74' })).toEqual({
      requiresMeteringPoint: false,
      requiresGridArea: true,
    })
  })
})

describe('admin instruction coverage derives complete canonical scope', () => {
  it('contains every canonical PRODAT function without stale partial labels', () => {
    const rows = EDIEL_INSTRUCTION_SPECS.filter((row) => row.family === 'PRODAT')
    expect(rows.map((row) => row.code)).toEqual([
      'Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18',
    ])
    expect(rows.every((row) => row.status === 'runtime_ready')).toBe(true)
  })

  it('contains every current canonical UTILTS code without conflating guide and association', () => {
    const rows = EDIEL_INSTRUCTION_SPECS.filter((row) => row.family === 'UTILTS')
    expect(rows.map((row) => row.code)).toEqual([
      'E30', 'E31', 'E66', 'E72', 'E73', 'E74', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07',
    ])
    expect(rows.every((row) => row.sourceVersion === '25-A-3')).toBe(true)
    expect(rows.every((row) => row.currentVersion === 'E5SE5A')).toBe(true)

    const readiness = Object.fromEntries(rows.map((row) => [row.code, row.status]))
    expect(readiness).toMatchObject({
      E30: 'runtime_partial',
      E31: 'runtime_ready',
      E66: 'runtime_ready',
      E72: 'runtime_partial',
      E73: 'runtime_ready',
      E74: 'runtime_partial',
      S01: 'runtime_partial',
      S02: 'runtime_ready',
      S03: 'runtime_ready',
      S04: 'runtime_partial',
      S05: 'runtime_ready',
      S06: 'runtime_partial',
      S07: 'runtime_partial',
    })
  })
})

describe('UTILTS support matrix derives business semantics from canonical profiles', () => {
  it('does not present received E66 facts as a data request', () => {
    expect(getUtiltsMessageSupport('E66')?.businessProcesses).toEqual(['validated_metering'])
  })

  it.each([
    ['S02', 'object_consumption_forecast'],
    ['S03', 'preliminary_shares'],
    ['E31', 'final_aggregated_metering'],
    ['E73', 'missing_s02_e66_request'],
    ['E74', 'missing_s03_e31_request'],
  ] as const)('maps %s to %s', (code, process) => {
    expect(getUtiltsMessageSupport(code)?.businessProcesses).toEqual([process])
  })
})
