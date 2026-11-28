import { createHash } from 'node:crypto'
import { looksLikeSmimeMessage, unpackInboundSmimeIfNeeded } from '@/lib/ediel/transport/smime'
import type { EdielEnvironment } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'
import { parseInboundEmailContent, type ParsedEdifactEnvelope } from './edielEmailParser'
import type { InboundLeaseReceipt } from './edielMailboxPoller.part-1'

type RetainedSmimeRecoveryReceipt = {
  status: 'needs_recovery' | 'recovered'
  sourceMailId?: string
  companyId?: string
  environment?: EdielEnvironment
  cipherHash?: string
  clearHash?: string
  cleartext?: string
  actorUserId?: string
}

type RetainedSmimeScope = {
  p_company_id: string
  p_environment: EdielEnvironment
  p_mail_id: string
  p_failed_payload_id: string
  p_cipher_sha256: string
  p_actor_user_id: string | null
  p_job_id: string | null
  p_claim_owner: string | null
  p_claimed_at: string | null
}

export type RetainedSmimeAck = {
  parsed: ParsedEdifactEnvelope
  scope: RetainedSmimeScope
  clearHash: string
  actorUserId: string
}

// Normal adapters use the generated definitions once the migration is installed
// and its function arguments have been incorporated into the database contract.
const recoveryDb = supabaseService as unknown as {
  rpc(name: 'gridex_resolve_retained_smime_ack_v1', args: RetainedSmimeScope & {
    p_certificate_id: string | null
    p_cleartext: string | null
    p_clear_sha256: string | null
  }): Promise<{ data: RetainedSmimeRecoveryReceipt | null; error: { message: string } | null }>
  rpc(name: 'gridex_commit_retained_smime_ack_v1', args: RetainedSmimeScope & {
    p_clear_sha256: string
    p_current_ack_id: string | null
    p_projection: Record<string, unknown>
  }): Promise<{ data: string | null; error: { message: string; code?: string } | null }>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseOriginalAck(cleartext: string): ParsedEdifactEnvelope | null {
  const parsed = parseInboundEmailContent({ bodyText: cleartext })
  if (parsed?.messageFamily !== 'CONTRL' && parsed?.messageFamily !== 'APERAK') return null
  return parsed.rawPayload === cleartext ? parsed : null
}

export async function recoverRetainedSmimeAck(input: {
  row: Record<string, unknown>
  actorUserId?: string | null
  lease?: InboundLeaseReceipt
  hasProtectedProjection: boolean
}): Promise<RetainedSmimeAck | null> {
  const { row, lease } = input
  if (typeof row.raw_email !== 'string' || !looksLikeSmimeMessage(row.raw_email)) return null
  if (!input.hasProtectedProjection && (row.processing_status !== 'manual_review' || row.match_status !== 'missing_payload')) return null
  if (typeof row.id !== 'string' || typeof row.company_id !== 'string' ||
      (row.environment !== 'test' && row.environment !== 'production') ||
      row.received_at_source !== 'imap_internal_date' || typeof row.raw_mailbox_bytes_sha256 !== 'string') return null
  if (!input.actorUserId && !lease) return null

  const source = row.raw_email
  const cipherHash = sha256(source)
  if (cipherHash !== row.raw_mailbox_bytes_sha256 || cipherHash !== row.raw_message_sha256) return null

  const { data: failures, error } = await supabaseService.from('ediel_message_payloads')
    .select('id,encrypted_payload_ref')
    .eq('company_id', row.company_id).eq('inbound_email_message_id', row.id)
    .eq('security_status', 'decrypt_failed').eq('payload_kind', 'inbound_smime').limit(2)
  if (error) throw error
  if (!failures?.length && !input.hasProtectedProjection) return null
  if (failures?.length !== 1) throw new Error('retained_smime_failed_intake_receipt_required')
  const failure = failures[0]

  const scope: RetainedSmimeScope = {
    p_company_id: row.company_id,
    p_environment: row.environment,
    p_mail_id: row.id,
    p_failed_payload_id: failure.id,
    p_cipher_sha256: cipherHash,
    p_actor_user_id: lease ? null : input.actorUserId ?? null,
    p_job_id: lease?.id ?? null,
    p_claim_owner: lease?.locked_by ?? null,
    p_claimed_at: lease?.locked_at ?? null,
  }
  const project = async (certificateId: string | null, cleartext: string | null) => {
    const { data, error } = await recoveryDb.rpc('gridex_resolve_retained_smime_ack_v1', {
      ...scope,
      p_certificate_id: certificateId,
      p_cleartext: cleartext,
      p_clear_sha256: cleartext ? sha256(cleartext) : null,
    })
    if (error || !data) throw new Error('retained_smime_projection_required', { cause: error })
    return data
  }

  let receipt = await project(null, null)
  if (receipt.status === 'needs_recovery') {
    const smime = await unpackInboundSmimeIfNeeded({ rawEmail: source, environment: row.environment, companyId: row.company_id })
    if (smime.securityStatus !== 'decrypted' || !smime.decryptedText || smime.matchedCompanyId !== row.company_id ||
        !smime.matchedCertificateId || smime.encryptedPayloadRef !== failure.encrypted_payload_ref ||
        !parseOriginalAck(smime.decryptedText)) return null
    receipt = await project(smime.matchedCertificateId, smime.decryptedText)
  }
  if (receipt.status !== 'recovered' || receipt.sourceMailId !== row.id || receipt.companyId !== row.company_id ||
      receipt.environment !== row.environment || receipt.cipherHash !== cipherHash || typeof receipt.actorUserId !== 'string' ||
      typeof receipt.cleartext !== 'string' || typeof receipt.clearHash !== 'string' || sha256(receipt.cleartext) !== receipt.clearHash) {
    throw new Error('retained_smime_projection_receipt_invalid')
  }
  const parsed = parseOriginalAck(receipt.cleartext)
  if (!parsed) throw new Error('retained_smime_original_ack_required')
  return { parsed, scope, clearHash: receipt.clearHash, actorUserId: receipt.actorUserId }
}

export async function commitRetainedSmimeAck(
  recovery: RetainedSmimeAck,
  currentAckId: string | null,
  projection: Record<string, unknown>,
) {
  const { data, error } = await recoveryDb.rpc('gridex_commit_retained_smime_ack_v1', {
    ...recovery.scope,
    p_clear_sha256: recovery.clearHash,
    p_current_ack_id: currentAckId,
    p_projection: projection,
  })
  return { data: data ? { id: data } : null, error }
}
