import type { EdielMessageFamily, EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

export type EdielAgtCaseDirection = 'actor_to_portal' | 'portal_to_actor'
export type EdielAgtExpectedResponse = 'positive_contrl' | 'negative_aperak' | 'negative_utilts' | 'inbound_aperak'

export type EdielAgtCase = {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  approvalVersion: string
  testCaseCode: string
  title: string
  messageFamily: EdielMessageFamily
  messageCode: string
  direction: EdielAgtCaseDirection
  expectedResponses: EdielAgtExpectedResponse[]
  notes: string
}

export const EDIEL_AGT_APPROVAL_VERSION_2026A = '2026A'
export const EDIEL_AGT_PORTAL_EDIEL_ID = '91100'
export const EDIEL_AGT_PORTAL_SMTP = '91100@ediel.se'
export const EDIEL_AGT_PRODAT_SUB_ADDRESS = 'PRODAT'
export const EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID = '92825'

export const EDIEL_AGT_SUPPLIER_2026A_CASES: EdielAgtCase[] = [
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L1',
    title: 'PRODAT L1 · Z03',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    direction: 'actor_to_portal',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Leverantören skickar Z03 till Edielportalen. Portalen ska svara med positiv CONTRL om begärt och negativ APERAK.',
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L2',
    title: 'PRODAT L2 · Z04',
    messageFamily: 'PRODAT',
    messageCode: 'Z04',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Edielportalen skickar Z04. Leverantören ska svara med positiv CONTRL och negativ APERAK.',
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L3',
    title: 'PRODAT L3 · Z05',
    messageFamily: 'PRODAT',
    messageCode: 'Z05',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Edielportalen skickar Z05. Leverantören ska svara med positiv CONTRL och negativ APERAK.',
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L4',
    title: 'PRODAT L4 · Z06',
    messageFamily: 'PRODAT',
    messageCode: 'Z06',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Edielportalen skickar Z06. Leverantören ska svara med positiv CONTRL och negativ APERAK.',
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L5',
    title: 'PRODAT L5 · Z10',
    messageFamily: 'PRODAT',
    messageCode: 'Z10',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Edielportalen skickar Z10. Leverantören ska svara med positiv CONTRL och negativ APERAK.',
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L7',
    title: 'PRODAT L7 · Z09',
    messageFamily: 'PRODAT',
    messageCode: 'Z09',
    direction: 'actor_to_portal',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    notes: 'Leverantören skickar Z09F eller Z09G till Edielportalen. Portalen ska svara med positiv CONTRL om begärt och negativ APERAK.',
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'UL1',
    title: 'UTILTS UL1 · S03',
    messageFamily: 'UTILTS',
    messageCode: 'S03',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    notes: 'Edielportalen skickar S03. Leverantören ska svara med positiv CONTRL och negativ UTILTS; portalen svarar därefter med APERAK.',
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'UL2',
    title: 'UTILTS UL2 · E66 KVART',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    notes: 'Edielportalen skickar E66-KVART. Leverantören ska svara med positiv CONTRL och negativ UTILTS; portalen svarar därefter med APERAK.',
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'UL3',
    title: 'UTILTS UL3 · E66 SCH',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    notes: 'Edielportalen skickar E66-SCH. Leverantören ska svara med positiv CONTRL och negativ UTILTS; portalen svarar därefter med APERAK.',
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'UL4',
    title: 'UTILTS UL4 · S02',
    messageFamily: 'UTILTS',
    messageCode: 'S02',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    notes: 'Edielportalen skickar S02. Leverantören ska svara med positiv CONTRL och negativ UTILTS; portalen svarar därefter med APERAK.',
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'UL6',
    title: 'UTILTS UL6 · E31 SCH',
    messageFamily: 'UTILTS',
    messageCode: 'E31',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    notes: 'Edielportalen skickar E31-SCH. Leverantören ska svara med positiv CONTRL och negativ UTILTS; portalen svarar därefter med APERAK.',
  },
]

export function getEdielAgtSupplier2026ACase(testCaseCode: string): EdielAgtCase | null {
  const normalized = testCaseCode.trim().toUpperCase()
  return EDIEL_AGT_SUPPLIER_2026A_CASES.find((testCase) => testCase.testCaseCode === normalized) ?? null
}

export function getEdielAgtRouteName(family: 'PRODAT' | 'UTILTS'): string {
  return `AGT 2026A ${family} Edielportalen`
}
