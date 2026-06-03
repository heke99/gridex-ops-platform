import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow, EdielRouteProfileRow, EdielTestRunMessageRow, EdielTestRunRow } from '@/lib/ediel/types'
import {
  isAgtPortalProdatAddress,
  normalizeTransportSecurityMode,
  transportSecurityModeToEncryptionMode,
} from '@/lib/ediel/partyRegistry'

export type EdielResolvedSmtpMimeMode = 'ediel-singlepart-base64' | 'ediel-smime-enveloped'

export type EdielSendConsistencyIssue = {
  code: string
  message: string
  severity: 'blocking' | 'warning'
}

export type EdielSendConsistencyResult = {
  ok: boolean
  blockingIssues: EdielSendConsistencyIssue[]
  warnings: EdielSendConsistencyIssue[]
  selectedEncryptionMode: 'none' | 'smime' | null
  resolvedEncryptionMode: 'none' | 'smime'
  resolvedSmtpMimeMode: EdielResolvedSmtpMimeMode
  sendButtonLabel: string
  linkedTestRun: EdielTestRunRow | null
  linkedTestRunIds: string[]
  routeProfile: EdielRouteProfileRow | null
  routeProfileId: string | null
  communicationRouteId: string | null
}

function normalizeEncryptionMode(value: unknown): 'none' | 'smime' | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'encrypted' || normalized === 'smime' || normalized === 's/mime') return 'smime'
  if (normalized === 'unencrypted' || normalized === 'none' || normalized === 'plain') return 'none'
  return null
}

function expectedMessageEnvironment(run: EdielTestRunRow): 'test' | 'production' | null {
  const environmentType = String((run as unknown as { environment_type?: unknown }).environment_type ?? '').trim().toLowerCase()
  if (environmentType === 'production') return 'production'
  if (environmentType === 'tgt_test' || environmentType === 'agt_test' || environmentType === 'bilateral_test') return 'test'
  return null
}

function resolveSmtpMimeMode(encryptionMode: 'none' | 'smime', override?: string | null): EdielResolvedSmtpMimeMode {
  if (override === 'ediel-smime-enveloped') return 'ediel-smime-enveloped'
  if (override === 'ediel-singlepart-base64') return 'ediel-singlepart-base64'
  return encryptionMode === 'smime' ? 'ediel-smime-enveloped' : 'ediel-singlepart-base64'
}

async function listLinkedTestRuns(messageId: string): Promise<EdielTestRunRow[]> {
  const { data: links, error: linkError } = await supabaseService
    .from('ediel_test_run_messages')
    .select('*')
    .eq('ediel_message_id', messageId)
    .order('created_at', { ascending: false })
  if (linkError) throw linkError
  const runIds = Array.from(new Set(((links ?? []) as EdielTestRunMessageRow[]).map((link) => link.test_run_id).filter(Boolean)))
  if (runIds.length === 0) return []
  const { data: runs, error: runError } = await supabaseService
    .from('ediel_test_runs')
    .select('*')
    .in('id', runIds)
  if (runError) throw runError
  const order = new Map(runIds.map((id, index) => [id, index]))
  return ((runs ?? []) as EdielTestRunRow[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

async function getRouteProfileForMessage(message: EdielMessageRow, run: EdielTestRunRow | null): Promise<EdielRouteProfileRow | null> {
  if (message.communication_route_id) {
    let query = supabaseService
      .from('ediel_route_profiles')
      .select('*')
      .eq('communication_route_id', message.communication_route_id)
      .limit(1)
    if (message.company_id) query = query.eq('company_id', message.company_id)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (data) return data as EdielRouteProfileRow
  }

  const routeProfileId = String(run?.route_profile_id ?? '').trim()
  if (!routeProfileId) return null
  let query = supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('id', routeProfileId)
    .limit(1)
  if (run?.company_id) query = query.eq('company_id', run.company_id)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as EdielRouteProfileRow | null) ?? null
}

function addIssue(target: EdielSendConsistencyIssue[], code: string, message: string, severity: 'blocking' | 'warning' = 'blocking') {
  target.push({ code, message, severity })
}

function routeAllowsNonProdatSmime(routeProfile: EdielRouteProfileRow | null): boolean {
  const metadata = routeProfile?.metadata
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      (metadata.bilateralSmimeException === true || metadata.allowNonProdatSmime === true),
  )
}

function applyMessageFamilyEncryptionPolicy(params: {
  messageFamily?: string | null
  encryptionMode: 'none' | 'smime'
  routeProfile: EdielRouteProfileRow | null
}): 'none' | 'smime' {
  const family = String(params.messageFamily ?? '').toUpperCase()
  if (family === 'PRODAT') return params.encryptionMode
  if (params.encryptionMode === 'smime' && !routeAllowsNonProdatSmime(params.routeProfile)) return 'none'
  return params.encryptionMode
}

export async function validateEdielSendContext(params: {
  message: EdielMessageRow
  smtpMimeModeOverride?: string | null
}): Promise<EdielSendConsistencyResult> {
  const linkedRuns = await listLinkedTestRuns(params.message.id)
  const linkedTestRun = linkedRuns[0] ?? null
  const routeProfile = await getRouteProfileForMessage(params.message, linkedTestRun)
  const rawRouteTransportSecurityMode = routeProfile?.transport_security_mode ?? routeProfile?.transport_mode ?? null
  const routeTransportSecurityMode = rawRouteTransportSecurityMode
    ? normalizeTransportSecurityMode(rawRouteTransportSecurityMode)
    : null
  const routeEncryption = normalizeEncryptionMode(routeProfile?.encryption_mode)
  const selectedEncryptionMode = normalizeEncryptionMode(linkedTestRun?.encryption_mode)
  const routeTransportEncryption = transportSecurityModeToEncryptionMode(routeTransportSecurityMode)
  const resolvedEncryptionMode = selectedEncryptionMode ?? routeTransportEncryption ?? routeEncryption ?? 'none'
  const resolvedSmtpMimeMode = resolveSmtpMimeMode(resolvedEncryptionMode, params.smtpMimeModeOverride)
  const finalEncryptionMode: 'none' | 'smime' = applyMessageFamilyEncryptionPolicy({
    messageFamily: params.message.message_family,
    encryptionMode: resolvedSmtpMimeMode === 'ediel-smime-enveloped' ? 'smime' : 'none',
    routeProfile,
  })
  const finalSmtpMimeMode = resolveSmtpMimeMode(finalEncryptionMode, finalEncryptionMode === 'smime' ? params.smtpMimeModeOverride : 'ediel-singlepart-base64')
  const blockingIssues: EdielSendConsistencyIssue[] = []
  const warnings: EdielSendConsistencyIssue[] = []
  const receiverSubaddress =
    routeProfile?.receiver_message_subaddress ??
    routeProfile?.receiver_subaddress ??
    routeProfile?.receiver_sub_address ??
    params.message.receiver_sub_address ??
    null
  const agtPortalUnencryptedAllowed =
    routeProfile?.allow_unencrypted_test === true &&
    isAgtPortalProdatAddress({
      receiverEdielId: routeProfile?.receiver_ediel_id ?? params.message.receiver_ediel_id ?? null,
      receiverSubaddress,
      messageFamily: String(params.message.message_family ?? routeProfile?.message_family ?? ''),
      environment: params.message.environment,
    })

  for (const run of linkedRuns) {
    const runEncryption = normalizeEncryptionMode(run.encryption_mode)
    if (runEncryption && runEncryption !== finalEncryptionMode) {
      addIssue(
        blockingIssues,
        'transport_security_mismatch',
        `Sending blocked: this test run requires ${runEncryption === 'smime' ? 'encrypted' : 'unencrypted'} transport, but the outbound message is configured as ${finalEncryptionMode === 'smime' ? 'encrypted' : 'unencrypted'}.`,
      )
    }
    const expectedEnvironment = expectedMessageEnvironment(run)
    if (expectedEnvironment && params.message.environment !== expectedEnvironment) {
      addIssue(blockingIssues, 'environment_mismatch', 'Sending blocked: test environment and route/message environment do not match.')
    }
    if (run.company_id && params.message.company_id && run.company_id !== params.message.company_id) {
      addIssue(blockingIssues, 'tenant_mismatch', 'Sending blocked: outbound message tenant does not match the selected company.')
    }
    if (run.message_family && params.message.message_family && String(run.message_family).toUpperCase() !== String(params.message.message_family).toUpperCase()) {
      addIssue(blockingIssues, 'message_family_mismatch', 'Sending blocked: selected test suite/message family does not match the generated message.')
    }
    if (run.route_profile_id && routeProfile?.id && run.route_profile_id !== routeProfile.id) {
      addIssue(blockingIssues, 'route_profile_mismatch', 'Sending blocked: route profile does not match the selected test run.')
    }
  }

  if (linkedTestRun?.route_profile_id && !routeProfile) {
    addIssue(blockingIssues, 'route_profile_missing', 'Sending blocked: selected test run has a route profile, but the outbound message cannot resolve it.')
  }
  if (routeProfile?.communication_route_id && !params.message.communication_route_id) {
    addIssue(blockingIssues, 'message_route_missing', 'Sending blocked: generated outbound message did not inherit the selected route profile. Create a new draft from the test run so route, encryption and mailbox are locked before sending.')
  }
  if (selectedEncryptionMode === 'smime' && !routeProfile) {
    addIssue(blockingIssues, 'encrypted_transport_unresolved', 'Sending blocked: encrypted test run cannot resolve route or mailbox encryption settings.')
  }
  if (routeTransportSecurityMode === 'needs_verification') {
    addIssue(blockingIssues, 'transport_security_needs_verification', 'Sending blocked: route transport security is marked needs_verification.')
  }
  if (routeTransportSecurityMode === 'required_encrypted' && finalEncryptionMode !== 'smime' && !agtPortalUnencryptedAllowed) {
    addIssue(blockingIssues, 'required_encrypted_route_mismatch', 'Sending blocked: this route requires encrypted S/MIME transport.')
  }
  if (routeTransportSecurityMode === 'unencrypted' && finalEncryptionMode === 'smime') {
    addIssue(blockingIssues, 'unencrypted_route_mismatch', 'Sending blocked: this route is explicitly unencrypted but the message is configured as S/MIME.')
  }
  if (
    params.message.environment === 'production' &&
    String(params.message.message_family ?? '').toUpperCase() === 'PRODAT' &&
    finalEncryptionMode !== 'smime' &&
    routeProfile?.allow_unencrypted_production !== true
  ) {
    addIssue(blockingIssues, 'production_prodat_requires_smime', 'Sending blocked: real grid owner PRODAT requires required_encrypted/S/MIME.')
  }

  return {
    ok: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    selectedEncryptionMode,
    resolvedEncryptionMode: finalEncryptionMode,
    resolvedSmtpMimeMode: finalSmtpMimeMode,
    sendButtonLabel: finalEncryptionMode === 'smime' ? 'Skicka krypterat' : 'Skicka okrypterat EDIFACT',
    linkedTestRun,
    linkedTestRunIds: linkedRuns.map((run) => run.id),
    routeProfile,
    routeProfileId: routeProfile?.id ?? linkedTestRun?.route_profile_id ?? null,
    communicationRouteId: params.message.communication_route_id ?? routeProfile?.communication_route_id ?? null,
  }
}

export async function assertEdielSendContextConsistency(params: {
  message: EdielMessageRow
  actorUserId?: string | null
  smtpMimeModeOverride?: string | null
}): Promise<EdielSendConsistencyResult> {
  const result = await validateEdielSendContext({
    message: params.message,
    smtpMimeModeOverride: params.smtpMimeModeOverride,
  })
  if (!result.ok) {
    try {
      await supabaseService.from('ediel_message_events').insert({
        ediel_message_id: params.message.id,
        message_id: params.message.id,
        event_type: 'manual_note',
        event_status: 'error',
        message: `Sending blocked by Ediel send consistency: ${result.blockingIssues.map((issue) => issue.message).join(' ')}`,
        payload: {
          phase: 'send_context_consistency',
          selectedEncryptionMode: result.selectedEncryptionMode,
          resolvedEncryptionMode: result.resolvedEncryptionMode,
          resolvedSmtpMimeMode: result.resolvedSmtpMimeMode,
          linkedTestRunIds: result.linkedTestRunIds,
          routeProfileId: result.routeProfileId,
          communicationRouteId: result.communicationRouteId,
          issues: result.blockingIssues,
        },
        created_by: params.actorUserId ?? null,
      })
    } catch {
      // Send blocking is authoritative; audit persistence is best effort.
    }
    throw new Error(result.blockingIssues.map((issue) => issue.message).join(' '))
  }
  return result
}
