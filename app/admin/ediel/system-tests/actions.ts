'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  RULEBOOK_FIELD_MATRIX,
  RULEBOOK_MESSAGE_RULES,
  deriveRulebookAckDecision,
  createRulebookPayloadValidationRun,
  importRulebookTestDataSet,
  runRulebookRegressionSuite,
} from '@/lib/ediel/rulebook'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function formFileText(value: FormDataEntryValue | null): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === 'string') return { text: null, fileName: null }
  const maybeFile = value as unknown as { arrayBuffer?: () => Promise<ArrayBuffer>; name?: string; size?: number }
  if (!maybeFile.arrayBuffer || (maybeFile.size ?? 0) <= 0) return { text: null, fileName: null }
  const decoder = new TextDecoder('utf-8')
  return {
    text: decoder.decode(await maybeFile.arrayBuffer()),
    fileName: typeof maybeFile.name === 'string' ? maybeFile.name : null,
  }
}

function revalidateSystemTests() {
  revalidatePath('/admin/ediel/system-tests')
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/agt')
  revalidatePath('/admin/ediel/control-tower')
}

export async function validateEdielRulebookPayloadAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const rawPayload = formString(formData.get('rawPayload'))
  if (!rawPayload) throw new Error('Klistra in ett EDIFACT-/AI-/BI-meddelande först.')

  await createRulebookPayloadValidationRun({
    rawPayload,
    createdBy: context.userId,
    title: formString(formData.get('title')),
  })

  revalidateSystemTests()
}

export async function runEdielRulebookRegressionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))

  await runRulebookRegressionSuite({
    actorUserId: context.userId,
    ruleVersionId,
  })

  revalidateSystemTests()
}

export async function cloneEdielRuleVersionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))
  const newVersionCode = formString(formData.get('newVersionCode'))
  if (!ruleVersionId) throw new Error('Välj regelversion att kopiera.')

  const { data: source, error: sourceError } = await supabaseService
    .from('ediel_rule_versions')
    .select('*')
    .eq('id', ruleVersionId)
    .single()

  if (sourceError) throw sourceError
  if (!source) throw new Error('Regelversionen hittades inte.')

  const versionCode = newVersionCode ?? `${source.version_code}-DRAFT-${new Date().toISOString().slice(0, 10)}`
  const { data: clone, error: cloneError } = await supabaseService
    .from('ediel_rule_versions')
    .insert({
      rulebook_id: source.rulebook_id,
      rulebook_key: source.rulebook_key,
      message_family: source.message_family,
      message_code: source.message_code,
      message_standard: source.message_standard,
      version_code: versionCode,
      previous_version_code: source.version_code,
      status: 'draft',
      valid_from: source.valid_from,
      valid_to: null,
      business_process: source.business_process,
      default_application_reference: source.default_application_reference,
      requires_contrl: source.requires_contrl,
      requires_aperak: source.requires_aperak,
      supports_negative_response: source.supports_negative_response,
      supports_utilts_err: source.supports_utilts_err,
      source_title: source.source_title,
      source_version: source.source_version,
      notes: {
        ...(source.notes && typeof source.notes === 'object' ? source.notes : {}),
        clonedFromRuleVersionId: ruleVersionId,
        clonedBy: context.userId,
        clonedAt: new Date().toISOString(),
      },
      created_by: context.userId,
    })
    .select('id')
    .single()

  if (cloneError) throw cloneError
  const clonedId = typeof clone?.id === 'string' ? clone.id : null

  if (clonedId) {
    await copyRuleVersionChildren(ruleVersionId, clonedId)
    await supabaseService.from('ediel_rule_change_logs').insert({
      rule_version_id: clonedId,
      changed_by: context.userId,
      change_type: 'clone_rule_version',
      old_value: { sourceRuleVersionId: ruleVersionId },
      new_value: { clonedRuleVersionId: clonedId, versionCode },
    })
  }

  revalidateSystemTests()
}

async function copyRuleVersionChildren(sourceId: string, targetId: string) {
  const copySpecs = [
    { table: 'ediel_field_rules', omit: new Set(['id', 'created_at', 'updated_at']) },
    { table: 'ediel_code_rules', omit: new Set(['id', 'created_at']) },
    { table: 'ediel_ack_rules', omit: new Set(['id', 'created_at', 'updated_at']) },
    { table: 'ediel_message_build_rules', omit: new Set(['id', 'created_at']) },
  ]

  for (const spec of copySpecs) {
    const { data, error } = await supabaseService.from(spec.table).select('*').eq('rule_version_id', sourceId)
    if (error) throw error
    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const next: Record<string, unknown> = { rule_version_id: targetId }
      for (const [key, value] of Object.entries(row)) {
        if (spec.omit.has(key) || key === 'rule_version_id') continue
        next[key] = value
      }
      return next
    })
    if (rows.length > 0) {
      const { error: insertError } = await supabaseService.from(spec.table).insert(rows)
      if (insertError) throw insertError
    }
  }
}

export async function activateEdielRuleVersionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const ruleVersionId = formString(formData.get('ruleVersionId'))
  if (!ruleVersionId) throw new Error('Välj regelversion att aktivera.')

  const { data: lastRegression, error: regressionError } = await supabaseService
    .from('ediel_test_runs')
    .select('id,status,created_at')
    .eq('test_case_code', 'RULEBOOK_REGRESSION')
    .eq('status', 'passed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (regressionError) throw regressionError
  if (!lastRegression) {
    throw new Error('Kör regression först. Regelversion får inte aktiveras utan grön regression.')
  }

  const { data: selected, error: selectedError } = await supabaseService
    .from('ediel_rule_versions')
    .select('*')
    .eq('id', ruleVersionId)
    .single()

  if (selectedError) throw selectedError
  if (!selected) throw new Error('Regelversionen hittades inte.')

  await supabaseService
    .from('ediel_rule_versions')
    .update({ status: 'superseded', valid_to: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
    .eq('message_family', selected.message_family)
    .eq('message_code', selected.message_code)
    .eq('message_standard', selected.message_standard)
    .eq('status', 'active')
    .neq('id', ruleVersionId)

  const { error: updateError } = await supabaseService
    .from('ediel_rule_versions')
    .update({
      status: 'active',
      approved_by: context.userId,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: {
        ...(selected.notes && typeof selected.notes === 'object' ? selected.notes : {}),
        activatedBy: context.userId,
        activatedAt: new Date().toISOString(),
        regressionRunId: lastRegression.id,
      },
    })
    .eq('id', ruleVersionId)

  if (updateError) throw updateError

  await supabaseService.from('ediel_rule_change_logs').insert({
    rule_version_id: ruleVersionId,
    changed_by: context.userId,
    change_type: 'activate_rule_version',
    old_value: { previousStatus: selected.status },
    new_value: { status: 'active', regressionRunId: lastRegression.id },
    approved_by: context.userId,
    activated_at: new Date().toISOString(),
  })

  revalidateSystemTests()
}

export async function importEdielRulebookTestDataAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const uploaded = await formFileText(formData.get('testDataFile'))
  const pasted = formString(formData.get('rawText'))
  const rawText = uploaded.text ?? pasted
  if (!rawText) throw new Error('Ladda upp eller klistra in testdata först.')

  const datasetKey = formString(formData.get('datasetKey')) ?? `ediel-testdata-${Date.now()}`
  const name = formString(formData.get('name')) ?? uploaded.fileName ?? datasetKey

  await importRulebookTestDataSet({
    actorUserId: context.userId,
    datasetKey,
    name,
    sourceFileName: uploaded.fileName,
    sourceType: uploaded.fileName ? 'file_upload' : 'pasted_text',
    rawText,
  })

  revalidateSystemTests()
}

export async function syncRulebookStaticRulesAction(_formData: FormData) {
  const context = await requirePlatformAdminActionAccess()

  const { data: rulebook, error: rulebookError } = await supabaseService
    .from('ediel_rulebooks')
    .upsert({
      rulebook_key: 'ediel-electricity-2026A',
      name: 'Ediel elmarknad 2026A',
      market: 'electricity',
      status: 'active',
      description: 'Synkad från rulebook-kod efter Batch 2.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'rulebook_key' })
    .select('id')
    .single()

  if (rulebookError) throw rulebookError
  const rulebookId = rulebook?.id ?? null

  for (const item of RULEBOOK_MESSAGE_RULES) {
    const { data: version, error: versionError } = await supabaseService
      .from('ediel_rule_versions')
      .upsert({
        rulebook_id: rulebookId,
        rulebook_key: 'ediel-electricity-2026A',
        message_family: item.family,
        message_code: item.code,
        message_standard: item.standard,
        version_code: item.currentVersion,
        previous_version_code: item.previousVersion ?? null,
        status: item.runtimeStatus === 'runtime_ready' ? 'active' : 'review',
        valid_from: item.validFrom,
        business_process: item.businessProcess,
        default_application_reference: item.defaultApplicationReference,
        requires_contrl: item.requiresContrl,
        requires_aperak: item.requiresAperak,
        supports_negative_response: item.supportsNegativeAperak,
        supports_utilts_err: item.supportsUtiltsErr,
        notes: { syncedBy: context.userId, syncedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'message_family,message_code,message_standard,version_code,valid_from' })
      .select('id')
      .single()

    if (versionError) throw versionError

    const ack = deriveRulebookAckDecision({ family: item.family, code: item.code })
    await supabaseService.from('ediel_ack_rules').upsert({
      rule_version_id: version?.id ?? null,
      message_family: item.family,
      message_code: item.code,
      requires_contrl: ack.requiresContrl,
      requires_aperak: ack.requiresAperak,
      send_negative_aperak_on_error: ack.negativeAperakAlwaysOnError,
      send_utilts_err_on_functional_error: ack.utiltsErrStatus === 'pending',
      ack_deadline_minutes: ack.ackDueMinutes,
      status: 'active',
      notes: { syncedBy: context.userId },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'message_family,message_code,status' })
  }

  for (const item of RULEBOOK_FIELD_MATRIX) {
    const match = await supabaseService
      .from('ediel_field_rules')
      .select('id')
      .eq('message_family', item.family)
      .eq('message_code', item.code)
      .eq('field_key', item.fieldKey)
      .eq('segment_path', item.segmentPath)
      .is('subtype', null)
      .maybeSingle()

    if (match.error) throw match.error

    const payload = {
      message_family: item.family,
      message_code: item.code,
      subtype: null,
      field_key: item.fieldKey,
      field_label: item.label,
      segment_path: item.segmentPath,
      requirement: item.requirement,
      condition: item.condition,
      allowed_values: item.allowedValues ?? [],
      error_code_if_missing: item.errorCodeIfMissing ?? null,
      error_code_if_invalid: item.errorCodeIfInvalid ?? null,
      updated_at: new Date().toISOString(),
    }

    const write = match.data?.id
      ? await supabaseService.from('ediel_field_rules').update(payload).eq('id', match.data.id)
      : await supabaseService.from('ediel_field_rules').insert(payload)

    if (write.error) throw write.error
  }

  revalidateSystemTests()
}
