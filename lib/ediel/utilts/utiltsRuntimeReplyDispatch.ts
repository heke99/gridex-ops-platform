// lib/ediel/utilts/utiltsRuntimeReplyDispatch.ts
//
// FINDINGS F112: the UTILTS runtime (createUtiltsRuntimeAcks) created its
// CONTRL / APERAK / UTILTS-ERR replies as canonical drafts but never queued
// them in ediel_outbox, so an operational grid owner never received the
// application reply that UCASE-E66-SUPPLIER-inbound and ACK-03/ACK-05 prescribe.
//
// The same runtime also serves runs that must not send on their own:
//   * the Test Center meter-to-invoice chain (runTestCenterMeteringToInvoiceChain:
//     externalSideEffectsAllowed=false, test lane only);
//   * TGT runs, where the operator sends the engine's reply from the message
//     page ("Skicka befintligt svar"); recognised by an explicit or stored test
//     case code, an active UTILTS test run (resolveUtiltsRuntimeTestCaseCode) or
//     the Ediel portal E66-T reference;
//   * AGT / system-test sources (fileEngine mode agt, systemTest suite).
// This module decides, per source, whether a freshly created runtime reply is
// queued through the ordinary outbox (and therefore through every send gate:
// tenant state, production send lock, route contract, readiness and S/MIME)
// or stays a draft. The decision is fail-closed: only a caller that declares
// itself the operational path can ever queue.
import type { EdielMessageRow } from '@/lib/ediel/types'
import { isEdielPortalUtiltsE66TgtMessage } from '@/lib/ediel/ack'

/** Who runs the UTILTS runtime. Anything but 'operational' keeps replies as drafts. */
export type UtiltsRuntimeReplyOrigin = 'operational' | 'draft_only'
export type UtiltsRuntimeReplyDispatch = 'operational_outbox' | 'draft_only'

export type UtiltsRuntimeReplyDispatchDecision = {
  dispatch: UtiltsRuntimeReplyDispatch
  reason:
    | 'not_operational_origin'
    | 'not_operational_source'
    | 'tgt_reference_in_production'
    | 'tgt_test_case'
    | 'actor_test_context'
    | 'tgt_portal_reference'
    | 'unknown_lane'
    | 'production_lane'
    | 'operational_test_lane'
}

// A test case code is a short identifier (U2.1.8b, UL3, S142). Free text, such
// as a hold reason that ended up in failure_reason, is never a test case.
const TEST_CASE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,23}$/

const TEST_CASE_KEYS = [
  'testCaseCode', 'test_case_code', 'requestedTestCaseCode', 'requested_test_case_code',
  'selectedTgtCaseCode', 'selected_tgt_case_code', 'tgtTestCaseCode', 'tgt_test_case_code',
  'activeTgtCaseCode', 'active_tgt_case_code', 'utiltsRuntimeTestCaseCode',
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The normalized code when the value is shaped like a test case code, else null. */
export function utiltsTestCaseCodeOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return TEST_CASE_CODE.test(code) ? code : null
}

function storedTestCaseCode(message: EdielMessageRow): string | null {
  for (const source of [record(message.parsed_payload), record(message.validation_report)]) {
    for (const key of TEST_CASE_KEYS) {
      const code = utiltsTestCaseCodeOrNull(source[key])
      if (code) return code
    }
  }
  return null
}

function isActorTestContext(message: EdielMessageRow): boolean {
  const parsed = record(message.parsed_payload)
  const report = record(message.validation_report)
  return record(parsed.fileEngine).mode === 'agt' || report.fileEngineMode === 'agt'
    || Boolean(String(record(parsed.systemTest).suite ?? '').trim())
}

export function resolveUtiltsRuntimeReplyDispatch(input: {
  origin?: UtiltsRuntimeReplyOrigin | null
  sourceMessage: EdielMessageRow
  /** The runtime's resolved test case code (explicit, stored or active UTILTS test run). */
  testCaseCode?: string | null
}): UtiltsRuntimeReplyDispatchDecision {
  if (input.origin !== 'operational') return { dispatch: 'draft_only', reason: 'not_operational_origin' }
  const source = input.sourceMessage
  if (source.direction !== 'inbound' || source.message_family !== 'UTILTS' || !source.company_id) {
    return { dispatch: 'draft_only', reason: 'not_operational_source' }
  }
  if (source.environment === 'production') {
    // ENV-05: a TGT reference is never run as production business. The send
    // guards refuse it too; the reply is not queued in the first place.
    if (isEdielPortalUtiltsE66TgtMessage(source)) return { dispatch: 'draft_only', reason: 'tgt_reference_in_production' }
    return { dispatch: 'operational_outbox', reason: 'production_lane' }
  }
  if (source.environment === 'test') {
    if (utiltsTestCaseCodeOrNull(input.testCaseCode) || storedTestCaseCode(source)) return { dispatch: 'draft_only', reason: 'tgt_test_case' }
    if (isActorTestContext(source)) return { dispatch: 'draft_only', reason: 'actor_test_context' }
    if (isEdielPortalUtiltsE66TgtMessage(source)) return { dispatch: 'draft_only', reason: 'tgt_portal_reference' }
    return { dispatch: 'operational_outbox', reason: 'operational_test_lane' }
  }
  return { dispatch: 'draft_only', reason: 'unknown_lane' }
}
