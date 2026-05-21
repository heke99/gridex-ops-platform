// lib/ediel/core/actorRegistry.ts

import type { EdielActorSettingsRow, EdielEnvironment } from '@/lib/ediel/types'
import {
  buildDefaultApplicationReference,
  getActiveEdielActorSettings,
} from '@/lib/ediel/config'

export type CanonicalActorContext = {
  actor: EdielActorSettingsRow
  senderEdielId: string
  senderName: string | null
  senderSubAddress: string | null
  defaultApplicationReference: string | null
  mailbox: string | null
  smtpFromEmail: string | null
  smtpReplyToEmail: string | null
  brpEdielId: string | null
  brpName: string | null
  brpStatus: string | null
  esettStatus: string | null
  environment: EdielEnvironment
  testFlag: 0 | 1
  charset: string
  timezone: number
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function resolveCanonicalActorContext(
  environment: EdielEnvironment = 'test',
  companyId?: string | null
): Promise<CanonicalActorContext> {
  const actor = await getActiveEdielActorSettings(environment, companyId)

  if (!actor) {
    throw new Error(
      `Ingen aktiv ediel_actor_settings hittades för environment ${environment}${companyId ? ` och company_id ${companyId}` : ''}.`
    )
  }

  const senderEdielId = trimOrNull(actor.actor_ediel_id)
  if (!senderEdielId) {
    throw new Error(
      `Aktiv ediel_actor_settings för ${environment} saknar actor_ediel_id.`
    )
  }

  const senderName = trimOrNull(actor.sender_name) ?? trimOrNull(actor.actor_name)
  const senderSubAddress = trimOrNull(actor.sender_sub_address)
  const defaultApplicationReference =
    trimOrNull(actor.default_application_reference) ??
    buildDefaultApplicationReference({
      actorSubAddress: senderSubAddress,
      process: 'EDIEL',
    })

  return {
    actor,
    senderEdielId,
    senderName,
    senderSubAddress,
    defaultApplicationReference,
    mailbox: trimOrNull(actor.mailbox),
    smtpFromEmail: trimOrNull(actor.smtp_from_email),
    smtpReplyToEmail: trimOrNull(actor.smtp_reply_to_email),
    brpEdielId: trimOrNull(actor.brp_ediel_id),
    brpName: trimOrNull(actor.brp_name),
    brpStatus: trimOrNull(actor.brp_status),
    esettStatus: trimOrNull(actor.esett_status),
    environment: actor.environment,
    testFlag: (actor.default_test_flag ?? 1) as 0 | 1,
    charset: actor.default_charset ?? 'UNOC',
    timezone: actor.default_timezone ?? 1,
  }
}