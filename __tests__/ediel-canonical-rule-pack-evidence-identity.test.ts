import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: mocks.rpc,
  },
}))

import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

function z01Evidence(profileOverrides: Record<string, unknown> = {}) {
  return {
    rule_pack_id: 'fa1b164d-a996-43a8-906a-1d495ea0e2b2',
    message_profile_id: '39157f78-0b05-4300-8b80-bf5cc5de3000',
    market: 'electricity',
    family: 'PRODAT',
    guide_version: '26.A',
    guide_revision: '3',
    unh_association_code: 'E2SE6A',
    valid_from: '2026-04-01',
    valid_to: null,
    source_document: 'PRODAT 26.A revision 3',
    source_hash: 'a'.repeat(64),
    field_matrix_version: '26A-r3',
    profile_key: 'PRODAT:Z01:L:26.A:r3',
    business_process: 'facility_contract_check',
    phase: null,
    profile: {
      family: 'PRODAT',
      source: 'canonical-db-rule-pack',
      messageCode: 'Z01',
      guideVersion: '26.A',
      guideRevision: '3',
      canonicalDirection: 'outbound',
      transactionSubtype: 'L',
      reasonForTransaction: 'Z22',
      ...profileOverrides,
    },
    parser_ready: true,
    builder_ready: true,
    validator_ready: true,
    ack_ready: true,
    state_machine_ready: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canonical rule-pack evidence identity', () => {
  it('accepts the DB technical profile key while returning the semantic canonical profile key', async () => {
    mocks.rpc.mockResolvedValue({ data: [z01Evidence()], error: null })

    await expect(resolveCanonicalRulePack({
      family: 'PRODAT',
      messageCode: 'Z01',
      transactionSubtype: 'L',
      direction: 'outbound',
      businessDate: '2026-09-03',
    })).resolves.toMatchObject({
      profileKey: 'prodat_z01_customer_identity_request',
      businessProcess: 'customer_masterdata',
      family: 'PRODAT',
    })
  })

  it('fails closed when the DB evidence points at another message code', async () => {
    mocks.rpc.mockResolvedValue({ data: [z01Evidence({ messageCode: 'Z02' })], error: null })

    await expect(resolveCanonicalRulePack({
      family: 'PRODAT',
      messageCode: 'Z01',
      transactionSubtype: 'L',
      direction: 'outbound',
      businessDate: '2026-09-03',
    })).rejects.toThrow('canonical_rule_pack_evidence_message_code_mismatch:Z02:Z01')
  })

  it('fails closed when the DB evidence points at another subtype', async () => {
    mocks.rpc.mockResolvedValue({ data: [z01Evidence({ transactionSubtype: 'LK' })], error: null })

    await expect(resolveCanonicalRulePack({
      family: 'PRODAT',
      messageCode: 'Z01',
      transactionSubtype: 'L',
      direction: 'outbound',
      businessDate: '2026-09-03',
    })).rejects.toThrow('canonical_rule_pack_evidence_subtype_mismatch:LK:L')
  })

  it('fails closed when the DB evidence direction disagrees with canonical policy', async () => {
    mocks.rpc.mockResolvedValue({ data: [z01Evidence({ canonicalDirection: 'inbound' })], error: null })

    await expect(resolveCanonicalRulePack({
      family: 'PRODAT',
      messageCode: 'Z01',
      transactionSubtype: 'L',
      direction: 'outbound',
      businessDate: '2026-09-03',
    })).rejects.toThrow('canonical_rule_pack_evidence_direction_mismatch:inbound:outbound')
  })
})
