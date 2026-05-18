import type { EdielMessageFamily, EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

export type EdielAgtScenario = 'actor_sends_and_receives_ack' | 'portal_sends_actor_answers'
export type EdielAgtCaseDirection = 'actor_to_portal' | 'portal_to_actor'
export type EdielAgtStepActor = 'actor' | 'portal'
export type EdielAgtStepDirection = 'inbound' | 'outbound'
export type EdielAgtExpectedResponse = 'positive_contrl' | 'negative_aperak' | 'negative_utilts' | 'inbound_aperak'

export type EdielAgtExpectedStep = {
  stepNo: number
  actor: EdielAgtStepActor
  direction: EdielAgtStepDirection
  family: EdielMessageFamily
  code: string
  title: string
}

export type EdielAgtTestCaseDefinition = {
  suite: Extract<EdielTestSuite, 'PRODAT' | 'UTILTS'>
  roleCode: Extract<EdielTestRoleCode, 'supplier'>
  approvalVersion: string
  testCaseCode: string
  title: string
  portalTitle: string
  purpose: string
  agtInstruction: string
  notes: string[]
  messageFamily: Extract<EdielMessageFamily, 'PRODAT' | 'UTILTS'>
  messageCode: string
  messageVariant: string | null
  scenario: EdielAgtScenario
  direction: EdielAgtCaseDirection
  expectedResponses: EdielAgtExpectedResponse[]
  expectedSteps: EdielAgtExpectedStep[]
}

// Backwards-compatible alias for older UI/components that imported EdielAgtCase.
export type EdielAgtCase = EdielAgtTestCaseDefinition

export const EDIEL_AGT_APPROVAL_VERSION_2026A = '2026A'
export const EDIEL_AGT_APPROVAL_VERSION_LABEL_2026A = 'AGT 2026A'
export const EDIEL_AGT_PORTAL_EDIEL_ID = '91100'
export const EDIEL_AGT_PORTAL_SMTP = '91100@ediel.se'
export const EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS = 'PRODAT'
export const EDIEL_AGT_PRODAT_SENDER_SUB_ADDRESS: string | null = null
// Backwards-compatible alias. In supplier AGT PRODAT this means the portal/receiver subaddress.
export const EDIEL_AGT_PRODAT_SUB_ADDRESS = EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS
export const EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID = '92825'

function actorOutbound(stepNo: number, family: EdielMessageFamily, code: string, title: string): EdielAgtExpectedStep {
  return { stepNo, actor: 'actor', direction: 'outbound', family, code, title }
}

function portalInbound(stepNo: number, family: EdielMessageFamily, code: string, title: string): EdielAgtExpectedStep {
  return { stepNo, actor: 'portal', direction: 'inbound', family, code, title }
}

function prodatPortalToActor(params: {
  testCaseCode: string
  messageCode: string
  title: string
  purpose: string
  instruction: string
}): EdielAgtTestCaseDefinition {
  return {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: params.testCaseCode,
    title: params.title,
    portalTitle: params.title,
    purpose: params.purpose,
    agtInstruction: params.instruction,
    notes: [
      'Edielportalen agerar nätägare och skickar meddelandet till leverantören.',
      'Leverantören ska svara med positiv CONTRL och negativ APERAK eftersom portalens testdata inte finns i produktionsapplikationen.',
    ],
    messageFamily: 'PRODAT',
    messageCode: params.messageCode,
    messageVariant: null,
    scenario: 'portal_sends_actor_answers',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    expectedSteps: [
      portalInbound(1, 'PRODAT', params.messageCode, `Edielportalen skickar ${params.messageCode}`),
      actorOutbound(2, 'CONTRL', 'CONTRL', 'Positiv CONTRL till Edielportalen'),
      actorOutbound(3, 'APERAK', 'APERAK', 'Negativ APERAK till Edielportalen'),
    ],
  }
}

function utiltsPortalToActor(params: {
  testCaseCode: string
  messageCode: string
  messageVariant: string | null
  title: string
  purpose: string
  instruction: string
}): EdielAgtTestCaseDefinition {
  return {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: params.testCaseCode,
    title: params.title,
    portalTitle: params.title,
    purpose: params.purpose,
    agtInstruction: params.instruction,
    notes: [
      'Edielportalen agerar nätägare och skickar UTILTS till leverantören.',
      'Leverantören ska svara med positiv CONTRL och negativ UTILTS/UTILTS_ERR. Därefter skickar Edielportalen APERAK tillbaka till leverantören.',
    ],
    messageFamily: 'UTILTS',
    messageCode: params.messageCode,
    messageVariant: params.messageVariant,
    scenario: 'portal_sends_actor_answers',
    direction: 'portal_to_actor',
    expectedResponses: ['positive_contrl', 'negative_utilts', 'inbound_aperak'],
    expectedSteps: [
      portalInbound(1, 'UTILTS', params.messageCode, `Edielportalen skickar ${params.messageCode}${params.messageVariant ? ` ${params.messageVariant}` : ''}`),
      actorOutbound(2, 'CONTRL', 'CONTRL', 'Positiv CONTRL till Edielportalen'),
      actorOutbound(3, 'UTILTS_ERR', 'UTILTS_ERR', 'Negativ UTILTS/UTILTS_ERR till Edielportalen'),
      portalInbound(4, 'APERAK', 'APERAK', 'Edielportalen skickar APERAK på negativ UTILTS'),
    ],
  }
}

export const EDIEL_AGT_SUPPLIER_2026A_CASES: EdielAgtTestCaseDefinition[] = [
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L1',
    title: 'PRODAT L1 · Z03',
    portalTitle: 'L1 – PRODAT Z03',
    purpose: 'Verifierar att leverantören kan skicka PRODAT Z03 till Edielportalen och ta emot positiv CONTRL samt negativ APERAK.',
    agtInstruction: 'Starta L1 i Edielportalen. Skapa därefter ett outbound Z03-draft i systemet, kontrollera att leverantörens Ediel-id är avsändare, att avsändarens UNB-subadress matchar Edielportalen, att mottagare är 91100:ZZ:PRODAT, skicka filen och invänta CONTRL + APERAK från portalen.',
    notes: [
      'Leverantören skickar Z03 till Edielportalen.',
      'Nätägaren och mottagaren i Z03 ska vara Ediel-id 91100. UNB avsändar-subadress ska följa aktörens Edielregisterprofil; för Div3rsa är den tom, medan mottagaren har subadress PRODAT.',
      'Portalen svarar med positiv CONTRL om CONTRL är begärd och därefter negativ APERAK.',
    ],
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    messageVariant: null,
    scenario: 'actor_sends_and_receives_ack',
    direction: 'actor_to_portal',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    expectedSteps: [
      actorOutbound(1, 'PRODAT', 'Z03', 'Leverantören skickar Z03'),
      portalInbound(2, 'CONTRL', 'CONTRL', 'Edielportalen skickar positiv CONTRL om begärd'),
      portalInbound(3, 'APERAK', 'APERAK', 'Edielportalen skickar negativ APERAK'),
    ],
  },
  prodatPortalToActor({
    testCaseCode: 'L2',
    messageCode: 'Z04',
    title: 'PRODAT L2 · Z04',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z04, skicka positiv CONTRL och negativ APERAK.',
    instruction: 'Starta L2 i Edielportalen. Vänta på inbound Z04 från portalen, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  prodatPortalToActor({
    testCaseCode: 'L3',
    messageCode: 'Z05',
    title: 'PRODAT L3 · Z05',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z05, skicka positiv CONTRL och negativ APERAK.',
    instruction: 'Starta L3 i Edielportalen. Vänta på inbound Z05 från portalen, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  prodatPortalToActor({
    testCaseCode: 'L4',
    messageCode: 'Z06',
    title: 'PRODAT L4 · Z06',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z06, skicka positiv CONTRL och negativ APERAK.',
    instruction: 'Starta L4 i Edielportalen. Vänta på inbound Z06 från portalen, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  prodatPortalToActor({
    testCaseCode: 'L5',
    messageCode: 'Z10',
    title: 'PRODAT L5 · Z10',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z10, skicka positiv CONTRL och negativ APERAK.',
    instruction: 'Starta L5 i Edielportalen. Vänta på inbound Z10 från portalen, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    testCaseCode: 'L7',
    title: 'PRODAT L7 · Z09',
    portalTitle: 'L7 – PRODAT Z09',
    purpose: 'Verifierar att leverantören kan skicka PRODAT Z09 till Edielportalen och ta emot positiv CONTRL samt negativ APERAK.',
    agtInstruction: 'Starta L7 i Edielportalen. Spara portalens test-id/testversion och klistra in eventuell testdata eller valideringsrapport på aktiv run. Skapa därefter outbound Z09-draft; generatorn läser 223 Reason for transaction och 217 Measuring method från run-data, använder DTM+157 i SG8, skickar till 91100:ZZ:PRODAT och inväntar CONTRL + APERAK från portalen.',
    notes: [
      'Leverantören skickar Z09 till Edielportalen.',
      'L7 ska använda SG8/DTM+157 i stället för DTM+92. Det är facit från portalens L7-validering.',
      'L7 ska inte vara hårdkodad till E64/Z03 eller E32/Z04. Den aktiva runnen måste bära portalens förväntade 223 Reason for transaction och 217 Measuring method.',
      'Nätägaren och mottagaren i Z09 ska vara Ediel-id 91100. UNB avsändar-subadress ska följa aktörens Edielregisterprofil; för Div3rsa är den tom, medan mottagaren har subadress PRODAT.',
      'Portalen svarar med positiv CONTRL om CONTRL är begärd och därefter negativ APERAK.',
    ],
    messageFamily: 'PRODAT',
    messageCode: 'Z09',
    messageVariant: 'F/G',
    scenario: 'actor_sends_and_receives_ack',
    direction: 'actor_to_portal',
    expectedResponses: ['positive_contrl', 'negative_aperak'],
    expectedSteps: [
      actorOutbound(1, 'PRODAT', 'Z09', 'Leverantören skickar Z09F/Z09G'),
      portalInbound(2, 'CONTRL', 'CONTRL', 'Edielportalen skickar positiv CONTRL om begärd'),
      portalInbound(3, 'APERAK', 'APERAK', 'Edielportalen skickar negativ APERAK'),
    ],
  },
  utiltsPortalToActor({
    testCaseCode: 'UL1',
    messageCode: 'S03',
    messageVariant: null,
    title: 'UTILTS UL1 · S03',
    purpose: 'Verifierar att leverantören kan ta emot UTILTS S03, skicka positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    instruction: 'Starta UL1 i Edielportalen. Vänta på inbound S03, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  utiltsPortalToActor({
    testCaseCode: 'UL2',
    messageCode: 'E66',
    messageVariant: 'KVART',
    title: 'UTILTS UL2 · E66 KVART',
    purpose: 'Verifierar att leverantören kan ta emot UTILTS E66 med kvartsvärden, skicka positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    instruction: 'Starta UL2 i Edielportalen. Vänta på inbound E66 KVART, importera filen med motorläge AGT och ange UL2 om systemet behöver skilja E66-fallen.',
  }),
  utiltsPortalToActor({
    testCaseCode: 'UL3',
    messageCode: 'E66',
    messageVariant: 'SCH',
    title: 'UTILTS UL3 · E66 SCH',
    purpose: 'Verifierar att leverantören kan ta emot UTILTS E66-SCH, skicka positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    instruction: 'Starta UL3 i Edielportalen. Vänta på inbound E66-SCH, importera filen med motorläge AGT och ange UL3 om systemet behöver skilja E66-fallen.',
  }),
  utiltsPortalToActor({
    testCaseCode: 'UL4',
    messageCode: 'S02',
    messageVariant: null,
    title: 'UTILTS UL4 · S02',
    purpose: 'Verifierar att leverantören kan ta emot UTILTS S02, skicka positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    instruction: 'Starta UL4 i Edielportalen. Vänta på inbound S02, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
  utiltsPortalToActor({
    testCaseCode: 'UL6',
    messageCode: 'E31',
    messageVariant: 'SCH',
    title: 'UTILTS UL6 · E31 SCH',
    purpose: 'Verifierar att leverantören kan ta emot UTILTS E31-SCH, skicka positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    instruction: 'Starta UL6 i Edielportalen om den visas/krävs. Vänta på inbound E31-SCH, importera filen med motorläge AGT och skapa AGT-svar från inbound-raden.',
  }),
]

export function isEdielAgtRunApprovalVersion(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized === EDIEL_AGT_APPROVAL_VERSION_2026A || normalized.startsWith(`${EDIEL_AGT_APPROVAL_VERSION_LABEL_2026A} `) || normalized.startsWith(`${EDIEL_AGT_APPROVAL_VERSION_LABEL_2026A} ·`)
}

export function listEdielSupplierAgt2026Cases(params?: {
  suite?: 'PRODAT' | 'UTILTS' | null
}): EdielAgtTestCaseDefinition[] {
  const suite = params?.suite ?? null
  return EDIEL_AGT_SUPPLIER_2026A_CASES.filter((testCase) => !suite || testCase.suite === suite)
}

export function getEdielAgtSupplier2026ACase(testCaseCode: string): EdielAgtTestCaseDefinition | null {
  const normalized = String(testCaseCode ?? '').trim().toUpperCase()
  return EDIEL_AGT_SUPPLIER_2026A_CASES.find((testCase) => testCase.testCaseCode === normalized) ?? null
}

export function getEdielAgtTestCaseByCode(params: {
  suite?: EdielTestSuite | string | null
  roleCode?: EdielTestRoleCode | string | null
  testCaseCode: string
}): EdielAgtTestCaseDefinition | null {
  const suite = params.suite ? String(params.suite).toUpperCase() : null
  const roleCode = params.roleCode ? String(params.roleCode).toLowerCase() : 'supplier'
  const testCaseCode = String(params.testCaseCode ?? '').trim().toUpperCase()

  return EDIEL_AGT_SUPPLIER_2026A_CASES.find((testCase) =>
    testCase.testCaseCode === testCaseCode &&
    (!suite || testCase.suite === suite) &&
    testCase.roleCode === roleCode
  ) ?? null
}

function rawContains(rawPayload: string | null | undefined, values: string[]): boolean {
  const raw = String(rawPayload ?? '').toUpperCase()
  return values.some((value) => raw.includes(value.toUpperCase()))
}

export function inferEdielAgtCaseForInboundMessage(params: {
  family: string | null
  code: string | null
  rawPayload?: string | null
  applicationReference?: string | null
  explicitTestCaseCode?: string | null
}): EdielAgtTestCaseDefinition | null {
  const explicit = String(params.explicitTestCaseCode ?? '').trim().toUpperCase()
  if (explicit) return getEdielAgtTestCaseByCode({ roleCode: 'supplier', testCaseCode: explicit })

  const family = String(params.family ?? '').trim().toUpperCase()
  const code = String(params.code ?? '').trim().toUpperCase()

  if (family === 'PRODAT') {
    if (code === 'Z04') return getEdielAgtSupplier2026ACase('L2')
    if (code === 'Z05') return getEdielAgtSupplier2026ACase('L3')
    if (code === 'Z06') return getEdielAgtSupplier2026ACase('L4')
    if (code === 'Z10') return getEdielAgtSupplier2026ACase('L5')
  }

  if (family === 'UTILTS') {
    if (code === 'S03') return getEdielAgtSupplier2026ACase('UL1')
    if (code === 'S02') return getEdielAgtSupplier2026ACase('UL4')
    if (code === 'E31') return getEdielAgtSupplier2026ACase('UL6')
    if (code === 'E66') {
      if (rawContains(params.rawPayload, ['SCH'])) return getEdielAgtSupplier2026ACase('UL3')
      if (rawContains(params.rawPayload, ['KVART', ':15:804', ':PT15M', '15M'])) return getEdielAgtSupplier2026ACase('UL2')
      return null
    }
  }

  if (family === 'CONTRL' || family === 'APERAK') {
    const raw = `${params.rawPayload ?? ''} ${params.applicationReference ?? ''}`.toUpperCase()
    const candidates = EDIEL_AGT_SUPPLIER_2026A_CASES.filter((testCase) => raw.includes(testCase.testCaseCode))
    return candidates[0] ?? null
  }

  return null
}

export function getEdielAgtRouteName(family: 'PRODAT' | 'UTILTS'): string {
  return `AGT 2026A ${family} Edielportalen`
}
