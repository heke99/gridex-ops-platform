// lib/ediel/intent/applicationReferencePolicy.ts
//
// Application Reference is controlled by canonical policy, not by the route
// profile. Route profiles may declare an exact expected value that is validated
// against policy; a mismatch blocks sending. APERAK/CONTRL echo/correlate the
// original Application Reference.

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

// Compatibility helper for process-only PRODAT callers. It is intentionally
// PRODAT-only; non-PRODAT Application References require message-profile context
// and must never be fabricated from a family name.
export function resolveApplicationReferenceForProcess(
  businessProcess: string | null | undefined,
  family: string = 'PRODAT',
): string {
  const fam = upper(family) || 'PRODAT'
  if (fam !== 'PRODAT') {
    throw new Error(`application_reference_process_only_unsupported_family:${fam}`)
  }

  const process = String(businessProcess ?? '').trim().toLowerCase()
  const dgiProcesses = new Set([
    'metering_access',
    'metering_permission',
  ])
  const ddqProcesses = new Set([
    'facility_lookup',
    'customer_masterdata',
    'supplier_switch',
  ])

  if (dgiProcesses.has(process)) return '23-DGI-PRODAT'
  if (ddqProcesses.has(process)) return '23-DDQ-PRODAT'
  throw new Error(`prodat_application_reference_process_unsupported:${process || 'missing'}`)
}

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

  if (isAck && !input.correlatedApplicationReference) {
    return {
      ok: false,
      expectedApplicationReference: '',
      providedApplicationReference: input.applicationReference ? String(input.applicationReference).trim() : null,
      ruleKeys: ['ACK_APPLICATION_REFERENCE_ORIGINAL_REQUIRED'],
      blockingReasons: [{
        code: 'ack_application_reference_original_required',
        message: `${family} måste använda Application Reference från det korrelerade originalmeddelandet.`,
        field: 'correlatedApplicationReference',
        severity: 'block',
      }],
    }
  }

  const guard = evaluateApplicationReferenceGuard({
    family: input.messageFamily,
    messageCode: input.businessCode ?? input.messageType,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.applicationReference,
  })

  const expected = isAck
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
