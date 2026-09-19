import { ud, udAddressFact } from './fixtures/prodat-ud'
import { describe, expect, it } from 'vitest'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { characteristic, input, line, qty, raw } from './fixtures/prodat-register'

type Context = 'normal' | 'missing snapshot' | 'stale snapshot'
type Chain = 'valid' | 'global 7,9' | 'register 1,1'
const structureCode = 'PRODAT_REGISTER_STRUCTURE_INVALID'

function message(context: Context, chain: Chain): EdielMessageRow {
  // Original P26.A pp47,114–116: global LIN and own register indices both
  // progress 1,2. Complete own values/facts isolate topology from D conditions.
  const payload = raw([
    line(chain === 'global 7,9' ? '7' : '1', 'A', '1'), qty('10'),
    ...characteristic('Z13', 'Z22'), ...characteristic('Z02', '1', 3),
    ...characteristic('Z05', '6', 3), ...characteristic('Z16', '111', 3),
    ud(),
    line(chain === 'global 7,9' ? '9' : '2', 'A', chain === 'register 1,1' ? '1' : '2'), qty('20'),
    ...characteristic('Z13', 'Z22'), ...characteristic('Z02', '2', 3),
    ...characteristic('Z05', '6', 3), ...characteristic('Z16', '112', 3),
  ])
  return {
    message_family: 'PRODAT', message_code: 'Z04', message_version: '26A',
    direction: 'outbound', environment: context === 'normal' ? 'test' : 'production',
    message_standard: 'edifact', application_reference: '23-DDQ-PRODAT', company_id: 'tenant',
    raw_payload: payload, mime_type: 'application/EDIFACT', parsed_payload: {
      rulebookAllowInvalidSend: true,
      prodatEngine: {
        registerEvidence: createProdatRegisterEvidence({ ...input(payload), code: 'Z04', facts: {
          market: 'electricity', endUserAddressObjects:[udAddressFact('A','tenant')], registerObjects: [{ meteringPointId: 'A', identityAgency: '89',
            expectedRegisterCount: 2, meterReadingsSentInUtilts: true }],
        } }),
        ...(context === 'stale snapshot'
          ? { dependentConditionStatuses: [{ id: 'Z04:obsolete', fieldNumber: 'obsolete', status: 'required' }] }
          : {}),
      },
    },
  } as unknown as EdielMessageRow
}

describe.each<Context>(['normal', 'missing snapshot', 'stale snapshot'])('register topology: %s', context => {
  for (const chain of ['global 7,9', 'register 1,1'] as const) {
    it(`${chain}: validation retains a protected structural error`, () => {
      const issues = validateEdielMessageRowWithRulebook(message(context, chain), 'send').issues
      expect(issues).toContainEqual(expect.objectContaining({
        code: structureCode, scope: 'prodat_register', severity: 'error', blocking: true,
      }))
    })
    it(`${chain}: rulebook guard rejects before the invalid override`, () => {
      expect(() => assertRulebookAllowsSend(message(context, chain))).toThrow(structureCode)
    })
    it(`${chain}: preflight independently rejects structure`, () => {
      expect(preflightEdielMessageRow(message(context, chain), 'send').issues)
        .toContainEqual(expect.objectContaining({ code: structureCode, severity: 'error' }))
    })
    it(`${chain}: transport guard independently rejects structure`, () => {
      expect(() => assertEdielSendLock(message(context, chain))).toThrow(structureCode)
    })
  }
  it('valid 1,2 chain has no register issues; production still requires its canonical snapshot', () => {
    const issues = validateEdielMessageRowWithRulebook(message(context, 'valid'), 'send').issues
    expect(issues.filter(issue => issue.scope === 'prodat_register' || issue.code.startsWith('PRODAT_REGISTER_'))).toEqual([])
    expect(issues.some(issue => issue.code === 'CANONICAL_POLICY_VALIDATION_FAILED'
      && issue.description === 'prodat_canonical_policy_snapshot_missing:Z04')).toBe(context !== 'normal')
  })
  it('valid chain passes the register rulebook boundary with the existing test override', () => {
    expect(() => assertRulebookAllowsSend(message(context, 'valid'))).not.toThrow()
  })
  it('valid chain has no preflight register blocker', () => {
    expect(preflightEdielMessageRow(message(context, 'valid'), 'send').issues
      .filter(issue => issue.code.startsWith('PRODAT_REGISTER_'))).toEqual([])
  })
  it('valid chain has no transport register blocker; other production locks remain', () => {
    if (context === 'normal') expect(() => assertEdielSendLock(message(context, 'valid'))).not.toThrow()
    else {
      let failure: unknown
      try { assertEdielSendLock(message(context, 'valid')) } catch (error) { failure = error }
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).not.toContain('PRODAT_REGISTER_')
    }
  })
})
