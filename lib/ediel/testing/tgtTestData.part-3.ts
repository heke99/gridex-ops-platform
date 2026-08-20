// Extracted from tgtTestData.ts; keep public imports on the facade module.
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import type { EdielTgtCaseExpectedAck, EdielTgtCaseTestData, EdielTgtCaseTestDataGroup, EdielTgtExcelBlock, EdielTgtExcelColumn, EdielTgtExcelField } from './tgtTestData.part-1'
import { RAW_PRODAT_BLOCKS } from './tgtTestData.part-1'
import { RAW_UTILTS_BLOCKS } from './tgtTestData.part-2'

export const IMPORTANT_FIELD_CODES = new Set([
  // Core PRODAT object, customer and contract fields.
  // Keep these in the reduced testdata view; otherwise the TGT generator can
  // create structurally valid EDIFACT with empty customer fields.
  '209',
  '210',
  '211',
  '213',
  '214',
  '216',
  '217',
  '218',
  '220',
  '222',
  '223',
  '224',
  '226',
  '227',
  '228',
  '229',
  '231',
  '232',
  '233',
  '234',
  '235',
  '236',
  '237',
  '242',
  '245',
  '249',
  '250',
  '251',
  '252',
  '253',
  '254',
  '259',
  '260',
  '261',
  '262',
  '264',
  '306',
  '307',
  '309',
  '311',
  '316',
  '317',
  '318',

  // UTILTS and metering-series fields.
  '505',
  '506',
  '508',
  '509',
  '512',
  '513',
  '514',
  '515',
  '516',
  '517',
  '520',
  '527',
  '530a',
  '532',
])

export function normalize(value: string): string {
  return value.trim().toUpperCase()
}

export function blockByEntity(blocks: readonly EdielTgtExcelBlock[], entityNumber: string, sourceSheetIncludes?: string): EdielTgtExcelBlock | null {
  return (
    blocks.find((block) => {
      if (!block.entityNumbers.includes(entityNumber)) return false
      if (sourceSheetIncludes && !block.sourceSheet.toLowerCase().includes(sourceSheetIncludes.toLowerCase())) return false
      return true
    }) ?? null
  )
}

export function pickColumns(block: EdielTgtExcelBlock, selectors: string[]): EdielTgtExcelColumn[] {
  const normalizedSelectors = selectors.map(normalize)
  const selected = block.columns.filter((column) => {
    const haystack = normalize(column.name + ' ' + column.testCase)
    return normalizedSelectors.some((selector) => haystack.includes(selector))
  })
  return selected.length > 0 ? selected : [...block.columns]
}

export function pickFields(block: EdielTgtExcelBlock, columns: readonly EdielTgtExcelColumn[]): EdielTgtExcelField[] {
  const selectedColumnNames = new Set(columns.map((column) => column.name))
  const hasValueInSelectedColumn = (field: EdielTgtExcelField) =>
    Object.entries(field.values).some(([columnName, value]) => selectedColumnNames.has(columnName) && value.trim().length > 0)

  const important = block.fields.filter((field) => IMPORTANT_FIELD_CODES.has(field.fieldCode) && hasValueInSelectedColumn(field))
  const fallback = block.fields.filter(hasValueInSelectedColumn)
  return important.length > 0 ? important : fallback.slice(0, 20)
}

export function groupFor(block: EdielTgtExcelBlock | null, columnSelectors: string[]): EdielTgtCaseTestDataGroup[] {
  if (!block) return []
  const columns = pickColumns(block, columnSelectors)
  return [
    {
      block,
      columns,
      fields: pickFields(block, columns),
    },
  ]
}

export function groupsFor(blocks: Array<EdielTgtExcelBlock | null>, columnSelectors: string[]): EdielTgtCaseTestDataGroup[] {
  return blocks.flatMap((block) => groupFor(block, columnSelectors))
}

export function prodatS14SupplierSwitchData(testCaseCode: '1.4.2' | '1.4.2B'): EdielTgtCaseTestData {
  const isB = testCaseCode === '1.4.2B'
  const columns: EdielTgtExcelColumn[] = [
    { index: 1, name: 'Testkund 12 - Testdata Z03L', testCase: 'Testfall 1.4.2', sourceOrder: 1 },
    ...(isB ? [] : [
      { index: 2, name: 'Testkund 13 - Testdata Z03L', testCase: 'Testfall 1.4.2', sourceOrder: 2 },
      { index: 3, name: 'Testkund 14 - Testdata Z03L', testCase: 'Testfall 1.4.2', sourceOrder: 3 },
    ] as EdielTgtExcelColumn[]),
  ]

  const values = (testkund12: string, testkund13?: string, testkund14?: string): Record<string, string> => {
    const result: Record<string, string> = {
      [columns[0]?.name ?? 'Testkund 12 - Testdata Z03L']: testkund12,
    }
    if (!isB && columns[1]?.name && testkund13 !== undefined) result[columns[1].name] = testkund13
    if (!isB && columns[2]?.name && testkund14 !== undefined) result[columns[2].name] = testkund14
    return result
  }

  const fields: EdielTgtExcelField[] = [
    { fieldCode: '209', fieldName: 'Anläggningsid', values: values('735999888000000123', '735999888000000130', '735999888000000147') },
    { fieldCode: '210', fieldName: 'Avtal, startdatum', values: values('sätts av avsändaren (10:e i nästa månad)', 'sätts av avsändaren (10:e i nästa månad)', 'sätts av avsändaren (10:e i nästa månad)') },
    { fieldCode: '217', fieldName: 'Mätmetod', values: values('Z03 (nätägaren avgör)', 'Z03 (nätägaren avgör)', 'Z03 (nätägaren avgör)') },
    { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('Z22 (Z03L)', 'Z22 (Z03L)', 'Z22 (Z03L)') },
    { fieldCode: '260', fieldName: 'Nätområdesid', values: values('TES', 'TES', 'TES') },
    { fieldCode: '261', fieldName: 'Referens till avtal/fullmakt', values: values('sätts av avsändaren', 'sätts av avsändaren', 'sätts av avsändaren') },
    { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('196805249288', '196501022773', '193001017072') },
    { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Hanna Hållander', 'Patrik Sjöberg', 'Harald Hårfager') },
    { fieldCode: '229', fieldName: 'Adress-elanvändare', values: values('Öregrundsgatan 99', 'Höjdhoppsslingan 5B', 'Älvsjövägen 44') },
    { fieldCode: '231', fieldName: 'Postnr-elanvändare', values: values('11820', '11820', '11820') },
    { fieldCode: '232', fieldName: 'Postort-elanvändare', values: values('STOCKHOLM', 'STOCKHOLM', 'STOCKHOLM') },
    { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE', 'SE', 'SE') },
    { fieldCode: '262', fieldName: 'Balansansvarig', values: values('valfritt, skall finnas som balansansvarig i aktörsregistret', 'valfritt, skall finnas som balansansvarig i aktörsregistret', '91109') },
  ]

  const block: EdielTgtExcelBlock = {
    kind: 'PRODAT',
    sourceWorkbook: 'TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx',
    sourceSheet: 'Testkund 1 - 20 - elleverantör',
    entityLabel: isB ? 'Testkund 12' : 'Testkund 12, 13 och 14',
    entityNumbers: isB ? ['12'] : ['12', '13', '14'],
    columns,
    fields,
  }

  return {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode,
    title: isB
      ? 'Testkund 12 · S1.4.2B Z03L startdata'
      : 'Testkund 12, 13 och 14 · S1.4.2 Z03L startdata',
    sourceNote: 'Data hämtad från PRODAT bilaga 1 version el 4.0.5. Endast Z03L-startdata används vid steg 1; CONTRL och APERAK-motorn är oförändrad.',
    groups: [{ block, columns, fields }],
  }
}

export type ProdatEscoColumnName = 'Testdata - Z13V' | 'Testdata - Z14V' | 'Testdata - Z14N' | 'Testdata - Z13VH' | 'Testdata - Z14VH' | 'Testdata - Z15V' | 'Testdata - Z18V'

export type ProdatEscoFieldValue = {
  fieldCode: string
  fieldName: string
  values: Record<string, string>
}

export function prodatEscoPermissionData(testCaseCode: '8.1.1' | '8.1.2' | '8.1.3' | '8.2.1' | '9.1.1' | '9.1.2' | '9.2.1'): EdielTgtCaseTestData {
  const makeBlock = (params: {
    entityLabel: string
    entityNumbers: string[]
    columns: EdielTgtExcelColumn[]
    fields: ProdatEscoFieldValue[]
  }): EdielTgtExcelBlock => ({
    kind: 'PRODAT',
    sourceWorkbook: 'TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx',
    sourceSheet: 'Testkund 70 - 76 - ESCO',
    entityLabel: params.entityLabel,
    entityNumbers: params.entityNumbers,
    columns: params.columns,
    fields: params.fields,
  })

  const groupFrom = (block: EdielTgtExcelBlock): EdielTgtCaseTestDataGroup[] => [{ block, columns: block.columns, fields: block.fields }]

  if (testCaseCode === '8.1.2') {
    const columns: EdielTgtExcelColumn[] = [
      { index: 2, name: 'Testdata - Z13V', testCase: 'Testfall 8.1.2', sourceOrder: 1 },
      { index: 3, name: 'Testdata - Z14N', testCase: 'Testfall 8.1.2', sourceOrder: 2 },
    ]
    const values = (z13: string, z14n = '') => ({ [columns[0].name]: z13, [columns[1].name]: z14n })
    const block = makeBlock({
      entityLabel: 'Testkund 70 och 72',
      entityNumbers: ['70', '72'],
      columns,
      fields: [
        { fieldCode: '302', fieldName: 'Rapportstartdatum', values: values('sätts av avsändaren (15:e i föregående månad)') },
        { fieldCode: '217', fieldName: 'Mätmetod', values: values('Z03 (nätägaren avgör)') },
        { fieldCode: '222', fieldName: 'Rapporteringsfrekvens', values: values('D (dagligen)') },
        { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S17 (Z13V)', 'Z96 (Z14N)') },
        { fieldCode: '506', fieldName: 'Produkt id (Energiprodukt)', values: values('8716867000030 (aktiv energi)') },
        { fieldCode: '513', fieldName: 'Riktning (Typ av anläggning)', values: values('E19 (Combined)') },
        { fieldCode: '322', fieldName: 'Tillståndets status', values: values('', 'A13 (Withdrawn)') },
        { fieldCode: '323', fieldName: 'Tillståndets syfte', values: values('B71 (Samtycke)') },
        { fieldCode: '261', fieldName: 'Referens till avtal/fullmakt', values: values('sätts av avsändaren', '-') },
        { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren', 'Samma som Z13V') },
        { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('194507018820', '-') },
        { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('MARGIT PAULSSON', '-') },
        { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE', '-') },
      ],
    })
    return { suite: 'PRODAT', roleCode: 'esco', testCaseCode, title: 'Testkund 70 och 72 · Z13V/Z14N ESCO', sourceNote: 'Importerad från PRODAT bilaga 1, fliken Testkund 70 - 76 - ESCO.', groups: groupFrom(block) }
  }

  if (testCaseCode === '8.1.1' || testCaseCode === '8.2.1') {
    const isNegative = testCaseCode === '8.2.1'
    const columns: EdielTgtExcelColumn[] = isNegative
      ? [{ index: 5, name: 'Testdata - Z14V', testCase: 'Testfall 8.2.1', sourceOrder: 1 }]
      : [
          { index: 2, name: 'Testdata - Z13V', testCase: 'Testfall 8.1.1', sourceOrder: 1 },
          { index: 3, name: 'Testdata - Z14V första anl.', testCase: 'Testfall 8.1.1 (första anl.)', sourceOrder: 2 },
          { index: 4, name: 'Testdata - Z14V andra anl.', testCase: 'Testfall 8.1.1 (andra anl.)', sourceOrder: 3 },
        ]
    const names = columns.map((column) => column.name)
    const values = (...vals: string[]) => Object.fromEntries(names.map((name, index) => [name, vals[index] ?? '']))
    const block = makeBlock({
      entityLabel: 'Testkund 71',
      entityNumbers: ['71'],
      columns,
      fields: isNegative ? [
        { fieldCode: '209', fieldName: 'Anläggningsid', values: values('735999888000000710') },
        { fieldCode: '302', fieldName: 'Rapportstartdatum', values: values('sätts av avsändaren, ogiltigt datum') },
        { fieldCode: '508', fieldName: 'Tidslängd', values: values('15 (kvart)') },
        { fieldCode: '326', fieldName: 'Tillståndets tidstämpel', values: values('Sätts av avsändaren, aktuell tidpunkt') },
        { fieldCode: '217', fieldName: 'Mätmetod', values: values('Z04 (kvart)') },
        { fieldCode: '222', fieldName: 'Rapporteringsfrekvens', values: values('D (dagligen)') },
        { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S17 (Z14V)') },
        { fieldCode: '506', fieldName: 'Produkt id (Energiprodukt)', values: values('8716867000030 (aktiv energi)') },
        { fieldCode: '513', fieldName: 'Riktning (Typ av anläggning)', values: values('E17 (Consumption)') },
        { fieldCode: '322', fieldName: 'Tillståndets status', values: values('A74 (Validated)') },
        { fieldCode: '323', fieldName: 'Tillståndets syfte', values: values('B71 (Samtycke)') },
        { fieldCode: '260', fieldName: 'Nätområdesid', values: values('TES') },
        { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren') },
        { fieldCode: '325', fieldName: 'Tillståndets id', values: values('Sätts av avsändaren, annat än i testfall 8.1.1') },
        { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('195503072026') },
        { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Anna Andersson') },
        { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE') },
        { fieldCode: '233', fieldName: 'Anläggningsid', values: values('735999888000000710') },
        { fieldCode: '234', fieldName: 'Adress-anläggning', values: values('Lyckliga gatan 122') },
        { fieldCode: '235', fieldName: 'Postnr-anläggning', values: values('11820') },
        { fieldCode: '236', fieldName: 'Postort-anläggning', values: values('STOCKHOLM') },
        { fieldCode: '237', fieldName: 'Land-anläggning', values: values('SE') },
      ] : [
        { fieldCode: '209', fieldName: 'Anläggningsid', values: values('735999888000000109', '735999888000000109', '735999888000000710') },
        { fieldCode: '302', fieldName: 'Rapportstartdatum', values: values('sätts av avsändaren (15:e i föregående månad)', 'Samma som Z13V', 'Samma som Z13V') },
        { fieldCode: '508', fieldName: 'Tidslängd', values: values('', '15 (kvart)', '15 (kvart)') },
        { fieldCode: '326', fieldName: 'Tillståndets tidstämpel', values: values('', 'Tidpunkten när tillståndet skapas', 'Tidpunkten när tillståndet skapas') },
        { fieldCode: '217', fieldName: 'Mätmetod', values: values('Z04 (kvart)', 'Z04 (kvart)', 'Z04 (kvart)') },
        { fieldCode: '222', fieldName: 'Rapporteringsfrekvens', values: values('D (dagligen)', 'D (dagligen)', 'D (dagligen)') },
        { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S17 (Z13V)', 'S17 (Z14V)', 'S17 (Z14V)') },
        { fieldCode: '506', fieldName: 'Produkt id (Energiprodukt)', values: values('8716867000030 (aktiv energi)', '8716867000030 (aktiv energi)', '8716867000030 (aktiv energi)') },
        { fieldCode: '513', fieldName: 'Riktning (Typ av anläggning)', values: values('E19 (Combined)', 'E17 (Consumption)', 'E17 (Consumption)') },
        { fieldCode: '322', fieldName: 'Tillståndets status', values: values('', 'A74 (Validated)', 'A74 (Validated)') },
        { fieldCode: '323', fieldName: 'Tillståndets syfte', values: values('B71 (Samtycke)', 'B71 (Samtycke)', 'B71 (Samtycke)') },
        { fieldCode: '260', fieldName: 'Nätområdesid', values: values('', 'TES', 'TES') },
        { fieldCode: '261', fieldName: 'Referens till avtal/fullmakt', values: values('AVTALE5', '-', '-') },
        { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren', 'Samma som Z13V', 'Samma som Z13V') },
        { fieldCode: '325', fieldName: 'Tillståndets id', values: values('', 'Sätts av avsändaren', 'Sätts av avsändaren') },
        { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('195503072026', '195503072026', '195503072026') },
        { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Anna Andersson', 'Anna Andersson', 'Anna Andersson') },
        { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE', 'SE', 'SE') },
        { fieldCode: '233', fieldName: 'Anläggningsid', values: values('-', '735999888000000109', '735999888000000710') },
        { fieldCode: '234', fieldName: 'Adress-anläggning', values: values('-', 'Lyckliga gatan 119', 'Lyckliga gatan 121') },
        { fieldCode: '235', fieldName: 'Postnr-anläggning', values: values('-', '11820', '11820') },
        { fieldCode: '236', fieldName: 'Postort-anläggning', values: values('-', 'STOCKHOLM', 'STOCKHOLM') },
        { fieldCode: '237', fieldName: 'Land-anläggning', values: values('-', 'SE', 'SE') },
      ],
    })
    return { suite: 'PRODAT', roleCode: 'esco', testCaseCode, title: isNegative ? 'Testkund 71 · felaktig Z14V ESCO' : 'Testkund 71 · Z13V/Z14V ESCO', sourceNote: 'Importerad från PRODAT bilaga 1, fliken Testkund 70 - 76 - ESCO.', groups: groupFrom(block) }
  }

  if (testCaseCode === '8.1.3') {
    const columns: EdielTgtExcelColumn[] = [
      { index: 2, name: 'Testdata - Z13VH', testCase: 'Testfall 8.1.3', sourceOrder: 1 },
      { index: 3, name: 'Testdata - Z14VH', testCase: 'Testfall 8.1.3', sourceOrder: 2 },
    ]
    const values = (z13vh: string, z14vh = '') => ({ [columns[0].name]: z13vh, [columns[1].name]: z14vh })
    const block = makeBlock({
      entityLabel: 'Testkund 73',
      entityNumbers: ['73'],
      columns,
      fields: [
        { fieldCode: '209', fieldName: 'Anläggningsid', values: values('', '735999888000000734') },
        { fieldCode: '302', fieldName: 'Rapportstartdatum', values: values('sätts av avsändaren (1:a i samma månad föregående år)', 'Samma som Z13VH') },
        { fieldCode: '321', fieldName: 'Rapportslutdatum', values: values('sätts av avsändaren (1:a i föregående månad)', 'Samma som Z13VH') },
        { fieldCode: '508', fieldName: 'Tidslängd', values: values('', '15 (kvart)') },
        { fieldCode: '326', fieldName: 'Tillståndets tidstämpel', values: values('', 'Tidpunkten när tillståndet skapas') },
        { fieldCode: '217', fieldName: 'Mätmetod', values: values('Z04 (kvart)', 'Z04 (kvart)') },
        { fieldCode: '222', fieldName: 'Rapporteringsfrekvens', values: values('D (dagligen)', 'D (dagligen)') },
        { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S18 (Z13VH)', 'S18 (Z14VH)') },
        { fieldCode: '506', fieldName: 'Produkt id (Energiprodukt)', values: values('8716867000030 (aktiv energi)', '8716867000030 (aktiv energi)') },
        { fieldCode: '513', fieldName: 'Riktning (Typ av anläggning)', values: values('E19 (Combined)', 'E18 (Production)') },
        { fieldCode: '322', fieldName: 'Tillståndets status', values: values('', 'A74 (Validated)') },
        { fieldCode: '323', fieldName: 'Tillståndets syfte', values: values('B72 (Avtal)', 'B72 (Avtal)') },
        { fieldCode: '260', fieldName: 'Nätområdesid', values: values('', 'TES') },
        { fieldCode: '261', fieldName: 'Referens till avtal/fullmakt', values: values('sätts av avsändaren', '-') },
        { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren', 'Samma som Z13VH') },
        { fieldCode: '325', fieldName: 'Tillståndets id', values: values('', 'Sätts av avsändaren') },
        { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE1, 3055=260)', values: values('5560269986', '5560269986') },
        { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Sonjas Fröhandel AB', 'Sonjas Fröhandel AB') },
        { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE', 'SE') },
        { fieldCode: '233', fieldName: 'Anläggningsid', values: values('-', '735999888000000734') },
        { fieldCode: '234', fieldName: 'Adress-anläggning', values: values('-', 'Groddgatan 2') },
        { fieldCode: '235', fieldName: 'Postnr-anläggning', values: values('-', '11820') },
        { fieldCode: '236', fieldName: 'Postort-anläggning', values: values('-', 'STOCKHOLM') },
        { fieldCode: '237', fieldName: 'Land-anläggning', values: values('-', 'SE') },
      ],
    })
    return { suite: 'PRODAT', roleCode: 'esco', testCaseCode, title: 'Testkund 73 · Z13VH/Z14VH ESCO', sourceNote: 'Importerad från PRODAT bilaga 1, fliken Testkund 70 - 76 - ESCO.', groups: groupFrom(block) }
  }

  const is921 = testCaseCode === '9.2.1'
  if (testCaseCode === '9.1.1' || is921) {
    const columns: EdielTgtExcelColumn[] = [{ index: is921 ? 3 : 2, name: 'Testdata - Z15V', testCase: is921 ? 'Testfall 9.2.1' : 'Testfall 9.1.1', sourceOrder: 1 }]
    const values = (z15v: string) => ({ [columns[0].name]: z15v })
    const block = makeBlock({
      entityLabel: 'Testkund 74',
      entityNumbers: ['74'],
      columns,
      fields: [
        { fieldCode: '209', fieldName: 'Anläggningsid', values: values('735999888000000741') },
        { fieldCode: '326', fieldName: 'Tillståndets tidstämpel', values: values('sätts av avsändaren (1:a i föregående månad)') },
        { fieldCode: '327', fieldName: 'Tjänsten/rapporteringen upphör', values: values('sätts av avsändaren (Dagens datum)') },
        { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S17 (Z15V)') },
        { fieldCode: '322', fieldName: 'Tillståndets status', values: values(is921 ? 'Z75 (Ogiltig statuskod)' : 'A75 (Tillstånd ogiltigt)') },
        { fieldCode: '324', fieldName: 'Orsak till tillståndets upphörande', values: values(is921 ? 'Z79 (Ogiltig orsakskod)' : 'B79 (Tillståndet återkallat)') },
        { fieldCode: '260', fieldName: 'Nätområdesid', values: values('TES') },
        { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren') },
        { fieldCode: '325', fieldName: 'Tillståndets id', values: values('TILLST74') },
        { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('194801171770') },
        { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Ville Vessla') },
        { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE') },
      ],
    })
    return { suite: 'PRODAT', roleCode: 'esco', testCaseCode, title: is921 ? 'Testkund 74 · felaktig Z15V ESCO' : 'Testkund 74 · Z15V ESCO', sourceNote: 'Importerad från PRODAT bilaga 1, fliken Testkund 70 - 76 - ESCO.', groups: groupFrom(block) }
  }

  const columns: EdielTgtExcelColumn[] = [
    { index: 2, name: 'Testdata - Z18V', testCase: 'Testfall 9.1.2', sourceOrder: 1 },
    { index: 3, name: 'Testdata - Z15V', testCase: 'Testfall 9.1.2', sourceOrder: 2 },
  ]
  const values = (z18v: string, z15v = '') => ({ [columns[0].name]: z18v, [columns[1].name]: z15v })
  const block = makeBlock({
    entityLabel: 'Testkund 75',
    entityNumbers: ['75'],
    columns,
    fields: [
      { fieldCode: '209', fieldName: 'Anläggningsid', values: values('735999888000000758', '735999888000000758') },
      { fieldCode: '326', fieldName: 'Tillståndets tidstämpel', values: values('Får anges', 'Om angivet i Z18V, i så fall samma') },
      { fieldCode: '327', fieldName: 'Tjänsten/rapporteringen upphör', values: values('sätts av avsändaren (Dagens datum)', 'sätts av avsändaren (Dagens datum)') },
      { fieldCode: '223', fieldName: 'Transaktionstyp', values: values('S17 (Z18V)', 'S17 (Z15V)') },
      { fieldCode: '322', fieldName: 'Tillståndets status', values: values('', 'A75 (Tillstånd ogiltigt)') },
      { fieldCode: '324', fieldName: 'Orsak till tillståndets upphörande', values: values('B80 (Tillståndet uppsagt)', 'B80 (Tillståndet uppsagt)') },
      { fieldCode: '260', fieldName: 'Nätområdesid', values: values('TES', 'TES') },
      { fieldCode: '226', fieldName: 'Ärendereferens', values: values('sätts av avsändaren', 'Samma som i Z18V') },
      { fieldCode: '325', fieldName: 'Tillståndets id', values: values('sätts av avsändaren', 'Samma som i Z18V') },
      { fieldCode: '227', fieldName: 'Kund-id (DE 1131=SE2, 3055=260)', values: values('200206012387', '200206012387') },
      { fieldCode: '228', fieldName: 'Namn-elanvändare', values: values('Petronella Persson', 'Petronella Persson') },
      { fieldCode: '316', fieldName: 'Land-elanvändare', values: values('SE', 'SE') },
    ],
  })
  return { suite: 'PRODAT', roleCode: 'esco', testCaseCode, title: 'Testkund 75 · Z18V/Z15V ESCO', sourceNote: 'Importerad från PRODAT bilaga 1, fliken Testkund 70 - 76 - ESCO.', groups: groupFrom(block) }
}

export function getEdielTgtTestDataForCase(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): EdielTgtCaseTestData | null {
  const code = normalize(testCaseCode)

  if (suite === 'UTILTS' && roleCode === 'esco') {
    const utiltsEscoCases: Record<string, { title: string; expectedAck: EdielTgtCaseExpectedAck }> = {
      'U3.1.1': {
        title: 'Korrekt UTILTS-E66, periodisk månadsavl. (SCH)',
        expectedAck: { contrl: 'positive', aperak: 'positive', utiltsErr: false, reason: 'TGT U3.1 correct E66-SCH expects positive APERAK.' },
      },
      'U3.1.2': {
        title: 'Korrekt UTILTS-E66, dygnsavräknad (kvart)',
        expectedAck: { contrl: 'positive', aperak: 'positive', utiltsErr: false, reason: 'TGT U3.1 correct E66 quarter expects positive APERAK.' },
      },
      'U3.2.1': {
        title: 'Felaktig UTILTS-E66, anvisningsfel (Kvart)',
        expectedAck: { contrl: 'positive', aperak: 'negative', utiltsErr: false, reason: 'TGT U3.2 guide/application error expects negative APERAK.' },
      },
      'U3.2.2': {
        title: 'Felaktig UTILTS-E66, funktionsfel (Kvart)',
        expectedAck: { contrl: 'positive', aperak: null, utiltsErr: true, reason: 'TGT U3.2 functional error expects UTILTS_ERR.' },
      },
    }

    const utiltsEscoCase = utiltsEscoCases[code]
    if (utiltsEscoCase) {
      return {
        suite,
        roleCode,
        testCaseCode: code,
        title: utiltsEscoCase.title,
        sourceNote: 'TGT UTILTS ESCO/Energitjänsteföretag U3 expected acknowledgement profile.',
        groups: [],
        expectedAck: utiltsEscoCase.expectedAck,
      }
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.1') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 1 · Z03L/Z04L extra information',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 1.2.1.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '1'), ['Z03L', 'Z04L']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.2') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 20 · Z03LK/Z04LK minsta information',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 1.2.2.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '20'), ['Z03LK', 'Z04LK']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.4.2') {
    return prodatS14SupplierSwitchData('1.4.2')
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.4.2B') {
    return prodatS14SupplierSwitchData('1.4.2B')
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.5') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund S1 · Z04D mottagningspliktig mikroproduktion',
      sourceNote: 'Data hämtas från PRODAT-testdataregistret. Om Edielportalen visar avvikande värden ska testdataregistret uppdateras, inte generatorn hårdkodas.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '1'), ['Z03L', 'Z04L']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '2.5.1') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 11 · Z09F avtal om 15-minutersvärden',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 2.5.1 Z09F.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '11'), ['Z09F']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '2.5.2') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 18 · Z09G avtal om 15-minutersvärden upphör',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 2.5.2 Z09G.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '18'), ['Z09G']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '2.5.3') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 10 · Z09D nytt avtal om mikroproduktion',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 2.5.3 Z09D.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '10'), ['Z09D']),
    }
  }



  if (suite === 'PRODAT' && roleCode === 'esco' && ['8.1.1', '8.1.2', '8.1.3', '8.2.1', '9.1.1', '9.1.2', '9.2.1'].includes(code)) {
    return prodatEscoPermissionData(code as '8.1.1' | '8.1.2' | '8.1.3' | '8.2.1' | '9.1.1' | '9.1.2' | '9.2.1')
  }

  if (suite === 'UTILTS' && roleCode === 'supplier' && code === 'U2.1') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'UTILTS E66 · korrekt mottagning',
      sourceNote: 'Importerad från UTILTS bilaga 1, elmarknad. Visar representativa E66-S testanläggningar för leverantörsrollen.',
      groups: groupsFor(
        [
          blockByEntity(RAW_UTILTS_BLOCKS, '4', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '5', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '7', 'lev'),
        ],
        ['E66-S']
      ),
    }
  }


  if (suite === 'PRODAT' && roleCode === 'esco' && ['8.1.1', '8.1.2', '8.1.3', '8.2.1', '9.1.1', '9.1.2', '9.2.1'].includes(code)) {
    return prodatEscoPermissionData(code as '8.1.1' | '8.1.2' | '8.1.3' | '8.2.1' | '9.1.1' | '9.1.2' | '9.2.1')
  }

  if (suite === 'UTILTS' && roleCode === 'supplier' && code === 'U2.2') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'UTILTS E66 · felhantering',
      sourceNote: 'Importerad från UTILTS bilaga 1, elmarknad. Används som underlag för negativ APERAK/UTILTS-ERR-test.',
      groups: groupsFor(
        [
          blockByEntity(RAW_UTILTS_BLOCKS, '5', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '7', 'lev'),
        ],
        ['E66-S']
      ),
    }
  }

  return null
}

export function getEdielTgtAvailableTestDataBlocks(): readonly EdielTgtExcelBlock[] {
  return [...RAW_PRODAT_BLOCKS, ...RAW_UTILTS_BLOCKS]
}
