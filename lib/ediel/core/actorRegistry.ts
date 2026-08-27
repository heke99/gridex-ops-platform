// lib/ediel/core/actorRegistry.ts

import type { EdielActorSettingsRow, EdielEnvironment } from '@/lib/ediel/types'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'
import {
  resolveCanonicalTenantEdielIdentity,
  type CanonicalTenantEdielIdentity,
} from '@/lib/ediel/tenant/tenantEdielIdentity'

export type CanonicalActorContext = {
  actor: EdielActorSettingsRow
  /** UNB transport sender. For a represented tenant this can be an Ediel ombud. */
  senderEdielId: string
  /** Legal market actor used in message-level NAD sender/receiver semantics. */
  legalActorEdielId: string
  transportActorEdielId: string
  marketRoles: string[]
  representedByTransportAgent: boolean
  tenantIdentity: CanonicalTenantEdielIdentity | null
  senderName: string | null
  senderSubAddress: string | null
  /** Legacy route fallback only. Canonical message builders must resolve by process/message. */
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

  const legacySenderEdielId = trimOrNull(actor.ediel_id) ?? trimOrNull(actor.actor_ediel_id)
  if (!legacySenderEdielId) {
    throw new Error(`Aktiv ediel_actor_settings för ${environment} saknar ediel_id/actor_ediel_id.`)
  }

  let tenantIdentity: CanonicalTenantEdielIdentity | null = null
  if (companyId) {
    tenantIdentity = await resolveCanonicalTenantEdielIdentity({ companyId, environment })
    if (tenantIdentity.legalEdielId !== legacySenderEdielId) {
      throw new Error(
        `canonical_actor_legacy_identity_mismatch:${companyId}:${environment}:${legacySenderEdielId}:${tenantIdentity.legalEdielId}`,
      )
    }
  }

  const senderEdielId = tenantIdentity?.transportEdielId ?? legacySenderEdielId
  const legalActorEdielId = tenantIdentity?.legalEdielId ?? legacySenderEdielId
  const senderName = trimOrNull(actor.sender_name) ?? trimOrNull(actor.legal_name) ?? trimOrNull(actor.actor_name)
  const senderSubAddress =
    trimOrNull(actor.sender_subaddress_prodat) ??
    trimOrNull(actor.sender_subaddress) ??
    trimOrNull(actor.sender_sub_address)

  return {
    actor,
    senderEdielId,
    legalActorEdielId,
    transportActorEdielId: senderEdielId,
    marketRoles: tenantIdentity?.roleCodes ?? [],
    representedByTransportAgent: tenantIdentity?.representedByTransportAgent ?? false,
    tenantIdentity,
    senderName,
    senderSubAddress,
    // Never synthesize 23-<role>-<family>. The exact application reference is
    // message/process specific and must be resolved by the canonical rulebook.
    defaultApplicationReference: trimOrNull(actor.default_application_reference),
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
