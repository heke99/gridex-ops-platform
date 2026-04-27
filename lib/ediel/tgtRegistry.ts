// lib/ediel/tgtRegistry.ts

import type {
  EdielDirection,
  EdielMessageRow,
  EdielTestRoleCode,
  EdielTestRunRow,
  EdielTestSuite,
} from '@/lib/ediel/types'
import {
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  GRIDEX_EDIEL_ID,
} from '@/lib/ediel/fileEngine'

export type EdielTgtExpectedStep = {
  stepNo: number
  direction: EdielDirection
  actor: 'gridex' | 'portal'
  family: 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL' | 'UTILTS_ERR'
  code: string
  outcome?: 'positive' | 'negative'
  required: boolean
  title: string
  description: string
}

export type EdielTgtTestCaseDefinition = {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title: string
  approvalVersion: string
  market: 'el' | 'gas' | 'generic'
  source: 'TGT_PRODAT_UTILTS_6_0_5'
  scope: 'core' | 'extended' | 'future'
  status: 'ready_for_file_engine' | 'manual_later'
  purpose: string
  testDataHint: string
  expectedSteps: EdielTgtExpectedStep[]
  notes: string[]
}

export type EdielTgtStepMatch = {
  step: EdielTgtExpectedStep
  message: EdielMessageRow | null
  status: 'passed' | 'missing' | 'mismatch'
  issues: string[]
}

export type EdielTgtRunEvaluation = {
  testRun: EdielTestRunRow
  definition: EdielTgtTestCaseDefinition | null
  matches: EdielTgtStepMatch[]
  passedSteps: number
  requiredSteps: number
  missingRequiredSteps: number
  hasMismatch: boolean
  computedStatus: 'not_mapped' | 'not_started' | 'in_progress' | 'passed' | 'failed'
}

const PRODAT_POSITIVE_APERAK = {
  outcome: 'positive' as const,
  description: 'Positiv APERAK med BGM/1225 = 34, ERC = 100 och OK-text.',
}

export const EDIEL_TGT_TEST_CASES: readonly EdielTgtTestCaseDefinition[] = [
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.2.1',
    title: 'Z03L extra info → positiv APERAK → Z04L → positiv APERAK',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att Gridex som leverantör kan skapa korrekt Z03, ta emot CONTRL och positiv APERAK, ta emot Z04 och skicka CONTRL + positiv APERAK.',
    testDataHint: 'Testkund 1 enligt PRODAT bilaga 1. Z03L med extra information.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'outbound',
        actor: 'gridex',
        family: 'PRODAT',
        code: 'Z03',
        required: true,
        title: 'Skicka PRODAT Z03',
        description: 'Gridex skickar Z03 som leverantör till Edielportalen.',
      },
      {
        stepNo: 2,
        direction: 'inbound',
        actor: 'portal',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Ta emot positiv CONTRL',
        description: 'Portalen kvitterar syntax för Z03.',
      },
      {
        stepNo: 3,
        direction: 'inbound',
        actor: 'portal',
        family: 'APERAK',
        code: 'APERAK',
        required: true,
        title: 'Ta emot positiv APERAK',
        ...PRODAT_POSITIVE_APERAK,
      },
      {
        stepNo: 4,
        direction: 'inbound',
        actor: 'portal',
        family: 'PRODAT',
        code: 'Z04',
        required: true,
        title: 'Ta emot PRODAT Z04',
        description: 'Portalen skickar Z04L enligt testkund 1.',
      },
      {
        stepNo: 5,
        direction: 'outbound',
        actor: 'gridex',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Skicka CONTRL på Z04',
        description: 'Gridex skickar syntaxkvittens på mottagen Z04.',
      },
      {
        stepNo: 6,
        direction: 'outbound',
        actor: 'gridex',
        family: 'APERAK',
        code: 'APERAK',
        required: true,
        title: 'Skicka positiv APERAK på Z04',
        ...PRODAT_POSITIVE_APERAK,
      },
    ],
    notes: [
      `TGT outbound ska normalt skickas från ${GRIDEX_EDIEL_ID} till ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.`,
      `PRODAT i TGT ska ha mottagarens subadress ${EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}.`,
      `Application Reference för elmarknadens PRODAT-test är ${EDIEL_TGT_PRODAT_APPLICATION_REFERENCE}.`,
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.2.2',
    title: 'Z03LK minsta info → positiv APERAK → Z04LK → positiv APERAK',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar minsta tillåtna informationsmängd i Z03/Z04-flödet för leverantörsbyte.',
    testDataHint: 'Testkund 20 enligt PRODAT bilaga 1. Z03LK/Z04LK med minsta information.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'outbound',
        actor: 'gridex',
        family: 'PRODAT',
        code: 'Z03',
        required: true,
        title: 'Skicka PRODAT Z03',
        description: 'Gridex skickar Z03LK med minsta information.',
      },
      {
        stepNo: 2,
        direction: 'inbound',
        actor: 'portal',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Ta emot positiv CONTRL',
        description: 'Portalen kvitterar syntax för Z03.',
      },
      {
        stepNo: 3,
        direction: 'inbound',
        actor: 'portal',
        family: 'APERAK',
        code: 'APERAK',
        required: true,
        title: 'Ta emot positiv APERAK',
        ...PRODAT_POSITIVE_APERAK,
      },
      {
        stepNo: 4,
        direction: 'inbound',
        actor: 'portal',
        family: 'PRODAT',
        code: 'Z04',
        required: true,
        title: 'Ta emot PRODAT Z04',
        description: 'Portalen skickar Z04LK enligt testkund 20.',
      },
      {
        stepNo: 5,
        direction: 'outbound',
        actor: 'gridex',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Skicka CONTRL på Z04',
        description: 'Gridex skickar syntaxkvittens på mottagen Z04.',
      },
      {
        stepNo: 6,
        direction: 'outbound',
        actor: 'gridex',
        family: 'APERAK',
        code: 'APERAK',
        required: true,
        title: 'Skicka positiv APERAK på Z04',
        ...PRODAT_POSITIVE_APERAK,
      },
    ],
    notes: ['Detta är ett bra första TGT-flöde efter att filmotorn är på plats.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.2.5',
    title: 'Z04D mottagningspliktig mikroproduktion med två register',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att Gridex kan hantera Z04D för mottagningspliktig mikroproduktion, inklusive mätare, två register, avräkningsmetod, produktkod, tariff och positiv kvittens.',
    testDataHint: 'Testkund S1 enligt Edielportalen. Z04D mikroproduktion med register 201 och 202.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka PRODAT Z03', description: 'Gridex skickar Z03 med kund-, anläggnings- och avtalsdata till Edielportalen.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalen kvitterar syntax för Z03.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', required: true, title: 'Ta emot positiv APERAK', ...PRODAT_POSITIVE_APERAK },
      { stepNo: 4, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z04', required: true, title: 'Skicka PRODAT Z04D mikroproduktion', description: 'Gridex skickar Z04D med två register, mätarnummer, produktkod, avräkningsmetod och mikroproduktionsdata.' },
      { stepNo: 5, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalen kvitterar syntax för Z04D.' },
      { stepNo: 6, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', required: true, title: 'Ta emot positiv APERAK', ...PRODAT_POSITIVE_APERAK },
    ],
    notes: [
      'Detta test kräver mätare/registerdata och ska inte byggas från ofullständig kund/anläggning.',
      'Register 1: 5800 KWH och tidsintervall 201. Register 2: 2800 KWH och tidsintervall 202.',
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.3.1',
    title: 'Negativ APERAK efter Z03: felaktigt anläggnings-id',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att Gridex kan hantera negativ APERAK efter att Z03 innehåller en fördefinierad felaktighet.',
    testDataHint: 'Testkund 5 enligt PRODAT bilaga 1. Felaktigt anläggnings-/mätpunkts-id provoceras.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'outbound',
        actor: 'gridex',
        family: 'PRODAT',
        code: 'Z03',
        required: true,
        title: 'Skicka felaktig PRODAT Z03',
        description: 'Gridex skickar Z03 med fördefinierat fel.',
      },
      {
        stepNo: 2,
        direction: 'inbound',
        actor: 'portal',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Ta emot positiv CONTRL',
        description: 'Syntaxen kan vara korrekt även om affärsinnehållet är fel.',
      },
      {
        stepNo: 3,
        direction: 'inbound',
        actor: 'portal',
        family: 'APERAK',
        code: 'APERAK',
        outcome: 'negative',
        required: true,
        title: 'Ta emot negativ APERAK',
        description: 'Portalen avvisar affärsinnehåll, till exempel okänt objekt.',
      },
    ],
    notes: ['Detta test ska inte skapa ny positiv APERAK för samma transaktion.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.5',
    title: 'Syntaxfel → negativ CONTRL',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att negativ CONTRL importeras, markeras som negative outcome och leder till felsignal i kontrollflödet.',
    testDataHint: 'Manipulerad EDIFACT-fil enligt testbeskrivning för syntaxfel.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'outbound',
        actor: 'gridex',
        family: 'PRODAT',
        code: 'Z03',
        required: true,
        title: 'Skicka syntaxfelaktig PRODAT',
        description: 'Filen manipuleras endast i detta feltest.',
      },
      {
        stepNo: 2,
        direction: 'inbound',
        actor: 'portal',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'negative',
        required: true,
        title: 'Ta emot negativ CONTRL',
        description: 'Portalen avvisar syntaxen.',
      },
    ],
    notes: ['Efter negativ CONTRL ska ärendet larmas och kunna omsändas efter korrigering.'],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    testCaseCode: 'U2.1',
    title: 'Mottagning av korrekt UTILTS E66',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att Gridex kan läsa in validerade mätdata per objekt från nätägare och skapa rätt kvittenser.',
    testDataHint: 'Testanläggning enligt UTILTS bilaga 1. E66 för enskilda värden.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'inbound',
        actor: 'portal',
        family: 'UTILTS',
        code: 'E66',
        required: true,
        title: 'Ta emot UTILTS E66',
        description: 'Portalen skickar E66 med validerade mätdata.',
      },
      {
        stepNo: 2,
        direction: 'outbound',
        actor: 'gridex',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Skicka positiv CONTRL',
        description: 'Gridex syntaxkvitterar mottagen UTILTS.',
      },
      {
        stepNo: 3,
        direction: 'outbound',
        actor: 'gridex',
        family: 'APERAK',
        code: 'APERAK',
        outcome: 'positive',
        required: true,
        title: 'Skicka positiv APERAK',
        description: 'Gridex applikationskvitterar mottagen UTILTS.',
      },
    ],
    notes: ['Detta ska senare kopplas mot mätvärdesimport och kundportalens förbrukningsvy.'],
  },
  {
    suite: 'UTILTS',
    roleCode: 'supplier',
    testCaseCode: 'U2.2',
    title: 'Mottagning av felaktig UTILTS E66',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose:
      'Verifierar att Gridex kan svara med negativ APERAK eller UTILTS-ERR beroende på feltyp.',
    testDataHint: 'Felaktig E66 enligt UTILTS testfall U2.2.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'inbound',
        actor: 'portal',
        family: 'UTILTS',
        code: 'E66',
        required: true,
        title: 'Ta emot felaktig UTILTS E66',
        description: 'Portalen skickar E66 med fördefinierad felaktighet.',
      },
      {
        stepNo: 2,
        direction: 'outbound',
        actor: 'gridex',
        family: 'CONTRL',
        code: 'CONTRL',
        outcome: 'positive',
        required: true,
        title: 'Skicka CONTRL',
        description: 'Syntax kan vara godkänd även om innehållet är fel.',
      },
      {
        stepNo: 3,
        direction: 'outbound',
        actor: 'gridex',
        family: 'APERAK',
        code: 'APERAK',
        outcome: 'negative',
        required: false,
        title: 'Skicka negativ APERAK vid formellt fel',
        description: 'Används när felet hör hemma i APERAK-flödet.',
      },
      {
        stepNo: 4,
        direction: 'outbound',
        actor: 'gridex',
        family: 'UTILTS_ERR',
        code: 'UTILTS_ERR',
        outcome: 'negative',
        required: false,
        title: 'Skicka UTILTS-ERR vid process/funktionsfel',
        description: 'Används när felet upptäcks vid kontroll/lagring, exempelvis okänd mätpunkt eller saknade värden.',
      },
    ],
    notes: ['I detta test är APERAK eller UTILTS-ERR beroende av feltyp; minst ett negativt svar ska hanteras.'],
  },
]

export function getEdielTgtTestCases(): EdielTgtTestCaseDefinition[] {
  return [...EDIEL_TGT_TEST_CASES]
}

export function getEdielTgtTestCaseByCode(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): EdielTgtTestCaseDefinition | null {
  const normalizedCode = testCaseCode.trim().toUpperCase()
  return (
    EDIEL_TGT_TEST_CASES.find(
      (testCase) =>
        testCase.suite === suite &&
        testCase.roleCode === roleCode &&
        testCase.testCaseCode.toUpperCase() === normalizedCode
    ) ?? null
  )
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function messageOutcome(row: EdielMessageRow): 'positive' | 'negative' | null {
  const direct = row.ack_outcome
  if (direct === 'positive' || direct === 'negative') return direct

  const payloadOutcome = row.parsed_payload?.ackOutcome
  if (payloadOutcome === 'positive' || payloadOutcome === 'negative') return payloadOutcome

  if (row.syntax_check_status === 'accepted' || row.functional_check_status === 'accepted') return 'positive'
  if (row.syntax_check_status === 'rejected' || row.functional_check_status === 'rejected') return 'negative'

  return null
}

function matchesExpectedStep(message: EdielMessageRow, step: EdielTgtExpectedStep): boolean {
  if (message.direction !== step.direction) return false
  if (normalizeCode(message.message_family) !== step.family) return false
  if (normalizeCode(String(message.message_code)) !== normalizeCode(step.code)) return false
  if (step.outcome && messageOutcome(message) !== step.outcome) return false
  return true
}

function stepIssues(message: EdielMessageRow, step: EdielTgtExpectedStep): string[] {
  const issues: string[] = []

  if (message.direction !== step.direction) issues.push(`Fel riktning: ${message.direction}`)
  if (normalizeCode(message.message_family) !== step.family) issues.push(`Fel familj: ${message.message_family}`)
  if (normalizeCode(String(message.message_code)) !== normalizeCode(step.code)) issues.push(`Fel kod: ${message.message_code}`)
  if (step.outcome && messageOutcome(message) !== step.outcome) {
    issues.push(`Fel outcome: ${messageOutcome(message) ?? 'saknas'}`)
  }

  return issues
}

export function evaluateEdielTgtRun(
  testRun: EdielTestRunRow,
  messages: EdielMessageRow[]
): EdielTgtRunEvaluation {
  const definition = getEdielTgtTestCaseByCode(
    testRun.test_suite,
    testRun.role_code,
    testRun.test_case_code
  )

  if (!definition) {
    return {
      testRun,
      definition: null,
      matches: [],
      passedSteps: 0,
      requiredSteps: 0,
      missingRequiredSteps: 0,
      hasMismatch: false,
      computedStatus: 'not_mapped',
    }
  }

  const candidates = messages
    .filter((message) => {
      if (message.status === 'cancelled') return false
      if (message.message_family !== 'PRODAT' && message.message_family !== 'UTILTS' && message.message_family !== 'APERAK' && message.message_family !== 'CONTRL' && message.message_family !== 'UTILTS_ERR') {
        return false
      }
      if (testRun.created_at && message.created_at < testRun.created_at) return false
      return true
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const usedIds = new Set<string>()
  const matches = definition.expectedSteps.map((step) => {
    const exact = candidates.find((message) => !usedIds.has(message.id) && matchesExpectedStep(message, step))
    if (exact) {
      usedIds.add(exact.id)
      return {
        step,
        message: exact,
        status: 'passed' as const,
        issues: [],
      }
    }

    const close = candidates.find(
      (message) =>
        !usedIds.has(message.id) &&
        (message.direction === step.direction || normalizeCode(String(message.message_code)) === normalizeCode(step.code))
    )

    if (close) {
      usedIds.add(close.id)
      return {
        step,
        message: close,
        status: 'mismatch' as const,
        issues: stepIssues(close, step),
      }
    }

    return {
      step,
      message: null,
      status: 'missing' as const,
      issues: ['Steget saknas ännu.'],
    }
  })

  const requiredSteps = definition.expectedSteps.filter((step) => step.required).length
  const passedSteps = matches.filter((match) => match.status === 'passed').length
  const missingRequiredSteps = matches.filter((match) => match.step.required && match.status !== 'passed').length
  const hasMismatch = matches.some((match) => match.status === 'mismatch')

  let computedStatus: EdielTgtRunEvaluation['computedStatus'] = 'not_started'
  if (hasMismatch) computedStatus = 'failed'
  else if (missingRequiredSteps === 0) computedStatus = 'passed'
  else if (passedSteps > 0) computedStatus = 'in_progress'

  return {
    testRun,
    definition,
    matches,
    passedSteps,
    requiredSteps,
    missingRequiredSteps,
    hasMismatch,
    computedStatus,
  }
}

export function getFileEngineTestcaseTemplates() {
  return EDIEL_TGT_TEST_CASES.filter((testCase) => testCase.scope === 'core').map((testCase) => ({
    suite: testCase.suite,
    role: testCase.roleCode,
    code: testCase.testCaseCode,
    title: testCase.title,
    focus: testCase.purpose,
  }))
}

export type EdielTgtNextAction = {
  kind: 'create_file' | 'import_portal_file' | 'fix_mismatch' | 'complete' | 'not_mapped'
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
  title: string
  description: string
  stepNo: number | null
  canGenerateDraft: boolean
}

export type EdielTgtCoverageSummary = {
  totalRuns: number
  passedRuns: number
  failedRuns: number
  inProgressRuns: number
  notStartedRuns: number
  mappedRuns: number
  totalCoreCases: number
  coreCasesWithRuns: number
  coreCasesWithoutRuns: number
  readyForFinalApproval: boolean
}

export function getEdielTgtNextAction(evaluation: EdielTgtRunEvaluation): EdielTgtNextAction {
  if (!evaluation.definition) {
    return {
      kind: 'not_mapped',
      tone: 'red',
      title: 'Testfallet saknas i registret',
      description: 'Skapa test run via en mall i workbenchen så att systemet kan guida stegen automatiskt.',
      stepNo: null,
      canGenerateDraft: false,
    }
  }

  const mismatch = evaluation.matches.find((match) => match.status === 'mismatch')
  if (mismatch) {
    return {
      kind: 'fix_mismatch',
      tone: 'red',
      title: `Åtgärda mismatch på steg ${mismatch.step.stepNo}`,
      description: mismatch.issues.length > 0
        ? mismatch.issues.join(' · ')
        : 'Ett meddelande matchar delvis men uppfyller inte förväntad riktning, familj, kod eller outcome.',
      stepNo: mismatch.step.stepNo,
      canGenerateDraft: mismatch.step.actor === 'gridex',
    }
  }

  const nextMissing = evaluation.matches.find((match) => match.status === 'missing')
  if (!nextMissing) {
    return {
      kind: 'complete',
      tone: 'green',
      title: 'Alla obligatoriska steg är klara',
      description: 'Test run ser komplett ut i Gridex. Kontrollera Edielportalens logg innan du markerar slutgodkännande.',
      stepNo: null,
      canGenerateDraft: false,
    }
  }

  if (nextMissing.step.actor === 'gridex') {
    return {
      kind: 'create_file',
      tone: 'blue',
      title: `Skapa fil för steg ${nextMissing.step.stepNo}`,
      description: `${nextMissing.step.title}. Skapa utkastet, ladda ner/öppna meddelandet och ladda upp filen i Edielportalen enligt testfallet.`,
      stepNo: nextMissing.step.stepNo,
      canGenerateDraft: true,
    }
  }

  return {
    kind: 'import_portal_file',
    tone: 'yellow',
    title: `Importera portalens fil för steg ${nextMissing.step.stepNo}`,
    description: `${nextMissing.step.title}. När Edielportalen skickar filen eller kvittensen, importera den i filmotorn och koppla den till detta steg.`,
    stepNo: nextMissing.step.stepNo,
    canGenerateDraft: false,
  }
}

export function getEdielTgtCoverageSummary(
  evaluations: readonly EdielTgtRunEvaluation[],
  definitions: readonly EdielTgtTestCaseDefinition[] = EDIEL_TGT_TEST_CASES
): EdielTgtCoverageSummary {
  const coreDefinitions = definitions.filter((definition) => definition.scope === 'core')
  const coreCaseKeys = new Set(coreDefinitions.map((definition) => `${definition.suite}:${definition.roleCode}:${definition.testCaseCode}`))
  const runKeys = new Set(evaluations.map((evaluation) => `${evaluation.testRun.test_suite}:${evaluation.testRun.role_code}:${evaluation.testRun.test_case_code}`))
  const coreCasesWithRuns = [...coreCaseKeys].filter((key) => runKeys.has(key)).length

  return {
    totalRuns: evaluations.length,
    passedRuns: evaluations.filter((evaluation) => evaluation.computedStatus === 'passed').length,
    failedRuns: evaluations.filter((evaluation) => evaluation.computedStatus === 'failed' || evaluation.computedStatus === 'not_mapped').length,
    inProgressRuns: evaluations.filter((evaluation) => evaluation.computedStatus === 'in_progress').length,
    notStartedRuns: evaluations.filter((evaluation) => evaluation.computedStatus === 'not_started').length,
    mappedRuns: evaluations.filter((evaluation) => Boolean(evaluation.definition)).length,
    totalCoreCases: coreDefinitions.length,
    coreCasesWithRuns,
    coreCasesWithoutRuns: Math.max(0, coreDefinitions.length - coreCasesWithRuns),
    readyForFinalApproval: coreDefinitions.length > 0 && coreCasesWithRuns === coreDefinitions.length && evaluations.length > 0 && evaluations.every((evaluation) => evaluation.computedStatus === 'passed'),
  }
}
