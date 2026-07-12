import { supabaseService } from '@/lib/supabase/service'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { loadRegistryFieldRules } from '@/lib/ediel/rulebook/fieldRuleRegistry'

export type RulePackVerificationCase = {
  profileKey: string
  family: string
  code: string
  activeVersion: string
  checksum: string
  status: 'passed' | 'failed'
  failures: string[]
}

export async function generateRulePackVerificationCases(input: {
  companyId?: string | null
  environment: 'test' | 'production'
}): Promise<RulePackVerificationCase[]> {
  const { data, error } = await supabaseService
    .from('ediel_rule_profiles')
    .select('profile_key,message_family,message_code,active_version,is_active')
    .eq('is_active', true)
    .in('message_family', ['PRODAT', 'UTILTS', 'UTILTS_ERR', 'CONTRL', 'APERAK'])
    .order('message_family')
    .order('message_code')
  if (error) throw error

  const cases: RulePackVerificationCase[] = []
  for (const profile of data ?? []) {
    const family = String(profile.message_family ?? '').trim().toUpperCase()
    const code = String(profile.message_code ?? '').trim().toUpperCase()
    const failures: string[] = []
    try {
      const resolved = await loadRegistryFieldRules({
        family,
        code,
        companyId: input.companyId ?? null,
        environment: input.environment,
        direction: 'outbound',
      })
      if (!resolved.rulePack) failures.push('rule_pack_snapshot_missing')
      if (!resolved.rulePack?.checksum) failures.push('rule_pack_checksum_missing')
      if (family !== 'CONTRL') {
        const sample = EdifactEnvelopeCodec.encode({
          sender: 'VERIFY-SENDER',
          receiver: 'VERIFY-RECEIVER',
          interchangeReference: `VERIFY-${profile.profile_key}`,
          applicationReference: family === 'PRODAT' ? 'DDQ' : 'DGI',
          environment: 'test',
          messages: [{
            messageReference: '1',
            messageTypeToken: family === 'PRODAT' ? 'PRODAT:D:97A:UN:E2SE6A' : 'UTILTS:D:96A:UN:E5SE5A',
            businessSegments: [`BGM+${code}+VERIFY+9`],
          }],
        })
        const decoded = EdifactEnvelopeCodec.decode(sample)
        if (decoded.applicationReference !== (family === 'PRODAT' ? 'DDQ' : 'DGI')) failures.push('application_reference_roundtrip_failed')
        if (decoded.environment !== 'test') failures.push('test_indicator_roundtrip_failed')
      }
      cases.push({
        profileKey: String(profile.profile_key), family, code,
        activeVersion: resolved.rulePack?.version ?? String(profile.active_version ?? ''),
        checksum: resolved.rulePack?.checksum ?? '',
        status: failures.length ? 'failed' : 'passed', failures,
      })
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
      cases.push({
        profileKey: String(profile.profile_key), family, code,
        activeVersion: String(profile.active_version ?? ''), checksum: '', status: 'failed', failures,
      })
    }
  }
  return cases
}
