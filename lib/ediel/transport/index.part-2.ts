import {captureEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {assertNoTgtLeakageInProductionMessage} from '@/lib/ediel/core/productionGuards'
import {assertNoConfiguredPortalRecipient} from './productionRecipient'
import {loadRecoveryReportingValidationContext} from '@/lib/ediel/recovery/reportingContext'
import {assertRequestedChangeSendSource} from '@/lib/ediel/production/requestedChangeSource'
import {assertBrpChangeSendSource} from '@/lib/ediel/production/brpChangeSource'
import {assertMeteringMethodChangeSendSource} from '@/lib/ediel/production/meteringMethodChangeSource'
import { assertProdatFreeTextSendBoundary } from '@/lib/ediel/prodat/prodatFreeText'
import { assertEdifactUnocSyntax3, assertEdifactUnocText, encodeEdifactUnoc } from '@/lib/ediel/core/edifactEncoding'
import { assertUtiltsPositiveAckAuthorityForSend } from '@/lib/ediel/utilts/positiveAckAuthority'
import { wireFormatIdentityIssue } from '@/lib/ediel/core/messageWireFormat'
import { assertAiListOutboundMessage } from '@/lib/ediel/aiListFormat'
import { assertScopedEdielProductionCapability } from '@/lib/ediel/scopedCapabilityReadiness'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {assertGasApplicabilitySendBoundary,gasApplicabilitySendIssue,gasApplicabilitySendFieldIssues} from '@/lib/ediel/prodat/prodatGasAuthority'
import {deathStatusSendIssue} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {readFreshEdielSendValidationSources} from '@/lib/ediel/production/sendValidationSources'
import {meterChangeSendIssue} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import {hasReportingPermissionMessage} from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import {loadTgtReportingValidationContext} from '@/lib/ediel/testing/tgtReportingPermissionContext'
import {loadServiceReportingValidationContext} from '@/lib/ediel/services/reporting'
import {hasProdatDateEventMessage} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {loadProdatDateEventValidationContext} from '@/lib/ediel/production/dateEventContext'
import {assertRulebookAllowsSend, assertRegistryRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import { prepareEdielBusinessExpectationPlan, prepareEdielTechnicalExpectationPlan } from '@/lib/ediel/businessExpectations'
import {prepareEdielMeteringMethodExpectationPlan} from '@/lib/ediel/meteringMethodExpectationPolicy'
import {assertEdielSendLock} from './sendLock'
import { inspectCmsRecipientCertificateSet } from './cmsRecipientSet'
import { resolveSourceQualifiedNegativeFixtureForMessage } from '@/lib/ediel/testing/negativeFixtureAuthority'
import { readProdatTransportRetryBasis } from '@/lib/ediel/recovery/transportRetry'
import { readAcceptedEdielTransportProjection } from './acceptedProjection'
import { repairAcceptedEdielMessageProjection, repairObservedEdielSmtpProjection } from './acceptedProjectionRepair'
import {readTransportExceptionAuthorization,plaintextTransportException,withTransportExceptionCertificateScope,type TransportExceptionAuthorization} from './exception/source'
// Extracted from index.ts; keep public imports on the facade module.






import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'


import { parseInboundProdat } from '@/lib/ediel/prodat'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { computeCanonicalAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/core/ackPolicy'
import { inferInboundAiListExternalReference } from '@/lib/ediel/core/referenceRegistry'
import { resolveInboundAcceptedVersions } from '@/lib/ediel/core/kernel'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'


import { describeCertificate, fullEdielAddress, resolveOutboundRecipientCertificate, routeReceiverSubaddress } from '@/lib/ediel/security/outboundRecipientCertificate'

import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import type { SendEdielEmailInput } from '@/lib/email/sendEdielEmail'
import { sendCorrectionFencedEmail, type OutboundDispatchOwner } from '@/lib/ediel/sources/correctionOutboundDispatch'
import { SmtpDeliveryUncertainError } from './smtpOutcome'

import type { EdielSmtpMimeMode, SmtpSendResult } from './index.part-1'
import { applyMessageFamilyEncryptionPolicy, assertRouteTransportSecurity, assertTransportFamily, buildInnerEdifactMimeForSmime, buildMultipartValidationBase64Mime, buildOuterSmimeMime, buildSinglePartEdielBase64Mime, buildSinglePartEdielMime, encodeBase64Mime, encryptSmimeEnvelopedData, encryptionModeFromMimeMode, extractEdielSubjectFromPayload, findRelatedOutboundForInboundAck, inferAckOutcomeFromPayload, inferAttachmentExtension, inferBodyText, inferMimeType, inspectCmsRecipientInfo, isEdifactMessage, parseEdifactEnvelope, requireActorUserId, resolveSmtpMimeMode, routeCertificateEnvironment, safePreview, sanitizeMimeToken, sha256, storeTransportPayloadSnapshot } from './index.part-1'

export function buildInboundProdatMessageInput(params: {
  rawPayload: string
  communicationRouteId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
}): CreateEdielMessageInput {
  const parsed = parseInboundProdat(params.rawPayload)
  const envelope = parseEdifactEnvelope(params.rawPayload, 'PRODAT', String(parsed.messageCode ?? ''))
  const messageCode = parsed.messageCode ?? envelope.code ?? 'Z03'
  const ack = deriveEdielAckDefaults({
    family: 'PRODAT',
    code: messageCode,
  })

  const receivedAt = new Date().toISOString()

  return {
    actorUserId: 'system',
    direction: 'inbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode,
    messageVersion: parsed.messageVersion ?? envelope.messageVersion ?? 'E2SE6A',
    status: 'received',
    transportType: 'imap',
    mailbox: params.mailbox ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
    senderEdielId: parsed.senderEdielId ?? envelope.senderEdielId,
    receiverEdielId: parsed.receiverEdielId ?? envelope.receiverEdielId,
    senderSubAddress: parsed.senderSubAddress ?? envelope.senderSubAddress,
    receiverSubAddress: parsed.receiverSubAddress ?? envelope.receiverSubAddress,
    senderEmail: params.senderEmail ?? null,
    receiverEmail: params.receiverEmail ?? null,
    subject: params.subject ?? null,
    fileName: inferEdielFileName({
      family: 'PRODAT',
      code: messageCode,
      direction: 'inbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    externalReference: parsed.externalReference ?? envelope.externalReference,
    transactionReference: parsed.transactionReference ?? envelope.transactionReference,
    applicationReference: parsed.applicationReference ?? envelope.applicationReference,
    communicationRouteId: params.communicationRouteId ?? null,
    rawPayload: params.rawPayload,
    parsedPayload: {
      ...(parsed.parsedPayload ?? {}),
      ...envelope.parsedPayload,
      importedVia: 'imap',
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    syntaxCheckStatus: 'pending',
    functionalCheckStatus: 'pending',
    messageReceivedAt: receivedAt,
    ackDueAt: computeCanonicalAckDueAt(receivedAt),
  }
}

export function buildInboundAiListMessageInput(params: {
  rawPayload: string
  listType: 'AI' | 'BI'
  communicationRouteId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
}): CreateEdielMessageInput {
  const externalReference = inferInboundAiListExternalReference({
    subject: params.subject ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
  })

  return {
    actorUserId: 'system',
    direction: 'inbound',
    messageStandard: 'ai_list',
    messageFamily: 'AI_LIST',
    messageCode: params.listType,
    messageVersion: 'Ver20140401',
    status: 'received',
    transportType: 'imap',
    mailbox: params.mailbox ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
    senderEmail: params.senderEmail ?? null,
    receiverEmail: params.receiverEmail ?? null,
    subject: params.subject ?? null,
    fileName: inferEdielFileName({
      family: 'AI_LIST',
      code: params.listType,
      direction: 'inbound',
      extension: 'csv',
    }),
    mimeType: 'text/csv; charset=utf-8',
    externalReference,
    communicationRouteId: params.communicationRouteId ?? null,
    rawPayload: params.rawPayload,
    parsedPayload: {
      listType: params.listType,
      lineCount: params.rawPayload.split(/\r?\n/).filter(Boolean).length,
      separator: ';',
      importedVia: 'imap',
      controlOnly: true,
    },
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
    messageReceivedAt: new Date().toISOString(),
  }
}

export async function buildInboundAckMessageInput(params: {
  rawPayload: string
  family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  code?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
}): Promise<CreateEdielMessageInput> {
  const parsed = parseEdifactEnvelope(params.rawPayload, params.family, params.code ?? params.family)
  const related = await findRelatedOutboundForInboundAck({
    senderEdielId: parsed.senderEdielId,
    receiverEdielId: parsed.receiverEdielId,
    applicationReference: parsed.applicationReference,
    transactionReference: parsed.transactionReference,
    externalReference: parsed.externalReference,
  })

  const receivedAt = new Date().toISOString()
  const isUnlinkedAck = !related
  const isContrl = params.family === 'CONTRL'
  const isAperak = params.family === 'APERAK'
  const ackOutcome = inferAckOutcomeFromPayload({
    family: params.family,
    rawPayload: params.rawPayload,
  })
  const isNegative = ackOutcome === 'negative'
  // The database requires acknowledgement outcome rows to be linked to the
  // outbound/source message they acknowledge. When an old mailbox item is
  // imported after the original outbound message was deleted or cannot be
  // matched, keep the inferred outcome in parsed_payload/validation_report for
  // manual review, but do not persist ack_outcome on the canonical row. This
  // preserves the production constraint and prevents one unlinked APERAK/CONTRL
  // from crashing the entire IMAP poll.
  const persistedAckOutcome = related ? ackOutcome : null

  return {
    actorUserId: 'system',
    direction: 'inbound',
    messageStandard: 'edifact',
    messageFamily: params.family,
    messageCode: params.family,
    messageVersion: parsed.messageVersion ?? (params.family === 'CONTRL' ? 'D96A' : params.family === 'APERAK' ? 'E2SE6A' : 'E5SE5A'),
    processType: 'ack',
    status: 'received',
    transportType: 'imap',
    mailbox: params.mailbox ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
    senderEdielId: parsed.senderEdielId,
    receiverEdielId: parsed.receiverEdielId,
    senderSubAddress: parsed.senderSubAddress,
    receiverSubAddress: parsed.receiverSubAddress,
    senderEmail: params.senderEmail ?? null,
    receiverEmail: params.receiverEmail ?? null,
    subject: params.subject ?? null,
    fileName: inferEdielFileName({ family: params.family, code: params.family, direction: 'inbound', extension: 'edi' }),
    mimeType: 'application/edifact',
    interchangeReference: parsed.interchangeReference,
    externalReference: parsed.externalReference,
    transactionReference: parsed.transactionReference,
    applicationReference: parsed.applicationReference,
    originalMessageId: related?.interchange_reference ?? null,
    originalTransactionId: related?.transaction_reference ?? null,
    originalMessageCode: related ? String(related.message_code) : null,
    relatedMessageId: related?.id ?? null,
    communicationRouteId: params.communicationRouteId ?? related?.communication_route_id ?? null,
    outboundRequestId: related?.outbound_request_id ?? null,
    switchRequestId: related?.switch_request_id ?? null,
    gridOwnerDataRequestId: related?.grid_owner_data_request_id ?? null,
    partnerExportId: related?.partner_export_id ?? null,
    customerId: related?.customer_id ?? null,
    siteId: related?.site_id ?? null,
    meteringPointId: related?.metering_point_id ?? null,
    gridOwnerId: related?.grid_owner_id ?? null,
    rawPayload: params.rawPayload,
    parsedPayload: {
      ...parsed.parsedPayload,
      ackFamily: params.family,
      ackOutcome,
      relatedOutboundMessageId: related?.id ?? null,
      relatedOutboundFamily: related?.message_family ?? null,
      relatedOutboundCode: related?.message_code ?? null,
      importedVia: 'imap',
      unlinkedInboundAck: isUnlinkedAck,
      unlinkedReason: isUnlinkedAck
        ? 'No matching outbound message was found during IMAP import. The acknowledgement was imported for manual review instead of blocking the mailbox poll.'
        : null,
    },
    validationReport: isUnlinkedAck
      ? {
          ackLinkStatus: 'unlinked',
          ackLinkSeverity: 'warning',
          ackLinkReason:
            'No matching outbound message was found during IMAP import. Review references and link manually if needed.',
          parsedReferences: {
            interchangeReference: parsed.interchangeReference,
            externalReference: parsed.externalReference,
            transactionReference: parsed.transactionReference,
            applicationReference: parsed.applicationReference,
          },
        }
      : undefined,
    failureReason: isUnlinkedAck
      ? 'Inkommande kvittens importerades utan automatisk koppling till outbound-meddelande.'
      : null,
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    ackOutcome: persistedAckOutcome,
    syntaxCheckStatus: isContrl && related ? (isNegative ? 'failed' : 'ok') : 'not_checked',
    functionalCheckStatus: (isAperak || params.family === 'UTILTS_ERR') && related ? (isNegative ? 'failed' : 'ok') : 'not_checked',
    messageReceivedAt: receivedAt,
  }
}

export async function withAcceptedInboundVersions(
  input: CreateEdielMessageInput
): Promise<CreateEdielMessageInput> {
  const acceptedVersions = await resolveInboundAcceptedVersions({
    family: input.messageFamily,
    code: String(input.messageCode),
    standard: input.messageStandard,
    date:
      typeof input.messageReceivedAt === 'string'
        ? input.messageReceivedAt.slice(0, 10)
        : null,
  })

  const currentVersion = typeof input.messageVersion === 'string' ? input.messageVersion : null
  const acceptedVersionCodes = acceptedVersions.map((row) => row.version_code)
  const versionAccepted =
    currentVersion === null
      ? acceptedVersionCodes.length === 0
      : acceptedVersionCodes.includes(currentVersion)

  return {
    ...input,
    validationReport: {
      ...(input.validationReport ?? {}),
      acceptedInboundVersions: acceptedVersionCodes,
      inboundVersionAccepted: versionAccepted,
      inboundVersionCheckDate:
        typeof input.messageReceivedAt === 'string'
          ? input.messageReceivedAt.slice(0, 10)
          : new Date().toISOString().slice(0, 10),
    },
  }
}

export async function sendEdielMessageViaSmtp(
  message: EdielMessageRow,
  params?: { actorUserId?: string | null; smtpMimeMode?: EdielSmtpMimeMode | string | null; dispatchOwner?: OutboundDispatchOwner; temporarySecurityExceptionId?: string | null }
): Promise<{
  accepted: string[]
  rejected: string[]
  messageId: string | null
  dispatchObservedAt: string
}> {
  const actorUserId = requireActorUserId(params?.actorUserId)
  if (!message.company_id) throw new Error('ediel_transport_company_required')
  const established = await readAcceptedEdielTransportProjection({ companyId: message.company_id,
    environment: message.environment, actorUserId, messageId: message.id })
  if (established) {
    try {
      const repaired = await repairAcceptedEdielMessageProjection({ message, actorUserId, projection: established })
      return { accepted: repaired.providerReceipt.accepted, rejected: [], messageId: repaired.providerReceipt.messageId,
        dispatchObservedAt: repaired.observedAt }
    } catch (error) { throw new SmtpDeliveryUncertainError(error, established.providerReceipt.messageId) }
  }
  if (['provider_accepted','sent','delivered','acknowledged'].includes(String(message.status))) {
    throw new Error('ediel_historical_transport_receipt_unavailable')
  }
  assertNoTgtLeakageInProductionMessage(message)
  await assertNoConfiguredPortalRecipient(message)
  // Historical accepted-journal replay above never needs a new exception or
  // re-enters SMTP. A fresh selector supplies no approval or incident facts.
  let transportException:TransportExceptionAuthorization|null=null
  if(params?.temporarySecurityExceptionId){
    const selected=await readTransportExceptionAuthorization({message,actorUserId,exceptionId:params.temporarySecurityExceptionId})
    if(selected.status!=='authorized')throw new Error(selected.missing.join(' | '))
    transportException=selected
  }
  const plaintextException=transportException?plaintextTransportException(transportException,message,actorUserId):false
  const formatIssue = wireFormatIdentityIssue({ rawPayload: message.raw_payload, messageStandard: message.message_standard, mimeType: message.mime_type })
  if (formatIssue) throw new Error(`${formatIssue.code}: ${formatIssue.description}`)
  if (isEdifactMessage(message)) {
    assertEdifactUnocText(message.raw_payload ?? '')
    if (['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK'].includes(message.message_family)) {
      assertEdifactUnocSyntax3(message.raw_payload ?? '')
    }
  }
  const {deathStatusContext,customerMasterdataContext,ackSourceQualification,prodatCommonHeaderRejectionEvidence:commonHeaderEvidence}=await readFreshEdielSendValidationSources(message,actorUserId)
  await assertBrpChangeSendSource(message, actorUserId)
  const requestedChangeBasis = isEdifactMessage(message) ? await assertRequestedChangeSendSource(message, actorUserId) : null
  const methodSendBasis = await assertMeteringMethodChangeSendSource(message, actorUserId)
  await assertUtiltsPositiveAckAuthorityForSend(message)
  assertAiListOutboundMessage(message)
  await assertScopedEdielProductionCapability(message)
  assertProdatFreeTextSendBoundary(message)
  const sourceHolds=[gasApplicabilitySendIssue(message),...gasApplicabilitySendFieldIssues(message),deathStatusSendIssue(message,deathStatusContext,requestedChangeBasis??undefined)].filter(Boolean)
  if(sourceHolds.length){
    const messages=sourceHolds.map(i=>`${i!.code}: ${i!.description}`)
    // Add the existing pure protected diagnostics before this new early hold;
    // no route/context loader or provider is invoked for a GAS boundary defect.
    if(sourceHolds.some(i=>i?.code.startsWith('PRODAT_GAS_'))){
      try{for(const issue of validateEdielMessageRowWithRulebook(message,'send',undefined,undefined,ackSourceQualification,deathStatusContext,commonHeaderEvidence,customerMasterdataContext,requestedChangeBasis??undefined).issues){
        if((issue.scope==='prodat_dependent'||issue.scope==='prodat_register')&&(issue.blocking||issue.severity==='error'))messages.push(`${issue.code}: ${issue.description}`)
      }}catch(error){messages.push(error instanceof Error?error.message:String(error))}
    }
    throw new Error([...new Set(messages)].join(' | '))
  }
  if(meterChangeSendIssue(message)){assertRulebookAllowsSend(message,undefined,undefined,undefined,deathStatusContext,ackSourceQualification,customerMasterdataContext,requestedChangeBasis??undefined);assertEdielSendLock(message,undefined,undefined,ackSourceQualification,deathStatusContext,undefined,customerMasterdataContext,requestedChangeBasis??undefined)}
  assertTransportFamily(message.message_family, 'sendEdielMessageViaSmtp')
  const recoveryReporting = await loadRecoveryReportingValidationContext(message, actorUserId)
  const reportingContext = hasReportingPermissionMessage(message)
    ? recoveryReporting?.status === 'qualified' ? recoveryReporting.context
      : message.parsed_payload?.sourcePermissionBasis
        ? await loadServiceReportingValidationContext(message, actorUserId)
        : await loadTgtReportingValidationContext(message)
    : undefined
  const dateEventContext = hasProdatDateEventMessage(message) ? await loadProdatDateEventValidationContext(message, actorUserId) : undefined
  const negativeFixture = await resolveSourceQualifiedNegativeFixtureForMessage({ message, actorUserId })
  const admission = isEdifactMessage(message) ? await assertRegistryRulebookAllowsSend(message, dateEventContext, reportingContext, negativeFixture,deathStatusContext,ackSourceQualification??undefined,customerMasterdataContext,requestedChangeBasis??undefined,actorUserId) : null
  if (reportingContext || dateEventContext || deathStatusContext || customerMasterdataContext || ackSourceQualification || commonHeaderEvidence || requestedChangeBasis) assertEdielSendLock(message, dateEventContext, reportingContext,ackSourceQualification,deathStatusContext,commonHeaderEvidence,customerMasterdataContext,requestedChangeBasis??undefined)
  const technicalSyntaxAckEvidence = admission?.technicalSyntaxAckEvidence ?? null
  const prodatCommonHeaderRejectionEvidence=admission?.prodatCommonHeaderRejectionEvidence ?? null
  const sourceRulePackEvidence = !prodatCommonHeaderRejectionEvidence && ['PRODAT','UTILTS','APERAK','UTILTS_ERR'].includes(message.message_family)
    ? await captureEdielSourceRulePackEvidence(message.company_id, message.id) : null
  if (message.message_family === 'CONTRL' && !technicalSyntaxAckEvidence) throw new Error('ediel_technical_ack_basis_required')
  if (sourceRulePackEvidence && (!admission?.rulePackSnapshot || sourceRulePackEvidence.profileKey !== admission.rulePackSnapshot.profileKey
      || sourceRulePackEvidence.messageProfileId !== admission.rulePackSnapshot.profileVersionId || sourceRulePackEvidence.version !== admission.rulePackSnapshot.version
      || sourceRulePackEvidence.sourceHash !== admission.rulePackSnapshot.checksum)) throw new Error('ediel_send_original_rule_pack_mismatch')
  const policy = admission?.canonicalPolicy
  const admissionDecision = policy ? Object.freeze({ version: 1, referenceDate: policy.referenceDate,
    family: policy.family, code: policy.code, subtype: policy.subtype, profileKey: policy.profileKey,
    guide: policy.guide, associationAssignedCode: policy.associationAssignedCode, sourceTrace: policy.sourceTrace }) : null
  const businessExpectationPlan = policy ? prepareEdielBusinessExpectationPlan(message, policy) : null
  const technicalExpectationPlan = policy ? prepareEdielTechnicalExpectationPlan(message, policy) : null
  const meteringMethodExpectationPlan = policy && methodSendBasis.kind !== 'certification'
    ? prepareEdielMeteringMethodExpectationPlan(message, policy) : null

  if (!message.company_id) throw new Error('ediel_transport_company_required')
  const recoveryAuthorization = params?.dispatchOwner?.kind === 'worker'
    ? await readProdatTransportRetryBasis({ companyId: message.company_id, messageId: message.id,
      outboxId: params.dispatchOwner.outboxId, actorUserId })
    : null
  if (isEdifactMessage(message)) {
    const { error } = await supabaseService.rpc('ediel_reserve_wire_reference_namespace_v1', {
      p_company_id: message.company_id, p_message_id: message.id,
    })
    if (error) throw error
  }

  if (!message.receiver_email?.trim()) {
    throw new Error(`Kan inte skicka Ediel-meddelande ${message.id} utan receiver_email.`)
  }

  const routeProfile = message.communication_route_id
    ? await getEdielRouteProfileByCommunicationRouteId(message.communication_route_id, {
        companyId: message.company_id ?? null,
      })
    : null
  assertGasApplicabilitySendBoundary({...message,routeApplicationReference:routeProfile?.application_reference})
  const overrideEncryptionMode = encryptionModeFromMimeMode(params?.smtpMimeMode)
  const requestedEncryptionMode =
    overrideEncryptionMode ??
    (routeProfile?.transport_security_mode === 'required_encrypted' || routeProfile?.transport_security_mode === 'encrypted'
      ? 'smime'
      : routeProfile?.transport_security_mode === 'unencrypted'
        ? 'none'
        : routeProfile?.encryption_mode) ??
    'none'
  const effectiveEncryptionMode = plaintextException?'none':applyMessageFamilyEncryptionPolicy({
    messageFamily: message.message_family,
    environment: message.environment,
    requestedEncryptionMode,
    routeProfile,
  })
  // Outbound S/MIME encryption must use the receiver route certificate only.
  // The shared mailbox certificate is our own/private transport material and must never
  // be used as recipientCertificatePem for another Ediel party.
  const effectiveCertificateId = routeProfile?.receiver_certificate_id ?? routeProfile?.certificate_id ?? null
  // Legacy route-level "allow unencrypted production" is never an incident
  // source. Only an exact private current capability can reserve plaintext.
  if(message.environment==='production'&&effectiveEncryptionMode!=='smime'&&!plaintextException)
    throw new Error('transport_exception_actual_approved_plaintext_source_required')
  if(plaintextException){
    if(!routeProfile||routeProfile.tls_required!==true||routeProfile.transport_security_mode==='needs_verification')
      throw new Error('transport_exception_current_verified_tls_route_required')
  }else await assertRouteTransportSecurity({
    message,
    routeProfile,
    effectiveEncryptionMode,
    effectiveCertificateId,
  })

  const edielMail = assertEdielSmtpReadiness()
  const from = edielMail.from
  const replyTo = edielMail.replyTo

  const extension = inferAttachmentExtension(message)
  const bodyText = inferBodyText(message)
  const fileName =
    message.file_name ??
    inferEdielFileName({
      family: message.message_family,
      code: String(message.message_code),
      direction: message.direction,
      extension,
    })
  const routeEncryptionMode = effectiveEncryptionMode
  const mimeMode = resolveSmtpMimeMode(plaintextException?'ediel-singlepart-base64':params?.smtpMimeMode, routeEncryptionMode)
  if(message.environment==='production'&&mimeMode!=='ediel-smime-enveloped'&&!plaintextException)
    throw new Error('transport_exception_actual_approved_plaintext_source_required')
  const normalizedPayload = isEdifactMessage(message) || message.message_standard === 'ai_list'
    ? message.raw_payload ?? ''
    : bodyText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  const contentType = isEdifactMessage(message)
    ? 'application/EDIFACT'
    : message.message_standard === 'xml'
      ? 'application/xml'
      : inferMimeType(message)
  const mimeEncoding: BufferEncoding = isEdifactMessage(message) ? 'latin1' : 'utf8'
  const payloadBytes = isEdifactMessage(message)
    ? encodeEdifactUnoc(normalizedPayload)
    : Buffer.from(normalizedPayload, mimeEncoding)
  const contentTransferEncoding =
    mimeMode === 'nodemailer-attachment'
      ? 'nodemailer-managed'
      : mimeMode === 'ediel-singlepart-lines' || mimeMode === 'ediel-singlepart-compact'
        ? '8bit'
        : 'base64'
  const fallbackSmtpSubject = `EDIEL_${String(message.message_family).toUpperCase()}_${String(message.message_code).toUpperCase()}_${String(message.interchange_reference ?? message.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`
  const smtpSubject = isEdifactMessage(message)
    ? extractEdielSubjectFromPayload(normalizedPayload, fallbackSmtpSubject)
    : fallbackSmtpSubject

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: 'info',
    message: 'SMTP-skick förberett. Kontrollera denna payload om Edielportalen inte registrerar meddelandet.',
    payload: {
      mimeMode,
      smtpProvider: edielMail.provider,
      senderLane: 'ediel_strato',
      appLevelDkimEnabled: edielMail.appLevelDkimEnabled,
      contentType,
      contentTransferEncoding,
      envelopeFrom: from,
      envelopeTo: message.receiver_email,
      headerFrom: from,
      headerTo: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      fileName,
      payloadLength: normalizedPayload.length,
      payloadPreview: safePreview(normalizedPayload),
      interchangeReference: message.interchange_reference,
      interchangeReferenceLength: String(message.interchange_reference ?? '').length,
      documentReference: message.external_reference,
      documentReferenceLength: String(message.external_reference ?? '').length,
      caseReference: message.transaction_reference,
      caseReferenceLength: String(message.transaction_reference ?? '').length,
      receiverEdielId: message.receiver_ediel_id,
      receiverSubAddress: message.receiver_sub_address,
      applicationReference: message.application_reference,
    },
  })

  await storeTransportPayloadSnapshot({
    message,
    payloadKind: 'raw_edifact',
    rawPayload: normalizedPayload,
    encryptionMode: mimeMode === 'ediel-smime-enveloped' ? 'smime' : 'none',
    certificateFingerprint: null,
    metadata: {
      phase: 'smtp_prepare',
      mimeMode,
      routeProfileId: routeProfile?.id ?? null,
      routeEncryptionMode,
      smtpProvider: edielMail.provider,
      senderLane: 'ediel_strato',
      canonicalRawEdifactBeforePackaging: true,
    },
  }).catch((error) => {
    console.warn('[ediel-transport] Could not store raw payload snapshot', error)
  })

  const sendFenced = (input: SendEdielEmailInput) => sendCorrectionFencedEmail(input, {
    message, actorUserId, owner: params?.dispatchOwner, mimeMode,
    payload: payloadBytes, encoding: mimeEncoding, admissionDecision, businessExpectationPlan, technicalExpectationPlan, meteringMethodExpectationPlan, recoveryAuthorization, sourceRulePackEvidence, technicalSyntaxAckEvidence, prodatCommonHeaderRejectionEvidence,transportException,
  })
  let result: SmtpSendResult & { dispatchReplay?: boolean; dispatchObservedAt?: string }
  let rawMimePreview: string | null = null
  let decodedPayloadPreview: string | null = null
  let encodedPayloadPreview: string | null = null
  let encryptedPayloadLength: number | null = null
  let innerMimePreview: string | null = null
  let usedReceiverCertificateId: string | null = null
  let cmsExpectedReceiverPresent: boolean | null = null

  if (mimeMode === 'nodemailer-attachment') {
    result = await sendFenced({
      from,
      to: message.receiver_email,
      subject: smtpSubject,
      text: '',
      attachments: [
        {
          filename: fileName,
          content: payloadBytes,
          contentType,
          contentDisposition: 'attachment',
        },
      ],
    })
  } else if (mimeMode === 'ediel-smime-enveloped') {
    if (!isEdifactMessage(message)) {
      throw new Error('S/MIME-läget stöder just nu EDIFACT. Använd ediel-singlepart-base64 för XML/AI-listor tills separat XML-S/MIME är byggt.')
    }

    const receiverSubaddress =
      routeReceiverSubaddress(routeProfile) ??
      message.receiver_sub_address ??
      null
    const outboundRecipientCertificate = await withTransportExceptionCertificateScope(transportException,()=>resolveOutboundRecipientCertificate({
      companyId: message.company_id,
      certificateId: effectiveCertificateId,
      receiverEdielId: routeProfile?.receiver_ediel_id ?? message.receiver_ediel_id ?? null,
      receiverSubaddress,
      messageFamily: String(message.message_family ?? routeProfile?.message_family ?? ''),
      businessCode: String(message.message_code ?? routeProfile?.business_code ?? ''),
      messageType: String(message.message_family ?? routeProfile?.message_family ?? ''),
      environment: message.environment,
      certificateEnvironment: routeCertificateEnvironment(routeProfile as Record<string, unknown> | null, message.environment),
      routeProfileId: routeProfile?.id ?? null,
      smtpTo: message.receiver_email,
      ownEdielId:
        (routeProfile as Record<string, unknown> | null)?.own_ediel_id as string | undefined ??
        (routeProfile as Record<string, unknown> | null)?.sender_ediel_id as string | undefined ??
        message.sender_ediel_id ??
        null,
    }))
    const recipientCertificatePems = outboundRecipientCertificate.recipientCertificates.map(certificate => certificate.publicCertificatePem)
    usedReceiverCertificateId = outboundRecipientCertificate.id
    const recipientCertPath = null
    const innerMime = buildInnerEdifactMimeForSmime({
      filename: fileName,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })
    const encryptedDer = await encryptSmimeEnvelopedData({
      innerMime,
      recipientCertificatePems,
    })
    const cmsRecipientInfo = await inspectCmsRecipientInfo({
      encryptedDer,
      expectedSerialNumber: outboundRecipientCertificate.serialNumber,
    })
    const recipientSet = inspectCmsRecipientCertificateSet({ encryptedDer, recipientCertificatePems })
    cmsRecipientInfo.expectedReceiverPresent = cmsRecipientInfo.expectedReceiverPresent && recipientSet.expectedReceiverPresent
    cmsExpectedReceiverPresent = cmsRecipientInfo.expectedReceiverPresent
    if (!cmsRecipientInfo.expectedReceiverPresent) {
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'error',
        message: 'SMTP-skick stoppades: S/MIME-kuvertet innehåller inte förväntat mottagarcertifikat.',
        payload: {
          expectedReceiverAddress: fullEdielAddress(routeProfile?.receiver_ediel_id ?? message.receiver_ediel_id ?? null, 'ZZ', receiverSubaddress),
          expectedReceiverCertificate: describeCertificate(outboundRecipientCertificate.raw),
          actualCmsRecipientSerials: cmsRecipientInfo.serialNumbers,
          actual_cms_recipient_serial: cmsRecipientInfo.serialNumbers[0] ?? null,
          cmsExpectedReceiverPresent: false,
          expected_receiver_certificate_id: outboundRecipientCertificate.id,
          expected_receiver_certificate_subject: outboundRecipientCertificate.subject,
          expected_receiver_certificate_issuer: outboundRecipientCertificate.issuer,
          expected_receiver_certificate_serial: outboundRecipientCertificate.serialNumber,
          expected_receiver_certificate_fingerprint: outboundRecipientCertificate.fingerprintSha256,
          block_reason: 'cms_expected_receiver_missing',
        },
      })
      throw new Error(
        `Sending blocked: S/MIME envelope does not include expected receiver certificate for ${fullEdielAddress(routeProfile?.receiver_ediel_id ?? message.receiver_ediel_id ?? null, 'ZZ', receiverSubaddress) ?? 'receiver'}.`,
      )
    }
    const rawMime = buildOuterSmimeMime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      encryptedDer,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 900)
    innerMimePreview = safePreview(innerMime.toString('ascii'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(payloadBytes), 900)
    encryptedPayloadLength = encryptedDer.length
    const encryptedPayloadRef = `smtp-smime://${message.id}/${sha256(encryptedDer).slice(0, 24)}`

    await storeTransportPayloadSnapshot({
      message,
      payloadKind: 'smime_enveloped',
      rawPayload: null,
      encryptedPayloadRef,
      encryptionMode: 'smime',
      certificateFingerprint: outboundRecipientCertificate.fingerprintSha256,
      metadata: {
        mimeMode,
        encryptedPayloadLength,
        encryptedPayloadSha256: sha256(encryptedDer),
        recipientCertPath,
        expectedReceiverCertificate: describeCertificate(outboundRecipientCertificate.raw),
        expectedReceiverCertificates: outboundRecipientCertificate.recipientCertificates.map(c => ({ id: c.id, serialNumber: c.serialNumber, fingerprintSha256: c.fingerprintSha256 })),
        sourceRecipientTrustEvidence: outboundRecipientCertificate.trustEvidence,
        actualCmsRecipientSerials: cmsRecipientInfo.serialNumbers,
        actual_cms_recipient_serial: cmsRecipientInfo.serialNumbers[0] ?? null,
        cmsExpectedReceiverPresent: cmsRecipientInfo.expectedReceiverPresent,
        expected_receiver_certificate_id: outboundRecipientCertificate.id,
        expected_receiver_certificate_subject: outboundRecipientCertificate.subject,
        expected_receiver_certificate_issuer: outboundRecipientCertificate.issuer,
        expected_receiver_certificate_serial: outboundRecipientCertificate.serialNumber,
        expected_receiver_certificate_fingerprint: outboundRecipientCertificate.fingerprintSha256,
      },
    }).catch((error) => {
      console.warn('[ediel-transport] Could not store S/MIME payload snapshot', error)
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'S/MIME envelope byggt enligt Ediel-regler före SMTP-skickning.',
      payload: {
        mimeMode,
        recipientCertPath: 'database:ediel_certificates.public_certificate_pem',
        certificateId: outboundRecipientCertificate.id,
        expectedReceiverCertificate: describeCertificate(outboundRecipientCertificate.raw),
        actualCmsRecipientSerials: cmsRecipientInfo.serialNumbers,
        cmsExpectedReceiverPresent: cmsRecipientInfo.expectedReceiverPresent,
        outerContentType: 'application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m',
        outerContentTransferEncoding: 'base64',
        outerContentDisposition: 'attachment; filename=smime.p7m',
        innerContentType: 'application/EDIFACT',
        innerContentTransferEncoding: 'base64',
        innerContentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        innerMimePreview,
        encryptedPayloadLength,
        rawMimePreview,
      },
    })

    result = await sendFenced({
      to: message.receiver_email,
      envelopeFrom: from,
      raw: rawMime,
    })
  } else if (mimeMode === 'ediel-multipart-validation-base64') {
    if (!isEdifactMessage(message)) {
      throw new Error('Multipart-diagnostikläget är endast avsett för EDIFACT/PRODAT-test.')
    }

    const rawMime = buildMultipartValidationBase64Mime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 1200)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(payloadBytes), 900)

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'SMTP diagnostik-MIME byggt: multipart/mixed med application/EDIFACT attachment base64.',
      payload: {
        mimeMode,
        purpose: 'Diagnostik för att återskapa valideringsrespons från Edielportalen utan 8bit.',
        outerContentType: 'multipart/mixed',
        attachmentContentType: contentType,
        attachmentContentTransferEncoding: 'base64',
        attachmentContentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        encodedPayloadLength: payloadBytes.toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await sendFenced({
      to: message.receiver_email,
      envelopeFrom: from,
      raw: rawMime,
    })
  } else if (mimeMode === 'ediel-singlepart-base64') {
    const rawMime = buildSinglePartEdielBase64Mime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(payloadBytes), 900)

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'SMTP MIME byggt enligt Ediel-regler före skickning.',
      payload: {
        mimeMode,
        contentType,
        contentTransferEncoding: 'base64',
        contentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        encodedPayloadLength: payloadBytes.toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await sendFenced({
      to: message.receiver_email,
      envelopeFrom: from,
      raw: rawMime,
    })
  } else {
    const rawMime = buildSinglePartEdielMime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      rawPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('latin1'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)

    result = await sendFenced({
      to: message.receiver_email,
      envelopeFrom: from,
      raw: rawMime,
    })
  }

  const accepted = Array.isArray(result.accepted) ? result.accepted.map(String) : []
  const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : []

  if (rejected.length > 0 || accepted.length === 0) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'failed',
      eventStatus: 'error',
      message: 'SMTP-servern accepterade inte Ediel-meddelandet fullt ut.',
      payload: {
        smtpMessageId: result.messageId ?? null,
        accepted,
        rejected,
        response: result.response ?? null,
        mimeMode,
      },
    })

    throw new Error(`SMTP accepterade inte mottagaren. accepted=${accepted.join(',') || 'tomt'} rejected=${rejected.join(',') || 'tomt'}`)
  }
  const dispatchObservedAt = result.dispatchObservedAt
  if (typeof dispatchObservedAt !== 'string' || !Number.isFinite(Date.parse(dispatchObservedAt))) {
    throw new SmtpDeliveryUncertainError(new Error('ediel_transport_observation_clock_required'), result.messageId ?? null)
  }
  if (result.dispatchReplay) {
    // Another invocation may have established acceptance after the initial
    // read. Consume its journal under the same atomic repair lock, preserving
    // a later acknowledgement instead of writing a stale sent projection.
    try {
      const repaired = await repairObservedEdielSmtpProjection({ message, actorUserId, observedAt: dispatchObservedAt, smtpMessageId: result.messageId ?? null })
      return { accepted: repaired.providerReceipt.accepted, rejected: [], messageId: repaired.providerReceipt.messageId,
        dispatchObservedAt: repaired.observedAt }
    } catch (error) { throw new SmtpDeliveryUncertainError(error, result.messageId ?? null) }
  }
  try {
    await repairObservedEdielSmtpProjection({ message, actorUserId, observedAt: dispatchObservedAt, smtpMessageId: result.messageId ?? null })
    await supabaseService
      .from('ediel_messages')
      .update({
        transport_security_mode: mimeMode === 'ediel-smime-enveloped' ? 'required_encrypted' : 'unencrypted',
        route_transport_security_mode: routeProfile?.transport_security_mode ?? routeProfile?.encryption_mode ?? null,
        was_smime_encrypted: mimeMode === 'ediel-smime-enveloped',
        expected_receiver_certificate_id: usedReceiverCertificateId,
        cms_expected_receiver_present: cmsExpectedReceiverPresent,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', message.id)
      .eq('company_id', message.company_id)
      .eq('environment', message.environment)
      .then(({ error }) => {
        if (error) throw error
      })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'sent',
      eventStatus: 'success',
      message: 'Ediel-meddelande skickat via SMTP.',
      payload: {
        smtpMessageId: result.messageId ?? null,
        smtpResponse: result.response ?? null,
        accepted,
        rejected,
        mimeMode,
        contentType,
        contentTransferEncoding,
        subject: smtpSubject,
        fileName,
        payloadLength: normalizedPayload.length,
        payloadPreview: safePreview(normalizedPayload),
        rawMimePreview,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        encodedPayloadPreview,
        encryptedPayloadLength,
        innerMimePreview,
        wasSmimeEncrypted: mimeMode === 'ediel-smime-enveloped',
        certificateId: usedReceiverCertificateId,
        cmsExpectedReceiverPresent,
      },
    })

    return {
      accepted,
      rejected,
      messageId: result.messageId ?? null,
      dispatchObservedAt,
    }
  } catch (error) {
    // SMTP already accepted. A failed status/event write cannot establish
    // non-delivery and must not be surfaced as a definite transport failure.
    throw new SmtpDeliveryUncertainError(error, result.messageId ?? null)
  }
}
