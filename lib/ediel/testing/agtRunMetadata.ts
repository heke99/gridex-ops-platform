// lib/ediel/agtRunMetadata.ts

import type { EdielTestRunRow } from '@/lib/ediel/types'
import type { EdielAgtTestCaseDefinition } from '@/lib/ediel/testing/agtRegistry'

export type EdielAgtRunMetadataSource = 'portal_report' | 'portal_testdata' | 'operator' | 'system_default' | 'unknown'

export type EdielAgtRunMetadata = {
  portalTestId: string | null
  portalTestVersion: string | null
  expectedReasonForTransaction: string | null
  expectedMeteringMethod: string | null
  dateQualifier: string | null
  source: EdielAgtRunMetadataSource
  updatedAt: string | null
}

export type EdielAgtPortalReportParseResult = {
  expectedReasonForTransaction: string | null
  expectedMeteringMethod: string | null
  portalTestId: string | null
  portalTestVersion: string | null
  confidence: 'high' | 'partial' | 'none'
  warnings: string[]
}

const METADATA_MARKER = 'AGT_RUNTIME_METADATA:'

export function blankAgtRunMetadata(): EdielAgtRunMetadata {
  return {
    portalTestId: null,
    portalTestVersion: null,
    expectedReasonForTransaction: null,
    expectedMeteringMethod: null,
    dateQualifier: null,
    source: 'unknown',
    updatedAt: null,
  }
}

function clean(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value?: string | null): string | null {
  return clean(value)?.toUpperCase() ?? null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseMetadataObject(value: unknown): EdielAgtRunMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const source = asString(raw.source)
  return {
    portalTestId: asString(raw.portalTestId),
    portalTestVersion: asString(raw.portalTestVersion),
    expectedReasonForTransaction: upper(asString(raw.expectedReasonForTransaction)),
    expectedMeteringMethod: upper(asString(raw.expectedMeteringMethod)),
    dateQualifier: upper(asString(raw.dateQualifier)),
    source: source === 'portal_report' || source === 'portal_testdata' || source === 'operator' || source === 'system_default'
      ? source
      : 'unknown',
    updatedAt: asString(raw.updatedAt),
  }
}

export function parseEdielAgtRunMetadata(notes?: string | null): EdielAgtRunMetadata {
  const base = blankAgtRunMetadata()
  const text = clean(notes)
  if (!text) return base

  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const direct = parseMetadataObject(record.agtRuntimeMetadata ?? record.metadata ?? record)
      if (direct) return { ...base, ...direct }
    }
  } catch {
    // Older runs may store human-readable notes. Fall through to marker parsing.
  }

  const markerIndex = text.indexOf(METADATA_MARKER)
  if (markerIndex >= 0) {
    const jsonText = text.slice(markerIndex + METADATA_MARKER.length).trim()
    try {
      const parsed = JSON.parse(jsonText) as unknown
      const marker = parseMetadataObject(parsed)
      if (marker) return { ...base, ...marker }
    } catch {
      // Ignore malformed historic notes.
    }
  }

  return base
}

export function buildEdielAgtRunNotes(params: {
  purpose: string
  instruction: string
  actorLabel?: string | null
  metadata?: Partial<EdielAgtRunMetadata> | null
  notes?: string[]
}): string {
  const metadata: EdielAgtRunMetadata = {
    ...blankAgtRunMetadata(),
    ...(params.metadata ?? {}),
    updatedAt: params.metadata?.updatedAt ?? new Date().toISOString(),
  }

  return JSON.stringify({
    purpose: params.purpose,
    instruction: params.instruction,
    actorLabel: params.actorLabel ?? null,
    notes: params.notes ?? [],
    agtRuntimeMetadata: metadata,
  })
}

export function mergeEdielAgtRunMetadata(
  currentNotes: string | null | undefined,
  updates: Partial<EdielAgtRunMetadata>
): { notes: string; metadata: EdielAgtRunMetadata } {
  const current = parseEdielAgtRunMetadata(currentNotes)
  const metadata: EdielAgtRunMetadata = {
    ...current,
    ...updates,
    expectedReasonForTransaction: upper(updates.expectedReasonForTransaction) ?? current.expectedReasonForTransaction,
    expectedMeteringMethod: upper(updates.expectedMeteringMethod) ?? current.expectedMeteringMethod,
    dateQualifier: upper(updates.dateQualifier) ?? current.dateQualifier,
    portalTestId: clean(updates.portalTestId) ?? current.portalTestId,
    portalTestVersion: clean(updates.portalTestVersion) ?? current.portalTestVersion,
    source: updates.source ?? current.source,
    updatedAt: new Date().toISOString(),
  }

  let purpose = 'AGT run metadata'
  let instruction = 'AGT run metadata updated from portal report/testdata.'
  let notes: string[] = []
  let actorLabel: string | null = null

  const text = clean(currentNotes)
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      purpose = asString(parsed.purpose) ?? purpose
      instruction = asString(parsed.instruction) ?? instruction
      actorLabel = asString(parsed.actorLabel)
      notes = Array.isArray(parsed.notes) ? parsed.notes.filter((item): item is string => typeof item === 'string') : notes
    } catch {
      notes = [text]
    }
  }

  return {
    metadata,
    notes: buildEdielAgtRunNotes({ purpose, instruction, actorLabel, notes, metadata }),
  }
}

function extractExpectedValue(text: string, ruleCode: '217' | '223'): string | null {
  const patterns = [
    new RegExp(`regelbeskr\\.\\s*=\\s*"${ruleCode}[^"\\n]*"[\\s\\S]{0,700}?värde enligt testfall\\s*=\\s*"([A-Za-z0-9_-]+)"`, 'i'),
    new RegExp(`${ruleCode}\\s*[-–]\\s*(?:Measuring method|Mätmetod|Reason for transaction|Transaktionstyp)[\\s\\S]{0,700}?värde enligt testfall\\s*=\\s*"([A-Za-z0-9_-]+)"`, 'i'),
    new RegExp(`${ruleCode}\\s*[-–]\\s*(?:Measuring method|Mätmetod|Reason for transaction|Transaktionstyp)\\s*[:=]\\s*([A-Za-z0-9_-]+)`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim().toUpperCase()
  }

  return null
}

function extractPortalTestId(text: string): string | null {
  const patterns = [
    /(?:test(?:fall)?\s*id|portal(?:ens)?\s*test(?:fall)?\s*id|id)\s*[:=]\s*([A-Za-z0-9_-]{3,})/i,
    /ID:\s*([A-Za-z0-9_-]{3,})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  return null
}

function extractPortalTestVersion(text: string): string | null {
  const patterns = [
    /(?:godkännandeversion|testversion|approval\s*version)\s*[:=]\s*([A-Za-z0-9_. -]{2,40})/i,
    /(?:gällande|v2023|2026A|2025A)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
    if (match?.[0]) return match[0].trim()
  }

  return null
}

export function parseEdielAgtPortalValidationReport(rawText: string | null | undefined): EdielAgtPortalReportParseResult {
  const text = String(rawText ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const expectedMeteringMethod = extractExpectedValue(text, '217')
  const expectedReasonForTransaction = extractExpectedValue(text, '223')
  const portalTestId = extractPortalTestId(text)
  const portalTestVersion = extractPortalTestVersion(text)
  const warnings: string[] = []

  if (!expectedMeteringMethod) warnings.push('Kunde inte hitta 217 / Measuring method i rapporten.')
  if (!expectedReasonForTransaction) warnings.push('Kunde inte hitta 223 / Reason for transaction i rapporten.')

  return {
    expectedReasonForTransaction,
    expectedMeteringMethod,
    portalTestId,
    portalTestVersion,
    confidence: expectedReasonForTransaction && expectedMeteringMethod ? 'high' : expectedReasonForTransaction || expectedMeteringMethod ? 'partial' : 'none',
    warnings,
  }
}

export function isL7DynamicTestDataRequired(definition: EdielAgtTestCaseDefinition): boolean {
  return definition.testCaseCode === 'L7' && definition.suite === 'PRODAT' && definition.messageCode === 'Z09'
}

export function getL7AgtExpectedValues(run: EdielTestRunRow | null | undefined): {
  reasonForTransaction: string | null
  meteringMethod: string | null
  dateQualifier: string
  source: EdielAgtRunMetadataSource
} {
  const metadata = parseEdielAgtRunMetadata(run?.notes ?? null)
  return {
    reasonForTransaction: metadata.expectedReasonForTransaction,
    meteringMethod: metadata.expectedMeteringMethod,
    dateQualifier: metadata.dateQualifier ?? '157',
    source: metadata.source,
  }
}

export function validateL7PayloadPreflight(rawPayload: string): string[] {
  const raw = String(rawPayload ?? '').toUpperCase()
  const blockers: string[] = []

  if (raw.includes('DTM+92:')) blockers.push('L7/Z09 får inte använda DTM+92 i SG8. Använd DTM+157.')
  if (!raw.includes('DTM+157:')) blockers.push('L7/Z09 saknar DTM+157 i SG8.')
  if (raw.includes('RFF+ANJ:')) blockers.push('L7/Z09 F/G ska inte skicka RFF+ANJ i AGT.')
  if (raw.includes('NAD+UD+')) blockers.push('L7/Z09 F/G ska inte skicka NAD+UD i AGT.')
  if (raw.includes('NAD+IT+')) blockers.push('L7/Z09 F/G ska inte skicka NAD+IT i AGT.')
  if (!raw.includes("NAD+Z02+")) blockers.push('L7/Z09 ska ha NAD+Z02 med test-/tenant-BRP.')

  return blockers
}
