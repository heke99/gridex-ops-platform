#!/usr/bin/env node
const fs = require('fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, label) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${label || path} saknar ${needle}`)
  }
}

function assertAll() {
  assertIncludes('lib/ediel/orchestrator/edielProcessingPipeline.ts', 'analyzeEdielProcessingPipeline', 'processing pipeline')
  assertIncludes('lib/ediel/orchestrator/edielProcessingPipeline.ts', 'recordDecisionTrace', 'decision trace')
  assertIncludes('lib/ediel/orchestrator/autoAckOrchestrator.ts', 'ensureExpectedAckSent', 'ACK lifecycle guard')
  assertIncludes('lib/ediel/outbox/supersedeWrongDrafts.ts', 'blocked_final_ack_exists', 'opposite final ACK guard')
  assertIncludes('lib/ediel/matching/index.ts', 'resolveEdielBusinessMatch', 'business matcher')
  assertIncludes('lib/ediel/sla/createAckTimers.ts', 'contrlDueAt', 'SLA timer plan')
  assertIncludes('lib/ediel/portal/parsePortalValidationReport.ts', 'portalValidationReportStorageRows', 'portal feedback parser')
  assertIncludes('supabase/migrations/20260605160000_ediel_backend_automation_foundation.sql', 'ediel_decision_traces', 'decision trace table')
  assertIncludes('supabase/migrations/20260605160000_ediel_backend_automation_foundation.sql', 'ediel_outbox', 'outbox table')
  assertIncludes('supabase/migrations/20260605160000_ediel_backend_automation_foundation.sql', 'ediel_sla_timers', 'SLA table')
  assertIncludes('supabase/migrations/20260605160000_ediel_backend_automation_foundation.sql', 'ediel_portal_validation_feedback', 'portal feedback table')
  assertIncludes('lib/ediel/flows/inboundProcessing.ts', 'recordBackendAutomationPipelineTrace', 'inbound trace integration')
  assertIncludes('lib/ediel/flows/inboundProcessing.ts', 'createOutboxItem', 'inbound ACK outbox integration')
  assertIncludes('lib/ediel/outbox/sendOutboxItem.ts', 'assertNoActiveSendLock', 'outbox send lock guard')
  assertIncludes('app/admin/ediel/automation/page.tsx', 'Ediel automation', 'automation dashboard page')
  assertIncludes('app/admin/ediel/outbox/page.tsx', 'processEdielOutboxAction', 'outbox processor UI')
  assertIncludes('app/admin/ediel/portal-feedback/page.tsx', 'importPortalValidationFeedbackAction', 'portal feedback UI')
  assertIncludes('app/api/ediel/outbox/process/route.ts', 'EDIEL_CRON_SECRET', 'protected outbox processor API')
}

assertAll()
console.log('ediel automation foundation regression: ok')
