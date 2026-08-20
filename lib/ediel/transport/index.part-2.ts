// Extracted from index.ts; keep public imports on the facade module.






import { updateEdielMessageStatus, createEdielMessageEvent } from '@/lib/ediel/db'
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
import { sendEdielEmail } from '@/lib/email/sendEdielEmail'

import type { EdielSmtpMimeMode, SmtpSendResult } from './index.part-1'
import { applyMessageFamilyEncryptionPolicy, assertRouteTransportSecurity, assertTransportFamily, buildInnerEdifactMimeForSmime, buildMultipartValidationBase64Mime, buildOuterSmimeMime, buildSinglePartEdielBase64Mime, buildSinglePartEdielMime, encodeBase64Mime, encryptSmimeEnvelopedData, encryptionModeFromMimeMode, extractEdielSubjectFromPayload, findRelatedOutboundForInboundAck, inferAckOutcomeFromPayload, inferAttachmentExtension, inferBodyText, inferMimeType, inspectCmsRecipientInfo, isEdifactMessage, normalizeEdifactForSmtp, parseEdifactEnvelope, requireActorUserId, resolveSmtpMimeMode, routeCertificateEnvironment, safePreview, sanitizeMimeToken, sha256, storeTransportPayloadSnapshot } from './index.part-1'

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
  params?: { actorUserId?: string | null; smtpMimeMode?: EdielSmtpMimeMode | string | null }
): Promise<{
  accepted: string[]
  rejected: string[]
  messageId: string | null
}> {
  const actorUserId = requireActorUserId(params?.actorUserId)
  assertTransportFamily(message.message_family, 'sendEdielMessageViaSmtp')

  if (!message.receiver_email?.trim()) {
    throw new Error(`Kan inte skicka Ediel-meddelande ${message.id} utan receiver_email.`)
  }

  const routeProfile = message.communication_route_id
    ? await getEdielRouteProfileByCommunicationRouteId(message.communication_route_id, {
        companyId: message.company_id ?? null,
      })
    : null
  const overrideEncryptionMode = encryptionModeFromMimeMode(params?.smtpMimeMode)
  const requestedEncryptionMode =
    overrideEncryptionMode ??
    (routeProfile?.transport_security_mode === 'required_encrypted' || routeProfile?.transport_security_mode === 'encrypted'
      ? 'smime'
      : routeProfile?.transport_security_mode === 'unencrypted'
        ? 'none'
        : routeProfile?.encryption_mode) ??
    'none'
  const effectiveEncryptionMode = applyMessageFamilyEncryptionPolicy({
    messageFamily: message.message_family,
    requestedEncryptionMode,
    routeProfile,
  })
  // Outbound S/MIME encryption must use the receiver route certificate only.
  // The shared mailbox certificate is our own/private transport material and must never
  // be used as recipientCertificatePem for another Ediel party.
  const effectiveCertificateId = routeProfile?.receiver_certificate_id ?? routeProfile?.certificate_id ?? null
  await assertRouteTransportSecurity({
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
  const mimeMode = resolveSmtpMimeMode(params?.smtpMimeMode, routeEncryptionMode)
  const edifactPayloadMode =
    mimeMode === 'ediel-singlepart-lines' || mimeMode === 'nodemailer-attachment'
      ? 'lines'
      : 'compact'
  const normalizedPayload = isEdifactMessage(message)
    ? normalizeEdifactForSmtp(bodyText, edifactPayloadMode)
    : bodyText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  const contentType = isEdifactMessage(message)
    ? 'application/EDIFACT'
    : message.message_standard === 'xml'
      ? 'application/xml'
      : inferMimeType(message)
  const mimeEncoding: BufferEncoding = isEdifactMessage(message) ? 'latin1' : 'utf8'
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

  let result: SmtpSendResult
  let rawMimePreview: string | null = null
  let decodedPayloadPreview: string | null = null
  let encodedPayloadPreview: string | null = null
  let encryptedPayloadLength: number | null = null
  let innerMimePreview: string | null = null
  let usedReceiverCertificateId: string | null = null
  let cmsExpectedReceiverPresent: boolean | null = null

  if (mimeMode === 'nodemailer-attachment') {
    result = await sendEdielEmail({
      from,
      to: message.receiver_email,
      subject: smtpSubject,
      text: '',
      attachments: [
        {
          filename: fileName,
          content: Buffer.from(normalizedPayload, mimeEncoding),
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
    const outboundRecipientCertificate = await resolveOutboundRecipientCertificate({
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
    })
    const recipientCertificatePem = outboundRecipientCertificate.publicCertificatePem
    usedReceiverCertificateId = outboundRecipientCertificate.id
    const recipientCertPath = null
    const innerMime = buildInnerEdifactMimeForSmime({
      filename: fileName,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })
    const encryptedDer = await encryptSmimeEnvelopedData({
      innerMime,
      recipientCertPath,
      recipientCertificatePem,
    })
    const cmsRecipientInfo = await inspectCmsRecipientInfo({
      encryptedDer,
      expectedSerialNumber: outboundRecipientCertificate.serialNumber,
    })
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
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)
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

    result = await sendEdielEmail({
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
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)

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
        encodedPayloadLength: Buffer.from(normalizedPayload, mimeEncoding).toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await sendEdielEmail({
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
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)

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
        encodedPayloadLength: Buffer.from(normalizedPayload, mimeEncoding).toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await sendEdielEmail({
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

    result = await sendEdielEmail({
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
    .then(({ error }) => {
      if (error) console.warn('[ediel-transport] Could not persist transport audit fields', error)
    })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'sent',
    messageSentAt: new Date().toISOString(),
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
  }
}
