import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getUtiltsApplicationReferenceTarget,
  resolveVerifiedUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsApplicationReference'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('canonical Ediel runtime closure', () => {
  it('resolves UTILTS request targets only from exact canonical evidence', () => {
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'E72',
      applicationReference: '23-MDR-E30-S',
    })).toBe('E30')
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'E73',
      applicationReference: '23-DDQ-E66-S',
    })).toBe('E66')
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'E73',
      applicationReference: '23-DDQ-S02-S',
    })).toBe('S02')
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'E74',
      applicationReference: '23-DDX-E31-T',
    })).toBe('E31')
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'E74',
      applicationReference: '23-DDK-S03-S',
    })).toBe('S03')
    expect(getUtiltsApplicationReferenceTarget({
      messageCode: 'S06',
      applicationReference: '23-DDK-S04-S',
    })).toBe('S04')
    expect(() => getUtiltsApplicationReferenceTarget({
      messageCode: 'E73',
      applicationReference: '23-DDK-S04-S',
    })).toThrow(/target_invalid/)

    expect(resolveVerifiedUtiltsApplicationReference({
      messageCode: 'E73',
      applicationReference: '23-DDQ-S02-S',
    })).toBe('23-DDQ-S02-S')
  })

  it('forces the public UTILTS inbound path through the canonical side-effect dispatcher', () => {
    const facade = read('lib/ediel/flows/utiltsDataRequest.ts')
    const dispatcher = read('lib/ediel/flows/utiltsInboundPolicyProcessor.ts')
    expect(facade).toContain('processInboundUtiltsMessageByCanonicalPolicy')
    expect(facade).not.toContain("export { processInboundUtiltsMessage } from './utiltsDataRequest.part-2'")
    expect(dispatcher).toContain("outcome.kind === 'actual_metering_values'")
    expect(dispatcher).toContain('billingConsumptionAllowed: false')
    expect(dispatcher).toContain('meteringValueIngestAllowed: false')
    expect(dispatcher).toContain('utilts_individual_customer_link_forbidden')
    expect(dispatcher).not.toContain('ingestBillingUnderlay')
    expect(dispatcher).not.toContain('normalizeAndStoreMeteringValue')
  })

  it('keeps S02/E31 and every known UTILTS outcome out of ignored business state', () => {
    const state = read('lib/ediel/flows/inboundBusinessStateMachine.ts')
    expect(state).toContain("'metering_forecast_received'")
    expect(state).toContain("'grid_area_values_received'")
    expect(state).toContain("'metering_values_request_received'")
    expect(state).not.toContain("| 'ignored'")
    expect(state).toContain('billingConsumptionAllowed: false')
  })

  it('makes PRODAT lifecycle and outbound kernel policy consumers, not rule owners', () => {
    const lifecycle = read('lib/ediel/stateMachines/prodatLifecycle.ts')
    const kernel = read('lib/ediel/core/kernel.ts')
    const validator = read('lib/ediel/rulebook/validator.ts')

    expect(lifecycle).toContain('decideProdatLifecycleFromPolicy')
    expect(lifecycle).toContain('policy.semantics.businessEffect')
    expect(lifecycle).not.toContain("if (code === 'Z04' &&")
    expect(lifecycle).not.toContain("if (code === 'Z05' &&")

    expect(kernel).toContain('assertOutboundDraftAllowedByCanonicalPolicy')
    expect(kernel).toContain('parsedPayload: params.draft.parsedPayload')
    expect(kernel).not.toContain('assertOutboundDraftAllowedByFieldRules')

    expect(validator).toContain('resolveCanonicalEdielPolicy')
    expect(validator).toContain('validateCanonicalPolicyFields')
    expect(validator).toContain('resolveCanonicalRulePack')
    expect(validator).not.toContain('getCanonicalProdatProfile')
    expect(validator).not.toContain('loadRegistryFieldRules')
  })

  it('makes automatic ACK policy consume canonical policy rather than DB rule semantics', () => {
    const ackPolicy = read('lib/ediel/core/ackPolicy.ts')
    expect(ackPolicy).toContain('resolveCanonicalAckRuleForSource')
    expect(ackPolicy).toContain('policy.ackRule')
    expect(ackPolicy).not.toContain('loadCanonicalAckRulePack')
    expect(ackPolicy).not.toContain('getActiveEdielMessageRule')
  })
})
