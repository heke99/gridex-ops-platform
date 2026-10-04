import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: mocks.rpc,
  },
}))

import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

function z01Evidence(profileOverrides: Record<string, unknown> = {}) {
  const row = {
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
  return {...row,original_version:'26.A:r3',original_snapshot:{rulePack:{id:row.rule_pack_id,source_hash:row.source_hash,guide_version:row.guide_version,guide_revision:row.guide_revision},messageProfile:{id:row.message_profile_id,rule_pack_id:row.rule_pack_id,profile_key:row.profile_key,profile:row.profile},guideSources:[]}}
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
      databaseProfileKey: 'PRODAT:Z01:L:26.A:r3',
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


describe('original named owner witness',()=>{
  const input={family:'PRODAT' as const,messageCode:'Z01',transactionSubtype:'L',direction:'outbound' as const,businessDate:'2026-09-30'}
  it('preserves registered opaque version and named snapshot through semantic projection',async()=>{
    const row=z01Evidence();mocks.rpc.mockResolvedValue({data:[row],error:null})
    const result=await resolveCanonicalRulePack(input)
    expect(result.originalVersion).toBe('26.A:r3')
    expect(result.originalSnapshot).toEqual(row.original_snapshot)
    expect(result.guideRevision).not.toBe(result.originalVersion)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_canonical_ediel_rule_pack_with_witness_v1',expect.objectContaining({p_business_date:'2026-09-30'}))
  })
  it.each(['version','scope','missing'])('rejects %s original witness without replacement',async(change)=>{
    const row=z01Evidence() as Record<string,unknown>
    if(change==='version')row.original_version='26.A:r999'
    if(change==='scope')(row.original_snapshot as {rulePack:{id:string}}).rulePack.id='foreign'
    if(change==='missing')delete row.original_snapshot
    mocks.rpc.mockResolvedValue({data:[row],error:null})
    await expect(resolveCanonicalRulePack(input)).rejects.toThrow(/canonical_original_rule_witness/)
  })
  it('does not silently replace an explicit selected policy from another source scope',async()=>{
    const canonicalPolicy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'LK',direction:'outbound',referenceDate:'2026-09-30',mode:'catalog_evidence'})
    await expect(resolveCanonicalRulePack({...input,canonicalPolicy})).rejects.toThrow('canonical_selected_policy_scope_mismatch')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('registered source guide scope cannot be borrowed from the UNH association',()=>{
 const input={family:'PRODAT' as const,messageCode:'Z01',transactionSubtype:'L',direction:'outbound' as const,businessDate:'2026-09-30'}
 it.each(['guide','revision','profileGuide','profileRevision'])('holds mismatched %s rather than treating E2SE6A as a guide version',async(change)=>{
  const row=z01Evidence()
  if(change==='guide'){row.guide_version='99.FUTURE';row.guide_revision='E2SE6A'}
  if(change==='revision')row.guide_revision='999'
  if(change==='profileGuide')row.profile.guideVersion='99.FUTURE'
  if(change==='profileRevision')row.profile.guideRevision='999'
  row.original_version=`${row.guide_version}:r${row.guide_revision}`
  row.original_snapshot.rulePack.guide_version=row.guide_version;row.original_snapshot.rulePack.guide_revision=row.guide_revision
  mocks.rpc.mockResolvedValue({data:[row],error:null})
  await expect(resolveCanonicalRulePack(input)).rejects.toThrow(/canonical_rule_pack_evidence_.*(guide|revision)_mismatch/)
 })
})
