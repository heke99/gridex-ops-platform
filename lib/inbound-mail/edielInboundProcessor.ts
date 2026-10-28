import { prepareDuplicate103Response } from '@/lib/ediel/inbound/duplicateResponses'
import { InboundReceptionHeldError, readUnattributedTechnicalIntake } from '@/lib/ediel/inbound/receptions'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { selectInboundEdifactInterchange, strictEdifactPayload, unbTestIndicator } from '@/lib/inbound-mail/inboundEdifactSources'
import { isDeliveryStatusNotification } from './dsnClassifier'
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

/**
 * Shared-mailbox mail is stored before its tenant is known (company_id NULL).
 * Once the tenant is verified, attribute the mail to it before any
 * ediel_messages row is created from it: the database only links a message to
 * mail of the same company. Mail already owned by another tenant is a
 * conflict and stops processing instead of being re-attributed.
 *
 * Two mails carrying the same interchange (sender + UNB 0020, or sender +
 * UNH 0062 + document reference) cannot both belong to one tenant: the unique
 * indexes ux_inbound_email_messages_company_sender_interchange/_tx_external
 * refuse the second attribution with 23505. That refusal is a duplicate
 * delivery, not a transient error (J3-11): the earlier mail is returned.
 */
async function attributeInboundEmailToTenant(input: { inboundEmailMessageId: string; companyId: string; row: Record<string, unknown> }):
  Promise<{ duplicateOf: { id: string; samePayload: boolean } | null }> {
  const { error } = await supabaseService.from('inbound_email_messages')
    .update({ company_id: input.companyId, updated_at: new Date().toISOString() })
    .eq('id', input.inboundEmailMessageId)
    .is('company_id', null)
  if (error) {
    if ((error as { code?: unknown }).code !== '23505') throw error
    const duplicateOf = await findAttributedTwin(input)
    if (!duplicateOf) throw error
    return { duplicateOf }
  }
  const { data, error: readError } = await supabaseService.from('inbound_email_messages')
    .select('company_id')
    .eq('id', input.inboundEmailMessageId)
    .maybeSingle()
  if (readError) throw readError
  if (!data || (data as { company_id?: unknown }).company_id !== input.companyId) {
    throw new Error('inbound_email_tenant_attribution_conflict')
  }
  return { duplicateOf: null }
}

/** The tenant's earlier mail holding the same interchange identity as this one (the stored reception facts). */
async function findAttributedTwin(input: { inboundEmailMessageId: string; companyId: string; row: Record<string, unknown> }) {
  const environment = text(input.row.environment), sender = text(input.row.sender_ediel_id)
  if (!environment || !sender) return null
  const keys: Array<Record<string, string>> = []
  const interchange = text(input.row.interchange_reference)
  if (interchange) keys.push({ interchange_reference: interchange })
  const transaction = text(input.row.transaction_reference), external = text(input.row.external_reference)
  if (transaction && external) keys.push({ transaction_reference: transaction, external_reference: external })
  for (const key of keys) {
    let query = supabaseService.from('inbound_email_messages')
      .select('id,raw_edifact_payload')
      .eq('company_id', input.companyId)
      .eq('environment', environment)
      .eq('sender_ediel_id', sender)
      .neq('id', input.inboundEmailMessageId)
    for (const [column, value] of Object.entries(key)) query = query.eq(column, value)
    const { data, error } = await query.limit(1)
    if (error) throw error
    const twin = (data ?? [])[0] as { id?: unknown; raw_edifact_payload?: unknown } | undefined
    if (typeof twin?.id === 'string') return { id: twin.id, samePayload: twin.raw_edifact_payload === input.row.raw_edifact_payload }
  }
  return null
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

  // A born technical-only original never acquires business authority when a
  // later registry lookup would resolve its legal party. Read before matchers.
  const protectedIntake = await readUnattributedTechnicalIntake({
    inboundEmailMessageId: input.inboundEmailMessageId,
    actorUserId: input.actorUserId ?? null,
  })
  if (protectedIntake) {
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
  for (const sourceField of ['raw_email','body_text'] as const) {
    const raw=row[sourceField]
    if (typeof raw==='string' && isDeliveryStatusNotification(raw)) return quarantineDsn(raw,sourceField)
  }

  const attachmentResult = await supabaseService
    .from('inbound_email_attachments')
    .select('id,raw_text,is_edifact_candidate,filename,mime_type')
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
  // Each physical source is framed on its own (J3-01/J3-02). raw_edifact_payload
  // is normally extracted from the same attachment; deduplicating the framed
  // payloads keeps one copy even when the attachment carries a trailing newline
  // or BOM, and two distinct interchanges are never merged into one payload.
  const selection = selectInboundEdifactInterchange([
    { text: row.raw_edifact_payload },
    ...attachments.map((attachment) => ({ text: attachment.raw_text, filename: attachment.filename, mimeType: attachment.mime_type })),
  ])
  if (selection.kind === 'multiple') {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: 'multiple_interchanges',
      matchPayload: { interchangeCount: selection.interchangeCount, interchangeReferences: selection.interchangeReferences, authorizesBusinessEffect: false },
      errorMessage: `Mailet innehåller ${selection.interchangeCount} EDIFACT-interchange; varje interchange ska komma i ett eget mail. Inget har tillämpats eller kvitterats.`,
    })
    await createInboundMailTask({
      companyId,
      title: 'Inkommande Ediel-mail innehåller flera interchange',
      description: `Interchange-referenser: ${selection.interchangeReferences.map((reference) => reference ?? 'okänd').join(', ')}. Be avsändaren skicka en fil per mail eller hantera filerna manuellt.`,
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, interchangeReferences: selection.interchangeReferences },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }

  let parsed: ReturnType<typeof parseInboundEmailContent>
  try {
    // Body and raw mail are fallbacks for a payload reception could not
    // extract; they are framed strictly too (base64 or prose is no UNA/UNB).
    parsed = parseInboundEmailContent({
      rawEmail: strictEdifactPayload(row.raw_email),
      bodyText: strictEdifactPayload(row.body_text),
      attachmentText: selection.kind === 'single' ? selection.payload : null,
    })
  } catch (error) {
    // The parser is pure: a payload it cannot frame fails identically on every
    // retry. Hold it visibly on the mail instead of five silent job retries.
    const companyId = text(row.company_id)
    const reason = error instanceof Error ? error.message : String(error)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: 'edifact_unparseable',
      matchPayload: { reason, authorizesBusinessEffect: false },
      errorMessage: `EDIFACT kunde inte tolkas (${reason}). Inget har tillämpats eller kvitterats.`,
    })
    await createInboundMailTask({
      companyId,
      title: 'Inkommande Ediel-fil kan inte tolkas',
      description: `Filen är trasig eller avkortad (${reason}). Kontrollera råmailet och be avsändaren skicka om.`,
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, reason },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId, parseResultId: null }
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

  // UNB/0035 marks a test interchange. A test interchange in a production
  // mailbox must not be attributed to a production tenant or reach business
  // processing (J3-05). Test Center imports are bound separately above.
  if (environment === 'production' && !input.testCenterTenantBinding && unbTestIndicator(parsed.rawPayload) === '1') {
    const companyId = text(row.company_id)
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId,
      status: 'manual_review',
      matchStatus: 'environment_mismatch',
      matchPayload: { mailboxEnvironment: environment, unbTestIndicator: '1', interchangeReference: parsed.interchangeReference,
        senderEdielId: parsed.senderEdielId, receiverEdielId: parsed.receiverEdielId, authorizesBusinessEffect: false },
      errorMessage: 'Testinterchange (UNB 0035=1) kom till produktionsbrevlådan. Inget har tillämpats eller kvitterats.',
    })
    await createInboundMailTask({
      companyId,
      title: 'Ediel-testfil kom till produktion',
      description: `Avsändare ${parsed.senderEdielId ?? 'okänd'} skickade interchange ${parsed.interchangeReference ?? 'okänd'} med testindikator till produktionsbrevlådan.`,
      metadata: { inboundEmailMessageId: input.inboundEmailMessageId, interchangeReference: parsed.interchangeReference },
      actorUserId: input.actorUserId ?? null,
    })
    return { status: 'manual_review', companyId, parseResultId: null }
  }

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

  const attribution = await attributeInboundEmailToTenant({ inboundEmailMessageId: input.inboundEmailMessageId, companyId: tenant.companyId, row })
  if (attribution.duplicateOf) {
    // A re-delivery of an interchange the tenant already received. The mail
    // stays unattributed (the tenant owns the first copy) and is held visibly;
    // nothing is applied or acknowledged a second time.
    await updateInboundEmailProcessingStatus({
      inboundEmailMessageId: input.inboundEmailMessageId,
      companyId: null,
      status: 'manual_review',
      matchStatus: 'duplicate_interchange',
      matchPayload: { duplicateOfInboundEmailMessageId: attribution.duplicateOf.id, samePayload: attribution.duplicateOf.samePayload,
        tenantCompanyId: tenant.companyId, senderEdielId: parsed.senderEdielId, interchangeReference: parsed.interchangeReference, authorizesBusinessEffect: false },
      errorMessage: attribution.duplicateOf.samePayload
        ? 'Samma interchange har redan tagits emot i ett tidigare mail. Dubbletten har inte tillämpats eller kvitterats igen.'
        : 'Avsändaren återanvände en interchange-referens med annat innehåll. Inget har tillämpats; kontrollera med avsändaren.',
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
        // A database refusal arrives as a plain PostgREST error object; keep its own code (J1-03, FINDINGS J1-FP2).
        const message = preparationError instanceof Error ? preparationError.message
          : typeof (preparationError as { message?: unknown } | null)?.message === 'string' ? (preparationError as { message: string }).message : ''
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

  await updateInboundEmailProcessingStatus({
    inboundEmailMessageId: input.inboundEmailMessageId,
    companyId: tenant.companyId,
    status: safeMatch ? 'processed' : 'manual_review',
    matchStatus,
    matchPayload: { tenant, outboundMatch, meteringPointMatch, parsed },
  })

  return { status: safeMatch ? 'processed' : 'manual_review', companyId: tenant.companyId, parseResultId }
}
