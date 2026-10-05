// masterplan: TR-06, AT-TR-06
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { outboundRecipientCertificateScopeBlocker, recipientCertificatePemValidityBlocker, recipientCertificateTrustBlocker } from '@/lib/ediel/security/outboundRecipientCertificate'
const receiver = { companyId: '10000000-0000-4000-8000-000000000001', receiverEdielId: '27700', receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z03', certificateEnvironment: 'production' }
const certificate = { company_id: receiver.companyId, scope: 'tenant_owned', usage: 'outbound_recipient', purpose: 'encryption', owner_ediel_id: '27700', owner_subaddress: 'PRODAT', message_family: 'PRODAT', message_type: 'PRODAT', environment: 'production' }

describe('recipient certificate same scope for explicit IDs and candidate search', () => {
  it('accepts correctly scoped family material and explicit code scope', () => {
    expect(outboundRecipientCertificateScopeBlocker(certificate, receiver)).toBeNull()
    expect(outboundRecipientCertificateScopeBlocker({ ...certificate, message_type: 'Z03' }, receiver)).toBeNull()
  })
  it.each([
    [{ message_family: 'UTILTS' }, 'receiver_certificate_message_family_mismatch'],
    [{ message_type: 'Z01' }, 'receiver_certificate_message_code_mismatch'],
    [{ business_code: 'Z01' }, 'receiver_certificate_message_code_mismatch'],
    [{ owner_ediel_id: 'OTHER' }, 'receiver_certificate_owner_mismatch'],
    [{ owner_subaddress: 'OTHER' }, 'receiver_certificate_subaddress_mismatch'],
    [{ usage: 'inbound_private' }, 'receiver_certificate_usage_mismatch'],
    [{ purpose: 'signing' }, 'receiver_certificate_purpose_mismatch'],
    [{ environment: 'test' }, 'receiver_certificate_environment_mismatch'],
    [{ environment: null }, 'receiver_certificate_environment_mismatch'],
  ])('holds a contradictory or missing route scope %o', (change, code) => {
    expect(outboundRecipientCertificateScopeBlocker({ ...certificate, ...change }, receiver)).toBe(code)
  })
  it('keeps missing trusted chain and fresh authenticated revocation authority held', () => {
    expect(recipientCertificateTrustBlocker()).toBe('receiver_certificate_trust_and_revocation_evidence_missing')
  })
  it('does not accept a PEM marker as an authentic parsed X509 certificate', () => {
    expect(recipientCertificatePemValidityBlocker('-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----')).toBe('receiver_certificate_x509_invalid')
  })
})
