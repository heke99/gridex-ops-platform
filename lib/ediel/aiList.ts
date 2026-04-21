import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import {
  buildDefaultApplicationReference,
  resolveMessageVersion,
} from '@/lib/ediel/config'
import {
  buildEdielExternalReference,
  buildEdielTransactionReference,
  deriveEdielAckDefaults,
} from '@/lib/ediel/references'
import { inferEdielFileName } from '@/lib/ediel/classify'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'

export type AiListType = 'AI' | 'BI'

export type AiListDetailRow = {
  anlaggningsId: string
  natavrakningsomrade?: string | null
  balansansvarsId?: string | null
  elhandelsId?: string | null
  natforetagsId?: string | null
  anlaggningsAdress?: string | null
  postnummer?: string | null
  ort?: string | null
  franDatum?: string | null
  tillDatum?: string | null
  avrakningsmetod?: string | null
  matmetod?: string | null
  rapporteringsfrekvens?: string | null
  produktkod?: string | null
  matarNummer?: string | null
  serieId?: string | null
  elanvandarId?: string | null
}

export type BuildAiListCsvInput = {
  listType: AiListType
  senderEdielId: string
  receiverEdielId: string
  fromDate: string
  toDate: string
  details: AiListDetailRow[]
}

function normalizeDate(value?: string | null): string {
  return (value ?? '').replace(/-/g, '').trim()
}

function safe(value?: string | null): string {
  return (value ?? '').replace(/;/g, ',').trim()
}

export function buildAiListCsv(input: BuildAiListCsvInput): string {
  const header = [
    input.listType,
    'Ver20140401',
    safe(input.senderEdielId),
    safe(input.receiverEdielId),
    new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ''),
    normalizeDate(input.fromDate),
    normalizeDate(input.toDate),
  ].join(';')

  const rows = input.details.map((row) =>
    [
      safe(row.anlaggningsId),
      safe(row.natavrakningsomrade),
      safe(row.balansansvarsId),
      safe(row.elhandelsId),
      safe(row.natforetagsId),
      safe(row.anlaggningsAdress),
      safe(row.postnummer),
      safe(row.ort),
      normalizeDate(row.franDatum),
      normalizeDate(row.tillDatum),
      safe(row.avrakningsmetod),
      safe(row.matmetod),
      safe(row.rapporteringsfrekvens),
      safe(row.produktkod),
      safe(row.matarNummer),
      safe(row.serieId),
      safe(row.elanvandarId),
    ].join(';')
  )

  return [header, ...rows].join('\n')
}

export function buildAiListDetailFromSite(params: {
  site: CustomerSiteRow
  meteringPoint?: MeteringPointRow | null
  gridOwner?: GridOwnerRow | null
  supplierEdielId?: string | null
  balanceResponsibleEdielId?: string | null
}): AiListDetailRow {
  return {
    anlaggningsId:
      params.meteringPoint?.meter_point_id ??
      params.site.facility_id ??
      params.site.id,
    natavrakningsomrade: params.gridOwner?.owner_code ?? null,
    balansansvarsId: params.balanceResponsibleEdielId ?? null,
    elhandelsId: params.supplierEdielId ?? null,
    natforetagsId: params.gridOwner?.ediel_id ?? null,
    anlaggningsAdress: params.site.street ?? null,
    postnummer: params.site.postal_code ?? null,
    ort: params.site.city ?? null,
    franDatum: params.site.move_in_date ?? null,
    tillDatum: null,
    avrakningsmetod:
      params.meteringPoint?.reading_frequency === 'monthly'
        ? 'Z31'
        : params.meteringPoint?.reading_frequency === 'daily'
          ? 'Z32'
          : params.meteringPoint?.reading_frequency === 'hourly'
            ? 'Z33'
            : null,
    matmetod:
      params.meteringPoint?.reading_frequency === 'hourly'
        ? 'Z02'
        : params.meteringPoint?.reading_frequency === 'daily'
          ? 'Z04'
          : null,
    rapporteringsfrekvens:
      params.meteringPoint?.reading_frequency === 'monthly'
        ? 'M'
        : params.meteringPoint?.reading_frequency === 'daily'
          ? 'D'
          : params.meteringPoint?.reading_frequency === 'hourly'
            ? 'D'
            : null,
    produktkod:
      params.site.site_type === 'production' ? 'production' : 'consumption',
    matarNummer: null,
    serieId: params.meteringPoint?.ediel_reference ?? null,
    elanvandarId: params.site.customer_id,
  }
}

export async function buildAiListOutboundDraft(input: {
  actorUserId?: string | null
  listType: AiListType
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  communicationRouteId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  fromDate: string
  toDate: string
  details: AiListDetailRow[]
  mailbox?: string | null
  externalReference?: string | null
  correlationReference?: string | null
  transactionReference?: string | null
}): Promise<CreateEdielMessageInput> {
  const version =
    (await resolveMessageVersion({
      family: 'AI_LIST',
      code: input.listType,
      fallback: 'Ver20140401',
      standard: 'ai_list',
    })) ?? 'Ver20140401'

  const externalReference =
    input.externalReference ??
    buildEdielExternalReference({
      family: 'AI_LIST',
      code: input.listType,
    })

  const transactionReference =
    input.transactionReference ??
    buildEdielTransactionReference({
      family: 'AI_LIST',
      code: input.listType,
    })

  const csvPayload = buildAiListCsv({
    listType: input.listType,
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    details: input.details,
  })

  const ack = deriveEdielAckDefaults({
    family: 'AI_LIST',
    code: input.listType,
  })

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'ai_list',
    messageFamily: 'AI_LIST',
    messageCode: input.listType,
    messageVersion: version,
    processType: 'ai_list_export',
    environment: 'test',
    testFlag: 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.mailbox ?? null,
    senderEdielId: input.senderEdielId,
    senderName: input.senderName ?? null,
    receiverEdielId: input.receiverEdielId,
    receiverName: input.receiverName ?? null,
    receiverEmail: input.receiverEmail ?? null,
    applicationReference: buildDefaultApplicationReference({
      actorSubAddress: 'GRIDEX',
      process: 'AI_LIST',
    }),
    externalReference,
    correlationReference: input.correlationReference ?? null,
    transactionReference,
    communicationRouteId: input.communicationRouteId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    subject: `${input.listType}-LIST ${externalReference}`,
    fileName: inferEdielFileName({
      family: 'AI_LIST',
      code: input.listType,
      direction: 'outbound',
      extension: 'csv',
    }),
    mimeType: 'text/csv',
    rawPayload: csvPayload,
    parsedPayload: {
      listType: input.listType,
      fromDate: input.fromDate,
      toDate: input.toDate,
      detailCount: input.details.length,
      details: input.details,
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: 'not_required',
  }
}