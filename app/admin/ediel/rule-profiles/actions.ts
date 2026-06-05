'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { compileRuleProfile } from '@/lib/ediel/rulebook/compileRuleProfile'
import { parseFieldMatrixImport, summarizeFieldMatrixRows } from '@/lib/ediel/rulebook/fieldMatrixImport'
import { supabaseService } from '@/lib/supabase/service'

function formString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function formText(value: FormDataEntryValue | null): Promise<string | null> {
  if (!value) return null
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if ('text' in value && typeof value.text === 'function') {
    const text = await value.text()
    return text.trim().length > 0 ? text : null
  }
  return null
}

type RuleProfileRow = {
  id: string
  profile_key: string
  message_family: string
  message_code: string | null
  profile_name: string
}

type RuleProfileVersionRow = {
  id: string
  profile_key: string
  version: string
  status: string
  rules?: Record<string, unknown> | null
}

function profileName(profileKey: string): string {
  return profileKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function upsertRuleProfile(input: {
  profileKey: string
  messageFamily: string
  messageCode: string | null
  userId: string
  sourceDocument: string | null
  sourceVersion: string | null
}): Promise<RuleProfileRow> {
  const payload = {
    profile_key: input.profileKey,
    message_family: input.messageFamily,
    message_code: input.messageCode,
    profile_name: profileName(input.profileKey),
    description: 'Versionerad Ediel-regelprofil. Field Matrix får inte skriva över canonical safety rules.',
    updated_by: input.userId,
    payload: {
      source: 'batch4_canonical_field_matrix',
      sourceDocument: input.sourceDocument,
      sourceVersion: input.sourceVersion,
      canonicalRulesLocked: true,
      excludedScope: ['NBS_XML', 'GAS', 'ECP_EDX'],
      lastImportedAt: new Date().toISOString(),
    },
  }

  const { error: upsertError } = await supabaseService
    .from('ediel_rule_profiles')
    .upsert(payload, { onConflict: 'profile_key' })

  if (upsertError) throw upsertError

  const { data, error } = await supabaseService
    .from('ediel_rule_profiles')
    .select('id, profile_key, message_family, message_code, profile_name')
    .eq('profile_key', input.profileKey)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`Kunde inte läsa regelprofil ${input.profileKey}`)
  return data as unknown as RuleProfileRow
}

async function upsertRuleProfileVersion(input: {
  profile: RuleProfileRow
  version: string
  status: string
  rules: Record<string, unknown>
  userId: string
}): Promise<RuleProfileVersionRow> {
  const payload = {
    rule_profile_id: input.profile.id,
    profile_key: input.profile.profile_key,
    version: input.version,
    status: input.status,
    rules: input.rules,
    created_by: input.userId,
  }

  const { error: upsertError } = await supabaseService
    .from('ediel_rule_profile_versions')
    .upsert(payload, { onConflict: 'profile_key,version' })

  if (upsertError) throw upsertError

  const { data, error } = await supabaseService
    .from('ediel_rule_profile_versions')
    .select('id, profile_key, version, status, rules')
    .eq('profile_key', input.profile.profile_key)
    .eq('version', input.version)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`Kunde inte läsa regelprofilversion ${input.profile.profile_key}/${input.version}`)
  return data as unknown as RuleProfileVersionRow
}

export async function importEdielFieldMatrixAction(formData: FormData) {
  const context = await requirePlatformAdminAccess()
  const pastedText = await formText(formData.get('matrixText'))
  const fileText = await formText(formData.get('matrixFile'))
  const rawText = fileText ?? pastedText

  if (!rawText) {
    throw new Error('Ladda upp CSV/TSV eller klistra in kopierad Excel-tabell först.')
  }

  const sourceDocument = formString(formData.get('sourceDocument')) ?? 'Ediel Field Matrix'
  const sourceVersion = formString(formData.get('sourceVersion')) ?? null
  const validFrom = formString(formData.get('validFrom')) ?? null
  const validTo = formString(formData.get('validTo')) ?? null

  const parsed = parseFieldMatrixImport({
    rawText,
    version: formString(formData.get('version')),
    source: formString(formData.get('source')) ?? 'admin_field_matrix_import',
    defaultFamily: formString(formData.get('defaultFamily')) ?? 'PRODAT',
    defaultStatus: 'review',
    sourceDocument,
    sourceVersion,
    validFrom,
    validTo,
  })

  if (parsed.rows.length === 0) {
    throw new Error(`Inga regler kunde importeras. ${parsed.warnings.join(' ')}`)
  }

  const summary = summarizeFieldMatrixRows(parsed.rows)

  const { error: importError } = await supabaseService.from('ediel_field_matrix_imports').insert({
    batch_key: parsed.batchKey,
    version: parsed.version,
    source: formString(formData.get('source')) ?? 'admin_field_matrix_import',
    status: 'review',
    row_count: parsed.rows.length,
    warning_count: parsed.warnings.length,
    warnings: parsed.warnings,
    summary,
    raw_preview: rawText.slice(0, 12000),
    created_by: context.userId,
  })
  if (importError) throw importError

  const groups = new Map<string, typeof parsed.rows>()
  for (const row of parsed.rows) groups.set(row.profileKey, [...(groups.get(row.profileKey) ?? []), row])

  for (const [profileKey, rows] of groups.entries()) {
    const first = rows[0]
    if (!first) continue

    const profile = await upsertRuleProfile({
      profileKey,
      messageFamily: first.messageFamily,
      messageCode: first.messageCode,
      userId: context.userId,
      sourceDocument,
      sourceVersion,
    })

    const compile = compileRuleProfile({
      profileKey,
      version: parsed.version,
      sourceDocument,
      sourceVersion,
      validFrom,
      validTo,
      fieldRules: rows,
    })

    const version = await upsertRuleProfileVersion({
      profile,
      version: parsed.version,
      status: compile.ok ? 'review' : 'draft',
      rules: {
        importBatchKey: parsed.batchKey,
        sourceDocument,
        sourceVersion,
        validFrom,
        validTo,
        summary: summarizeFieldMatrixRows(rows),
        warnings: [...parsed.warnings, ...compile.warnings],
        conflicts: compile.conflicts,
        canonicalRulesLocked: true,
        compiled: compile.compiled,
      },
      userId: context.userId,
    })

    await supabaseService.from('ediel_field_matrix_rules').delete().eq('rule_profile_version_id', version.id)

    const rowsToInsert = rows.map((row) => ({
      rule_profile_version_id: version.id,
      profile_key: row.profileKey,
      message_family: row.messageFamily,
      message_code: row.messageCode,
      segment: row.segment,
      qualifier: row.qualifier,
      rule_type: row.ruleType,
      rule_payload: {
        ...row.rulePayload,
        sourceDocument: row.sourceDocument,
        sourceVersion: row.sourceVersion,
        validFrom: row.validFrom,
        validTo: row.validTo,
        applicationReference: row.applicationReference,
        actorRole: row.actorRole,
        direction: row.direction,
        ackPolicy: row.ackPolicy,
        errorMapping: row.errorMapping,
        fieldReferenceCode: row.fieldReferenceCode,
        ruleSeverity: row.ruleSeverity,
        canonicalOverrideGuard: row.canonicalOverrideGuard,
      },
      source: row.source,
      status: row.status,
      created_by: context.userId,
    }))

    const { error } = await supabaseService.from('ediel_field_matrix_rules').insert(rowsToInsert)
    if (error) throw error
  }

  revalidatePath('/admin/ediel/rule-profiles')
  revalidatePath('/admin/ediel/certification')
}

export async function activateEdielRuleProfileVersionAction(formData: FormData) {
  const context = await requirePlatformAdminAccess()
  const profileKey = formString(formData.get('profileKey'))
  const version = formString(formData.get('version'))

  if (!profileKey || !version) throw new Error('Profil och version krävs.')

  const { data: versionRow, error: versionError } = await supabaseService
    .from('ediel_rule_profile_versions')
    .select('id, profile_key, version, rules')
    .eq('profile_key', profileKey)
    .eq('version', version)
    .maybeSingle()

  if (versionError) throw versionError
  if (!versionRow) throw new Error('Regelprofilversionen finns inte.')

  const rules = (versionRow as { rules?: { conflicts?: unknown } }).rules ?? {}
  const conflicts = Array.isArray(rules.conflicts) ? rules.conflicts : []
  if (conflicts.length > 0) {
    throw new Error(`Versionen har canonical conflicts och kan inte aktiveras: ${conflicts.join(' | ')}`)
  }

  await supabaseService
    .from('ediel_rule_profile_versions')
    .update({ status: 'review' })
    .eq('profile_key', profileKey)
    .eq('status', 'active')

  const { error: activateError } = await supabaseService
    .from('ediel_rule_profile_versions')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', (versionRow as { id: string }).id)

  if (activateError) throw activateError

  const { error: profileError } = await supabaseService
    .from('ediel_rule_profiles')
    .update({
      active_version: version,
      is_active: true,
      updated_by: context.userId,
      payload: {
        activeVersion: version,
        activatedAt: new Date().toISOString(),
        activatedBy: context.userId,
        canonicalRulesLocked: true,
        rules: (versionRow as { rules?: unknown }).rules ?? {},
      },
    })
    .eq('profile_key', profileKey)

  if (profileError) throw profileError

  await supabaseService.from('ediel_rule_activation_log').insert({
    profile_key: profileKey,
    version,
    action: 'activate',
    payload: { canonicalRulesLocked: true },
    created_by: context.userId,
  }).throwOnError()

  revalidatePath('/admin/ediel/rule-profiles')
  revalidatePath('/admin/ediel/certification')
}
