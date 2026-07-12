import { createHash } from 'crypto'
import { createEdielTestRun } from '@/lib/ediel/db'
import { getEdielAgtTestCaseByCode } from '@/lib/ediel/testing/agtRegistry'
import { createEdielSupplierAgtOutboundCommand } from '@/lib/ediel/testing/agtEngine'
import { getEdielTgtTestCaseByCode } from '@/lib/ediel/testing/tgtRegistry'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder'
import { createSmimeEncryptedPayloadReference } from '@/lib/ediel/transport/smime'
import { resolveOutboundRecipientCertificate, routeReceiverSubaddress } from '@/lib/ediel/security/outboundRecipientCertificate'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import { assertEdielEnvironmentGate } from '@/lib/ediel/testing/environmentGate'

type TestEncryptionMode = 'none' | 'smime'
export type EdielEnvironmentType = 'tgt_test' | 'agt_test' | 'bilateral_test' | 'production'


function routeText(routeProfile: Record<string, unknown> | null | undefined, column: string): string | null {
  const value = routeProfile?.[column]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function routeMetadataText(routeProfile: Record<string, unknown> | null | undefined, key: string): string | null {
  const metadata = routeProfile?.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeRouteToken(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function routeLooksLikeAgtProdat(routeProfile: Record<string, unknown> | null | undefined): boolean {
  const messageFamily = normalizeRouteToken(
    routeText(routeProfile, 'message_family') ??
      routeMetadataText(routeProfile, 'messageFamily') ??
      routeMetadataText(routeProfile, 'message_family'),
  )
  if (messageFamily !== 'prodat') return false

  const environmentType = normalizeRouteToken(
    routeText(routeProfile, 'environment_type') ??
      routeMetadataText(routeProfile, 'environmentType') ??
      routeMetadataText(routeProfile, 'environment_type'),
  )
  const targetSystem = normalizeRouteToken(
    routeText(routeProfile, 'target_system') ??
      routeMetadataText(routeProfile, 'targetSystem') ??
      routeMetadataText(routeProfile, 'target_system'),
  )
  const testSuiteType = normalizeRouteToken(
    routeMetadataText(routeProfile, 'testSuiteType') ?? routeMetadataText(routeProfile, 'test_suite_type'),
  )
  const setupPackage = normalizeRouteToken(routeMetadataText(routeProfile, 'setupPackage') ?? routeMetadataText(routeProfile, 'setup_package'))

  return (
    environmentType === 'agt_test' ||
    targetSystem === 'ediel_portalen_agt' ||
    testSuiteType === 'agt' ||
    Boolean(setupPackage?.startsWith('agt_'))
  )
}

function routeCertificateEnvironment(routeProfile: Record<string, unknown> | null | undefined, fallbackEnvironment?: string | null): string | null {
  // Ediel actor tests are logical test runs, but Ediel/Expisoft requires production certificates.
  // Old route rows may still have certificate_environment='test', so AGT PRODAT routes must be normalized here too.
  if (routeLooksLikeAgtProdat(routeProfile)) return 'production'

  return (
    routeText(routeProfile, 'certificate_environment') ??
    routeMetadataText(routeProfile, 'certificateEnvironment') ??
    routeMetadataText(routeProfile, 'certificate_environment') ??
    (fallbackEnvironment && fallbackEnvironment.trim().length > 0 ? fallbackEnvironment.trim() : null)
  )
}

function normalizeEnvironmentType(value?: string | null): EdielEnvironmentType {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'production') return 'production'
  if (normalized === 'bilateral_test') return 'bilateral_test'
  if (normalized === 'tgt_test' || normalized === 'test' || normalized === 'production-like test') return 'tgt_test'
  return 'agt_test'
}

function legacyEnvironmentForType(value: EdielEnvironmentType): 'test' | 'production' {
  return value === 'production' ? 'production' : 'test'
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeSuite(value: string): EdielTestSuite {
  const suite = value.trim().toUpperCase()
  if (suite === 'UTILTS' || suite === 'AI_LIST' || suite === 'NBS_XML' || suite === 'OTHER') return suite
  return 'PRODAT'
}

function normalizeRole(value: string): EdielTestRoleCode {
  const role = value.trim().toLowerCase()
  if (role === 'esco' || role === 'grid_owner' || role === 'balance_responsible') return role
  return 'supplier'
}

function normalizeEncryptionMode(value?: string | null): TestEncryptionMode {
  return value === 'smime' ? 'smime' : 'none'
}

function recordText(value: unknown, ...keys: string[]): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  }
  return null
}

async function resolveRouteProfile(input: {
  companyId: string
  environment: 'test' | 'production'
  environmentType: EdielEnvironmentType
  messageFamily: string | null
  businessCode: string | null
}) {
  const buildQuery = (useEnvironmentType: boolean) => {
    let query = supabaseService
      .from('ediel_route_profiles')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('is_enabled', true)
      .order('updated_at', { ascending: false })
      .limit(1)

    query = useEnvironmentType
      ? query.eq('environment_type', input.environmentType)
      : query.eq('environment', input.environment)

    if (input.messageFamily) query = query.eq('message_family', input.messageFamily)
    if (input.businessCode) query = query.or(`business_code.eq.${input.businessCode},message_code.eq.${input.businessCode},business_code.is.null,message_code.is.null`)
    return query
  }

  let { data, error } = await buildQuery(true).maybeSingle()

  if (error && ['42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    const fallback = await buildQuery(false).maybeSingle()
    data = fallback.data
    error = fallback.error
  }

  if (error) throw error
  return data as Record<string, unknown> | null
}

async function resolveCertificate(certificateId?: string | null) {
  if (!certificateId) return null
  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .select('*')
    .eq('id', certificateId)
    .maybeSingle()
  if (error) throw error
  return data as Record<string, unknown> | null
}

async function resolveMailboxSecurity(input: {
  mailbox?: string | null
  environment: 'test' | 'production'
}) {
  const mailbox = String(input.mailbox ?? '').trim()
  if (!mailbox) return null
  const { data, error } = await supabaseService
    .from('ediel_mailboxes')
    .select('encryption_mode,certificate_id')
    .eq('environment', input.environment)
    .eq('is_active', true)
    .ilike('email_address', mailbox)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { encryption_mode?: string | null; certificate_id?: string | null } | null
}

async function acquireAgtRunLock(input: {
  companyId: string
  actorRole: string
  messageFamily: string
  environmentType: EdielEnvironmentType
  actorUserId: string
}): Promise<void> {
  if (input.environmentType !== 'agt_test') return

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const lockKey = {
    company_id: input.companyId,
    actor_role: input.actorRole,
    message_family: input.messageFamily,
    environment_type: input.environmentType,
    locked_at: new Date().toISOString(),
    expires_at: expiresAt,
  }

  const { data: existing, error: existingError } = await supabaseService
    .from('ediel_test_run_locks')
    .select('id,active_test_run_id,locked_at,expires_at,released_at')
    .eq('company_id', input.companyId)
    .eq('actor_role', input.actorRole)
    .eq('message_family', input.messageFamily)
    .eq('environment_type', input.environmentType)
    .is('released_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (existingError && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(existingError.code ?? '')) {
    throw existingError
  }

  if (existing?.id) {
    throw new Error('Ett AGT-test är redan aktivt. Avsluta eller markera det som misslyckat innan du startar ett nytt.')
  }

  const { error } = await supabaseService
    .from('ediel_test_run_locks')
    .insert({
      ...lockKey,
      metadata: {
        actorUserId: input.actorUserId,
        source: 'test_center',
      },
    })

  if (error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw error
  }
}

function expectedFlowFromSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return steps.map((step) => ({
    stepNo: step.stepNo ?? null,
    actor: step.actor ?? null,
    direction: step.direction ?? null,
    family: step.family ?? null,
    code: step.code ?? null,
    title: step.title ?? null,
    required: step.required ?? true,
    outcome: step.outcome ?? null,
  }))
}

export async function prepareEdielTestRunTransportMetadata(input: {
  actorUserId: string
  companyId: string
  testSuite: string
  roleCode: string
  testCaseCode: string
  environment?: 'test' | 'production'
  environmentType?: EdielEnvironmentType | string | null
  productionLike?: boolean
  encryptionMode?: string | null
}) {
  const suite = normalizeSuite(input.testSuite)
  const roleCode = normalizeRole(input.roleCode)
  const testCaseCode = input.testCaseCode.trim().toUpperCase()
  const environmentType = normalizeEnvironmentType(input.environmentType ?? input.environment)
  const environment = input.environment ?? legacyEnvironmentForType(environmentType)
  const agtDefinition = getEdielAgtTestCaseByCode({ suite, roleCode, testCaseCode })
  const tgtDefinition = agtDefinition ? null : getEdielTgtTestCaseByCode(suite, roleCode, testCaseCode)
  const definition = agtDefinition ?? tgtDefinition

  if (!definition) {
    throw new Error(`Okänt Ediel-testfall: ${suite} ${roleCode} ${testCaseCode}`)
  }

  const messageFamily =
    'messageFamily' in definition ? String(definition.messageFamily) : String(definition.suite)
  const businessCode =
    'messageCode' in definition ? String(definition.messageCode) : (definition.expectedSteps[0]?.code ?? null)
  const expectedFlow = expectedFlowFromSteps(definition.expectedSteps as Array<Record<string, unknown>>)
  const routeProfile = await resolveRouteProfile({
    companyId: input.companyId,
    environment,
    environmentType,
    messageFamily,
    businessCode,
  })
  const mailboxSecurity = await resolveMailboxSecurity({
    mailbox: String(routeProfile?.mailbox ?? ''),
    environment,
  })
  const effectiveEncryption = normalizeEncryptionMode(
    input.encryptionMode ??
    String(routeProfile?.encryption_mode ?? mailboxSecurity?.encryption_mode ?? 'none')
  )
  // Test runs must lock the receiver public route certificate only.
  // Mailbox certificate is private/inbound material and must not be used as outbound recipient.
  const effectiveCertificateId = String(routeProfile?.receiver_certificate_id ?? routeProfile?.certificate_id ?? '') || null
  const certificate = effectiveEncryption === 'smime'
    ? await resolveOutboundRecipientCertificate({
        certificateId: effectiveCertificateId,
        receiverEdielId: String(routeProfile?.receiver_ediel_id ?? ''),
        receiverSubaddress: routeReceiverSubaddress(routeProfile),
        messageType: messageFamily,
        environment,
        certificateEnvironment: routeCertificateEnvironment(routeProfile, environment),
        routeProfileId: String(routeProfile?.id ?? '') || null,
        smtpTo: String(routeProfile?.smtp_to ?? ''),
      })
    : await resolveCertificate(effectiveCertificateId)

  await assertEdielEnvironmentGate({
    companyId: input.companyId,
    actorRole: roleCode,
    messageFamily,
    environmentType,
  })

  await acquireAgtRunLock({
    companyId: input.companyId,
    actorRole: roleCode,
    messageFamily,
    environmentType,
    actorUserId: input.actorUserId,
  })

  const run = await createEdielTestRun({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    approvalVersion: definition.approvalVersion,
    roleCode,
    testSuite: suite,
    testCaseCode,
    title: definition.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    notes: [
      definition.purpose,
      ...(Array.isArray(definition.notes) ? definition.notes : []),
      'Test Center: transportläge sparat före skick. Samma builder/parser ska användas vid actual send.',
      `Environment type: ${environmentType}. Legacy environment: ${environment}.`,
    ].join('\n'),
    actorRole: roleCode,
    messageFamily,
    businessCode,
    encryptionMode: effectiveEncryption,
    certificateId: effectiveCertificateId,
    certificateFingerprintSha256: recordText(certificate, 'fingerprintSha256', 'fingerprint_sha256', 'certificate_fingerprint'),
    routeProfileId: String(routeProfile?.id ?? '') || null,
    expectedFlow,
    actualFlow: [],
    productionLike: input.productionLike ?? false,
  })

  let rawEdifact: string | null = null
  let encryptedPayloadRef: string | null = null
  let actualFlow: Array<Record<string, unknown>> = []

  if (agtDefinition?.scenario === 'actor_sends_and_receives_ack') {
    const message = await createEdielSupplierAgtOutboundCommand({
      actorUserId: input.actorUserId,
      testRunId: run.id,
      testCaseCode,
      companyId: input.companyId,
    })
    rawEdifact = message.raw_payload ?? null
    const preflight = preflightEdielPayload({
      rawPayload: rawEdifact,
      messageStandard: message.message_standard,
      mimeType: message.mime_type,
      mode: 'send',
    })
    actualFlow = [{
      stepNo: 1,
      action: 'prepared_edifact',
      messageId: message.id,
      ok: preflight.ok,
      family: preflight.family,
      code: preflight.code,
      rawPayloadHash: rawEdifact ? sha256(rawEdifact) : null,
    }]

    if (effectiveEncryption === 'smime' && rawEdifact) {
      const encrypted = await createSmimeEncryptedPayloadReference({
        rawEdifact,
        publicCertificatePem: recordText(certificate, 'publicCertificatePem', 'public_certificate_pem') ?? '',
        filename: message.file_name,
      })
      encryptedPayloadRef = encrypted.encryptedPayloadRef
      actualFlow.push({
        stepNo: 2,
        action: 'prepared_smime_envelope',
        encryptedPayloadRef,
        encryptedPayloadSha256: encrypted.encryptedPayloadSha256,
        encryptedPayloadLength: encrypted.encryptedPayloadLength,
      })
    }
  } else {
    actualFlow = [{
      stepNo: null,
      action: 'waiting_for_inbound_or_existing_runner',
      reason: 'Detta testfall startas av portal/inbound eller befintlig TGT/AGT-runner. Test Center lagrar transportval och expected flow.',
    }]
  }

  let updateResult = await supabaseService
    .from('ediel_test_runs')
    .update({
      raw_edifact: rawEdifact,
      encrypted_payload_ref: encryptedPayloadRef,
      actual_flow: actualFlow,
      environment_type: environmentType,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id)
    .select('*')
    .single()

  if (updateResult.error && ['42703', 'PGRST204', 'PGRST205'].includes(updateResult.error.code ?? '')) {
    updateResult = await supabaseService
      .from('ediel_test_runs')
      .update({
        raw_edifact: rawEdifact,
        encrypted_payload_ref: encryptedPayloadRef,
        actual_flow: actualFlow,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .select('*')
      .single()
  }

  if (updateResult.error) throw updateResult.error

  if (environmentType === 'agt_test') {
    await supabaseService
      .from('ediel_test_run_locks')
      .update({ active_test_run_id: run.id, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId)
      .eq('actor_role', roleCode)
      .eq('message_family', messageFamily)
      .eq('environment_type', environmentType)
      .is('released_at', null)
      .then(({ error }) => {
        if (error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
          throw error
        }
      })
  }

  return updateResult.data
}
