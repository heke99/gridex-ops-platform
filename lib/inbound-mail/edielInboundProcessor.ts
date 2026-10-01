import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { isDeliveryStatusNotification } from './dsnClassifier'
import { parseDeliveryStatusReport } from './dsnDisposition'
import { projectDsnTransportCandidates } from './dsnTransportCandidates'
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
import { supabaseService } from '@/lib/supabase/service'
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
  if (!input.binding) return null
  const companyId = text(input.binding.companyId)
  const customerId = text(input.binding.customerId)
  const rowCompanyId = text(input.row.company_id)
  const payload = objectValue(input.row.match_payload)

  if (
    !companyId ||
    !customerId ||
    input.environment !== 'test' ||
    rowCompanyId !== companyId ||
    text(input.row.match_status) !== 'test_center_raw_import' ||
    text(payload.source) !== 'test_center_raw_edifact_import_v1' ||
    text(payload.test_center_customer_id) !== customerId ||
    payload.external_side_effects_allowed !== false
  ) {
    throw new Error('Test Center tenantbindning kunde inte verifieras mot isolerad inbound-envelope.')
  }

  return companyId
}

export async function processInboundEmailMessage(input: {
  inboundEmailMessageId: string
  actorUserId?: string | null
  testCenterTenantBinding?: TestCenterTenantBinding | null
}): Promise<{ status: string; companyId: string | null; parseResultId: string | null }> {
  const { data, error } = await supabaseService
    .from('inbound_email_messages')
    .select('*, ediel_mailboxes(*)')
    .eq('id', input.inboundEmailMessageId)
    .maybeSingle()

  if (error) throw error
  const row = data as Record<string, unknown> | null
  if (!row) throw new Error('Inbound email hittades inte.')

  const quarantineDsn = async (raw: string | null) => {
    // The returned original cannot establish the report's tenant or authorize
    // business processing. Preserve mailbox attribution until attempt matching
    // and recipient verification can be performed by a transport handler.
    const companyId = text(row.company_id)
    const deliveryStatusReport = parseDeliveryStatusReport(raw)
    const transportCandidates = await projectDsnTransportCandidates(row, deliveryStatusReport)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: 'dsn_transport_review',
      matchPayload: { classification: 'delivery_status_notification', transportCorrelation: 'unverified',
        deliveryStatusReport, transportCandidates },
      errorMessage: 'Leveransrapport kräver verifierad korrelation till transportförsök och mottagare.',
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  for (const raw of [text(row.raw_email), text(row.body_text)]) {
    if (isDeliveryStatusNotification(raw)) return quarantineDsn(raw)
  }

  const attachmentResult = await supabaseService
    .from('inbound_email_attachments')
    .select('raw_text,is_edifact_candidate,filename')
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .order('is_edifact_candidate', { ascending: false })
    .limit(MAX_PHYSICAL_ATTACHMENTS + 1)

  if (attachmentResult.error) throw attachmentResult.error
  const attachments = (attachmentResult.data ?? []) as Array<Record<string, unknown>>
  if (attachments.length > MAX_PHYSICAL_ATTACHMENTS) {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({ inboundEmailMessageId: input.inboundEmailMessageId, companyId,
      status: 'manual_review', matchStatus: 'physical_attachment_limit_exceeded',
      errorMessage: 'Mail innehåller fler fysiska bilagor än den kompletta mottagningsgränsen.' })
    return { status: 'manual_review', companyId, parseResultId: null }
  }
  for (const attachment of attachments) {
    const raw = text(attachment.raw_text)
    if (isDeliveryStatusNotification(raw)) return quarantineDsn(raw)
  }
  // Technical lists have their own positional format, legal storage decision
  // and source-bound reconciliation. They never enter the EDIFACT/ACK engine.
  const aiCandidates = [...new Map([
    { raw: row.body_text, filename: null },
    { raw: row.raw_edifact_payload, filename: null },
    ...attachments.map(a => ({ raw: a.raw_text, filename: a.filename })),
  ].filter((candidate): candidate is { raw: string; filename: unknown } => typeof candidate.raw === 'string' && /^\uFEFF?(AI|BI);/.test(candidate.raw))
    .map(candidate => [candidate.raw, candidate] as const)).values()]
  if (aiCandidates.length) {
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
  const attachmentText = [
    typeof row.raw_edifact_payload === 'string' ? row.raw_edifact_payload : null,
    ...attachments
      .map((attachment) => typeof attachment.raw_text === 'string' ? attachment.raw_text : null),
  ].filter((value): value is string => Boolean(value)).join('\n\n')

  const parsed = parseInboundEmailContent({
    rawEmail: typeof row.raw_email === 'string' ? row.raw_email : null,
    bodyText: typeof row.body_text === 'string' ? row.body_text : null,
    attachmentText,
  })

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

  const mailbox = row.ediel_mailboxes as {
    id?: string | null
    company_id?: string | null
    environment?: string | null
    mailbox?: string | null
    email_address?: string | null
    address?: string | null
  } | null
  const mailboxId =
    typeof row.ediel_mailbox_id === 'string'
      ? row.ediel_mailbox_id
      : typeof row.mailbox_id === 'string'
        ? row.mailbox_id
        : mailbox?.id ?? null
  const mailboxAddress = mailbox?.mailbox ?? mailbox?.email_address ?? mailbox?.address ?? null
  const environment =
    mailbox?.environment ??
    (typeof row.environment === 'string' ? row.environment : null) ??
    (typeof row.mailbox_environment === 'string' ? row.mailbox_environment : null)
  const trustedExistingCompanyId = resolveTrustedTestCenterCompanyId({
    row,
    environment,
    binding: input.testCenterTenantBinding,
  })

  const tenant = await resolveTenantForInboundEdiel({
    existingCompanyId: trustedExistingCompanyId,
    mailboxCompanyId: typeof row.company_id === 'string' ? row.company_id : mailbox?.company_id ?? null,
    mailboxId,
    mailbox: mailboxAddress,
    environment,
    parsed,
  })

  const parseResultId = await createParseResult({
    inboundEmailMessageId: input.inboundEmailMessageId,
    companyId: tenant.companyId,
    parsed,
    tenantResolution: tenant.shared,
  })

  if (tenant.status !== 'resolved' || !tenant.companyId) {
    const unresolvedTenantStatus = tenant.status === 'ambiguous' ? 'ambiguous' : 'unassigned'
    await createUnresolvedInboundEdielMessage({
      companyId: tenant.companyId,
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

  const outboundMatch = await matchOutboundRequestForInbound({
    companyId: tenant.companyId,
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
      actorUserId: input.actorUserId ?? null,
      tenantResolution: tenant.shared,
    })

    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: tenant.companyId,
      status: ackResult.status,
      matchStatus: ackResult.matchStatus,
      matchPayload: { tenant, outboundMatch: guardedOutboundMatch, transportGuard, meteringPointMatch, parsed },
    })

    return { status: ackResult.status, companyId: tenant.companyId, parseResultId }
  }

  const safeMatch = outboundMatch.status === 'matched'
  const matchStatus = safeMatch ? 'matched' : outboundMatch.status

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
    await createInboundEdielMessage({
      companyId: tenant.companyId,
      environment,
      inboundEmailMessageId: input.inboundEmailMessageId,
      parseResultId,
      parsed,
      outboundMatch,
      meteringPointMatch,
      tenantResolution: tenant.shared,
    })

    await createInboundMailTask({
      companyId: tenant.companyId,
      title: 'Inkommande Ediel-mail kräver manuell matchning',
      description: outboundMatch.reasons.join('\n'),
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, parseResultId, outboundMatch, meteringPointMatch, parsed },
      actorUserId: input.actorUserId ?? null,
    })
  }

  await updateInboundEmailProcessingStatus({
    inboundEmailMessageId: input.inboundEmailMessageId,
    companyId: tenant.companyId,
    status: safeMatch ? 'processed' : 'manual_review',
    matchStatus,
    matchPayload: { tenant, outboundMatch, meteringPointMatch, parsed },
  })

  return { status: safeMatch ? 'processed' : 'manual_review', companyId: tenant.companyId, parseResultId }
}
