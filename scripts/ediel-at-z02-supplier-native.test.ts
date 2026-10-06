// Native prospective catalog component only. Both whole Z02 contracts remain
// unapproved until own Z01, public ingress, atomic effects, ACK and replay run.
// No finite registry/SQL port and no admission, snapshot or accepted fact seed.
import { describe, expect, it } from 'vitest'
import { resolveSupplierDataBirthProfile } from '@/lib/inbound-mail/supplierDataBirthProfile'
import { supabaseService } from '@/lib/supabase/service'
import { raw, line, characteristic, type Parts } from '../__tests__/fixtures/prodat-register'

const receivedAt = '2026-10-06T12:00:00.000Z'
const object = (number: string, point: string, reason: string): Parts[] => [
  line(number, point, undefined, '9'), ...characteristic('Z13', reason),
]
const wire = (reason: string, multiple = false) => raw([
  ...object('1', '735123456789012345', reason),
  ...(multiple ? object('2', '735123456789012346', reason) : []),
], 'Z02')

describe('native Z02 prospective catalog evidence (not whole acceptance)', () => {
  it.each(['Z22', 'Z23'])('pins real current %s catalog witnesses without replacing admission', async reason => {
    const result = await resolveSupplierDataBirthProfile({ rawPayload: wire(reason, true), receivedAt })
    expect(result).not.toBeNull()
    if (!result) throw new Error('native_z02_catalog_birth_missing')
    expect(Object.keys(result).sort()).toEqual([
      'canonical_rule_pack_id', 'rule_pack_checksum', 'rule_pack_snapshot',
      'rule_profile_key', 'rule_profile_version', 'rule_profile_version_id',
    ])
    const actual = await supabaseService.rpc('resolve_canonical_ediel_rule_pack_with_witness_v1', {
      p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z02',
      p_transaction_subtype: reason === 'Z22' ? 'L' : 'LK', p_direction: 'inbound',
      p_business_date: '2026-10-06',
    })
    if (actual.error) throw actual.error
    const witnesses = Array.isArray(actual.data) ? actual.data : actual.data ? [actual.data] : []
    expect(witnesses).toHaveLength(1)
    const witness = witnesses[0] as Record<string, unknown>
    expect(result).toEqual({ canonical_rule_pack_id: witness.rule_pack_id,
      rule_profile_key: witness.profile_key, rule_profile_version_id: witness.message_profile_id,
      rule_profile_version: witness.original_version, rule_pack_checksum: witness.source_hash,
      rule_pack_snapshot: { ...(witness.original_snapshot as Record<string, unknown>),
        profileKey: witness.profile_key, profileVersionId: witness.message_profile_id,
        version: witness.original_version, checksum: witness.source_hash },
    })
    const [profile, pack] = await Promise.all([
      supabaseService.from('ediel_message_profiles').select('id,rule_pack_id,profile_key,message_code,is_enabled')
        .eq('id', result.rule_profile_version_id).single(),
      supabaseService.from('ediel_rule_packs').select('id,source_hash,guide_version,guide_revision')
        .eq('id', result.canonical_rule_pack_id).single(),
    ])
    if (profile.error) throw profile.error
    if (pack.error) throw pack.error
    expect(profile.data).toMatchObject({ id: result.rule_profile_version_id,
      rule_pack_id: result.canonical_rule_pack_id, profile_key: result.rule_profile_key,
      message_code: 'Z02', is_enabled: true })
    expect(pack.data).toMatchObject({ id: result.canonical_rule_pack_id, source_hash: result.rule_pack_checksum })
    expect(result.rule_profile_version).toBe(`${pack.data.guide_version}:r${pack.data.guide_revision}`)
    expect(result.rule_pack_snapshot).toMatchObject({
      profileKey: result.rule_profile_key, profileVersionId: result.rule_profile_version_id,
      version: result.rule_profile_version, checksum: result.rule_pack_checksum,
      rulePack: { id: result.canonical_rule_pack_id },
      messageProfile: { id: result.rule_profile_version_id },
    })
    expect(result.rule_pack_snapshot.guideSources.length).toBeGreaterThan(0)
  })

  it('refuses mixed physical subtype rather than borrowing another object', async () => {
    const rawPayload = raw([...object('1', '735123456789012345', 'Z22'),
      ...object('2', '735123456789012346', 'Z23')], 'Z02')
    expect(await resolveSupplierDataBirthProfile({ rawPayload, receivedAt })).toBeNull()
  })

  it('refuses Z02 register repetition even when both reasons agree', async () => {
    const rawPayload = raw([
      line('1', '735123456789012345', '1', '9'), ...characteristic('Z13', 'Z22'),
      line('2', '735123456789012345', '2', '9'), ...characteristic('Z13', 'Z22'),
    ], 'Z02')
    expect(await resolveSupplierDataBirthProfile({ rawPayload, receivedAt })).toBeNull()
  })

  it('refuses foreign application reference as physical input', async () => {
    expect(await resolveSupplierDataBirthProfile({
      rawPayload: wire('Z22').replace('23-DDQ-PRODAT', '23-DDQ-OTHER'), receivedAt,
    })).toBeNull()
  })
})
