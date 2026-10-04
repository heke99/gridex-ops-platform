// masterplan: TR-09, AT-TR-09
// Owner decision 2026-10-04: S/MIME is required for every message family in
// production; plaintext only through a journaled, bounded exception (fail closed).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }))
vi.mock('@/lib/supabase/service', () => {
  const builder = (table: string) => {
    const rows = () => db.tables[table] ?? []
    const q: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'limit', 'ilike']) q[k] = () => q
    q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve)
    return q
  }
  return { supabaseService: { from: builder, rpc: vi.fn() } }
})

import {
  PLAINTEXT_EXCEPTION_TLS_REFUSAL,
  PRODUCTION_PLAINTEXT_REFUSAL,
  assertPlaintextExceptionKeepsTls,
  assertProductionTransportEncrypted,
} from '@/lib/ediel/transport/exception/productionEncryption'
import { applyMessageFamilyEncryptionPolicy } from '@/lib/ediel/transport/index.part-1'
import { validateEdielSendContext } from '@/lib/ediel/sendContextConsistency'

const FAMILIES = ['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK', 'CONTRL', 'MSCONS', 'QUOTES', 'INVOIC']

describe('TR-09 production S/MIME for all message families', () => {
  it.each(FAMILIES)('on_failure: production %s without a journaled exception refuses plaintext (no general switch)', (family) => {
    void family
    expect(() => assertProductionTransportEncrypted({ environment: 'production', wireEncrypted: false, plaintextException: false }))
      .toThrow(PRODUCTION_PLAINTEXT_REFUSAL)
  })

  it('condition/on_pass: S/MIME passes and only an approved exception admits plaintext in production', () => {
    expect(() => assertProductionTransportEncrypted({ environment: 'production', wireEncrypted: true, plaintextException: false })).not.toThrow()
    expect(() => assertProductionTransportEncrypted({ environment: 'production', wireEncrypted: false, plaintextException: true })).not.toThrow()
    expect(() => assertProductionTransportEncrypted({ environment: 'test', wireEncrypted: false, plaintextException: false })).not.toThrow()
  })

  it('condition: an exception keeps mandatory, verified TLS', () => {
    expect(() => assertPlaintextExceptionKeepsTls({ tls_required: true, transport_security_mode: 'unencrypted' })).not.toThrow()
    for (const route of [null, { tls_required: false, transport_security_mode: 'unencrypted' }, { tls_required: null }, { tls_required: true, transport_security_mode: 'needs_verification' }])
      expect(() => assertPlaintextExceptionKeepsTls(route)).toThrow(PLAINTEXT_EXCEPTION_TLS_REFUSAL)
  })

  it.each(FAMILIES.filter((f) => f !== 'PRODAT'))('prohibited: production %s S/MIME is never downgraded to plaintext by route policy', (family) => {
    expect(applyMessageFamilyEncryptionPolicy({ messageFamily: family, environment: 'production', requestedEncryptionMode: 'smime', routeProfile: null })).toBe('smime')
    // Non-production behaviour is unchanged (bilateral opt-in for non-PRODAT S/MIME).
    expect(applyMessageFamilyEncryptionPolicy({ messageFamily: family, environment: 'test', requestedEncryptionMode: 'smime', routeProfile: null })).toBe('none')
  })

  describe('send preflight', () => {
    beforeEach(() => { db.tables = {} })
    const message = (family: string, environment = 'production') => ({ id: 'm1', company_id: 'c1', communication_route_id: 'r1', environment, message_family: family, direction: 'outbound' }) as unknown as EdielMessageRow

    it.each(FAMILIES)('prohibited: production %s on an unencrypted route (even with legacy allow_unencrypted_production) is blocked', async (family) => {
      db.tables.ediel_route_profiles = [{ id: 'rp', communication_route_id: 'r1', transport_security_mode: 'unencrypted', encryption_mode: 'none', allow_unencrypted_production: true }]
      const result = await validateEdielSendContext({ message: message(family) })
      expect(result.ok).toBe(false)
      expect(result.blockingIssues.map((i) => i.code)).toContain('production_requires_smime')
    })

    it.each(FAMILIES)('on_pass: production %s on an S/MIME route resolves S/MIME', async (family) => {
      db.tables.ediel_route_profiles = [{ id: 'rp', communication_route_id: 'r1', transport_security_mode: 'required_encrypted', encryption_mode: 'smime' }]
      const result = await validateEdielSendContext({ message: message(family) })
      expect(result.resolvedEncryptionMode).toBe('smime')
      expect(result.blockingIssues.map((i) => i.code)).not.toContain('production_requires_smime')
    })

    it('a plaintext smtpMimeMode override cannot bypass production S/MIME', async () => {
      db.tables.ediel_route_profiles = [{ id: 'rp', communication_route_id: 'r1', transport_security_mode: 'required_encrypted', encryption_mode: 'smime' }]
      const result = await validateEdielSendContext({ message: message('UTILTS'), smtpMimeModeOverride: 'ediel-singlepart-base64' })
      expect(result.ok).toBe(false)
      expect(result.blockingIssues.map((i) => i.code)).toContain('production_requires_smime')
    })
  })
})
