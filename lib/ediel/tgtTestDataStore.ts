// lib/ediel/tgtTestDataStore.ts

import { supabaseService } from '@/lib/supabase/service'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import type {
  EdielTgtCaseTestData,
  EdielTgtExcelBlock,
  EdielTgtExcelColumn,
  EdielTgtExcelField,
} from '@/lib/ediel/tgtTestData'

export type EdielTgtDynamicTestDataRow = {
  id: string
  test_suite: EdielTestSuite
  role_code: EdielTestRoleCode
  test_case_code: string
  title: string | null
  source_note: string | null
  raw_text: string
  parsed_payload: EdielTgtCaseTestData | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type EdielTgtDynamicTestDataSummary = {
  id: string
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title: string
  sourceNote: string
  rawText: string
  parsedPayload: EdielTgtCaseTestData | null
  updatedAt: string
  updatedBy: string | null
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function normalizeFieldValue(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}


const KNOWN_PORTAL_FIELD_NAMES: Record<string, string> = {
  '209': 'Anläggningsid',
  '210': 'Avtal, startdatum',
  '213': 'Uppskattad årsenergi',
  '214': 'Konstant för mätare',
  '217': 'Mätmetod',
  '218': 'Antal siffror, mätare',
  '222': 'Rapporteringsfrekvens',
  '223': 'Transaktionstyp',
  '224': 'Mätarnummer',
  '227': 'Kund-id',
  '228': 'Namn-elanvändare',
  '229': 'Adress-elanvändare',
  '231': 'Postnr-elanvändare',
  '232': 'Postort-elanvändare',
  '233': 'Anläggningsid',
  '234': 'Address-anläggning',
  '235': 'Postnr-anläggning',
  '236': 'Postort-anläggning',
  '237': 'Land-anläggning',
  '242': 'Produktkod',
  '249': 'Födelsedatum',
  '250': 'Fakturamottagare-id',
  '251': 'Namn-fakturamottagare',
  '252': 'Address-fakturamottagare',
  '253': 'Postnr-fakturamottagare',
  '254': 'Avräkningsmetod',
  '259': 'Mätare, tidsintervall',
  '260': 'Nätområdesid',
  '261': 'Referens till avtal/fullmakt',
  '262': 'Balansansvarig',
  '306': 'Installationsstatus',
  '316': 'Land-elanvändare',
  '317': 'Postort-fakturamottagare',
  '318': 'Land-fakturamottagare',
  '508B': 'Upplösning',
}


const KNOWN_PORTAL_FIELD_ALIASES: Record<string, string[]> = {
  '234': ['Address-anläggning', 'Adress-anläggning', 'Address-anlaggning', 'Adress-anlaggning'],
  '252': ['Address-fakturamottagare', 'Adress-fakturamottagare'],
  '261': ['Referens till avtal/fullmakt', 'Referens til avtal/fullmakt'],
}

function parseKnownPortalFieldLine(cleaned: string): EdielTgtExcelField | null {
  const codeMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+(.+)$/)
  if (!codeMatch) return null

  const fieldCode = normalizeCode(codeMatch[1] ?? '')
  const rest = normalizeFieldValue(codeMatch[2] ?? '')
  const knownName = KNOWN_PORTAL_FIELD_NAMES[fieldCode]
  if (!knownName) return null

  const normalizedKnown = knownName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const normalizedRest = rest.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (normalizedRest.startsWith(normalizedKnown)) {
    const value = normalizeFieldValue(rest.slice(knownName.length))
    if (value) {
      return {
        fieldCode,
        fieldName: knownName,
        values: { Portaltestdata: value },
      }
    }
  }

  return null
}

function parsePortalFieldLine(line: string): EdielTgtExcelField | null {
  const cleaned = line.replace(/^[-•*]\s*/, '').trim()
  if (!cleaned) return null

  const knownField = parseKnownPortalFieldLine(cleaned)
  if (knownField) return knownField

  const tabParts = cleaned.split('\t').map((part) => part.trim()).filter(Boolean)
  if (tabParts.length >= 3 && /^\d{3}[A-Za-z]?$/.test(tabParts[0] ?? '')) {
    return {
      fieldCode: normalizeCode(tabParts[0]),
      fieldName: tabParts[1] ?? '',
      values: { Portaltestdata: normalizeFieldValue(tabParts.slice(2).join(' ')) },
    }
  }

  const fieldMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+(.+?)\s{2,}(.+)$/)
  if (fieldMatch) {
    return {
      fieldCode: normalizeCode(fieldMatch[1] ?? ''),
      fieldName: normalizeFieldValue(fieldMatch[2] ?? ''),
      values: { Portaltestdata: normalizeFieldValue(fieldMatch[3] ?? '') },
    }
  }

  const looseMatch = cleaned.match(/^(\d{3}[A-Za-z]?)\s+([^\d].*?)\s+(\S.*)$/)
  if (looseMatch) {
    const fieldCode = normalizeCode(looseMatch[1] ?? '')
    const fieldName = normalizeFieldValue(looseMatch[2] ?? '')
    const value = normalizeFieldValue(looseMatch[3] ?? '')

    if (fieldCode && fieldName && value) {
      return {
        fieldCode,
        fieldName,
        values: { Portaltestdata: value },
      }
    }
  }

  const namedMatch = cleaned.match(/^(Reference to metering point)\s+(.+)$/i)
  if (namedMatch) {
    return {
      fieldCode: 'REF_MP',
      fieldName: 'Reference to metering point',
      values: { Portaltestdata: normalizeFieldValue(namedMatch[2] ?? '') },
    }
  }

  const unitMatch = cleaned.match(/^(Enhet för uppskattad årsenergi)\s+(.+)$/i)
  if (unitMatch) {
    return {
      fieldCode: 'UNIT_213',
      fieldName: 'Enhet för uppskattad årsenergi',
      values: { Portaltestdata: normalizeFieldValue(unitMatch[2] ?? '') },
    }
  }

  return null
}

function mergeDuplicateFields(fields: EdielTgtExcelField[]): EdielTgtExcelField[] {
  const byKey = new Map<string, EdielTgtExcelField>()

  for (const field of fields) {
    const key = `${field.fieldCode}|${field.fieldName}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, field)
      continue
    }

    const existingValue = existing.values.Portaltestdata ?? ''
    const incomingValue = field.values.Portaltestdata ?? ''
    if (!existingValue && incomingValue) {
      existing.values.Portaltestdata = incomingValue
    }
  }

  return Array.from(byKey.values())
}

export function parseEdielPortalTestDataText(input: {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title?: string | null
  rawText: string
}): EdielTgtCaseTestData {
  const rawText = normalizeText(input.rawText)
  const fields = mergeDuplicateFields(
    rawText
      .split('\n')
      .map(parsePortalFieldLine)
      .filter((field): field is EdielTgtExcelField => Boolean(field))
  )

  const column: EdielTgtExcelColumn = {
    index: 1,
    name: 'Portaltestdata',
    testCase: input.testCaseCode,
  }

  const block: EdielTgtExcelBlock = {
    kind: input.suite === 'PRODAT' ? 'PRODAT' : 'UTILTS',
    sourceWorkbook: 'Edielportalen testdata – manuellt importerad',
    sourceSheet: `TGT ${input.testCaseCode}`,
    entityLabel: input.title?.trim() || `TGT ${input.testCaseCode}`,
    entityNumbers: [input.testCaseCode],
    columns: [column],
    fields,
  }

  return {
    suite: input.suite,
    roleCode: input.roleCode,
    testCaseCode: input.testCaseCode,
    title: input.title?.trim() || `TGT ${input.testCaseCode} · importerad testdata`,
    sourceNote: 'Importerad från Edielportalens testdatafält. Generatorn läser denna data före statiska bilagor.',
    groups: [
      {
        block,
        columns: [column],
        fields,
      },
    ],
  }
}

function isMissingTableError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '42P01')
}

function mapRow(row: EdielTgtDynamicTestDataRow): EdielTgtDynamicTestDataSummary {
  return {
    id: row.id,
    testSuite: row.test_suite,
    roleCode: row.role_code,
    testCaseCode: row.test_case_code,
    title: row.title ?? row.parsed_payload?.title ?? `TGT ${row.test_case_code}`,
    sourceNote: row.source_note ?? row.parsed_payload?.sourceNote ?? 'Importerad från Edielportalen.',
    rawText: row.raw_text,
    parsedPayload: row.parsed_payload,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function listEdielTgtDynamicTestData(): Promise<EdielTgtDynamicTestDataSummary[]> {
  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .select('*')
    .order('test_suite', { ascending: true })
    .order('role_code', { ascending: true })
    .order('test_case_code', { ascending: true })

  if (error) {
    if (isMissingTableError(error)) return []
    throw error
  }
  return ((data ?? []) as EdielTgtDynamicTestDataRow[]).map(mapRow)
}

export async function getEdielTgtDynamicTestDataForCase(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): Promise<EdielTgtCaseTestData | null> {
  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .select('parsed_payload')
    .eq('test_suite', suite)
    .eq('role_code', roleCode)
    .eq('test_case_code', testCaseCode)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  return (data?.parsed_payload as EdielTgtCaseTestData | null | undefined) ?? null
}

export async function upsertEdielTgtDynamicTestData(input: {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title?: string | null
  rawText: string
  actorUserId?: string | null
}): Promise<EdielTgtDynamicTestDataSummary> {
  const parsedPayload = parseEdielPortalTestDataText({
    suite: input.suite,
    roleCode: input.roleCode,
    testCaseCode: input.testCaseCode,
    title: input.title,
    rawText: input.rawText,
  })

  if (parsedPayload.groups[0]?.fields.length === 0) {
    throw new Error('Ingen testdata kunde läsas. Klistra in rader från Edielportalen, t.ex. "209 Anläggningsid 735...".')
  }

  const payload = {
    test_suite: input.suite,
    role_code: input.roleCode,
    test_case_code: input.testCaseCode,
    title: input.title?.trim() || parsedPayload.title,
    source_note: parsedPayload.sourceNote,
    raw_text: normalizeText(input.rawText),
    parsed_payload: parsedPayload,
    updated_by: input.actorUserId ?? null,
    created_by: input.actorUserId ?? null,
  }

  const { data, error } = await supabaseService
    .from('ediel_tgt_test_data')
    .upsert(payload, { onConflict: 'test_suite,role_code,test_case_code' })
    .select('*')
    .single()

  if (error) throw error
  return mapRow(data as EdielTgtDynamicTestDataRow)
}
