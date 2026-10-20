import { describe, expect, it } from 'vitest'
import { poaMailEvidence, poaMailEvidenceIssues } from '@/lib/email/poaMailEvidence'

const poa = (evidence: Record<string, unknown> = {}) => ({
  id: 'synthetic-poa', source: 'website_api', method: 'website_acceptance',
  evidence_payload: { source: 'website_api', ...evidence },
})

describe('API fullmakt evidence', () => {
  it('allows recorded electronic consent with a verification number and signer IP without BankID', () => {
    const record = poa({ verification_reference: 'synthetic-verification', ip_address: '192.0.2.10', ip_address_source: 'signer_reported' })
    expect(poaMailEvidenceIssues(record)).toEqual([])
    expect(poaMailEvidence(record).bankidVerified).toBe(false)
  })

  it('never counts the tenant server IP as a signer verification', () => {
    expect(poaMailEvidenceIssues(poa({ verification_reference: 'synthetic-verification', api_request_ip_address: '192.0.2.99' })))
      .toEqual([expect.objectContaining({ code: 'poa_signer_ip_missing' })])
  })

  it('rejects a non-IP string even when it was submitted in the signer IP field', () => {
    expect(poaMailEvidenceIssues(poa({ verification_reference: 'synthetic-verification', ip_address: 'tenant-server', ip_address_source: 'signer_reported' })))
      .toEqual([expect.objectContaining({ code: 'poa_signer_ip_missing' })])
  })

  it('does not accept a claimed BankID method or client metadata as verified BankID', () => {
    const record = { ...poa(), method: 'bankid', metadata: { verified_signature: { provider: 'bankid', status: 'completed', reference: 'fake' } } }
    expect(poaMailEvidence(record).bankidVerified).toBe(false)
    expect(poaMailEvidenceIssues(record).length).toBeGreaterThan(0)
  })

  it('accepts future BankID evidence only from a completed server-verified signing callback', () => {
    const record = poa({ verified_signature: { provider: 'bankid', status: 'completed', reference: 'synthetic-bankid-ref', verification_source: 'server_callback' } })
    expect(poaMailEvidenceIssues(record)).toEqual([])
    expect(poaMailEvidence(record).bankidVerified).toBe(true)
  })
})
