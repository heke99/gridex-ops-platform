import {
  listEdielSupplierAgt2026Cases,
  type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/testing/agtRegistry'

export type EdielEngineSuite = 'PRODAT' | 'UTILTS'
export type EdielEngineMode = 'test' | 'production'
export type EdielEngineDirection = 'actor_to_portal' | 'portal_to_actor'

export type EdielEngineCase = {
  caseCode: string
  suite: EdielEngineSuite
  direction: EdielEngineDirection
  messageFamily: 'PRODAT' | 'UTILTS'
  messageCode: string
  messageVariant: string | null
  title: string
  businessRule: string
  expectedFlow: string[]
  productionGuard: string
}

function toEngineCase(testCase: EdielAgtTestCaseDefinition): EdielEngineCase {
  const prodatTemplate = testCase.prodatOutboundTemplate ?? null
  const businessRule = testCase.testCaseCode === 'L7'
    ? 'PRODAT Z09G/E32 ska alltid bära mätmetod Z03. Z04 får bara användas när Z09F/E64 begär kvartsvärden.'
    : prodatTemplate
      ? `PRODAT ${testCase.messageCode} använder fält 223/${prodatTemplate.reasonForTransaction} och fält 217/${prodatTemplate.meteringMethod}.`
      : testCase.messageFamily === 'UTILTS'
        ? 'UTILTS behandlas via runtimeklassning: syntaxfel => CONTRL, anvisningsfel => APERAK, funktionsfel => UTILTS_ERR.'
        : 'Inbound PRODAT valideras mot tenantens kund-, anläggnings- och ärendebild innan APERAK skapas.'

  return {
    caseCode: testCase.testCaseCode,
    suite: testCase.suite,
    direction: testCase.direction,
    messageFamily: testCase.messageFamily,
    messageCode: testCase.messageCode,
    messageVariant: testCase.messageVariant,
    title: testCase.title,
    businessRule,
    expectedFlow: testCase.expectedSteps.map((step) => `${step.stepNo}. ${step.actor} ${step.direction} ${step.family}/${step.code}`),
    productionGuard: testCase.direction === 'actor_to_portal'
      ? 'Outbound skapas från registry + aktiv tenant-route. Ingen Div3rsa- eller testreferens hårdkodas i generatorn.'
      : 'Inbound svaras från faktisk meddelanderad och dedupe blockerar dubbla ACK/UTILTS_ERR.',
  }
}

export function listEdielEngineCases(params?: { suite?: EdielEngineSuite | null }): EdielEngineCase[] {
  return listEdielSupplierAgt2026Cases({ suite: params?.suite ?? null }).map(toEngineCase)
}

export function getEdielEngineCase(caseCode: string): EdielEngineCase | null {
  const normalized = String(caseCode ?? '').trim().toUpperCase()
  return listEdielEngineCases().find((testCase) => testCase.caseCode === normalized) ?? null
}

export function summarizeEdielEngineCoverage() {
  const cases = listEdielEngineCases()
  const prodatCases = cases.filter((testCase) => testCase.suite === 'PRODAT')
  const utiltsCases = cases.filter((testCase) => testCase.suite === 'UTILTS')

  return {
    totalCases: cases.length,
    prodatCases: prodatCases.length,
    utiltsCases: utiltsCases.length,
    prodatOutboundCases: prodatCases.filter((testCase) => testCase.direction === 'actor_to_portal').length,
    prodatInboundCases: prodatCases.filter((testCase) => testCase.direction === 'portal_to_actor').length,
    utiltsInboundCases: utiltsCases.filter((testCase) => testCase.direction === 'portal_to_actor').length,
    l7Rule: getEdielEngineCase('L7')?.businessRule ?? null,
  }
}
