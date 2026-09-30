import {aiListCell,aiListDate,assertAiListOutboundType,AI_LIST_FORMAT_VERSION,parseAiBiTechnicalFile} from '@/lib/ediel/aiListFormat'
import {resolveSwedishProdatCustomerIdentity} from '@/lib/ediel/prodat/customerIdentity'
import type { CreateEdielMessageInput, EdielEnvironment } from '@/lib/ediel/types'
import { inferEdielFileName } from '@/lib/ediel/classify'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { deriveEdielAckDefaults } from '@/lib/ediel/core/ackPolicy'

export const AI_LIST_VERSION = AI_LIST_FORMAT_VERSION

export type AiListType = 'AI' | 'BI'

export type AiListDetailRow = {
  anlaggningsId: string
  kodlista?: '9' | '89' | string | null
  natavrakningsomrade?: string | null
  nyttNatavrakningsomrade?: string | null
  nyttAnlaggningsId?: string | null
  nyKodlista?: '9' | '89' | string | null
  nyttNatforetagsId?: string | null
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
  arsforbrukningKwh?: string | number | null
  elanvandarId?: string | null
  elanvandarNamn?: string | null

  /** Legacy field kept only so old callers keep compiling. Not sent in AI-listan 14.A.3. */
  serieId?: string | null
}

export type BuildAiListCsvInput = {
  listType: AiListType
  senderEdielId: string
  receiverEdielId: string
  fromDate: string
  toDate: string
  details: AiListDetailRow[]
  senderName?: string | null
  receiverName?: string | null
  createdAt?: Date | string | null
  validityDate?: string | null
}

function normalizeDate(value?: string | null): string {
  return value ? aiListDate(value) : ''
}

function normalizeTimestamp(value?: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) {
    throw new Error('ai_list_creation_date_invalid')
  }
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, '')
}

function safe(value?: string | number | null): string {
  return aiListCell(value)
}

function onlyAsciiToken(value?: string | null): string {
  return safe(value).replace(/[^A-Za-z0-9_-]/g, '')
}

function compareDetails(a: AiListDetailRow, b: AiListDetailRow): number {
  const object = [safe(a.natavrakningsomrade),safe(a.anlaggningsId),safe(a.kodlista)].join('|').localeCompare([safe(b.natavrakningsomrade),safe(b.anlaggningsId),safe(b.kodlista)].join('|'),'sv')
  if(object)return object
  const from=normalizeDate(a.franDatum).localeCompare(normalizeDate(b.franDatum))
  if(from)return from
  return (normalizeDate(a.tillDatum)||'99999999').localeCompare(normalizeDate(b.tillDatum)||'99999999')
}

function normalizeDetailRow(row: AiListDetailRow): AiListDetailRow {
  return {
    anlaggningsId: safe(row.anlaggningsId),
    kodlista: safe(row.kodlista) || '9',
    natavrakningsomrade: safe(row.natavrakningsomrade),
    nyttNatavrakningsomrade: safe(row.nyttNatavrakningsomrade),
    nyttAnlaggningsId: safe(row.nyttAnlaggningsId),
    nyKodlista: safe(row.nyKodlista),
    nyttNatforetagsId: safe(row.nyttNatforetagsId),
    balansansvarsId: safe(row.balansansvarsId),
    elhandelsId: safe(row.elhandelsId),
    natforetagsId: safe(row.natforetagsId),
    anlaggningsAdress: safe(row.anlaggningsAdress),
    postnummer: safe(row.postnummer),
    ort: safe(row.ort),
    franDatum: normalizeDate(row.franDatum),
    tillDatum: normalizeDate(row.tillDatum),
    avrakningsmetod: safe(row.avrakningsmetod),
    matmetod: safe(row.matmetod),
    rapporteringsfrekvens: safe(row.rapporteringsfrekvens),
    produktkod: safe(row.produktkod),
    matarNummer: safe(row.matarNummer),
    arsforbrukningKwh: safe(row.arsforbrukningKwh),
    elanvandarId: safe(row.elanvandarId),
    elanvandarNamn: safe(row.elanvandarNamn),
    serieId: safe(row.serieId),
  }
}

function canonicalizeDetails(rows: AiListDetailRow[]): AiListDetailRow[] {
  const deduped = new Map<string, AiListDetailRow>()

  for (const row of rows) {
    const normalized = normalizeDetailRow(row)
    // Deduplicate only byte-identical exported rows. Different historical legal
    // customer/BRP states must never collapse through an incomplete sort key.
    deduped.set(buildAiDetailRow(normalized), normalized)
  }

  return [...deduped.values()].sort(compareDetails)
}

function buildAiListFileName(params: {
  listType: AiListType
  senderEdielId: string
  receiverEdielId: string
  fromDate: string
  toDate: string
  createdAt?: Date | string | null
  validityDate?: string | null
}) {
  const sender = onlyAsciiToken(params.senderEdielId)
  const receiver = onlyAsciiToken(params.receiverEdielId)
  const stamp = normalizeTimestamp(params.createdAt)

  if (params.listType === 'BI') {
    return `BI_${sender}_${receiver}_${normalizeDate(params.validityDate ?? params.fromDate)}_${stamp}.csv`
  }

  return `AI_${sender}_${receiver}_${normalizeDate(params.fromDate)}_${normalizeDate(params.toDate)}_${stamp}.csv`
}

function buildHeader(input: BuildAiListCsvInput): string {
  const common = [
    input.listType,
    safe(input.receiverEdielId),
    safe(input.receiverName),
    safe(input.senderEdielId),
    safe(input.senderName),
    normalizeTimestamp(input.createdAt),
  ]

  if (input.listType === 'BI') {
    return [
      ...common,
      normalizeDate(input.validityDate ?? input.fromDate),
      '',
      '',
      AI_LIST_VERSION,
    ].join(';')
  }

  return [
    ...common,
    '',
    normalizeDate(input.fromDate),
    normalizeDate(input.toDate),
    AI_LIST_VERSION,
  ].join(';')
}

function buildAiDetailRow(row: AiListDetailRow): string {
  return [
    safe(row.natavrakningsomrade),
    safe(row.anlaggningsId),
    safe(row.kodlista || '9'),
    '',
    '',
    '',
    '',
    safe(row.anlaggningsAdress),
    safe(row.postnummer),
    safe(row.ort),
    safe(row.balansansvarsId),
    '', // Supplier export: six network-only columns, AI14.A.3 pp8–9.
    '',
    '',
    '',
    '',
    '',
    safe(row.elanvandarId),
    safe(row.elanvandarNamn),
    normalizeDate(row.franDatum),
    normalizeDate(row.tillDatum),
    '',
  ].join(';')
}

function buildBiDetailRow(row: AiListDetailRow): string {
  return [
    safe(row.natavrakningsomrade),
    safe(row.anlaggningsId),
    safe(row.kodlista || '9'),
    safe(row.nyttNatavrakningsomrade),
    safe(row.nyttAnlaggningsId),
    safe(row.nyKodlista),
    safe(row.nyttNatforetagsId),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ].join(';')
}

export function buildAiListCsv(input: BuildAiListCsvInput): string {
  assertAiListOutboundType(input.listType)
  const canonicalDetails = canonicalizeDetails(input.details)
  const rows = canonicalDetails.map((row) =>
    input.listType === 'BI' ? buildBiDetailRow(row) : buildAiDetailRow(row)
  )

  const payload=[buildHeader(input), ...rows].join('\n')
  parseAiBiTechnicalFile(payload,input.listType)
  return payload
}

export function buildAiListDetailFromSite(params: {
  site: CustomerSiteRow
  meteringPoint?: MeteringPointRow | null
  gridOwner?: GridOwnerRow | null
  supplierEdielId?: string | null
  balanceResponsibleEdielId?: string | null
  customer?: Record<string,unknown> | null
  identityAgency?: '9' | '89'
}): AiListDetailRow {
  const customer=resolveSwedishProdatCustomerIdentity(params.customer)
  if(!customer.id||!customer.qualifier||!customer.name)throw new Error('ai_list_verified_customer_identity_required')
  const objectId=params.meteringPoint?.meter_point_id ?? params.site.facility_id
  if(!objectId||(!params.identityAgency&&!/^\d{18}$/.test(objectId)))throw new Error('ai_list_verified_object_identity_required')
  return {
    anlaggningsId:
      params.meteringPoint?.meter_point_id ??
      params.site.facility_id!,
    kodlista: params.identityAgency ?? '9',
    natavrakningsomrade: params.meteringPoint?.grid_area_code ?? (params.site as unknown as {grid_area_code?:string|null}).grid_area_code ?? null,
    balansansvarsId: params.balanceResponsibleEdielId ?? null,
    elhandelsId: params.supplierEdielId ?? null,
    natforetagsId: params.gridOwner?.ediel_id ?? null,
    anlaggningsAdress: params.site.street ?? null,
    postnummer: params.site.postal_code ?? null,
    ort: params.site.city ?? null,
    franDatum: params.site.move_in_date ?? null,
    tillDatum: null,
    avrakningsmetod:null,
    matmetod:null,
    rapporteringsfrekvens:null,
    produktkod:null,
    matarNummer:null,
    arsforbrukningKwh:null,
    elanvandarId:customer.id,
    elanvandarNamn:customer.name,
    serieId: null,
  }
}

export async function buildAiListOutboundDraft(input: {
  actorUserId?: string | null
  companyId?: string | null
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
  routeDefaultMessageVersion?: string | null
  validityDate?: string | null
  environment?: EdielEnvironment
}): Promise<CreateEdielMessageInput> {
  assertAiListOutboundType(input.listType)
  const refs = buildCanonicalOutboundReferences({
    family: 'AI_LIST',
    code: input.listType,
    relatedMessageId: null,
    preferredExternalReference: input.externalReference ?? null,
    preferredTransactionReference: input.transactionReference ?? null,
    correlationReference: input.correlationReference ?? null,
  })

  const version =
    (await resolveCanonicalOutboundVersion({
      family: 'AI_LIST',
      code: input.listType,
      standard: 'ai_list',
      routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
      environment: input.environment ?? 'test',
    }))
  if(version!==AI_LIST_VERSION)throw new Error('ai_list_canonical_version_unavailable')

  const createdAt = new Date()
  const canonicalDetails = canonicalizeDetails(input.details)
  const csvPayload = buildAiListCsv({
    listType: input.listType,
    senderEdielId: input.senderEdielId,
    senderName: input.senderName ?? null,
    receiverEdielId: input.receiverEdielId,
    receiverName: input.receiverName ?? null,
    fromDate: input.fromDate,
    toDate: input.toDate,
    validityDate: input.validityDate ?? null,
    createdAt,
    details: canonicalDetails,
  })

  const ack = deriveEdielAckDefaults({
    family: 'AI_LIST',
    code: input.listType,
  })

  return {
    actorUserId: input.actorUserId ?? 'system',
    companyId: input.companyId ?? null,
    direction: 'outbound',
    messageStandard: 'ai_list',
    messageFamily: 'AI_LIST',
    messageCode: input.listType,
    messageVersion: version,
    processType: input.listType === 'BI' ? 'bi_list_export' : 'ai_list_export',
    environment: input.environment ?? 'test',
    testFlag: input.environment === 'production' ? 0 : 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.mailbox ?? null,
    senderEdielId: input.senderEdielId,
    senderName: input.senderName ?? null,
    receiverEdielId: input.receiverEdielId,
    receiverName: input.receiverName ?? null,
    receiverEmail: input.receiverEmail ?? null,
    applicationReference: null,
    externalReference: refs.externalReference,
    correlationReference: refs.correlationReference,
    transactionReference: refs.transactionReference,
    communicationRouteId: input.communicationRouteId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    subject: `${input.listType}-LIST ${refs.externalReference ?? ''}`.trim(),
    fileName:
      buildAiListFileName({
        listType: input.listType,
        senderEdielId: input.senderEdielId,
        receiverEdielId: input.receiverEdielId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        validityDate: input.validityDate ?? null,
        createdAt,
      }) ||
      inferEdielFileName({
        family: 'AI_LIST',
        code: input.listType,
        direction: 'outbound',
        extension: 'csv',
      }),
    mimeType: 'text/csv',
    rawPayload: csvPayload,
    parsedPayload: {
      listType: input.listType,
      version,
      fromDate: input.fromDate,
      toDate: input.toDate,
      validityDate: input.validityDate ?? null,
      detailCount: canonicalDetails.length,
      rawDetailCount: input.details.length,
      details: canonicalDetails,
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: 'not_required',
  }
}
