import { createHash } from 'node:crypto'
import { prepareDuplicate103Response } from '@/lib/ediel/inbound/duplicateResponses'
import { InboundReceptionHeldError, readUnattributedTechnicalIntake } from '@/lib/ediel/inbound/receptions'
import { unpackInboundSmimeIfNeeded } from '@/lib/ediel/transport/smime'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { recoverRetainedSmimeAck } from './retainedSmimeRecovery'
import type { InboundLeaseReceipt } from './edielMailboxPoller.part-1'
import { isDeliveryStatusNotification } from './dsnClassifier'
import { INBOUND_ORIGINAL_ENVIRONMENT_UNVERIFIED, readRetainedInboundEnvironment } from './retainedInboundEnvironment'
import { extractPhysicalEdifactCandidate, IMAP_ORIGINAL_CUSTODY_UNVERIFIED, MULTIPLE_EDIFACT_ORIGINALS, readRetainedImapMime, splitMimeParts } from './edielMailboxPoller.part-1'
import { parseDeliveryStatusReport } from './dsnDisposition'
import { projectDsnTransportCandidates } from './dsnTransportCandidates'
import {recordDsnSourceObservation,type DsnSourceField} from './dsnSourceObservations'
import { resolveTenantForInboundEdiel } from '@/lib/inbound-mail/inboundTenantResolver'
import { matchMeteringPointForInbound, matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundMailTask } from '@/lib/inbound-mail/inboundTaskFactory'
import { applyCanonicalInboundAckStatusUpdate } from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {
  failClosedOutboundMatchForAck,
  verifyInboundAckTransportCorrelation,
} from '@/lib/inbound-mail/inboundAckTransportGuard'
import {
  applySafeInboundStatusUpdate,
  createInboundEdielMessage,
  createParseResult,
  createUnresolvedInboundEdielMessage,
  updateInboundEmailProcessingStatus,
} from '@/lib/inbound-mail/inboundStatusUpdater'
import type { EdielEnvironment } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { parseAiBiTechnicalFile } from '@/lib/ediel/aiListFormat'
import { registerInboundCanonicalMessage } from '@/lib/ediel/core/kernel'

type TestCenterTenantBinding = {
  companyId: string
  customerId: string
}

// Fetch one extra row so a mailbox source is never treated as complete after
// silently processing only a prefix of its physical attachments.
const MAX_PHYSICAL_ATTACHMENTS = 128

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function resolveTrustedTestCenterCompanyId(input: {
  row: Record<string, unknown>
  environment: string | null
  binding?: TestCenterTenantBinding | null
}): string | null {
  const payload = objectValue(input.row.match_payload)
  const hasTestCenterOrigin = payload.source === 'test_center_raw_edifact_import_v1'
  if (!input.binding) {
    if (hasTestCenterOrigin) throw new Error('Test Center-underlaget kan bara köras om från Test Center.')
    return null
  }
  const companyId = text(input.binding.companyId)
  const customerId = text(input.binding.customerId)
  const rowCompanyId = text(input.row.company_id)
  const raw = input.row.raw_edifact_payload
  const matchStatus = text(input.row.match_status)
  const canReprocessEnvelope = (matchStatus === 'test_center_raw_import' && input.row.processing_status === 'received') ||
    (matchStatus === 'matched' && input.row.processing_status === 'processed') ||
    (input.row.processing_status === 'manual_review' &&
      (matchStatus === 'missing' || matchStatus === 'ambiguous' || matchStatus === 'not_checked'))

  if (
    !companyId ||
    !customerId ||
    input.environment !== 'test' ||
    rowCompanyId !== companyId ||
    input.row.mailbox_id !== null ||
    input.row.raw_email != null ||
    input.row.body_text != null ||
    typeof raw !== 'string' ||
    payload.sha256 !== createHash('sha256').update(raw).digest('hex') ||
    !hasTestCenterOrigin ||
    text(payload.test_center_customer_id) !== customerId ||
    payload.external_side_effects_allowed !== false
  ) {
    throw new Error('Test Center tenantbindning kunde inte verifieras mot isolerad inbound-envelope.')
  }

  if (!canReprocessEnvelope) {
    throw new Error('Test Center-underlaget väntar på granskning och kan inte köras om.')
  }

  return companyId
}

/**
 * Shared-mailbox mail is stored before its tenant is known (company_id NULL).
 * Once the tenant is verified, attribute the mail to it before any
 * ediel_messages row is created from it: the database only links a message to
 * mail of the same company. Mail already owned by another tenant is a
 * conflict and stops processing instead of being re-attributed.
 */
async function attributeInboundEmailToTenant(input: { inboundEmailMessageId: string; companyId: string }) {
  // Deliberately cross-tenant: the row is still unattributed (company_id NULL)
  // and the read must see another tenant's ownership to refuse it.
  const db = tenantDb(input.companyId).unscoped()
  const { error } = await db.from('inbound_email_messages')
    .update({ company_id: input.companyId, updated_at: new Date().toISOString() })
    .eq('id', input.inboundEmailMessageId)
    .is('company_id', null)
  if (error) throw error
  const { data, error: readError } = await db.from('inbound_email_messages')
    .select('company_id')
    .eq('id', input.inboundEmailMessageId)
    .maybeSingle()
  if (readError) throw readError
  if (!data || (data as { company_id?: unknown }).company_id !== input.companyId) {
    throw new Error('inbound_email_tenant_attribution_conflict')
  }
}

async function readVerifiedSmimeAcknowledgement(row: Record<string, unknown>, raw: string) {
  // All ASCII bytes survive the mailbox text projection unchanged. For any
  // other encoding, keep the original transport review until byte proof exists.
  if (/[^\x00-\x7f]/u.test(raw) || createHash('sha256').update(raw).digest('hex') !== row.raw_message_sha256) return null
  const companyId = text(row.company_id)
  const mailbox = objectValue(row.ediel_mailboxes)
  const environment = row.environment
  if (!companyId || (environment !== 'test' && environment !== 'production') ||
      mailbox.id !== row.mailbox_id || mailbox.environment !== environment ||
      (mailbox.company_id != null && mailbox.company_id !== companyId) ||
      typeof row.raw_edifact_payload !== 'string') return null

  const verified = await unpackInboundSmimeIfNeeded({ rawEmail: raw, companyId, environment }).catch(() => null)
  if (!verified?.isolatedOuterTransferIssues || verified.securityStatus !== 'decrypted' ||
      verified.matchedCompanyId !== companyId || !verified.matchedCertificateId || !verified.recipientSerialNumber ||
      !verified.decryptedText || isDeliveryStatusNotification(verified.decryptedText)) return null

  const parts = splitMimeParts(verified.decryptedText)
  if (parts.physicalEdifactCandidateCount !== 1 || !parts.rawEdifactPayload ||
      parts.rawEdifactPayload !== row.raw_edifact_payload ||
      (parts.bodyText ?? verified.decryptedText) !== row.body_text) return null
  const parsed = parseInboundEmailContent({
    rawEmail: verified.decryptedText,
    bodyText: parts.bodyText,
    attachmentText: parts.rawEdifactPayload,
  })
  if (parsed?.messageFamily !== 'CONTRL' && parsed?.messageFamily !== 'APERAK' && parsed?.messageFamily !== 'UTILTS_ERR') return null
  return parsed
}

export async function processInboundEmailMessage(input: {
  inboundEmailMessageId: string
  actorUserId?: string | null
  testCenterTenantBinding?: TestCenterTenantBinding | null
  expectedEnvironment?: EdielEnvironment
  lease?: InboundLeaseReceipt
}): Promise<{ status: string; companyId: string | null; parseResultId: string | null; ackOriginal?: { edielMessageId: string; mailboxId: string; environment: string } }> {
  const { data, error } = await supabaseService
    .from('inbound_email_messages')
    .select('*, ediel_mailboxes(*)')
    .eq('id', input.inboundEmailMessageId)
    .maybeSingle()

  if (error) throw error
  const row = data as Record<string, unknown> | null
  if (!row) throw new Error('Inbound email hittades inte.')

  const mailbox = row.ediel_mailboxes as {
    id?: string | null
    company_id?: string | null
    environment?: string | null
    mailbox?: string | null
    email_address?: string | null
    address?: string | null
  } | null
  const environment = readRetainedInboundEnvironment(row)
  // Use the same retained envelope and mailbox values that drive processing.
  // A queue claim against a legacy default is not evidence of its environment.
  if (input.expectedEnvironment && (row.environment !== input.expectedEnvironment || environment !== input.expectedEnvironment)) {
    throw new Error('inbound_processing_environment_mismatch')
  }
  const trustedExistingCompanyId = resolveTrustedTestCenterCompanyId({
    row,
    environment: text(row.environment),
    binding: input.testCenterTenantBinding,
  })

  // A born technical-only original never acquires business authority when a
  // later registry lookup would resolve its legal party. Read before matchers.
  const protectedIntake = await readUnattributedTechnicalIntake({
    inboundEmailMessageId: input.inboundEmailMessageId,
    actorUserId: input.actorUserId ?? null,
  })
  if (protectedIntake) {
    if (trustedExistingCompanyId) throw new Error('Test Center-underlaget väntar på granskning och kan inte köras om.')
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: null,
      status: 'manual_review',
      matchStatus: 'technical_only_unattributed',
      matchPayload: { sourceMessageId: protectedIntake.sourceMessageId, authorizesBusinessEffect: false },
    })
    return { status: 'manual_review', companyId: null, parseResultId: protectedIntake.parseResultId }
  }

  const quarantineDsn = async (raw: string,sourceField:DsnSourceField,attachmentId?:string|null) => {
    // The returned original cannot establish the report's tenant or authorize
    // business processing. Preserve mailbox attribution until attempt matching
    // and recipient verification can be performed by a transport handler.
    const companyId = text(row.company_id)
    const deliveryStatusReport = parseDeliveryStatusReport(raw)
    const transportCandidates = await projectDsnTransportCandidates(row, deliveryStatusReport)
    let sourceObservation:Awaited<ReturnType<typeof recordDsnSourceObservation>>|null=null
    let observationStatus='not_qualified'
    if(companyId&&input.actorUserId&&transportCandidates.status==='candidate_found'){
      try{
        sourceObservation=await recordDsnSourceObservation({companyId,actorUserId:input.actorUserId,
          inboundEmailMessageId:input.inboundEmailMessageId,sourceField,attachmentId,rawSource:raw})
        observationStatus=sourceObservation?'source_matched_unverified':'not_qualified'
      }catch{observationStatus='source_observation_held'}
    }
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: 'dsn_transport_review',
      matchPayload: { classification: 'delivery_status_notification', transportCorrelation: 'unverified',
        deliveryStatusReport, transportCandidates, sourceObservation, observationStatus },
      errorMessage: 'Leveransrapport kräver verifierad korrelation till transportförsök och mottagare.',
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  let verifiedAcknowledgement: Awaited<ReturnType<typeof readVerifiedSmimeAcknowledgement>> = null
  const rawEmail = row.raw_email
  const retainedImapMime = readRetainedImapMime(row)
  if (retainedImapMime.kind === 'unverified') {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: IMAP_ORIGINAL_CUSTODY_UNVERIFIED,
      errorMessage: 'Det sparade mejlet kunde inte verifieras mot det mottagna IMAP-originalet.',
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  const holdMultipleEdifactOriginals = async () => {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: MULTIPLE_EDIFACT_ORIGINALS,
      errorMessage: 'Flera EDIFACT-original finns i samma mejl. Granska originalet och be avsändaren skicka varje utbyte separat.',
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  if (typeof rawEmail === 'string' && isDeliveryStatusNotification(rawEmail)) {
    verifiedAcknowledgement = await readVerifiedSmimeAcknowledgement(row, rawEmail)
    if (!verifiedAcknowledgement) return quarantineDsn(rawEmail,'raw_email')
  }
  if (retainedImapMime.kind === 'verified' && retainedImapMime.mime.physicalEdifactCandidateCount > 1) {
    return holdMultipleEdifactOriginals()
  }
  if (typeof row.body_text === 'string' && isDeliveryStatusNotification(row.body_text)) {
    return quarantineDsn(row.body_text,'body_text')
  }

  const attachmentResult = await supabaseService
    .from('inbound_email_attachments')
    .select('id,raw_text,is_edifact_candidate,filename,mime_type,metadata')
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .order('is_edifact_candidate', { ascending: false })
    .limit(MAX_PHYSICAL_ATTACHMENTS + 1)

  if (attachmentResult.error) throw attachmentResult.error
  const retainedAttachments = (attachmentResult.data ?? []) as Array<Record<string, unknown>>
  const attachments = retainedAttachments.filter(attachment => objectValue(attachment.metadata).retainedSmimeRecovery !== true)
  const hasProtectedProjection = retainedAttachments.length !== attachments.length
  if (trustedExistingCompanyId && retainedAttachments.length > 0) {
    throw new Error('Test Center-underlaget innehåller oväntade fysiska bilagor.')
  }
  if (retainedAttachments.length > MAX_PHYSICAL_ATTACHMENTS) {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({ inboundEmailMessageId: input.inboundEmailMessageId, companyId,
      status: 'manual_review', matchStatus: 'physical_attachment_limit_exceeded',
      errorMessage: 'Mail innehåller fler fysiska bilagor än den kompletta mottagningsgränsen.' })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  for (const attachment of attachments) {
    const raw=attachment.raw_text
    if (typeof raw==='string' && isDeliveryStatusNotification(raw)) return quarantineDsn(raw,'attachment',text(attachment.id))
  }
  // Technical lists have their own positional format, legal storage decision
  // and source-bound reconciliation. They never enter the EDIFACT/ACK engine.
  const aiCandidates = [...new Map([
    { raw: row.body_text, filename: null },
    { raw: row.raw_edifact_payload, filename: null },
    ...attachments.map(a => ({ raw: a.raw_text, filename: a.filename })),
  ].filter((candidate): candidate is { raw: string; filename: unknown } => typeof candidate.raw === 'string' && /^\uFEFF?(AI|BI);/.test(candidate.raw))
    .map(candidate => [candidate.raw, candidate] as const)).values()]
  if (!verifiedAcknowledgement && aiCandidates.length) {
    if (trustedExistingCompanyId) throw new Error('Test Center-underlaget är inte ett verifierbart UTILTS E66-original.')
    if (aiCandidates.length !== 1) throw new Error('ai_bi_reconciliation_physical_source_ambiguous')
    const companyId = text(row.company_id), actorUserId = text(input.actorUserId)
    if (!companyId || !actorUserId) throw new Error('ai_bi_reconciliation_verified_execution_context_required')
    const source = aiCandidates[0], technical = parseAiBiTechnicalFile(source.raw)
    if (row.environment !== 'test' && row.environment !== 'production') throw new Error('ai_bi_reconciliation_environment_required')
    const message = await registerInboundCanonicalMessage({ actorUserId, input: {
      actorUserId, companyId, direction: 'inbound', messageStandard: 'ai_list', messageFamily: 'AI_LIST',
      messageCode: technical.header.listType, messageVersion: technical.header.version, environment: row.environment,
      testFlag: row.environment === 'test' ? 1 : 0, status: 'received', transportType: 'imap',
      mailbox: text(row.mailbox_id), mailboxMessageId: input.inboundEmailMessageId,
      senderEdielId: technical.header.networkEdielId, receiverEdielId: technical.header.supplierEdielId,
      senderName: technical.header.networkName, receiverName: technical.header.supplierName,
      senderEmail: text(row.from_address), receiverEmail: text(row.to_address),
      rawPayload: source.raw, fileName: text(source.filename), mimeType: 'text/csv',
      parsedPayload: { importedVia: 'imap', inboundEmailMessageId: input.inboundEmailMessageId },
      requiresContrl: false, requiresAperak: false, contrlStatus: 'not_required', aperakStatus: 'not_required', utiltsErrStatus: 'not_required',
    } })
    await updateInboundEmailProcessingStatus({ inboundEmailMessageId: input.inboundEmailMessageId, companyId,
      status: 'processed', matchStatus: 'ai_bi_reconciled', matchPayload: { classification: 'ai_bi_reconciliation', sourceMessageId: message.id } })
    return { status: 'processed', companyId, parseResultId: null }
  }
  // A stored projection may mirror a physical part, but two retained parts
  // are distinct originals even when their decoded contents are identical.
  const attachmentOriginals = attachments.flatMap((attachment) => {
    const metadata = objectValue(attachment.metadata)
    const isSmimeProjection = attachment.mime_type === 'application/pkcs7-mime' &&
      attachment.filename === 'smime.p7m' && metadata.decryptedPayloadStoredInBodyText === true
    if (isSmimeProjection) return []
    const original = extractPhysicalEdifactCandidate(text(attachment.raw_text))
    return original ? [original] : []
  })
  const copies = new Set(attachmentOriginals)
  const storedProjection = extractPhysicalEdifactCandidate(text(row.raw_edifact_payload))
  if (storedProjection) copies.add(storedProjection)

  // The actual MIME is available independently of the attachment projection.
  // This also holds a legacy mail whose first stored projection hid siblings.
  const bodyText = typeof row.body_text === 'string' ? row.body_text : null
  const retainedMime = retainedImapMime.kind === 'verified'
    ? retainedImapMime.mime
    : splitMimeParts(typeof rawEmail === 'string' ? rawEmail : null)
  const retainedBody = bodyText !== rawEmail ? splitMimeParts(bodyText) : retainedMime
  for (const projection of [retainedMime.rawEdifactPayload, retainedBody.rawEdifactPayload]) {
    const original = extractPhysicalEdifactCandidate(projection)
    if (original) copies.add(original)
  }
  if (row.match_status === MULTIPLE_EDIFACT_ORIGINALS || attachmentOriginals.length > 1 ||
      (verifiedAcknowledgement && retainedMime.physicalEdifactCandidateCount > 0) ||
      copies.size > 1 || retainedMime.physicalEdifactCandidateCount > 1 || retainedBody.physicalEdifactCandidateCount > 1) {
    return holdMultipleEdifactOriginals()
  }
  const physicalParsed = verifiedAcknowledgement ?? parseInboundEmailContent({
    rawEmail: typeof rawEmail === 'string' ? rawEmail : null,
    bodyText,
    attachmentText: copies.values().next().value,
  })
  const recovery = physicalParsed || trustedExistingCompanyId ? null : await recoverRetainedSmimeAck({
    row, actorUserId: input.actorUserId, lease: input.lease, hasProtectedProjection,
  })
  const parsed = recovery?.parsed ?? physicalParsed

  if (trustedExistingCompanyId && (parsed?.messageFamily !== 'UTILTS' || parsed.messageCode?.toUpperCase() !== 'E66')) {
    throw new Error('Test Center-underlaget är inte ett verifierbart UTILTS E66-original.')
  }

  if (!parsed) {
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: typeof row.company_id === 'string' ? row.company_id : null,
      status: 'manual_review',
      matchStatus: 'missing_payload',
      errorMessage: 'Mail saknar EDIFACT payload.',
    })
    await createInboundMailTask({
      companyId: typeof row.company_id === 'string' ? row.company_id : null,
      title: 'Inkommande Ediel-mail saknar läsbar EDIFACT payload',
      description: 'Kontrollera råmail och bilagor manuellt.',
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId: typeof row.company_id === 'string' ? row.company_id : null, parseResultId: null }
  }

  if (!environment) {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId, companyId, status: 'manual_review',
      matchStatus: INBOUND_ORIGINAL_ENVIRONMENT_UNVERIFIED,
      errorMessage: 'Meddelandets Ediel-miljö kunde inte verifieras. Kontrollera det sparade originalet och brevlådan.',
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }

  const mailboxId =
    typeof row.ediel_mailbox_id === 'string'
      ? row.ediel_mailbox_id
      : typeof row.mailbox_id === 'string'
        ? row.mailbox_id
        : mailbox?.id ?? null
  const mailboxAddress = mailbox?.mailbox ?? mailbox?.email_address ?? mailbox?.address ?? null

  const tenant = await resolveTenantForInboundEdiel({
    existingCompanyId: trustedExistingCompanyId,
    mailboxCompanyId: typeof row.company_id === 'string' ? row.company_id : mailbox?.company_id ?? null,
    mailboxId,
    mailbox: mailboxAddress,
    environment,
    parsed,
  })

  if (trustedExistingCompanyId && (tenant.status !== 'resolved' || tenant.companyId !== trustedExistingCompanyId)) {
    throw new Error('Test Center tenantbindning kunde inte verifieras efter parsning.')
  }

  if (recovery && (tenant.status !== 'resolved' || tenant.companyId !== recovery.scope.p_company_id)) {
    throw new Error('retained_smime_projection_tenant_mismatch')
  }

  const parseResultId = await createParseResult({
    inboundEmailMessageId: input.inboundEmailMessageId,
    companyId: tenant.companyId,
    parsed,
    tenantResolution: tenant.shared,
    recoveredSmime: Boolean(recovery),
  })

  if (tenant.status !== 'resolved' || !tenant.companyId) {
    const unresolvedTenantStatus = tenant.status === 'ambiguous' ? 'ambiguous' : 'unassigned'
    await createUnresolvedInboundEdielMessage({
      companyId: tenant.companyId,
      actorUserId: input.actorUserId ?? null,
      inboundEmailMessageId: input.inboundEmailMessageId,
      parseResultId,
      parsed,
      tenantStatus: unresolvedTenantStatus,
      reasons: tenant.reasons,
      candidates: tenant.candidates,
      environment,
      tenantResolution: tenant.shared,
    })
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: tenant.companyId,
      status: 'manual_review',
      matchStatus: tenant.status,
      matchPayload: { tenant, parsed },
    })
    await createInboundMailTask({
      companyId: tenant.companyId,
      title: 'Inkommande Ediel-mail saknar säker tenant-match',
      description: tenant.reasons.join('\n') || 'Systemet kunde inte matcha company_id säkert.',
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId, tenant, parsed },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId: null, parseResultId }
  }

  await attributeInboundEmailToTenant({ inboundEmailMessageId: input.inboundEmailMessageId, companyId: tenant.companyId })

  const outboundMatch = await matchOutboundRequestForInbound({
    companyId: tenant.companyId,
    environment,
    parsed,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parseResultId,
  })
  const meteringPointMatch = await matchMeteringPointForInbound({
    companyId: tenant.companyId,
    parsed,
    inboundEmailMessageId: input.inboundEmailMessageId,
    parseResultId,
  })

  if (parsed.messageFamily === 'CONTRL' || parsed.messageFamily === 'APERAK') {
    const transportGuard = await verifyInboundAckTransportCorrelation({
      companyId: tenant.companyId,
      environment,
      parsed,
      outboundMatch,
    })
    const guardedOutboundMatch = failClosedOutboundMatchForAck({ outboundMatch, guard: transportGuard })

    const ackResult = await applyCanonicalInboundAckStatusUpdate({
      companyId: tenant.companyId,
      environment,
      parsed,
      outboundMatch: guardedOutboundMatch,
      meteringPointMatch,
      inboundEmailMessageId: input.inboundEmailMessageId,
      parseResultId,
      outboundMessageId: transportGuard.outboundMessageId,
      receivedAt: typeof row.received_at === 'string' ? row.received_at : null,
      actorUserId: recovery?.actorUserId ?? input.actorUserId ?? null,
      tenantResolution: tenant.shared,
      recovery,
    })

    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: tenant.companyId,
      status: ackResult.status,
      matchStatus: ackResult.matchStatus,
      matchPayload: recovery
        ? { retainedSmimeRecovery: true, inboundEdielMessageId: ackResult.inboundEdielMessageId, parseResultId }
        : { tenant, outboundMatch: guardedOutboundMatch, transportGuard, meteringPointMatch, parsed },
    })

    return {
      status: ackResult.status, companyId: tenant.companyId, parseResultId,
      ...(ackResult.inboundEdielMessageId && mailboxId && environment
        ? { ackOriginal: { edielMessageId: ackResult.inboundEdielMessageId, mailboxId, environment } }
        : {}),
    }
  }

  const safeMatch = outboundMatch.status === 'matched'
  const matchStatus = safeMatch ? 'matched' : outboundMatch.status

  try {
    if (safeMatch) {
      await applySafeInboundStatusUpdate({
        companyId: tenant.companyId,
        environment,
        parsed,
        outboundMatch,
        meteringPointMatch,
        inboundEmailMessageId: input.inboundEmailMessageId,
        parseResultId,
        actorUserId: input.actorUserId ?? null,
        tenantResolution: tenant.shared,
      })
    } else {
      const edielMessageId = await createInboundEdielMessage({
        actorUserId: input.actorUserId,
        companyId: tenant.companyId,
        environment,
        inboundEmailMessageId: input.inboundEmailMessageId,
        parseResultId,
        parsed,
        outboundMatch,
        meteringPointMatch,
        tenantResolution: tenant.shared,
      })
      // Same contract as the matched path (applySafeInboundStatusUpdate): an
      // unpersisted original fails the job so it is retried, instead of ending
      // as a manual-matching review that hides the database error.
      if (!edielMessageId) throw new Error('ediel_inbound_original_persistence_required')

      await createInboundMailTask({
        companyId: tenant.companyId,
        title: 'Inkommande Ediel-mail kräver manuell matchning',
        description: outboundMatch.reasons.join('\n'),
        metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId, outboundMatch, meteringPointMatch, parsed },
        actorUserId: input.actorUserId ?? null,
      })
    }
  } catch (error) {
    if (!(error instanceof InboundReceptionHeldError)) throw error
    const receipt = error.reception
    let protocolResponseFailureCode: string | null = input.actorUserId ? null : 'current_actor_required'
    if (input.actorUserId && receipt.classification === 'protocol_duplicate') {
      try {
        await prepareDuplicate103Response({ companyId: tenant.companyId, sourceMessageId: receipt.sourceMessageId, inboundEmailMessageId: input.inboundEmailMessageId, actorUserId: input.actorUserId })
        return { status: 'protocol_response_prepared', companyId: tenant.companyId, parseResultId }
      } catch (preparationError) {
        const message = preparationError instanceof Error ? preparationError.message : ''
        protocolResponseFailureCode = message.match(/^[A-Za-z][A-Za-z0-9_]+(?=:|\s|$)/)?.[0] ?? 'duplicate_response_preparation_failed'
        // Current authority, native source or strict wire hold preserves the
        // existing held-task path. No draft/intention is committed on failure.
      }
    }
    // The native receipt/request and NEW mail hold already committed. The old
    // canonical original, first validation and ACK are deliberately untouched.
    const matchedCustomer = outboundMatch.candidates?.[0]?.customer_id ?? meteringPointMatch.candidates?.[0]?.customer_id
    await createInboundMailTask({
      companyId: tenant.companyId,
      customerId: typeof matchedCustomer === 'string' ? matchedCustomer : null,
      title: 'Ny Ediel-mottagning väntar på källbelagt dubblettsvar',
      description: receipt.reason,
      taskType: 'ediel_duplicate_response_held',
      metadata: { sourceId: receipt.responseRequestId, reception: receipt, protocolResponseFailureCode, inboundEmailMessageId: input.inboundEmailMessageId, parseResultId },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId: tenant.companyId, parseResultId }
  }

  const testCenterOrigin = trustedExistingCompanyId ? objectValue(row.match_payload) : null
  // Keep the authenticated intake identity when recording the operational match.
  const matchPayload = {
    ...(testCenterOrigin ? {
      source: testCenterOrigin.source,
      test_center_customer_id: testCenterOrigin.test_center_customer_id,
      sha256: testCenterOrigin.sha256,
      actor_user_id: testCenterOrigin.actor_user_id,
      filename: testCenterOrigin.filename,
      external_side_effects_allowed: false,
    } : {}),
    tenant,
    outboundMatch,
    meteringPointMatch,
    parsed,
  }

  await updateInboundEmailProcessingStatus({
    inboundEmailMessageId: input.inboundEmailMessageId,
    companyId: tenant.companyId,
    status: safeMatch ? 'processed' : 'manual_review',
    matchStatus,
    matchPayload,
  })

  return { status: safeMatch ? 'processed' : 'manual_review', companyId: tenant.companyId, parseResultId }
}
