import { expect, it } from 'vitest'
import { bindDeathStatusSourceContext, deathStatusSendIssue, isQualifiedDeathStatusContext } from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import { deathBody, deathRaw, deathSelection } from './fixtures/prodat-death-status'
import { characteristic } from './fixtures/prodat-register'

function example() {
  const rawPayload = deathRaw('Z09', deathBody('E34', characteristic('Z17', 'Z41')))
  const context = bindDeathStatusSourceContext({ kind: 'customer_life_event', direction: 'outbound', code: 'Z09', companyId: 'company-A', environment: 'test', rawPayload, sourceEventId: 'event-A', sourceRevision: '2', sourceDigest: 'a'.repeat(64), businessContext: 'death', bilateralCapabilityVerified: false, intentId: 'intent-A', routeId: 'route-A', selection: deathSelection('death', 'Z09') })
  const row = { direction: 'outbound', company_id: 'company-A', environment: 'test', message_family: 'PRODAT', message_code: 'Z09', raw_payload: rawPayload, intent_id: 'intent-A', communication_route_id: 'route-A' }
  return { context, row }
}

it('uses the fresh independent source and holds restored metadata/caller clones', () => {
  const { context, row } = example()
  expect(deathStatusSendIssue(row, context)).toBeNull()
  expect(isQualifiedDeathStatusContext(JSON.parse(JSON.stringify(context)))).toBe(false)
  expect(deathStatusSendIssue(row, { ...context })?.code).toBe('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(deathStatusSendIssue({ ...row, parsed_payload: { deathStatus: context.selection, customer_event: 'death' } })?.code).toBe('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})

it.each(['company_id', 'environment', 'intent_id', 'communication_route_id', 'direction', 'message_code', 'raw_payload'] as const)('holds a changed or omitted own %s', field => {
  const { context, row } = example()
  expect(deathStatusSendIssue({ ...row, [field]: null }, context)?.code).toBe('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(deathStatusSendIssue({ ...row, [field]: 'different' }, context)?.code).toBe('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})

it('cannot classify bankruptcy as death without its own bilateral ground', () => {
  const { context } = example()
  expect(() => bindDeathStatusSourceContext({ ...context, businessContext: 'bankruptcy', bilateralCapabilityVerified: false })).toThrow('customer_life_event_source_context_invalid')
})
