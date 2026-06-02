import { createHash } from 'crypto'
import { createEdielTestRun } from '@/lib/ediel/db'
import { getEdielAgtTestCaseByCode } from '@/lib/ediel/agtRegistry'
import { createEdielSupplierAgtOutboundCommand } from '@/lib/ediel/agtEngine'
import { getEdielTgtTestCaseByCode } from '@/lib/ediel/tgtRegistry'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import { createSmimeEncryptedPayloadReference } from '@/lib/ediel/transport/smime'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

type TestEncryptionMode = 'none' | 'smime'

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

async function resolveRouteProfile(input: {
  companyId: string
  environment: 'test' | 'production'
  messageFamily: string | null
  businessCode: string | null
}) {
  let query = supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('is_enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (input.messageFamily) query = query.eq('message_family', input.messageFamily)
  if (input.businessCode) query = query.or(`business_code.eq.${input.businessCode},message_code.eq.${input.businessCode},business_code.is.null,message_code.is.null`)

  const { data, error } = await query.maybeSingle()
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
  productionLike?: boolean
  encryptionMode?: string | null
}) {
  const suite = normalizeSuite(input.testSuite)
  const roleCode = normalizeRole(input.roleCode)
  const testCaseCode = input.testCaseCode.trim().toUpperCase()
  const environment = input.environment ?? 'test'
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
  const effectiveCertificateId =
    String(routeProfile?.certificate_id ?? '') ||
    String(mailboxSecurity?.certificate_id ?? '') ||
    null
  const certificate = await resolveCertificate(effectiveCertificateId)

  if (effectiveEncryption === 'smime') {
    const certStatus = evaluateCertificateStatus(certificate ?? {})
    if (!certificate || !certStatus.isUsableForSmime) {
      throw new Error(`Testet kan inte startas förrän certifikat/route är komplett: ${certStatus.message}`)
    }
  }

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
    ].join('\n'),
    actorRole: roleCode,
    messageFamily,
    businessCode,
    encryptionMode: effectiveEncryption,
    certificateId: effectiveCertificateId,
    certificateFingerprintSha256: String(certificate?.fingerprint_sha256 ?? certificate?.certificate_fingerprint ?? '') || null,
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
        publicCertificatePem: String(certificate?.public_certificate_pem ?? ''),
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

  const { data, error } = await supabaseService
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

  if (error) throw error
  return data
}
