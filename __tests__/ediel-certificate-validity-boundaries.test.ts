// masterplan: TR-06, AT-TR-06, SC-060
import { describe, expect, it } from 'vitest'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
const now = new Date('2026-09-30T12:00:00.000Z')
const valid = { status: 'active', valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-10-10T12:00:00Z' }

describe('exact S/MIME certificate validity', () => {
  it.each(['2026-09-30T11:59:59.999Z', '2026-09-30T12:00:00.000Z', '2026-09-30T11:00:00Z'])('blocks expiry at %s without using rounded days as authority', valid_to => {
    expect(evaluateCertificateStatus({ ...valid, valid_to }, now).isUsableForSmime).toBe(false)
  })
  it('allows a certificate until the exact expiry boundary', () => {
    expect(evaluateCertificateStatus({ ...valid, valid_to: '2026-09-30T12:00:00.001Z' }, now).isUsableForSmime).toBe(true)
  })
  it('blocks a not-yet-valid replacement while an older overlapping certificate remains usable', () => {
    expect(evaluateCertificateStatus({ ...valid, valid_from: '2026-09-30T12:00:00.001Z' }, now).isUsableForSmime).toBe(false)
    expect(evaluateCertificateStatus({ ...valid, valid_from: now.toISOString() }, now).isUsableForSmime).toBe(true)
    expect(evaluateCertificateStatus(valid, now).isUsableForSmime).toBe(true)
  })
  it.each(['revoked', 'inactive', 'archived', 'deleted', 'invalid', 'expired', 'not_yet_valid', 'suspended'])('blocks lifecycle status %s despite otherwise valid dates', status => {
    expect(evaluateCertificateStatus({ ...valid, status }, now).isUsableForSmime).toBe(false)
  })
  it('does not treat malformed supplied notBefore as absent', () => {
    expect(evaluateCertificateStatus({ ...valid, valid_from: 'invalid' }, now).isUsableForSmime).toBe(false)
  })
  it('keeps historical private-key decryption discovery separate from live public-certificate validity', () => {
    expect(evaluateCertificateStatus({ usage: 'inbound_private', status: 'active', p12_secret_reference: 'env:INBOUND_CERT' }, now).status).toBe('runtime_validation_required')
  })
})
