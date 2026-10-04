import { describe, expect, it } from 'vitest'
import { evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'

describe('production lock never inherits a test action metadata exemption', () => {
  it('holds live test flags, portal parties and test application addressing even with the legacy marker', () => {
    const result = evaluateEdielProductionSendLock({ id: 'synthetic', company_id: 'synthetic-company', environment: 'production', direction: 'outbound', message_family: 'PRODAT', message_version: 'E2SE6A',
      test_flag: 1, sender_ediel_id: '12345', receiver_ediel_id: '91100', receiver_email: 'synthetic@example.invalid', application_reference: 'TGT', raw_payload: 'synthetic', communication_route_id: 'synthetic-route',
      validation_report: { systemTestAckSend: { enabled: true, source: 'system_test_ack_action' } } })
    expect(result.status).toBe('blocked')
    expect(result.issues.filter(issue => issue.severity === 'blocked').map(issue => issue.code)).toEqual(['production_test_flag', 'ediel_portal_party_in_production', 'tgt_application_reference_in_production'])
  })
  it('keeps an ordinary test-environment message outside production activation', () => {
    expect(evaluateEdielProductionSendLock({ environment: 'test', test_flag: 1, receiver_ediel_id: '91100' }).status).toBe('ready')
  })
})
