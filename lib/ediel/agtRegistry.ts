// lib/ediel/agtRegistry.ts

import type {
  EdielDirection,
  EdielMessageFamily,
  EdielTestRoleCode,
  EdielTestSuite,
} from '@/lib/ediel/types'

export type EdielAgtApprovalVersion = '2026A'

export type EdielAgtActor = 'actor' | 'portal'

export type EdielAgtExpectedAck = {
  family: Extract<EdielMessageFamily, 'CONTRL' | 'APERAK' | 'UTILTS_ERR'>
  outcome: 'positive' | 'negative'
  description: string
}

export type EdielAgtExpectedStep = {
  stepNo: number
  actor: EdielAgtActor
  direction: EdielDirection
  family: EdielMessageFamily
  code: string
  title: string
  expectedAck?: EdielAgtExpectedAck | null
  optional?: boolean
}

export type EdielAgtTestCaseDefinition = {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  approvalVersion: EdielAgtApprovalVersion
  testCaseCode: string
  title: string
  portalTitle: string
  messageFamily: Extract<EdielMessageFamily, 'PRODAT' | 'UTILTS'>
  messageCode: string
  messageVariant?: string | null
  scenario: 'actor_sends_and_receives_ack' | 'portal_sends_actor_answers'
  purpose: string
  agtInstruction: string
  notes: string[]
  expectedSteps: EdielAgtExpectedStep[]
}

const PRODAT_SUPPLIER_AGT_2026A: EdielAgtTestCaseDefinition[] = [
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L1',
    title: 'L1 · PRODAT Z03',
    portalTitle: 'Leverantör · L1 · PRODAT Z03',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    scenario: 'actor_sends_and_receives_ack',
    purpose: 'Verifierar att leverantören kan skicka PRODAT Z03 till Edielportalen och ta emot positiv CONTRL samt negativ APERAK.',
    agtInstruction: 'Starta L1 i Edielportalen. Skapa AGT-draften här, skicka den till 91100 och importera portalens CONTRL/APERAK när de kommer tillbaka.',
    notes: ['Nätägare och mottagare i Z03 ska vara Ediel-id 91100.', 'Portalens negativa APERAK är förväntad i AGT eftersom innehållet är okänt för testsystemet.'],
    expectedSteps: [
      { stepNo: 1, actor: 'actor', direction: 'outbound', family: 'PRODAT', code: 'Z03', title: 'Skicka PRODAT Z03 till Edielportalen' },
      { stepNo: 2, actor: 'portal', direction: 'inbound', family: 'CONTRL', code: 'CONTRL', title: 'Ta emot positiv CONTRL från Edielportalen', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Portalens syntaxkvittens ska vara positiv om filen är tekniskt korrekt.' } },
      { stepNo: 3, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot negativ APERAK från Edielportalen', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Negativ APERAK är förväntad i AGT för okänt affärsinnehåll.' } },
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L2',
    title: 'L2 · PRODAT Z04',
    portalTitle: 'Leverantör · L2 · PRODAT Z04',
    messageFamily: 'PRODAT',
    messageCode: 'Z04',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z04, skicka positiv CONTRL och negativ APERAK.',
    agtInstruction: 'Starta L2 i Edielportalen. Vänta på Z04 från portalen, importera den som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['CONTRL ska vara positiv.', 'APERAK ska vara negativ eftersom portalens Z04 innehåller uppgifter som inte finns i produktionsapplikationen.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'PRODAT', code: 'Z04', title: 'Ta emot PRODAT Z04 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'APERAK', code: 'APERAK', title: 'Skicka negativ APERAK', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Affärsinnehållet är okänt för aktörens produktionsapplikation.' } },
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L3',
    title: 'L3 · PRODAT Z05',
    portalTitle: 'Leverantör · L3 · PRODAT Z05',
    messageFamily: 'PRODAT',
    messageCode: 'Z05',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z05, skicka positiv CONTRL och negativ APERAK.',
    agtInstruction: 'Starta L3 i Edielportalen. Importera Z05 som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['AGT kontrollerar kommunikation och kvittensflöde, inte komplett kundaffär.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'PRODAT', code: 'Z05', title: 'Ta emot PRODAT Z05 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'APERAK', code: 'APERAK', title: 'Skicka negativ APERAK', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Affärsinnehållet är okänt för aktörens produktionsapplikation.' } },
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L4',
    title: 'L4 · PRODAT Z06',
    portalTitle: 'Leverantör · L4 · PRODAT Z06',
    messageFamily: 'PRODAT',
    messageCode: 'Z06',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z06, skicka positiv CONTRL och negativ APERAK.',
    agtInstruction: 'Starta L4 i Edielportalen. Importera Z06 som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['Negativ APERAK är förväntad i AGT.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'PRODAT', code: 'Z06', title: 'Ta emot PRODAT Z06 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'APERAK', code: 'APERAK', title: 'Skicka negativ APERAK', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Affärsinnehållet är okänt för aktörens produktionsapplikation.' } },
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L5',
    title: 'L5 · PRODAT Z10',
    portalTitle: 'Leverantör · L5 · PRODAT Z10',
    messageFamily: 'PRODAT',
    messageCode: 'Z10',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar att leverantören kan ta emot PRODAT Z10, skicka positiv CONTRL och negativ APERAK.',
    agtInstruction: 'Starta L5 i Edielportalen. Importera Z10 som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['Negativ APERAK är förväntad i AGT.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'PRODAT', code: 'Z10', title: 'Ta emot PRODAT Z10 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'APERAK', code: 'APERAK', title: 'Skicka negativ APERAK', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Affärsinnehållet är okänt för aktörens produktionsapplikation.' } },
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'L7',
    title: 'L7 · PRODAT Z09',
    portalTitle: 'Leverantör · L7 · PRODAT Z09',
    messageFamily: 'PRODAT',
    messageCode: 'Z09',
    scenario: 'actor_sends_and_receives_ack',
    purpose: 'Verifierar att leverantören kan skicka PRODAT Z09 till Edielportalen och ta emot positiv CONTRL samt negativ APERAK.',
    agtInstruction: 'Starta L7 i Edielportalen. Skapa AGT-draften här, skicka den till 91100 och importera portalens CONTRL/APERAK när de kommer tillbaka.',
    notes: ['Z09 får vara F eller G. AGT-draften använder Z09F/E64 som säker standard.', 'Nätägare och mottagare i Z09 ska vara Ediel-id 91100.'],
    expectedSteps: [
      { stepNo: 1, actor: 'actor', direction: 'outbound', family: 'PRODAT', code: 'Z09', title: 'Skicka PRODAT Z09 till Edielportalen' },
      { stepNo: 2, actor: 'portal', direction: 'inbound', family: 'CONTRL', code: 'CONTRL', title: 'Ta emot positiv CONTRL från Edielportalen', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Portalens syntaxkvittens ska vara positiv.' } },
      { stepNo: 3, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot negativ APERAK från Edielportalen', expectedAck: { family: 'APERAK', outcome: 'negative', description: 'Negativ APERAK är förväntad i AGT.' } },
    ],
  },
]

const UTILTS_SUPPLIER_AGT_2026A: EdielAgtTestCaseDefinition[] = [
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'UL1',
    title: 'UL1 · UTILTS S03',
    portalTitle: 'Leverantör · UL1 · UTILTS S03',
    messageFamily: 'UTILTS',
    messageCode: 'S03',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar mottagning av UTILTS S03 och att leverantören skickar positiv CONTRL och negativ UTILTS/UTILTS_ERR.',
    agtInstruction: 'Starta UL1 i Edielportalen. Importera S03 som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['Negativ UTILTS/UTILTS_ERR är förväntad eftersom tidsserien inte finns i produktionsapplikationen.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'UTILTS', code: 'S03', title: 'Ta emot UTILTS S03 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR', code: 'UTILTS_ERR', title: 'Skicka negativ UTILTS/UTILTS_ERR', expectedAck: { family: 'UTILTS_ERR', outcome: 'negative', description: 'Negativt UTILTS-svar för okänd tidsserie.' } },
      { stepNo: 4, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot APERAK på negativ UTILTS', optional: true },
    ],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'UL2',
    title: 'UL2 · UTILTS E66 KVART',
    portalTitle: 'Leverantör · UL2 · UTILTS E66-KVART',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    messageVariant: 'KVART',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar mottagning av UTILTS E66-KVART och negativt UTILTS-svar.',
    agtInstruction: 'Starta UL2 i Edielportalen. Importera E66-KVART som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['Använd UL2 för kvartsvärden. Använd UL3 för SCH/mätarställning.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'UTILTS', code: 'E66', title: 'Ta emot UTILTS E66-KVART från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR', code: 'UTILTS_ERR', title: 'Skicka negativ UTILTS/UTILTS_ERR', expectedAck: { family: 'UTILTS_ERR', outcome: 'negative', description: 'Negativt UTILTS-svar för okänd mätpunkt/tidsserie.' } },
      { stepNo: 4, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot APERAK på negativ UTILTS', optional: true },
    ],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'UL3',
    title: 'UL3 · UTILTS E66 SCH',
    portalTitle: 'Leverantör · UL3 · UTILTS E66-SCH',
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    messageVariant: 'SCH',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar mottagning av UTILTS E66-SCH och negativt UTILTS-svar.',
    agtInstruction: 'Starta UL3 i Edielportalen. Importera E66-SCH som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['UL3 är för icke kvartsmätta anläggningar/mätarställningar.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'UTILTS', code: 'E66', title: 'Ta emot UTILTS E66-SCH från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR', code: 'UTILTS_ERR', title: 'Skicka negativ UTILTS/UTILTS_ERR', expectedAck: { family: 'UTILTS_ERR', outcome: 'negative', description: 'Negativt UTILTS-svar för okänd mätpunkt.' } },
      { stepNo: 4, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot APERAK på negativ UTILTS', optional: true },
    ],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'UL4',
    title: 'UL4 · UTILTS S02',
    portalTitle: 'Leverantör · UL4 · UTILTS S02',
    messageFamily: 'UTILTS',
    messageCode: 'S02',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar mottagning av UTILTS S02 och negativt UTILTS-svar.',
    agtInstruction: 'Starta UL4 i Edielportalen. Importera S02 som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['S02 används för planvärden per objekt.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'UTILTS', code: 'S02', title: 'Ta emot UTILTS S02 från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR', code: 'UTILTS_ERR', title: 'Skicka negativ UTILTS/UTILTS_ERR', expectedAck: { family: 'UTILTS_ERR', outcome: 'negative', description: 'Negativt UTILTS-svar för okänt objekt.' } },
      { stepNo: 4, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot APERAK på negativ UTILTS', optional: true },
    ],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    approvalVersion: '2026A',
    testCaseCode: 'UL6',
    title: 'UL6 · UTILTS E31 SCH',
    portalTitle: 'Leverantör · UL6 · UTILTS E31-SCH',
    messageFamily: 'UTILTS',
    messageCode: 'E31',
    messageVariant: 'SCH',
    scenario: 'portal_sends_actor_answers',
    purpose: 'Verifierar mottagning av UTILTS E31-SCH och negativt UTILTS-svar.',
    agtInstruction: 'Starta UL6 om den visas/krävs i portalen. Importera E31-SCH som inbound/AGT och skapa AGT-svar från inbound-raden.',
    notes: ['UL6 kan saknas i portalvyn om meddelandetypen inte är tillagd för aktören. Om den visas ska den köras.'],
    expectedSteps: [
      { stepNo: 1, actor: 'portal', direction: 'inbound', family: 'UTILTS', code: 'E31', title: 'Ta emot UTILTS E31-SCH från Edielportalen' },
      { stepNo: 2, actor: 'actor', direction: 'outbound', family: 'CONTRL', code: 'CONTRL', title: 'Skicka positiv CONTRL', expectedAck: { family: 'CONTRL', outcome: 'positive', description: 'Syntaxen är mottagen och accepterad.' } },
      { stepNo: 3, actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR', code: 'UTILTS_ERR', title: 'Skicka negativ UTILTS/UTILTS_ERR', expectedAck: { family: 'UTILTS_ERR', outcome: 'negative', description: 'Negativt UTILTS-svar för okänd mätserie.' } },
      { stepNo: 4, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', title: 'Ta emot APERAK på negativ UTILTS', optional: true },
    ],
  },
]

export const EDIEL_SUPPLIER_AGT_2026A_CASES: readonly EdielAgtTestCaseDefinition[] = [
  ...PRODAT_SUPPLIER_AGT_2026A,
  ...UTILTS_SUPPLIER_AGT_2026A,
]

export function listEdielSupplierAgt2026Cases(params?: {
  suite?: EdielTestSuite | null
}): EdielAgtTestCaseDefinition[] {
  return EDIEL_SUPPLIER_AGT_2026A_CASES.filter((definition) =>
    params?.suite ? definition.suite === params.suite : true
  )
}

export function getEdielAgtTestCaseByCode(params: {
  suite?: EdielTestSuite | null
  roleCode?: EdielTestRoleCode | null
  testCaseCode: string | null | undefined
}): EdielAgtTestCaseDefinition | null {
  const code = String(params.testCaseCode ?? '').trim().toUpperCase()
  if (!code) return null

  return EDIEL_SUPPLIER_AGT_2026A_CASES.find((definition) => {
    if (definition.testCaseCode !== code) return false
    if (params.suite && definition.suite !== params.suite) return false
    if (params.roleCode && definition.roleCode !== params.roleCode) return false
    return true
  }) ?? null
}

export function isEdielAgtRunApprovalVersion(value: string | null | undefined): boolean {
  return String(value ?? '').toUpperCase().startsWith('AGT 2026A')
}

export function inferEdielAgtCaseForInboundMessage(params: {
  family: string | null | undefined
  code: string | null | undefined
  rawPayload?: string | null
  applicationReference?: string | null
  explicitTestCaseCode?: string | null
}): EdielAgtTestCaseDefinition | null {
  const explicit = getEdielAgtTestCaseByCode({ testCaseCode: params.explicitTestCaseCode })
  if (explicit) return explicit

  const family = String(params.family ?? '').toUpperCase()
  const code = String(params.code ?? '').toUpperCase()
  const context = `${params.rawPayload ?? ''}\n${params.applicationReference ?? ''}`.toUpperCase()

  if (family === 'PRODAT') {
    if (code === 'Z04') return getEdielAgtTestCaseByCode({ suite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'L2' })
    if (code === 'Z05') return getEdielAgtTestCaseByCode({ suite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'L3' })
    if (code === 'Z06') return getEdielAgtTestCaseByCode({ suite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'L4' })
    if (code === 'Z10') return getEdielAgtTestCaseByCode({ suite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'L5' })
  }

  if (family === 'UTILTS') {
    if (code === 'S03') return getEdielAgtTestCaseByCode({ suite: 'UTILTS', roleCode: 'supplier', testCaseCode: 'UL1' })
    if (code === 'S02') return getEdielAgtTestCaseByCode({ suite: 'UTILTS', roleCode: 'supplier', testCaseCode: 'UL4' })
    if (code === 'E31') return getEdielAgtTestCaseByCode({ suite: 'UTILTS', roleCode: 'supplier', testCaseCode: 'UL6' })
    if (code === 'E66') {
      if (context.includes('SCH')) return getEdielAgtTestCaseByCode({ suite: 'UTILTS', roleCode: 'supplier', testCaseCode: 'UL3' })
      return getEdielAgtTestCaseByCode({ suite: 'UTILTS', roleCode: 'supplier', testCaseCode: 'UL2' })
    }
  }

  return null
}
