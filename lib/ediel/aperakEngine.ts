import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {ProdatAperakText} from '@/lib/ediel/prodat/prodatAperakText'
import type {ProdatErrorOccurrence, ProdatDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveProdatAckMessageFunction,selectProdatAckFirstRegisterGroups} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { canonicalUtiltsTransactions } from '@/lib/ediel/utilts/canonicalObservationScope'
import { resolveUtiltsHeaderGuideIssues } from '@/lib/ediel/utilts/headerGuide'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { originalAckPartyIdentities, originalAckLegalNadSegment } from '@/lib/ediel/core/originalAckPartyIdentities'
import {isUtiltsAperakSourceText} from '@/lib/ediel/utilts/aperakSourceText'
import {prodatNowDate203 as standardTimeMinute} from '@/lib/ediel/prodat/render/dates'
import {readPhysicalUtiltsDocumentIdentity} from '@/lib/ediel/core/physicalDocumentReference'
import {buildEdielAckGroupReference} from '@/lib/ediel/core/referenceRegistry'
import {CANONICAL_ACK_GUIDE_CONSTRAINTS} from '@/lib/ediel/rulebook/ackGuidePolicy'
import type {OriginalAckLegalParty} from '@/lib/ediel/core/originalAckPartyIdentities'
import {isCopyableUtiltsReference,isValidUtiltsTransactionReference} from '@/lib/ediel/utilts/physicalReference'
// lib/ediel/aperakEngine.ts

export type AperakEngineOutcome = 'positive' | 'negative'

/** UTILTS_ERR is a storage alias for UTILTS with BGM ERR, not a P-family. */
export function usesUtiltsAperakProfile(messageFamily: string): boolean {
  return messageFamily === 'UTILTS' || messageFamily === 'UTILTS_ERR'
}

export type AperakEngineApplicationError = {
  prodatOccurrence?: ProdatErrorOccurrence
  prodatFieldDiagnostic?: ProdatDiagnostic
  prodatAperakText?: ProdatAperakText
  ercCode: string
  fieldCode?: string | null
  text: string
  referenceQualifier?: string | null
  referenceNumber?: string | null
  lineItemReference?: string | null
}

export type AperakEngineSource = {
  id: string
  rawPayload?: string | null
  messageFamily: string
  messageCode?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  /** Original own-header NAD actors, distinct from technical UNB endpoints. */
  legalSenderEdielId?: string | null
  legalReceiverEdielId?: string | null
  externalReference?: string | null
  messageReceivedAt?: string | null
  createdAt?: string | null
}

export type AperakEngineRefs = {
  messageReference?: string | null
  documentReference?: string | null
  interchangeReference?: string | null
  lineItemReference?: string | null
  meteringPointId?: string | null
}

export type AperakEngineResult = {
  segments: string[]
  diagnostics: {
    engine: 'aperak'
    renderer: 'aperakEngine.renderAperakEdiel'
    sourceFamily: string
    outcome: AperakEngineOutcome
    previousMessageReference: string
    errorCount: number
  }
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeSegmentText(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function sanitizeEdifactToken(value?: string | null, maxLength = 35): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const sanitized = trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9_.\/-]/g, '')
    .slice(0, maxLength)

  return sanitized.length > 0 ? sanitized : null
}

function escapeEdifactText(value?: string | null, maxLength = 70): string {
  const text = sanitizeSegmentText(value).slice(0, maxLength)
  return text.replace(/\?/g, '??').replace(/:/g, '?:')
}

function segmentsFromRawPayload(rawPayload?: string | null): string[] {
  if (!rawPayload) return []

  const normalized = rawPayload
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')

  return normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function swedishDateTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}${map.month}${map.day}${map.hour}${map.minute}`
}

function swedishDateTimeFromEdifactUnb(rawPayload?: string | null): string | null {
  const segments = segmentsFromRawPayload(rawPayload)
  const unb = segments.find((segment) => segment.toUpperCase().startsWith('UNB+'))
  const parts = unb?.split('+') ?? []
  const dateTimeComposite = parts[4]?.trim() ?? ''
  const date = dateTimeComposite.includes(':')
    ? dateTimeComposite.split(':')[0]?.trim() ?? ''
    : dateTimeComposite
  const time = dateTimeComposite.includes(':')
    ? dateTimeComposite.split(':')[1]?.trim() ?? ''
    : parts[5]?.trim() ?? ''

  if (!/^\d{6}$/.test(date) || !/^\d{4}$/.test(time)) {
    return null
  }

  const yearPrefix = Number(date.slice(0, 2)) >= 70 ? '19' : '20'
  return `${yearPrefix}${date}${time}`
}

function normalizeAperakErrors(
  errors?: readonly AperakEngineApplicationError[] | null,
  fallbackText?: string | null,
  utilts = false,
): AperakEngineApplicationError[] {
  const normalized = (errors ?? [])
    .map((error) => ({
      ercCode: sanitizeEdifactToken(error.ercCode, 12) ?? '',
      fieldCode: utilts ? (() => {
        const field = error.fieldCode ?? null
        if (field !== null && (!field || field.length > 17 || !/^[A-Za-z0-9_./-]+$/.test(field))) throw new Error('utilts_aperak_field_reference_invalid')
        return field
      })() : sanitizeEdifactToken(error.fieldCode ?? null, 12),
      text: utilts ? (()=>{
        if(!isUtiltsAperakSourceText(error.ercCode,error.text)) throw new Error('utilts_aperak_source_text_unavailable')
        return escapeEdifactValue(error.text)
      })() : error.prodatFieldDiagnostic || error.prodatAperakText
        ? (()=>{if(!isQualifiedProdatApplicationError(error))throw new Error('PRODAT_APERAK_TEXT_REVIEW_REQUIRED');return escapeEdifactValue(error.text)})()
        : escapeEdifactValue(error.text.trim().slice(0,140)),
      referenceQualifier: sanitizeEdifactToken(error.referenceQualifier ?? null, 12),
      referenceNumber: error.referenceNumber ?? null,
      lineItemReference: error.lineItemReference ?? null,
      prodatOccurrence: error.prodatOccurrence,
      prodatFieldDiagnostic: error.prodatFieldDiagnostic,
      prodatAperakText:error.prodatAperakText,
    }))
    .filter((error) => error.ercCode.length > 0 && error.text.length > 0)

  if (normalized.length > 0) return normalized
  return [
    {
      ercCode: '40',
      fieldCode: '40',
      text: escapeEdifactText(fallbackText || 'Applikationen kunde inte bearbeta meddelandet', 140),
      referenceQualifier: null,
      referenceNumber: null,
      lineItemReference: null,
    },
  ]
}

export function renderAperakEdiel(params: {
  source: AperakEngineSource
  refs: AperakEngineRefs
  externalReference: string
  transactionReference: string
  outcome: AperakEngineOutcome
  messageText?: string | null
  applicationErrors?: readonly AperakEngineApplicationError[] | null
  /**
   * For UTILTS b-tests and transaction-scoped acknowledgements, APERAK must
   * acknowledge the individual inbound transaction instead of only BGM/1004.
   */
  utiltsAcknowledgementReference?: string | null
  /** Canonical header-guide provenance; message scope alone grants nothing. */
  utiltsHeaderRejected?: boolean
  prodatAcknowledgementLineIndices?:readonly number[]
  /** Prospective response projection only (never a sendable reply): an
   * own-negative object may be projected before the processing owner has
   * supplied its siblings' outcomes. Object scope stays exact. */
  prodatProspectiveObjectProjection?: true
}): AperakEngineResult {
  const isUtiltsSource = usesUtiltsAperakProfile(params.source.messageFamily)
  let headerRejected = Boolean(params.utiltsHeaderRejected)
  if (!headerRejected && isUtiltsSource && params.outcome === 'negative'
    && params.applicationErrors?.length && params.applicationErrors.every(error => !error.referenceNumber && !error.lineItemReference)) {
    const wire = tokenizeEdifact(params.source.rawPayload)
    const bgm = wire.segments.find(segment => segment.tag === 'BGM')
    const messageCode = bgm ? segmentComposite(bgm,1,wire.una)[0] : ''
    const source = {raw_payload:params.source.rawPayload ?? null,message_family:'UTILTS',message_code:messageCode,
      message_received_at:params.source.messageReceivedAt ?? null,created_at:params.source.createdAt ?? null} as EdielMessageRow
    const derived = [...new Set(resolveUtiltsHeaderGuideIssues(source,messageCode)
      .map(issue => JSON.stringify([issue.aperakErcCode,issue.aperakFieldCode,issue.aperakText])))].sort()
    const supplied = params.applicationErrors.map(error => JSON.stringify([error.ercCode,error.fieldCode,error.text])).sort()
    headerRejected = derived.length > 0 && JSON.stringify(derived) === JSON.stringify(supplied)
  }
  if (params.utiltsHeaderRejected && (!isUtiltsSource || params.outcome !== 'negative'
    || params.utiltsAcknowledgementReference
    || !params.applicationErrors?.length
    || params.applicationErrors.some(error => error.referenceNumber || error.lineItemReference))) {
    throw new Error('utilts_header_aperak_scope_invalid')
  }
  if (headerRejected) {
    const wire = tokenizeEdifact(params.source.rawPayload)
    const unh = wire.segments.find(segment => segment.tag === 'UNH')
    const bgm = wire.segments.find(segment => segment.tag === 'BGM')
    const messageCode = bgm ? segmentComposite(bgm, 1, wire.una)[0] : ''
    // Only wire fields are consumed by syntax validation; cached status/report
    // is deliberately absent. Neither a flag nor an arbitrary error grants scope.
    const source = { raw_payload: params.source.rawPayload ?? null, message_family: 'UTILTS', message_code: messageCode,
      message_received_at: params.source.messageReceivedAt ?? null, created_at: params.source.createdAt ?? null } as EdielMessageRow
    const derived = [...new Set(resolveUtiltsHeaderGuideIssues(source, messageCode)
      .map(issue => [issue.aperakErcCode, issue.aperakFieldCode, issue.aperakText])
      .map(error => JSON.stringify(error)))].sort()
    const supplied = (params.applicationErrors ?? []).map(error => JSON.stringify([error.ercCode, error.fieldCode, error.text])).sort()
    if (!unh || segmentComposite(unh, 2, wire.una)[0] !== 'UTILTS' || !validateEdifactSyntax(source).ok
      || derived.length === 0 || JSON.stringify(derived) !== JSON.stringify(supplied)) {
      throw new Error('utilts_header_aperak_scope_invalid')
    }
  }
  const utiltsWire = isUtiltsSource && params.source.rawPayload ? tokenizeEdifact(params.source.rawPayload) : null
  const physicalIds = utiltsWire ? canonicalUtiltsTransactions(utiltsWire.segments.slice(utiltsWire.segments.findIndex(segment => segment.tag === 'UNH')), utiltsWire.una, 0)
    .map(transaction => transaction.transactionId).filter((id): id is string => id !== null && id.length > 0) : []
  const physicalReference = (reference: string | null | undefined): string => {
    if (!reference) throw new Error('utilts_aperak_transaction_reference_required')
    if (!(params.outcome==='positive' ? isValidUtiltsTransactionReference(reference)
      : isCopyableUtiltsReference(reference,CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.originalAcwMax))) throw new Error('utilts_aperak_transaction_reference_invalid')
    if (utiltsWire && !physicalIds.includes(reference)) throw new Error('utilts_aperak_transaction_reference_not_in_source')
    return reference
  }
  const positiveIds = isUtiltsSource && params.outcome === 'positive'
    ? (params.utiltsAcknowledgementReference ? [physicalReference(params.utiltsAcknowledgementReference)] : physicalIds.map(physicalReference)) : []
  if (isUtiltsSource && params.outcome === 'positive' && (!positiveIds.length || new Set(positiveIds).size !== positiveIds.length)) {
    throw new Error('utilts_aperak_transaction_reference_required')
  }
  const utiltsDocument = isUtiltsSource ? readPhysicalUtiltsDocumentIdentity(params.source.rawPayload) : null
  if (isUtiltsSource && !utiltsDocument) throw new Error('aperak_utilts_document_identity_ambiguous')
  if (isUtiltsSource && params.outcome === 'positive' && (!utiltsDocument!.messageCode || !utiltsDocument!.reference)) {
    throw new Error('aperak_utilts_document_reference_required')
  }
  const utiltsBgmCode = params.outcome === 'positive' ? '312' : '313'
  const sourceWire = params.source.messageFamily === 'PRODAT' ? tokenizeEdifact(params.source.rawPayload) : null
  const hasProdatWire = params.source.messageFamily === 'PRODAT' && Boolean(params.source.rawPayload?.trim())
  const bgmFunction=resolveProdatAckMessageFunction({sourceWire,hasProdatWire,messageCode:params.source.messageCode,outcome:params.outcome,applicationErrors:params.applicationErrors})
  const wireDocument = sourceWire ? prodatDocumentValue('203', sourceWire.segments, sourceWire.una) : null
  if (hasProdatWire && (!wireDocument || wireDocument.length > 35)) {
    // Missing/invalid original identity is a local correlation blocker, not a
    // licence to acknowledge an unrelated UNH/row/UUID. Preserve the source.
    throw new Error('aperak_prodat_document_reference_required')
  }
  const previousMessageReference = isUtiltsSource ? utiltsDocument!.reference : hasProdatWire ? wireDocument as string :
    sanitizeEdifactToken(params.refs.documentReference) ??
    sanitizeEdifactToken(params.refs.messageReference) ??
    sanitizeEdifactToken(params.source.externalReference, 14) ??
    sanitizeEdifactToken(params.refs.interchangeReference, 14) ??
    sanitizeEdifactToken(params.source.id, 14) ??
    sanitizeEdifactToken(params.transactionReference) ??
    'UNKNOWN'

  const utiltsParties = isUtiltsSource ? originalAckPartyIdentities({rawPayload:params.source.rawPayload,expectedFamily:'UTILTS'}) : null
  if (utiltsParties && ((params.source.legalSenderEdielId && params.source.legalSenderEdielId !== utiltsParties.legalSender.id)
    || (params.source.legalReceiverEdielId && params.source.legalReceiverEdielId !== utiltsParties.legalReceiver.id))) {
    throw new Error('aperak_original_legal_party_projection_conflict')
  }
  const segments = isUtiltsSource
    ? [
        `BGM+${utiltsBgmCode}+${sanitizeEdifactToken(params.externalReference) ?? 'APERAK'}+9`,
        // U p114: +0100 is the offset for every date/time in this APERAK.
        `DTM+137:${standardTimeMinute()}:203`,
        'DTM+735:?+0100:406',
        // U A503/A504: copy each present actual BGM value. An absent field
        // remains absent; technical/cached/generated references grant nothing.
        ...(utiltsDocument!.messageCode || utiltsDocument!.reference
          ? [`DOC+${escapeEdifactValue(utiltsDocument!.messageCode)}:SVK:260+${escapeEdifactValue(previousMessageReference)}`] : []),
        originalAckLegalNadSegment('MS', utiltsReplySender(utiltsParties!.legalReceiver, params.source.legalReceiverEdielId)),
        originalAckLegalNadSegment('MR', utiltsParties!.legalSender),
        // U A509: the reply keeps the original's actually stated subordinate
        // role(s) (NAD without party id before the first IDE), e.g. DDQ or DGI.
        ...utiltsSubordinateRoles(params.source.rawPayload).map(role => `NAD+${role}`),
      ]
    : [
        `BGM+++${bgmFunction}`,
        `DTM+137:${swedishDateTime()}:203`,
      ]

  const receivedDateTime = hasProdatWire
    // P A901 is the actual retained PRODAT arrival, in fixed UTC+1.
    ? (params.source.messageReceivedAt
      ? (() => {
          const receivedDate = new Date(params.source.messageReceivedAt as string)
          return Number.isFinite(receivedDate.getTime()) ? standardTimeMinute(receivedDate) : null
        })()
      : null)
    : swedishDateTimeFromEdifactUnb(params.source.rawPayload) ??
      (params.source.messageReceivedAt
        ? (() => {
            const receivedDate = new Date(params.source.messageReceivedAt as string)
            return Number.isFinite(receivedDate.getTime()) ? swedishDateTime(receivedDate) : null
          })()
        : null)

  if (!isUtiltsSource && receivedDateTime) {
    segments.push(`DTM+178:${receivedDateTime}:203`)
  }

  if (!isUtiltsSource) {
    const originalParties = originalAckPartyIdentities({ rawPayload: params.source.rawPayload, expectedFamily: 'PRODAT' })
    if ((params.source.legalSenderEdielId && params.source.legalSenderEdielId !== originalParties.legalSender.id)
      || (params.source.legalReceiverEdielId && params.source.legalReceiverEdielId !== originalParties.legalReceiver.id)) {
      throw new Error('aperak_original_legal_party_projection_conflict')
    }
    segments.push(
      `RFF+ACW:${hasProdatWire ? escapeEdifactValue(previousMessageReference) : previousMessageReference}`,
      originalAckLegalNadSegment('FR', originalParties.legalReceiver),
      originalAckLegalNadSegment('DO', originalParties.legalSender)
    )
  }

  if (params.outcome === 'negative' && isUtiltsSource && (!params.applicationErrors || params.applicationErrors.length === 0)) {
    throw new Error(
      'Negativ UTILTS-APERAK saknar applicationErrors. Generatorn får inte falla tillbaka till generisk ERC 40; kör UTILTS runtime/decision engine och skicka explicit ERC/FTX enligt anvisningen.'
    )
  }

  const errors: AperakEngineApplicationError[] =
    params.outcome === 'positive'
      ? isUtiltsSource
        ? positiveIds.map(reference => ({ ercCode:'100', fieldCode:null, text:'OK', referenceQualifier:null,
          referenceNumber:reference, lineItemReference:reference }))
        : sourceWire
        ? selectProdatAckFirstRegisterGroups(prodatRegisterGroups(sourceWire.segments, sourceWire.una).groups,params.prodatAcknowledgementLineIndices).map(group => {
          const party=group.segments.findIndex(segment=>segment.tag==='NAD')
          const lines = group.segments.slice(0,party<0?undefined:party).filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, sourceWire.una)[0] === 'LI')
          const li = lines.length === 1 ? segmentComposite(lines[0], 1, sourceWire.una)[1] : null
          if (!li) throw new Error('aperak_prodat_own_line_reference_required')
          return { ercCode: '100', fieldCode: null, text: 'OK', referenceQualifier: group.itemId ? 'Z07' : null, referenceNumber: group.itemId, lineItemReference: li }
        })
        : [
          {
            ercCode: '100',
            fieldCode: null,
            text: 'OK',
            referenceQualifier: null,
            referenceNumber: null,
            lineItemReference: null,
          },
        ]
      : normalizeAperakErrors(params.applicationErrors, params.messageText ?? null, isUtiltsSource)

  // BGM34 answers every physical object in the processed original. A negative
  // object does not grant success for an untouched sibling. Only actual own
  // outcomes supplied by the processing owner may complete a mixed response.
  if (hasProdatWire && bgmFunction === '34' && sourceWire) {
    const objects = prodatRegisterGroups(sourceWire.segments, sourceWire.una).groups.filter(group => group.registerPosition === 1)
    const answered = new Set<number>()
    for (const error of errors) {
      const matches = objects.filter(group => {
        const refs = group.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, sourceWire.una)[0] === 'LI')
        const li = refs.length === 1 ? segmentComposite(refs[0], 1, sourceWire.una)[1] : null
        return (error.lineItemReference ? error.lineItemReference === li : error.referenceNumber === group.itemId)
          && (!error.referenceNumber || error.referenceNumber === group.itemId)
      })
      if (matches.length !== 1) throw new Error('APERAK_PRODAT_OBJECT_OUTCOME_SCOPE_MISMATCH')
      answered.add(matches[0].lineIndex)
    }
    if (params.prodatProspectiveObjectProjection !== true && objects.some(object => !answered.has(object.lineIndex))) throw new Error('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
  }

  for (const [errorIndex, error] of errors.entries()) {
    segments.push(`ERC+${error.ercCode}::260`)
    segments.push(
      error.fieldCode
        ? `FTX+AAO++${error.fieldCode}::260+${error.text}`
        : `FTX+AAO+++${error.text}`
    )

    if (isUtiltsSource) {
      // A906 owns an independent transaction number per response group. Keep
      // every byte of the freshly allocated parent's entropy plus group scope;
      // the one national field authority supplies capacity, without truncation.
      const ownId = buildEdielAckGroupReference({parentReference:params.transactionReference,groupIndex:errorIndex,groupCount:errors.length,
        maxLength:CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.ownDmMax})
      segments.push(`RFF+DM:${ownId}`)
      if (headerRejected) continue
      const reference = physicalReference(error.lineItemReference ?? error.referenceNumber ?? params.refs.lineItemReference
        ?? (physicalIds.length === 1 ? physicalIds[0] : null))
      segments.push(`RFF+ACW:${escapeEdifactValue(reference)}`)
      continue
    }

    const errorReferenceQualifier = error.referenceQualifier ?? (error.referenceNumber ? 'Z07' : null)
    if (errorReferenceQualifier && error.referenceNumber) {
      segments.push(`RFF+${errorReferenceQualifier}:${escapeEdifactValue(error.referenceNumber)}`)
    }

    // A later register LIN has no LI of its own: copy its object's known
    // original LI from that object's unique first LIN (no sibling exchange).
    const ownLineItemReference = error.lineItemReference ?? (sourceWire && error.referenceNumber ? (() => {
      const owners = prodatRegisterGroups(sourceWire.segments, sourceWire.una).groups
        .filter(group => group.registerPosition === 1 && group.itemId === error.referenceNumber)
      if (owners.length !== 1) return null
      const refs = owners[0].segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, sourceWire.una)[0] === 'LI')
      return refs.length === 1 ? segmentComposite(refs[0], 1, sourceWire.una)[1] || null : null
    })() : null)
    if (ownLineItemReference) {
      segments.push(`RFF+LI:${escapeEdifactValue(ownLineItemReference)}`)
    }
  }

  const hasPerErrorReference = errors.some((error) => error.prodatOccurrence || error.referenceNumber || error.lineItemReference)

  if (!isUtiltsSource && !hasPerErrorReference && params.refs.meteringPointId) {
    segments.push(`RFF+Z07:${params.refs.meteringPointId}`)
  }

  if (!isUtiltsSource && !hasPerErrorReference && params.refs.lineItemReference) {
    segments.push(`RFF+LI:${params.refs.lineItemReference}`)
  }

  return {
    segments,
    diagnostics: {
      engine: 'aperak',
      renderer: 'aperakEngine.renderAperakEdiel',
      sourceFamily: params.source.messageFamily,
      outcome: params.outcome,
      previousMessageReference,
      errorCount: errors.length,
    },
  }
}

/** The APERAK sender is our own legal identity. When the original NAD+MR
 * (field 208) carries that identity with a code list/agency the guide does not
 * allow, the reply is built from the identity we resolved for this source
 * (SVK/260) instead of echoing the invalid qualifiers. Any other identity is
 * copied unchanged and still checked by the ACK guide. */
function utiltsReplySender(original: OriginalAckLegalParty, resolvedOwnLegalId: string | null | undefined): OriginalAckLegalParty {
  const u = CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS, [id, qualifier, agency] = original.identityComponents
  const valid = u.legalAgencies.includes(agency ?? '') && (agency !== u.svkAgency || qualifier === u.svkQualifier)
  if (valid || !resolvedOwnLegalId || id !== resolvedOwnLegalId) return original
  return Object.freeze({ id, identityComponents: Object.freeze([id, u.svkQualifier, u.svkAgency]), country: original.country })
}


/** Subordinate party roles of a UTILTS original's header: NAD segments other
 * than MS/MR that name no party, in physical order (U A509). */
function utiltsSubordinateRoles(rawPayload: string | null | undefined): string[] {
  if (!rawPayload) return []
  const wire = tokenizeEdifact(rawPayload)
  const firstDetail = wire.segments.findIndex(t => t.tag === 'IDE')
  const header = firstDetail < 0 ? wire.segments : wire.segments.slice(0, firstDetail)
  return header.filter(t => t.tag === 'NAD' && !['MS', 'MR'].includes(segmentComposite(t, 1, wire.una)[0] ?? '')
    && !segmentComposite(t, 2, wire.una).some(Boolean)).map(t => segmentComposite(t, 1, wire.una)[0] ?? '').filter(Boolean)
}
