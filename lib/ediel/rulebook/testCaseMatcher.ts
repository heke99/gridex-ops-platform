import { activeRulebookRules, processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'

export type RulebookTestCase = {
  testCaseCode: string
  suite: string
  title: string
  role: string
  family: string
  code: string
  subtype: string | null
  processGroup: string
  expectedContrl: string
  expectedAperak: string
  expectedUtiltsErr: string
  mandatory: boolean
}

const ESCO_PRODAT: RulebookTestCase[] = [
  ['E3', 'PRODAT Z13V', 'Z13', 'V'],
  ['E4', 'PRODAT Z13VH', 'Z13', 'VH'],
  ['E5', 'PRODAT Z14V', 'Z14', 'V'],
  ['E6', 'PRODAT Z14N', 'Z14', 'N'],
  ['E7', 'PRODAT Z15V', 'Z15', 'V'],
  ['E8', 'PRODAT Z18V', 'Z18', 'V'],
].map(([code, title, messageCode, subtype]) => ({
  testCaseCode: code,
  suite: 'AGT_PRODAT_ESCO',
  title,
  role: 'energy_service_company',
  family: 'PRODAT',
  code: messageCode,
  subtype,
  processGroup: processGroupForMessage('PRODAT', messageCode),
  expectedContrl: 'positive',
  expectedAperak: 'positive_or_negative_by_case',
  expectedUtiltsErr: 'not_required',
  mandatory: true,
}))

const ESCO_UTILTS: RulebookTestCase[] = [
  { testCaseCode: 'UE1', suite: 'AGT_UTILTS_ESCO', title: 'UTILTS E66-KVART', role: 'energy_service_company', family: 'UTILTS', code: 'E66', subtype: 'KVART', processGroup: 'meter_values', expectedContrl: 'positive', expectedAperak: 'positive', expectedUtiltsErr: 'not_required', mandatory: true },
  { testCaseCode: 'UE2', suite: 'AGT_UTILTS_ESCO', title: 'UTILTS E66-SCH', role: 'energy_service_company', family: 'UTILTS', code: 'E66', subtype: 'SCH', processGroup: 'meter_values', expectedContrl: 'positive', expectedAperak: 'positive', expectedUtiltsErr: 'not_required', mandatory: true },
]

const TGT_ESCO: RulebookTestCase[] = [
  ['8.1.1', 'Korrekt Z13V → Z14V', 'PRODAT', 'Z13', 'V'],
  ['8.1.2', 'Korrekt Z13V → Z14N', 'PRODAT', 'Z13', 'V'],
  ['8.1.3', 'Korrekt Z13VH → Z14VH', 'PRODAT', 'Z13', 'VH'],
  ['8.2.1', 'Avvisad Z14V', 'PRODAT', 'Z14', 'V'],
  ['9.1.1', 'Z15V', 'PRODAT', 'Z15', 'V'],
  ['9.1.2', 'Z18V → Z15V', 'PRODAT', 'Z18', 'V'],
  ['9.2.1', 'Avvisad Z15V', 'PRODAT', 'Z15', 'V'],
  ['U3.1.1', 'Korrekt UTILTS E66-SCH', 'UTILTS', 'E66', 'SCH'],
  ['U3.1.2', 'Korrekt UTILTS E66-KVART', 'UTILTS', 'E66', 'KVART'],
  ['U3.2.1', 'Felaktig UTILTS E66 anvisningsfel kvart', 'UTILTS', 'E66', 'KVART'],
  ['U3.2.2', 'Felaktig UTILTS E66 funktionsfel kvart', 'UTILTS', 'E66', 'KVART'],
].map(([testCaseCode, title, family, code, subtype]) => ({
  testCaseCode,
  suite: 'TGT_ESCO',
  title,
  role: 'energy_service_company',
  family,
  code,
  subtype,
  processGroup: processGroupForMessage(family, code),
  expectedContrl: 'by_case',
  expectedAperak: 'by_case',
  expectedUtiltsErr: String(testCaseCode).includes('U3.2.2') ? 'required' : 'not_required',
  mandatory: true,
}))

export function listRulebookTestCases(): RulebookTestCase[] {
  const supplierCaseRows: Array<[string, string, string, string, string | null]> = [
    ['L1', 'PRODAT Z03', 'PRODAT', 'Z03', 'L'],
    ['L2', 'PRODAT Z04', 'PRODAT', 'Z04', 'L'],
    ['L3', 'PRODAT Z05', 'PRODAT', 'Z05', 'L'],
    ['L4', 'PRODAT Z06', 'PRODAT', 'Z06', 'E'],
    ['L5', 'PRODAT Z10', 'PRODAT', 'Z10', 'M'],
    ['L7', 'PRODAT Z09', 'PRODAT', 'Z09', 'F'],
    ['UL1', 'UTILTS S03', 'UTILTS', 'S03', null],
    ['UL2', 'UTILTS E66-KVART', 'UTILTS', 'E66', 'KVART'],
    ['UL3', 'UTILTS E66-SCH', 'UTILTS', 'E66', 'SCH'],
    ['UL4', 'UTILTS S02', 'UTILTS', 'S02', null],
    ['UL6', 'UTILTS E31-SCH', 'UTILTS', 'E31', 'SCH'],
  ]
  const supplierCases: RulebookTestCase[] = supplierCaseRows.map(([testCaseCode, title, family, code, subtype]) => ({
    testCaseCode,
    suite: String(testCaseCode).startsWith('UL') ? 'AGT_UTILTS_SUPPLIER' : 'AGT_PRODAT_SUPPLIER',
    title,
    role: 'supplier',
    family,
    code,
    subtype,
    processGroup: processGroupForMessage(family, code),
    expectedContrl: 'positive',
    expectedAperak: 'by_case',
    expectedUtiltsErr: 'not_required',
    mandatory: true,
  }))

  const ruleCases = activeRulebookRules().map((rule) => ({
    testCaseCode: `RULE-${rule.family}-${rule.code}`,
    suite: 'RULEBOOK_REGRESSION',
    title: `${rule.family} ${rule.code} regelkontroll`,
    role: 'platform',
    family: String(rule.family),
    code: rule.code,
    subtype: null,
    processGroup: rule.processGroup,
    expectedContrl: rule.requiresContrl ? 'required' : 'not_required',
    expectedAperak: rule.requiresAperak ? 'required' : 'not_required',
    expectedUtiltsErr: rule.requiresUtiltsErr ? 'conditional' : 'not_required',
    mandatory: true,
  }))

  return [...supplierCases, ...ESCO_PRODAT, ...ESCO_UTILTS, ...TGT_ESCO, ...ruleCases]
}

export function findRulebookTestCase(testCaseCode: string | null | undefined): RulebookTestCase | null {
  const normalized = String(testCaseCode ?? '').trim().toUpperCase()
  return listRulebookTestCases().find((testCase) => testCase.testCaseCode.toUpperCase() === normalized) ?? null
}
