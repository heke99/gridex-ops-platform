import { supabaseService } from '@/lib/supabase/service'
import type { CanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'

export type AckRulePackSnapshot = {
  ruleId: string
  version: string
  checksum: string
}

export type ResolvedAckRulePack = {
  rule: CanonicalAckMatrixRule
  snapshot: AckRulePackSnapshot
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function upper(value: unknown): string {
  return text(value).toUpperCase().replace('-', '_')
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

export async function loadCanonicalAckRulePack(input: {
  family: string | null | undefined
  code?: string | null
  companyId?: string | null
  environment?: string | null
  version?: string | null
}): Promise<ResolvedAckRulePack> {
  const family = upper(input.family)
  const code = upper(input.code) || '*'
  const { data, error } = await supabaseService.rpc('resolve_ediel_ack_matrix_rule', {
    p_message_family: family,
    p_message_code: code,
    p_company_id: text(input.companyId) || null,
    p_environment: text(input.environment) || null,
    p_requested_version: text(input.version) || null,
  })
  if (error) throw new Error(`ediel_ack_rule_pack_resolution_failed:${String(error.message ?? error)}`)
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error(`ediel_ack_rule_pack_missing:${family}:${code}`)

  const ruleId = text(row.rule_id)
  const version = text(row.rule_version)
  const checksum = text(row.rule_checksum)
  if (!ruleId || !version || !checksum) {
    throw new Error(`ediel_ack_rule_pack_snapshot_incomplete:${family}:${code}`)
  }

  const technicalAck = text(row.technical_ack)
  const applicationAck = text(row.application_ack)
  const negativeApplicationResponse = text(row.negative_application_response)
  if (!['CONTRL', 'none'].includes(technicalAck)) throw new Error(`ediel_ack_rule_pack_invalid_technical_ack:${technicalAck}`)
  if (!['APERAK', 'transactional', 'none'].includes(applicationAck)) throw new Error(`ediel_ack_rule_pack_invalid_application_ack:${applicationAck}`)
  if (!['APERAK', 'UTILTS_ERR', 'APERAK_OR_UTILTS_ERR', 'none'].includes(negativeApplicationResponse)) {
    throw new Error(`ediel_ack_rule_pack_invalid_negative_response:${negativeApplicationResponse}`)
  }

  return {
    rule: {
      family: upper(row.message_family) || family,
      code: upper(row.message_code) || '*',
      technicalAck: technicalAck as CanonicalAckMatrixRule['technicalAck'],
      applicationAck: applicationAck as CanonicalAckMatrixRule['applicationAck'],
      businessResponses: stringArray(row.business_responses),
      negativeApplicationResponse: negativeApplicationResponse as CanonicalAckMatrixRule['negativeApplicationResponse'],
      acknowledgeIncomingMessageWith: stringArray(row.acknowledge_with) as CanonicalAckMatrixRule['acknowledgeIncomingMessageWith'],
    },
    snapshot: { ruleId, version, checksum },
  }
}
