// ops-api-remediation: package 4 — compatibility without exact documentation match
import { describe, expect, it } from 'vitest'
import { API_CONTRACT_PROFILE_REGISTRY, assessApiContractCompatibility, isCompatibleResponseRevision } from '@/lib/integrations/apiContractCompatibility'
import { profileRepresentationKey, projectForProfile } from '@/lib/integrations/apiContractProjection'
import { MINIMUM_TENANT_INTEGRATION_VERSION, WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const registry = [{ surface: 'website', major: 'v1', revision: '2026-10-02.3', status: 'supported', capabilities: ['contracts.read'] }] as const

describe('assessApiContractCompatibility (synthetic registry)', () => {
  it('accepts supported client profile without matching latest documentation date', () => {
    expect(assessApiContractCompatibility({ surface: 'website', major: 'v1', clientProfile: '2026-10-02.3', requiredCapabilities: ['contracts.read'], registry }).ok).toBe(true)
  })
  it('rejects another major and unsupported capability', () => {
    expect(assessApiContractCompatibility({ surface: 'website', major: 'v2', clientProfile: null, requiredCapabilities: [], registry }).ok).toBe(false)
    expect(assessApiContractCompatibility({ surface: 'website', major: 'v1', clientProfile: null, requiredCapabilities: ['future.required'], registry })).toEqual({ ok: false, code: 'required_capability_missing' })
  })
  it('explicit unknown profile is an error, never an arbitrary fallback', () => {
    expect(assessApiContractCompatibility({ surface: 'website', major: 'v1', clientProfile: '2099-01-01.1', requiredCapabilities: [], registry })).toEqual({ ok: false, code: 'unsupported_contract_profile' })
  })
  it('a profile of another surface is not usable', () => {
    expect(assessApiContractCompatibility({ surface: 'staff', major: 'v1', clientProfile: '2026-10-02.3', requiredCapabilities: [], registry }).ok).toBe(false)
  })
})

describe('qualified registry', () => {
  it('keeps the existing minimum marker and current release supported for Website and Customer', () => {
    for (const surface of ['website', 'customer'] as const) {
      for (const revision of [MINIMUM_TENANT_INTEGRATION_VERSION, WEBSITE_INTEGRATION_CONTRACT_VERSION]) {
        expect(assessApiContractCompatibility({ surface, major: 'v1', clientProfile: revision, requiredCapabilities: [], registry: API_CONTRACT_PROFILE_REGISTRY }).ok).toBe(true)
      }
    }
  })
  it('a Staff addition does not change Website support', () => {
    const website = API_CONTRACT_PROFILE_REGISTRY.filter((p) => p.surface === 'website')
    expect(website.every((p) => !p.capabilities.some((c) => c.startsWith('users') || c.startsWith('cases')))).toBe(true)
  })
  it('response revisions: any well-formed V1 revision, never another major', () => {
    expect(isCompatibleResponseRevision('2026-10-04.1')).toBe(true)
    expect(isCompatibleResponseRevision('2027-01-15.2')).toBe(true)
    expect(isCompatibleResponseRevision('2027-01-15.2', 'v2')).toBe(false)
    expect(isCompatibleResponseRevision('latest')).toBe(false)
    expect(isCompatibleResponseRevision(null)).toBe(false)
  })
  it('projection is identity for current profiles and cache keys differ per profile', () => {
    const body = { data: [{ offer_reference: 'o', extra: 1 }], meta: {} }
    expect(projectForProfile({ surface: 'website', revision: MINIMUM_TENANT_INTEGRATION_VERSION }, body)).toBe(body)
    expect(profileRepresentationKey('website', '2026-10-02.3')).not.toBe(profileRepresentationKey('website', '2026-10-04.1'))
  })
})
