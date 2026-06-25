// lib/ediel/intent/applicationReferencePolicy.ts
//
// PART 3 / Batch 3: Application Reference is controlled by policy, not by the
// route profile. Route profiles may declare an expected Application Reference
// that is validated against policy; a mismatch blocks sending. APERAK/CONTRL
// must echo/correlate the original Application Reference.

import {
  resolveApplicationReference,
  type ApplicationReferenceResolverInput,
} from '@/lib/ediel/core/applicationReferenceResolver'
import { evaluateApplicationReferenceGuard } from '@/lib/ediel/rulebook/canonicalRules'
import type { EdielIntentBlockingReason } from '@/lib/ediel/intent/types'

export type ApplicationReferencePolicyInput = ApplicationReferenceResolverInput & {
  applicationReference: string | null | undefined
  // For ACK families, the Application Reference of the original message that this
  // ACK correlates to. APERAK/CONTRL must echo it.
  correlatedApplicationReference?: string | null
}

export type ApplicationReferencePolicyResult = {
  ok: boolean
  expectedApplicationReference: string
  providedApplicationReference: string | null
  ruleKeys: string[]
  blockingReasons: EdielIntentBlockingReason[]
}

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

// The authoritative Application Reference for an outbound message, derived from
// policy only (never from a route profile override).
export function resolvePolicyApplicationReference(input: ApplicationReferenceResolverInput): string {
  return resolveApplicationReference(input)
}

export function validateApplicationReferencePolicy(
  input: ApplicationReferencePolicyInput,
): ApplicationReferencePolicyResult {
  const blockingReasons: EdielIntentBlockingReason[] = []
  const ruleKeys: string[] = []

  const family = upper(input.messageFamily)
  const isAck = family === 'APERAK' || family === 'CONTRL'

  // 1) PRODAT DDQ/DGI + unsupported-market guard. The guard returns the canonical
  // expected value for PRODAT permission/supplier codes regardless of role input.
  const guard = evaluateApplicationReferenceGuard({
    family: input.messageFamily,
    messageCode: input.businessCode ?? input.messageType,
    applicationReference: input.applicationReference,
  })

  // For ACK families the correlated original Application Reference is authoritative.
  const expected = isAck && input.correlatedApplicationReference
    ? String(input.correlatedApplicationReference).trim()
    : guard.expectedApplicationReference ?? resolvePolicyApplicationReference(input)

  const provided = input.applicationReference ? String(input.applicationReference).trim() : null

  if (!guard.ok) {
    ruleKeys.push(...guard.ruleKeys)
    blockingReasons.push({
      code: 'application_reference_policy_violation',
      message: guard.reason ?? 'Application Reference bryter mot policy.',
      field: 'applicationReference',
      severity: 'block',
      details: { ruleKeys: guard.ruleKeys, expected },
    })
  }

  // 2) Route profile may only declare an expected value; it must agree with policy.
  const routeDeclared = input.routeProfile?.applicationReference?.trim() || null
  if (routeDeclared && upper(routeDeclared) !== upper(expected)) {
    ruleKeys.push('ROUTE_APPLICATION_REFERENCE_OVERRIDE_BLOCKED')
    blockingReasons.push({
      code: 'route_application_reference_mismatch',
      message: `Route profile declarerar Application Reference ${routeDeclared} men policy kräver ${expected}. Route får inte åsidosätta policy.`,
      field: 'applicationReference',
      severity: 'block',
      details: { policyApplicationReference: expected, routeDeclaredApplicationReference: routeDeclared },
    })
  }

  // 3) The provided value must equal the policy/correlated expected value.
  if (provided && upper(provided) !== upper(expected)) {
    ruleKeys.push('APPLICATION_REFERENCE_MISMATCH')
    blockingReasons.push({
      code: 'application_reference_mismatch',
      message: isAck
        ? `Kvittensens Application Reference ${provided} korrelerar inte med originalets ${expected}.`
        : `Application Reference ${provided} matchar inte policyvärdet ${expected}.`,
      field: 'applicationReference',
      severity: 'block',
      details: { expected, provided },
    })
  }

  return {
    ok: blockingReasons.length === 0,
    expectedApplicationReference: expected,
    providedApplicationReference: provided,
    ruleKeys,
    blockingReasons,
  }
}
