import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { publicReference } from '@/lib/integrations/publicReferences'
import { poaMailEvidence } from '@/lib/email/poaMailEvidence'
import type { PoaDocumentScope } from './poaDocuments'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

// Complete missing audit fields only for the same signer and original consent
// timestamp. Never rebind an accepted text, scope, signer or BankID attestation.
export async function completePoaCaptureEvidence(scope: PoaDocumentScope, input: {
  signerName: string | null; signerIdentity: string | null; method: string | null; acceptedAt: string | null; signerIp: string | null
}): Promise<void> {
  const { data, error } = await tenantSelect(scope.companyId, 'powers_of_attorney')
    .eq('customer_id', scope.customerId).eq('id', scope.powerOfAttorneyId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Fullmakten hittades inte vid komplettering.')
  const poa = data as Row, evidence = record(poa.evidence_payload), proof = poaMailEvidence(poa)
  if (proof.verificationReference && (proof.bankidVerified || proof.signerIpAddress)) return
  if (clean(poa.signer_name) !== input.signerName || clean(poa.signer_identity_number) !== input.signerIdentity || clean(poa.method) !== input.method) {
    throw new Error('Fullmaktens godkännande kan inte kompletteras med en annan undertecknare eller signeringsmetod.')
  }
  const acceptedAt = clean(poa.accepted_at) ?? clean(evidence.accepted_at) ?? clean(poa.signed_at)
  const sameConsent = acceptedAt && input.acceptedAt && Number.isFinite(Date.parse(acceptedAt)) && Date.parse(acceptedAt) === Date.parse(input.acceptedAt)
  const signerIp = !proof.signerIpAddress && input.signerIp && isIP(input.signerIp) && sameConsent ? input.signerIp : proof.signerIpAddress
  const patch: Row = { evidence_payload: {
    ...evidence, verification_reference: proof.verificationReference ?? publicReference('poa_verification', scope.companyId, scope.powerOfAttorneyId),
    ...(signerIp ? { ip_address: signerIp, ip_address_source: 'signer_reported' } : {}),
  }, updated_at: new Date().toISOString() }
  if (signerIp && !proof.signerIpAddress) {
    patch.accepted_ip = signerIp
    patch.accepted_ip_hash = createHash('sha256').update(signerIp).digest('hex')
  }
  let update = tenantUpdate(scope.companyId, 'powers_of_attorney', patch)
    .eq('customer_id', scope.customerId).eq('id', scope.powerOfAttorneyId)
  update = clean(poa.updated_at) ? update.eq('updated_at', String(poa.updated_at)) : update.is('updated_at', null)
  const saved = await update.select('id').maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) throw new Error('Fullmakten ändrades samtidigt. Läs om underlaget och försök igen.')
}

// Also give manually uploaded/legacy originals a system verifier. This is a
// document identifier, never a claim that OPS verified the uploaded signature.
export async function ensurePoaVerificationReference(scope: PoaDocumentScope): Promise<Row> {
  const read = async () => {
    const { data, error } = await tenantSelect(scope.companyId, 'powers_of_attorney')
      .eq('customer_id', scope.customerId).eq('id', scope.powerOfAttorneyId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Fullmakten hittades inte.')
    return data as Row
  }
  const poa = await read()
  if (poaMailEvidence(poa).verificationReference) return poa
  await completePoaCaptureEvidence(scope, { signerName: clean(poa.signer_name), signerIdentity: clean(poa.signer_identity_number),
    method: clean(poa.method), acceptedAt: clean(poa.accepted_at) ?? clean(poa.signed_at), signerIp: null })
  return read()
}
