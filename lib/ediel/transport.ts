// lib/ediel/transport.ts

import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import {
  createEdielMessage,
  findEdielMessageByMailboxIdentity,
  getEdielRouteProfileByCommunicationRouteId,
} from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import { parseInboundProdat } from '@/lib/ediel/prodat'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'

function requireEnv(name: string, fallback?: string | null): string {
  const value = process.env[name] ?? fallback ?? ''
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

function resolveSmtpPort(value?: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const env = process.env.EDIEL_SMTP_PORT
  return env ? Number(env) : 465
}

function resolveImapPort(value?: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const env = process.env.EDIEL_IMAP_PORT
  return env ? Number(env) : 993
}

function normalizeMailboxIdentity(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

export async function sendEdielMessageViaSmtp(message: EdielMessageRow): Promise<{
  accepted: string[]
  rejected: string[]
  messageId: string | null
}> {
  if (!message.receiver_email?.trim()) {
    throw new Error(
      `Kan inte skicka Ediel-meddelande ${message.id} utan receiver_email.`
    )
  }

  const routeProfile = message.communication_route_id
    ? await getEdielRouteProfileByCommunicationRouteId(message.communication_route_id)
    : null

  const host = requireEnv('EDIEL_SMTP_HOST', routeProfile?.smtp_host ?? null)
  const port = resolveSmtpPort(routeProfile?.smtp_port ?? null)
  const user = requireEnv(
    'EDIEL_SMTP_USER',
    routeProfile?.mailbox ?? process.env.EDIEL_SMTP_USER ?? null
  )
  const pass = requireEnv('EDIEL_SMTP_PASS')
  const from = routeProfile?.mailbox ?? process.env.EDIEL_SMTP_FROM ?? user

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  })

  const result = await transporter.sendMail({
    from,
    to: message.receiver_email,
    subject: message.subject ?? `${message.message_family} ${message.message_code}`,
    text: message.raw_payload ?? '',
    attachments: [
      {
        filename:
          message.file_name ??
          inferEdielFileName({
            family: message.message_family,
            code: String(message.message_code),
            direction: message.direction,
            extension: 'edi',
          }),
        content: message.raw_payload ?? '',
        contentType: message.mime_type ?? 'application/edifact',
      },
    ],
  })

  return {
    accepted: result.accepted.map(String),
    rejected: result.rejected.map(String),
    messageId: result.messageId ?? null,
  }
}

export async function pollEdielMailboxViaImap(params?: {
  mailbox?: string | null
  communicationRouteId?: string | null
  limit?: number
}): Promise<EdielMessageRow[]> {
  const routeProfile = params?.communicationRouteId
    ? await getEdielRouteProfileByCommunicationRouteId(params.communicationRouteId)
    : null

  const host = requireEnv('EDIEL_IMAP_HOST', routeProfile?.imap_host ?? null)
  const port = resolveImapPort(routeProfile?.imap_port ?? null)
  const user = requireEnv(
    'EDIEL_IMAP_USER',
    routeProfile?.mailbox ?? params?.mailbox ?? null
  )
  const pass = requireEnv('EDIEL_IMAP_PASS')
  const mailbox = params?.mailbox ?? routeProfile?.mailbox ?? 'INBOX'
  const limit = params?.limit ?? 10

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
  })

  const created: EdielMessageRow[] = []

  await client.connect()
  await client.mailboxOpen(mailbox)

  try {
    const lock = await client.getMailboxLock(mailbox)

    try {
      const messages = client.fetch(
        { seen: false },
        {
          uid: true,
          envelope: true,
          source: true,
        }
      )

      let count = 0

      for await (const item of messages) {
        if (count >= limit) break

        const mailboxMessageId = normalizeMailboxIdentity(item.uid)
        if (!mailboxMessageId) {
          continue
        }

        const existing = await findEdielMessageByMailboxIdentity({
          mailbox,
          mailboxMessageId,
        })

        if (existing) {
          continue
        }

        const rawSource =
          typeof item.source === 'string'
            ? item.source
            : Buffer.isBuffer(item.source)
              ? item.source.toString('utf8')
              : ''

        const content = rawSource || ''
        const inferred = inferEdielFamilyAndCodeFromRawPayload(content)

        if (!inferred.messageFamily || !inferred.messageCode) {
          continue
        }

        let createdMessage: EdielMessageRow | null = null

        if (inferred.messageFamily === 'UTILTS') {
          createdMessage = await createEdielMessage(
            buildInboundUtiltsMessageInput({
              code: inferred.messageCode as
                | 'S01'
                | 'S02'
                | 'S03'
                | 'S04'
                | 'E31'
                | 'E66',
              communicationRouteId: params?.communicationRouteId ?? null,
              mailbox,
              mailboxMessageId,
              senderEmail: item.envelope?.from?.[0]?.address ?? null,
              receiverEmail: item.envelope?.to?.[0]?.address ?? null,
              rawPayload: content,
            })
          )
        } else if (inferred.messageFamily === 'PRODAT') {
          const parsed = parseInboundProdat(content)

          createdMessage = await createEdielMessage({
            direction: 'inbound',
            messageFamily: 'PRODAT',
            messageCode: parsed.messageCode ?? inferred.messageCode,
            status: 'received',
            transportType: 'imap',
            mailbox,
            mailboxMessageId,
            senderEdielId: parsed.senderEdielId,
            receiverEdielId: parsed.receiverEdielId,
            senderSubAddress: parsed.senderSubAddress,
            receiverSubAddress: parsed.receiverSubAddress,
            senderEmail: item.envelope?.from?.[0]?.address ?? null,
            receiverEmail: item.envelope?.to?.[0]?.address ?? null,
            subject: item.envelope?.subject ?? null,
            fileName: inferEdielFileName({
              family: 'PRODAT',
              code: parsed.messageCode ?? inferred.messageCode,
              direction: 'inbound',
              extension: 'edi',
            }),
            mimeType: 'application/edifact',
            externalReference: parsed.externalReference,
            transactionReference: parsed.transactionReference,
            applicationReference: parsed.applicationReference,
            communicationRouteId: params?.communicationRouteId ?? null,
            rawPayload: content,
            parsedPayload: parsed.parsedPayload,
            messageReceivedAt: new Date().toISOString(),
          })
        }

        if (createdMessage) {
          created.push(createdMessage)
          count += 1
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return created
}