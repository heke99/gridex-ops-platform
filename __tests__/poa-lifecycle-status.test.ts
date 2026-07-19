import { describe, expect, it } from 'vitest'
import {
  derivePowerOfAttorneyLifecycleStatus,
  hasLegalPoaAcceptance,
} from '@/lib/customers/poaReadiness'

const NOW = new Date('2026-05-15T12:00:00Z')

function poa(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'poa-1',
    status: 'signed',
    signed_at: '2026-04-20T10:00:00Z',
    valid_from: '2026-04-20',
    valid_to: null,
    document_path: 'poa/poa-1.pdf',
    ...overrides,
  }
}

describe('derivePowerOfAttorneyLifecycleStatus', () => {
  it('returns missing when no POA row exists', () => {
    expect(derivePowerOfAttorneyLifecycleStatus(null, { now: NOW })).toBe('missing')
    expect(derivePowerOfAttorneyLifecycleStatus(undefined, { now: NOW })).toBe('missing')
  })

  it('returns valid for a signed POA with evidence inside its validity window', () => {
    expect(derivePowerOfAttorneyLifecycleStatus(poa(), { now: NOW })).toBe('valid')
  })

  it('returns signed for an accepted POA whose validity has not started yet', () => {
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ valid_from: '2026-06-01' }), { now: NOW }),
    ).toBe('signed')
  })

  it('returns awaiting_signature for draft/sent rows', () => {
    expect(derivePowerOfAttorneyLifecycleStatus(poa({ status: 'draft' }), { now: NOW })).toBe(
      'awaiting_signature',
    )
    expect(derivePowerOfAttorneyLifecycleStatus(poa({ status: 'sent' }), { now: NOW })).toBe(
      'awaiting_signature',
    )
  })

  it('fails closed: accepted status without any acceptance evidence is awaiting_signature', () => {
    const unproven = poa({ signed_at: null, document_path: null, accepted_at: null })
    expect(hasLegalPoaAcceptance(unproven)).toBe(false)
    expect(derivePowerOfAttorneyLifecycleStatus(unproven, { now: NOW })).toBe('awaiting_signature')
  })

  it('returns expired when valid_to has passed, regardless of stored status', () => {
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ valid_to: '2026-01-01' }), { now: NOW }),
    ).toBe('expired')
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ status: 'expired' }), { now: NOW }),
    ).toBe('expired')
  })

  it('returns revoked for revoked status or revoked_at evidence', () => {
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ status: 'revoked' }), { now: NOW }),
    ).toBe('revoked')
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ revoked_at: '2026-05-01T00:00:00Z' }), { now: NOW }),
    ).toBe('revoked')
  })

  it('revocation wins over expiry and validity', () => {
    expect(
      derivePowerOfAttorneyLifecycleStatus(
        poa({ status: 'revoked', valid_to: '2026-01-01' }),
        { now: NOW },
      ),
    ).toBe('revoked')
  })

  it('returns replaced for replaced/superseded rows', () => {
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ status: 'replaced' }), { now: NOW }),
    ).toBe('replaced')
    expect(
      derivePowerOfAttorneyLifecycleStatus(poa({ replaced_by_id: 'poa-2' }), { now: NOW }),
    ).toBe('replaced')
  })

  it('treats runtime statuses active/accepted/completed with evidence as valid', () => {
    for (const status of ['active', 'accepted', 'completed']) {
      expect(derivePowerOfAttorneyLifecycleStatus(poa({ status }), { now: NOW })).toBe('valid')
    }
  })
})
