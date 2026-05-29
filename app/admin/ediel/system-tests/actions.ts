'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { activeRulebookRules, defaultApplicationReferenceForProcess } from '@/lib/ediel/rulebook/rulebook'
import { STATIC_FIELD_RULES } from '@/lib/ediel/rulebook/fieldMatrix'
import { STATIC_CODE_RULES } from '@/lib/ediel/rulebook/codeRules'
import { findRulebookTestCase, listRulebookTestCases } from '@/lib/ediel/rulebook/testCaseMatcher'
import { parseRulebookListPayload, parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { parseStructuredTestData } from '@/lib/ediel/rulebook/testDataImport'
import { attachRulebookArtifact, runRulebookRegression, type RulebookRegressionScope } from '@/lib/ediel/rulebook/testRunner'
import {
  attachEdielMessageToTestRun,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from '@/lib/ediel/db'
import { createAckDraftForMessage, pollAndIngestEdielMailbox, sendQueuedEdielMessage } from '@/lib/ediel/orchestrator'
import { getEdielTgtTestCaseByCode, getEdielTgtTestCases } from '@/lib/ediel/tgtRegistry'
import { autoAttachImportedMessageToActiveTgtRun, runTgtAutopilotForRun } from '@/lib/ediel/tgtAutopilot'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import type { AckFamily, AckOutcome } from '@/lib/ediel/core/ackPolicy'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function formFileText(value: FormDataEntryValue | null): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === 'string') return { text: null, fileName: null }
  const file = value as unknown as { arrayBuffer?: () => Promise<ArrayBuffer>; name?: string; size?: number }
  if (!file.arrayBuffer || (file.size ?? 0) <= 0) return { text: null, fileName: null }
  const buffer = await file.arrayBuffer()
  return { text: new TextDecoder('utf-8').decode(buffer), fileName: file.name ?? null }
}

async function safeUpsert(table: string, payload: Record<string, unknown>, onConflict?: string) {
  let query = supabaseService.from(table).upsert(payload, onConflict ? { onConflict } : undefined).select('*').maybeSingle()
  const { data, error } = await query
  if (error) throw error
  return data as Record<string, unknown> | null
}

async function safeInsert(table: string, payload: Record<string, unknown>) {
  const { data, error } = await supabaseService.from(table).insert(payload).select('*').maybeSingle()
  if (error) throw error
  return data as Record<string, unknown> | null
}

function revalidateSystemTests(testCaseCode?: string | null) {
  revalidatePath('/admin/ediel/system-tests')
  if (testCaseCode) revalidatePath(`/admin/ediel/system-tests/cases/${encodeURIComponent(testCaseCode)}`)
  revalidatePath('/admin/ediel')
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


function normalizeAckFamily(value: string | null | undefined): AckFamily {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'CONTRL' || normalized === 'APERAK' || normalized === 'UTILTS_ERR') return normalized
  throw new Error('Ogiltig ACK-familj')
}

function normalizeAckOutcome(value: string | null | undefined): AckOutcome {
  const normalized = String(value ?? 'positive').trim().toLowerCase()
  if (normalized === 'positive' || normalized === 'negative') return normalized
  throw new Error('Ogiltig ACK-outcome')
}

function formNumber(value: FormDataEntryValue | null): number | null {
  const raw = formString(value)
  if (!raw) return null
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

async function safeDeleteWhere(table: string, column: string, value: string) {
  const { error } = await supabaseService.from(table).delete().eq(column, value)
  if (error && error.code !== '42P01' && error.code !== '42703') throw error
}

async function safeDeleteMessageRunLink(params: { testRunId: string; edielMessageId?: string | null; linkId?: string | null }) {
  let query = supabaseService.from('ediel_test_run_messages').delete().eq('test_run_id', params.testRunId)
  if (params.linkId) query = query.eq('id', params.linkId)
  if (params.edielMessageId) query = query.eq('ediel_message_id', params.edielMessageId)
  const { error } = await query
  if (error && error.code !== '42P01' && error.code !== '42703') throw error
}

async function auditSystemTestMaintenance(params: {
  actorUserId: string
  action: string
  testRunId?: string | null
  edielMessageId?: string | null
  reason?: string | null
  payload?: Record<string, unknown>
}) {
  if (params.edielMessageId) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.edielMessageId,
      eventType: 'manual_note',
      eventStatus: params.action.includes('delete') || params.action.includes('unlink') ? 'warning' : 'info',
      message: params.reason ?? params.action,
      payload: {
        action: params.action,
        testRunId: params.testRunId ?? null,
        ...(params.payload ?? {}),
      },
    }).catch(() => undefined)
  }

  await supabaseService.from('audit_logs').insert({
    action: params.action,
    entity_type: 'ediel_system_test',
    entity_id: params.testRunId ?? params.edielMessageId ?? null,
    actor_user_id: params.actorUserId,
    metadata: {
      testRunId: params.testRunId ?? null,
      edielMessageId: params.edielMessageId ?? null,
      reason: params.reason ?? null,
      ...(params.payload ?? {}),
    },
  }).then((result: { error?: { code?: string } | null }) => {
    const error = result.error ?? null
    if (error && error.code !== '42P01' && error.code !== '42703') {
      console.warn('Audit log kunde inte sparas för systemtest-action', error)
    }
  })
}

async function findBestActiveRunForMessage(params: {
  testRunId?: string | null
  testCaseCode?: string | null
  sourceMessageId?: string | null
}) {
  if (params.testRunId) return params.testRunId

  const testCaseCode = normalizeCode(params.testCaseCode)
  if (!testCaseCode) return null

  const runs = await listEdielTestRuns().catch(() => [])
  const candidate = runs.find((run) =>
    normalizeCode(run.test_case_code) === testCaseCode &&
    (run.status === 'running' || run.status === 'draft')
  ) ?? runs.find((run) => normalizeCode(run.test_case_code) === testCaseCode)

  return candidate?.id ?? null
}

export async function createAndSendSystemTestAckAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const sourceMessageId = formString(formData.get('sourceMessageId'))
  const testRunIdInput = formString(formData.get('testRunId'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const ackFamily = normalizeAckFamily(formString(formData.get('ackFamily')))
  const outcome = normalizeAckOutcome(formString(formData.get('outcome')))
  const messageText = formString(formData.get('messageText'))
  const stepNo = formNumber(formData.get('stepNo'))
  const sendNow = (formString(formData.get('sendNow')) ?? 'true') !== 'false'

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')

  const sourceMessage = await getEdielMessageById(sourceMessageId)
  if (!sourceMessage) throw new Error('Källmeddelande hittades inte')
  if (sourceMessage.message_family === 'CONTRL') throw new Error('CONTRL ska aldrig kvitteras med en ny CONTRL/APERAK.')
  if (ackFamily === 'APERAK' && sourceMessage.message_family === 'APERAK') {
    throw new Error('APERAK får inte skickas på APERAK.')
  }

  const testRunId = await findBestActiveRunForMessage({ testRunId: testRunIdInput, testCaseCode, sourceMessageId })

  const existingAcks = await listAckMessagesForSource({
    sourceMessageId,
    ackFamily,
    outcome: ackFamily === 'UTILTS_ERR' ? undefined : outcome,
    companyId: sourceMessage.company_id ?? null,
  }).catch(() => [])
  const reusableAck = existingAcks.find((ack) => ack.direction === 'outbound' && ['draft', 'queued', 'prepared'].includes(String(ack.status)))
  let ackMessage = reusableAck ?? null
  if (!ackMessage) {
    ackMessage = await createAckDraftForMessage({
      actorUserId: context.userId,
      sourceMessageId,
      ackFamily,
      outcome: ackFamily === 'UTILTS_ERR' ? undefined : outcome,
      messageText: messageText ?? null,
      applicationErrors: null,
    })
  }

  if (testRunId) {
    await attachEdielMessageToTestRun({
      testRunId,
      edielMessageId: ackMessage.id,
      stepNo,
      expectedDirection: 'outbound',
      expectedFamily: ackFamily,
      expectedCode: ackFamily,
    }).catch(async (error) => {
      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: 'ediel.system_test.ack_attach_failed',
        testRunId,
        edielMessageId: ackMessage.id,
        reason: errorMessage(error),
      })
    })
  }

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: sendNow ? 'ediel.system_test.ack_create_and_send' : 'ediel.system_test.ack_create_preview',
    testRunId,
    edielMessageId: ackMessage.id,
    reason: `${ackFamily} ${outcome} skapades från Systemtest.`,
    payload: { sourceMessageId, ackFamily, outcome, testCaseCode: testCaseCode ?? null, stepNo },
  })

  if (sendNow) {
    try {
      await sendQueuedEdielMessage({ actorUserId: context.userId, edielMessageId: ackMessage.id })
      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: 'ediel.system_test.ack_sent',
        testRunId,
        edielMessageId: ackMessage.id,
        reason: `${ackFamily} ${outcome} skickades från Systemtest.`,
        payload: { sourceMessageId, ackFamily, outcome, testCaseCode: testCaseCode ?? null },
      })
    } catch (error) {
      await updateEdielMessageStatus({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
        status: 'failed',
        failureReason: `Systemtest kunde skapa men inte skicka ${ackFamily}: ${errorMessage(error)}`,
        failedAt: new Date().toISOString(),
      }).catch(() => undefined)
      throw error
    }
  }

  revalidateSystemTests(testCaseCode)
}

export async function unlinkSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testRunId = formString(formData.get('testRunId'))
  const edielMessageId = formString(formData.get('edielMessageId'))
  const linkId = formString(formData.get('linkId'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const reason = formString(formData.get('reason')) ?? 'Kopplades loss från testkörning via Systemtest.'

  if (!testRunId) throw new Error('testRunId saknas')
  if (!edielMessageId && !linkId) throw new Error('edielMessageId eller linkId saknas')

  await safeDeleteMessageRunLink({ testRunId, edielMessageId, linkId })

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: 'ediel.system_test.unlink_message',
    testRunId,
    edielMessageId,
    reason,
    payload: { linkId: linkId ?? null, testCaseCode: testCaseCode ?? null },
  })

  revalidateSystemTests(testCaseCode)
}

export async function softDeleteSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testRunId = formString(formData.get('testRunId'))
  const edielMessageId = formString(formData.get('edielMessageId'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const reason = formString(formData.get('reason')) ?? 'Soft delete från Systemtest. Meddelandet döljs men historik finns kvar.'

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  if (testRunId) await safeDeleteMessageRunLink({ testRunId, edielMessageId })
  await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId,
    status: 'cancelled',
    failureReason: reason,
  })

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: 'ediel.system_test.soft_delete_message',
    testRunId,
    edielMessageId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  })

  revalidateSystemTests(testCaseCode)
}

export async function deleteSystemTestRunAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testRunId = formString(formData.get('testRunId'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const reason = formString(formData.get('reason')) ?? 'Testkörningen avbröts/rensades från Systemtest.'

  if (!testRunId) throw new Error('testRunId saknas')

  await safeDeleteWhere('ediel_test_run_messages', 'test_run_id', testRunId)
  await safeDeleteWhere('ediel_test_artifacts', 'test_run_id', testRunId)
  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    testRunId,
    status: 'cancelled',
    failureReason: reason,
    completedAt: new Date().toISOString(),
  })

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: 'ediel.system_test.cancel_and_clear_run',
    testRunId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  })

  revalidateSystemTests(testCaseCode)
}

export async function validateSystemTestPayloadAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testRunId = formString(formData.get('testRunId'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const title = formString(formData.get('title')) ?? `Payload-validering ${testCaseCode ?? ''}`.trim()
  const pasted = formString(formData.get('rawPayload')) ?? ''
  const uploaded = await formFileText(formData.get('payloadFile'))
  const rawPayload = uploaded.text ?? pasted

  if (!rawPayload.trim()) throw new Error('Klistra in eller ladda upp payload först')

  const parsed = rawPayload.includes("'") ? parseRulebookMessage(rawPayload) : parseRulebookListPayload(rawPayload)
  const definition = testCaseCode ? getEdielTgtTestCases().find((testCase) => normalizeCode(testCase.testCaseCode) === normalizeCode(testCaseCode)) : null
  const validation = validateRulebookMessage({
    family: definition?.expectedSteps[0]?.family ?? parsed.family,
    code: definition?.expectedSteps[0]?.code ?? parsed.code,
    parsed,
    rawPayload,
    mode: 'parse',
  })

  let targetRunId = testRunId
  if (!targetRunId && definition) {
    targetRunId = await findBestActiveRunForMessage({ testCaseCode: definition.testCaseCode })
  }

  if (!targetRunId && definition) {
    const run = await createEdielTestRun({
      actorUserId: context.userId,
      testSuite: definition.suite,
      roleCode: definition.roleCode,
      testCaseCode: definition.testCaseCode,
      title: definition.title,
      approvalVersion: definition.approvalVersion,
      status: validation.blocking ? 'failed' : 'running',
      startedAt: new Date().toISOString(),
      failureReason: validation.blocking ? validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.description).join(' | ') : null,
      notes: 'Skapad av Payload-validator i Systemtest.',
    })
    targetRunId = run.id
  }

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: targetRunId,
    artifactType: 'system_test_payload_validation',
    title,
    payload: {
      testCaseCode: testCaseCode ?? null,
      fileName: uploaded.fileName,
      parsed,
      validation,
      rawPayload: rawPayload.slice(0, 25000),
      createdAt: new Date().toISOString(),
    },
  })

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: 'ediel.system_test.payload_validate',
    testRunId: targetRunId,
    reason: validation.blocking ? 'Payload-validering hittade blockerare.' : 'Payload-validering kördes utan blockerare.',
    payload: { testCaseCode: testCaseCode ?? null, blocking: validation.blocking, issueCount: validation.issues.length },
  })

  revalidateSystemTests(testCaseCode)
}

export async function pollAndSyncTgtSystemTestMailboxAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testCaseCode = normalizeCode(formString(formData.get('testCaseCode')) ?? formString(formData.get('tgtTestCaseCode')))
  const suiteRaw = normalizeCode(formString(formData.get('testSuite'))) || 'UTILTS'
  const roleRaw = String(formString(formData.get('roleCode')) ?? 'esco').trim().toLowerCase()
  const suite: EdielTestSuite = suiteRaw === 'PRODAT' || suiteRaw === 'UTILTS' || suiteRaw === 'AI_LIST' || suiteRaw === 'NBS_XML' ? suiteRaw : 'OTHER'
  const roleCode: EdielTestRoleCode = roleRaw === 'supplier' || roleRaw === 'grid_owner' || roleRaw === 'balance_responsible' || roleRaw === 'esco' ? roleRaw : 'esco'
  const mailbox = formString(formData.get('mailbox')) ?? 'INBOX'
  const limitRaw = formString(formData.get('limit'))
  const limitNumber = limitRaw ? Number(limitRaw) : 10
  const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(Math.floor(limitNumber), 50) : 10
  const startedAt = new Date().toISOString()

  const definition = getEdielTgtTestCaseByCode(suite, roleCode, testCaseCode)
    ?? getEdielTgtTestCases().find((testCase) => normalizeCode(testCase.testCaseCode) === testCaseCode)

  if (!testCaseCode || !definition) {
    throw new Error(`Okänt TGT-testfall: ${testCaseCode || 'saknas'}`)
  }

  let targetRunId: string | null = null

  try {
    const existingRuns = await listEdielTestRuns().catch(() => [])
    const activeRun = existingRuns.find((run) =>
      normalizeCode(run.test_suite) === normalizeCode(definition.suite) &&
      normalizeCode(run.role_code) === normalizeCode(definition.roleCode) &&
      normalizeCode(run.test_case_code) === normalizeCode(definition.testCaseCode) &&
      (run.status === 'running' || run.status === 'draft')
    )

    if (activeRun) {
      targetRunId = activeRun.id
    } else {
      const createdRun = await createEdielTestRun({
        actorUserId: context.userId,
        testSuite: definition.suite,
        roleCode: definition.roleCode,
        testCaseCode: definition.testCaseCode,
        title: definition.title,
        approvalVersion: definition.approvalVersion,
        notes: [
          definition.purpose,
          'Skapad automatiskt från Systemtest när IMAP-poll kördes.',
          'Synknyckel: explicit TGT-testfallskod så U3.1.1/U3.1.2/U3.2.1/U3.2.2 inte blandas ihop.',
        ].join('\n'),
        status: 'running',
        startedAt,
      })
      targetRunId = createdRun.id
    }

    const importedMessages = await pollAndIngestEdielMailbox({
      actorUserId: context.userId,
      mailbox,
      limit,
    })

    const linked: Array<Record<string, unknown>> = []
    const skipped: Array<Record<string, unknown>> = []

    for (const message of importedMessages) {
      const attachResult = await autoAttachImportedMessageToActiveTgtRun({
        edielMessage: message,
        explicitTestCaseCode: definition.testCaseCode,
      })

      if (!attachResult) {
        skipped.push({
          messageId: message.id,
          family: message.message_family,
          code: message.message_code,
          direction: message.direction,
          reason: 'Meddelandet matchade inte nästa förväntade steg för valt testfall.',
        })
        continue
      }

      linked.push({
        messageId: attachResult.messageId,
        testRunId: attachResult.testRunId,
        stepNo: attachResult.stepNo,
        action: attachResult.action,
        description: attachResult.description,
      })
      targetRunId = attachResult.testRunId

      await runTgtAutopilotForRun({
        actorUserId: context.userId,
        testRunId: attachResult.testRunId,
      }).catch(async (error) => {
        skipped.push({
          testRunId: attachResult.testRunId,
          messageId: attachResult.messageId,
          reason: `Autopilot kunde inte skapa nästa steg: ${errorMessage(error)}`,
        })
      })
    }

    await attachRulebookArtifact({
      actorUserId: context.userId,
      testRunId: targetRunId,
      artifactType: 'imap_poll_sync',
      title: `IMAP-poll och synk för ${definition.testCaseCode}`,
      payload: {
        testCaseCode: definition.testCaseCode,
        mailbox,
        limit,
        importedCount: importedMessages.length,
        linkedCount: linked.length,
        linked,
        skipped,
        pollStatus: linked.length > 0 ? 'linked' : importedMessages.length > 0 ? 'imported_without_match' : 'no_unread_messages',
        createdAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    const pollError = `IMAP-poll misslyckades: ${errorMessage(error)}`
    if (targetRunId) {
      await updateEdielTestRunStatus({
        actorUserId: context.userId,
        testRunId: targetRunId,
        status: 'failed',
        failureReason: pollError,
        completedAt: new Date().toISOString(),
      }).catch(() => undefined)
    }

    if (!targetRunId) {
      const failedRun = await createEdielTestRun({
        actorUserId: context.userId,
        testSuite: definition.suite,
        roleCode: definition.roleCode,
        testCaseCode: definition.testCaseCode,
        title: definition.title,
        approvalVersion: definition.approvalVersion,
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        failureReason: pollError,
        notes: 'Systemtest försökte polla IMAP från testfallssidan men kunde inte slutföra importen.',
      })
      targetRunId = failedRun.id
    }

    await attachRulebookArtifact({
      actorUserId: context.userId,
      testRunId: targetRunId,
      artifactType: 'imap_poll_error',
      title: `IMAP-poll misslyckades för ${definition.testCaseCode}`,
      payload: {
        testCaseCode: definition.testCaseCode,
        mailbox,
        limit,
        error: errorMessage(error),
        createdAt: new Date().toISOString(),
      },
    }).catch(() => undefined)
  }

  revalidateSystemTests(definition.testCaseCode)
}

export async function syncRulebookStaticRulesAction() {
  const context = await requirePlatformAdminActionAccess()
  const now = new Date().toISOString()

  const rulebook = await safeUpsert('ediel_rulebooks', {
    code: 'GRIDEX_EDIEL_RULEBOOK',
    name: 'Gridex Ediel Rulebook',
    description: 'Central rulebook för PRODAT, UTILTS, ACK, AI/BI och systemtester.',
    status: 'active',
    updated_by: context.userId,
    updated_at: now,
  }, 'code')

  const rulebookId = String(rulebook?.id ?? '')

  for (const rule of activeRulebookRules()) {
    await safeUpsert('ediel_rule_versions', {
      rulebook_id: rulebookId || null,
      rule_key: `${rule.family}:${rule.code}:${rule.version}`,
      version_code: rule.version,
      previous_version_code: rule.previousVersion,
      message_family: rule.family,
      message_code: rule.code,
      process_group: rule.processGroup,
      application_reference: rule.applicationReference,
      status: rule.status,
      valid_from: rule.validFrom,
      valid_to: rule.validTo ?? null,
      latest_change_at: now,
      metadata: { description: rule.description, allowedSubtypes: rule.allowedSubtypes ?? [] },
      updated_by: context.userId,
      updated_at: now,
    }, 'rule_key')

    await safeUpsert('ediel_ack_rules', {
      rule_key: `${rule.family}:${rule.code}:ACK`,
      message_family: rule.family,
      message_code: rule.code,
      requires_contrl: rule.requiresContrl,
      requires_aperak: rule.requiresAperak,
      requires_utilts_err: rule.requiresUtiltsErr,
      negative_aperak_on_error: rule.negativeAperakOnError,
      is_active: true,
      metadata: { processGroup: rule.processGroup },
      updated_by: context.userId,
      updated_at: now,
    }, 'rule_key')
  }

  for (const fieldRule of STATIC_FIELD_RULES) {
    await safeUpsert('ediel_field_rules', {
      rule_key: `${fieldRule.family}:${fieldRule.code}:${fieldRule.fieldKey}`,
      message_family: fieldRule.family,
      message_code: fieldRule.code,
      field_key: fieldRule.fieldKey,
      field_name: fieldRule.label,
      segment_path: fieldRule.segmentPath,
      requirement: fieldRule.requirement,
      condition: fieldRule.condition ?? null,
      allowed_values: fieldRule.allowedValues ?? [],
      error_code_if_missing: fieldRule.errorCodeIfMissing ?? null,
      error_code_if_invalid: fieldRule.errorCodeIfInvalid ?? null,
      is_active: true,
      updated_by: context.userId,
      updated_at: now,
    }, 'rule_key')
  }

  for (const codeRule of STATIC_CODE_RULES) {
    await safeUpsert('ediel_code_rules', {
      code_list: codeRule.codeList,
      allowed_values: codeRule.values,
      description: codeRule.description,
      is_active: true,
      updated_by: context.userId,
      updated_at: now,
    }, 'code_list')
  }

  for (const testCase of listRulebookTestCases()) {
    await safeUpsert('ediel_test_cases', {
      test_case_code: testCase.testCaseCode,
      suite_code: testCase.suite,
      title: testCase.title,
      role_code: testCase.role,
      message_family: testCase.family,
      message_code: testCase.code,
      subtype: testCase.subtype,
      process_group: testCase.processGroup,
      expected_contrl: testCase.expectedContrl,
      expected_aperak: testCase.expectedAperak,
      expected_utilts_err: testCase.expectedUtiltsErr,
      mandatory: testCase.mandatory,
      is_active: true,
      updated_by: context.userId,
      updated_at: now,
    }, 'test_case_code')
  }

  revalidateSystemTests()
}

export async function cloneRuleVersionToDraftAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))
  if (!ruleVersionId) throw new Error('ruleVersionId saknas')

  const { data, error } = await supabaseService.from('ediel_rule_versions').select('*').eq('id', ruleVersionId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Regelversion hittades inte')

  const original = data as Record<string, unknown>
  await safeInsert('ediel_rule_versions', {
    ...original,
    id: undefined,
    rule_key: `${String(original.rule_key ?? 'rule')}:draft:${Date.now()}`,
    status: 'draft',
    latest_change_at: new Date().toISOString(),
    last_regression_run_id: null,
    last_regression_status: null,
    last_regression_at: null,
    approved_by: null,
    activated_at: null,
    created_by: context.userId,
    updated_by: context.userId,
    created_at: undefined,
    updated_at: new Date().toISOString(),
  })

  revalidateSystemTests()
}

export async function runRulebookRegressionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))
  const scope = (formString(formData.get('scope')) ?? 'all') as RulebookRegressionScope
  await runRulebookRegression({ actorUserId: context.userId, ruleVersionId, scope })
  revalidateSystemTests()
}

export async function activateRuleVersionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))
  if (!ruleVersionId) throw new Error('ruleVersionId saknas')

  const { data, error } = await supabaseService.from('ediel_rule_versions').select('*').eq('id', ruleVersionId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Regelversion hittades inte')
  const row = data as Record<string, unknown>
  const status = String(row.last_regression_status ?? '')
  const regressionAt = typeof row.last_regression_at === 'string' ? Date.parse(row.last_regression_at) : NaN
  const changedAt = typeof row.latest_change_at === 'string'
    ? Date.parse(row.latest_change_at)
    : typeof row.updated_at === 'string'
      ? Date.parse(row.updated_at)
      : NaN

  if (status !== 'passed' || !Number.isFinite(regressionAt) || (Number.isFinite(changedAt) && regressionAt < changedAt)) {
    throw new Error('Regelversionen kan inte aktiveras. Kör en grön regression för samma rule_version_id efter senaste ändringen först.')
  }

  await supabaseService
    .from('ediel_rule_versions')
    .update({
      status: 'active',
      approved_by: context.userId,
      activated_at: new Date().toISOString(),
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ruleVersionId)

  await safeInsert('ediel_rule_change_logs', {
    rule_version_id: ruleVersionId,
    change_type: 'activated',
    old_value: { status: row.status ?? null },
    new_value: { status: 'active' },
    changed_by: context.userId,
  })

  revalidateSystemTests()
}

export async function parseAndValidateRulebookPayloadAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const pasted = formString(formData.get('rawPayload')) ?? ''
  const uploaded = await formFileText(formData.get('payloadFile'))
  const rawPayload = uploaded.text ?? pasted
  if (!rawPayload.trim()) throw new Error('Klistra in eller ladda upp payload först')

  const parsed = rawPayload.includes("'") ? parseRulebookMessage(rawPayload) : parseRulebookListPayload(rawPayload)
  const validation = validateRulebookMessage({ parsed, rawPayload, mode: 'parse' })

  const run = await safeInsert('ediel_test_runs', {
    test_suite: 'RULEBOOK_PARSER',
    role_code: 'system',
    test_case_code: `${validation.family ?? 'UNKNOWN'}_${validation.code ?? 'UNKNOWN'}_${Date.now()}`,
    title: `Parser & validering ${validation.family ?? 'okänd'} ${validation.code ?? ''}`,
    status: validation.blocking ? 'failed' : 'passed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    failure_reason: validation.blocking ? validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.description).join(' | ') : null,
    notes: JSON.stringify({ fileName: uploaded.fileName, validation }),
    created_by: context.userId,
    updated_by: context.userId,
  })

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: typeof run?.id === 'string' ? run.id : null,
    artifactType: 'parser_validation',
    title: 'Parser & rulebook-validering',
    payload: { parsed, validation, rawPayload: rawPayload.slice(0, 25000) },
  })

  revalidateSystemTests()
}

export async function importStructuredTestDataAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const title = formString(formData.get('title')) ?? 'Importerad testdata'
  const pasted = formString(formData.get('testDataText')) ?? ''
  const uploaded = await formFileText(formData.get('testDataFile'))
  const text = uploaded.text ?? pasted
  if (!text.trim()) throw new Error('Ingen testdata att importera')

  const parsed = parseStructuredTestData(text)
  const dataSet = await safeInsert('ediel_test_data_sets', {
    title,
    file_name: uploaded.fileName,
    source_type: uploaded.fileName ? 'upload' : 'paste',
    row_count: parsed.rows.length,
    headers: parsed.headers,
    raw_text_preview: text.slice(0, 25000),
    metadata: { warnings: parsed.warnings },
    created_by: context.userId,
  })
  const dataSetId = typeof dataSet?.id === 'string' ? dataSet.id : null

  const inserts: Array<[string, Array<Record<string, string>>]> = [
    ['ediel_test_customers', parsed.customers],
    ['ediel_test_facilities', parsed.facilities],
    ['ediel_test_metering_points', parsed.meteringPoints],
    ['ediel_test_expected_values', parsed.expectedValues],
    ['ediel_test_expected_acks', parsed.expectedAcks],
    ['ediel_test_field_values', parsed.fieldValues],
  ]

  for (const [table, rows] of inserts) {
    if (!dataSetId || rows.length === 0) continue
    const payload = rows.map((row) => ({ data_set_id: dataSetId, ...row, created_by: context.userId }))
    const { error } = await supabaseService.from(table).insert(payload)
    if (error) throw error
  }

  revalidateSystemTests()
}

export async function executeRulebookTestCaseAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const testCaseCode = formString(formData.get('testCaseCode'))
  if (!testCaseCode) throw new Error('testCaseCode saknas')

  const testCase = findRulebookTestCase(testCaseCode)
  if (!testCase) throw new Error(`Okänt testfall: ${testCaseCode}`)

  const executionMode = formString(formData.get('executionMode')) ?? 'start_portal'
  const pasted = formString(formData.get('rawPayload')) ?? ''
  const uploaded = await formFileText(formData.get('payloadFile'))
  const rawPayload = uploaded.text ?? pasted
  const now = new Date().toISOString()
  const appRef = defaultApplicationReferenceForProcess(testCase.processGroup as never, testCase.family)
  const hasPayload = rawPayload.trim().length > 0
  const parsed = hasPayload ? (rawPayload.includes("'") ? parseRulebookMessage(rawPayload) : parseRulebookListPayload(rawPayload)) : null
  const validation = validateRulebookMessage({
    family: testCase.family,
    code: testCase.code,
    processGroup: testCase.processGroup,
    applicationReference: appRef,
    parsed,
    rawPayload: hasPayload ? rawPayload : null,
    mode: hasPayload ? 'parse' : 'test',
  })

  const mismatchIssues: Array<Record<string, unknown>> = []
  if (parsed?.family && String(parsed.family).toUpperCase() !== String(testCase.family).toUpperCase()) {
    mismatchIssues.push({ severity: 'error', code: 'TEST_FAMILY_MISMATCH', title: 'Fel meddelandefamilj', description: `Payload är ${parsed.family}, men testfallet kräver ${testCase.family}.` })
  }
  if (parsed?.code && String(parsed.code).toUpperCase() !== String(testCase.code).toUpperCase()) {
    mismatchIssues.push({ severity: 'error', code: 'TEST_CODE_MISMATCH', title: 'Fel meddelandekod', description: `Payload är ${parsed.code}, men testfallet kräver ${testCase.code}.` })
  }

  const blocking = validation.blocking || mismatchIssues.some((issue) => issue.severity === 'error')
  const status = hasPayload ? (blocking ? 'failed' : 'passed') : 'running'
  const title = `${testCase.testCaseCode} · ${testCase.title}`
  const portalInstructions = testCase.family === 'UTILTS'
    ? 'Starta testet i Edielportalen. Testet är portal→aktör: portalen ska skicka inbound UTILTS till Gridex. När inbound finns, importera/polla mailbox och koppla meddelandet till denna körning via parser/inbound-kedjan.'
    : 'Starta testet enligt testsviten. Outbound-fall kan skickas från relevant kundkort/AGT-flöde; inbound-fall väntar på meddelande från Edielportalen.'

  const run = await safeInsert('ediel_test_runs', {
    test_suite: testCase.suite,
    role_code: testCase.role,
    test_case_code: testCase.testCaseCode,
    title,
    status,
    started_at: now,
    completed_at: hasPayload ? now : null,
    failure_reason: blocking ? [...validation.issues, ...mismatchIssues].filter((issue) => String(issue.severity ?? '') === 'error').map((issue) => String(issue.description ?? issue.title ?? issue.code)).join(' | ') : null,
    notes: JSON.stringify({
      source: 'system_tests_execute_action',
      executionMode,
      fileName: uploaded.fileName,
      portalInstructions,
      applicationReference: appRef,
      subtype: testCase.subtype,
    }),
    created_by: context.userId,
    updated_by: context.userId,
  })
  const runId = typeof run?.id === 'string' ? run.id : null

  if (runId) {
    const stepRows = hasPayload
      ? [
          {
            test_run_id: runId,
            step_no: 1,
            title: 'Payload parserad och validerad mot valt testfall',
            status,
            expected_direction: 'inbound',
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: { contrl: testCase.expectedContrl, aperak: testCase.expectedAperak, utiltsErr: testCase.expectedUtiltsErr },
            actual_direction: null,
            actual_family: parsed?.family ?? validation.family,
            actual_code: parsed?.code ?? validation.code,
            validation_report: { ...validation, mismatchIssues, testCase, applicationReference: appRef },
            created_at: now,
            updated_at: now,
          },
        ]
      : [
          {
            test_run_id: runId,
            step_no: 1,
            title: 'Starta testet i Edielportalen',
            status: 'pending',
            expected_direction: 'inbound',
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: { contrl: testCase.expectedContrl, aperak: testCase.expectedAperak, utiltsErr: testCase.expectedUtiltsErr },
            validation_report: { testCase, applicationReference: appRef, instructions: portalInstructions },
            created_at: now,
            updated_at: now,
          },
          {
            test_run_id: runId,
            step_no: 2,
            title: `Ta emot ${testCase.family} ${testCase.code}${testCase.subtype ? ` ${testCase.subtype}` : ''}`,
            status: 'pending',
            expected_direction: 'inbound',
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: { contrl: testCase.expectedContrl, aperak: testCase.expectedAperak, utiltsErr: testCase.expectedUtiltsErr },
            validation_report: { processGroup: testCase.processGroup, subtype: testCase.subtype, applicationReference: appRef },
            created_at: now,
            updated_at: now,
          },
          {
            test_run_id: runId,
            step_no: 3,
            title: 'Validera ACK-kedja och rulebook-resultat',
            status: 'pending',
            expected_direction: null,
            expected_family: testCase.expectedUtiltsErr === 'required' ? 'UTILTS_ERR' : 'CONTRL/APERAK',
            expected_code: null,
            expected_ack: { contrl: testCase.expectedContrl, aperak: testCase.expectedAperak, utiltsErr: testCase.expectedUtiltsErr },
            validation_report: { source: 'rulebook', expectedStatus: hasPayload ? status : 'waiting_for_inbound' },
            created_at: now,
            updated_at: now,
          },
        ]

    const { error: stepError } = await supabaseService.from('ediel_test_run_steps').insert(stepRows)
    if (stepError) throw stepError
  }

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: runId,
    artifactType: hasPayload ? 'test_payload_validation' : 'test_execution_instructions',
    title: hasPayload ? `Validering för ${title}` : `Körinstruktioner för ${title}`,
    payload: hasPayload
      ? { testCase, parsed, validation, mismatchIssues, rawPayload: rawPayload.slice(0, 25000) }
      : { testCase, validation, portalInstructions, applicationReference: appRef },
  })

  revalidateSystemTests()
}

