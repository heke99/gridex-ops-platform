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

function prodatInboundPositiveCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'PRODAT', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. Portalen skickar PRODAT ${code}, GridCore kvitterar automatiskt via backend-kärnan.`,
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'PRODAT', code, required: true, title: `Ta emot PRODAT ${code}`, description: title },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka positiv CONTRL', description: 'Syntaxen är OK.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Skicka positiv APERAK', description: 'Affärsinnehållet är OK.' },
    ],
    notes: ['Beslut ska komma från backend-kärnan, inte från en testknapp i UI.'],
  }
}

function prodatInboundNegativeCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'PRODAT', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. Portalen skickar felaktig PRODAT ${code}, GridCore skickar negativ APERAK efter positiv CONTRL.`,
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'PRODAT', code, required: true, title: `Ta emot felaktig PRODAT ${code}`, description: title },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka positiv CONTRL', description: 'Syntaxen är OK även om affärsinnehåll är fel.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Skicka negativ APERAK', description: 'Affärs-/anvisningsfel enligt backend-kärnan.' },
    ],
    notes: ['Syntaxfel får negativ CONTRL; detta test gäller affärsfel efter godkänd syntax.'],
  }
}

function prodatOutboundPositiveCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'PRODAT', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. GridCore är aktören och skickar PRODAT ${code} till Edielportalen. Portalen kvitterar med CONTRL och APERAK.`,
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code, required: true, title: `Skicka PRODAT ${code}`, description: title },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: `Portalen syntaxkvitterar GridCores PRODAT ${code}.` },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalen affärskvitterar med ERC 100 / OK.' },
    ],
    notes: ['GridCore ska inte vänta på inbound PRODAT i steg 1. Detta är ett outbound aktör→portal-test.'],
  }
}

function utiltsPositiveCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'UTILTS', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `UTILTS ${code}. Korrekt testfall ska ge positiv CONTRL och positiv APERAK.`,
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'UTILTS', code, required: true, title: `Ta emot UTILTS ${code}`, description: title },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka positiv CONTRL', description: 'Syntaxkvittens.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Skicka positiv APERAK', description: 'BGM 312, ERC 100 och OK.' },
    ],
    notes: ['Korrekt UTILTS ska inte gå till UTILTS-ERR.'],
  }
}

function utiltsNegativeAperakCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'UTILTS', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `UTILTS ${code}. Anvisningsfel ska ge positiv CONTRL och negativ APERAK.`,
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'UTILTS', code, required: true, title: `Ta emot felaktig UTILTS ${code}`, description: title },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka positiv CONTRL', description: 'Syntaxen är OK.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Skicka negativ APERAK', description: 'Anvisnings-/required-fel.' },
    ],
    notes: ['Anvisningsfel är APERAK, inte negativ CONTRL.'],
  }
}

function utiltsErrCase(testCaseCode: string, title: string, code: string, purpose: string): EdielTgtTestCaseDefinition {
  return {
    suite: 'UTILTS', roleCode: 'supplier', testCaseCode, title,
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1', market: 'el', source: 'TGT_PRODAT_UTILTS_6_0_5', scope: 'core', status: 'ready_for_file_engine',
    purpose,
    testDataHint: `UTILTS ${code}. Funktions-/processfel ska ge UTILTS-ERR.`,
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'UTILTS', code, required: true, title: `Ta emot felaktig UTILTS ${code}`, description: title },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka positiv CONTRL', description: 'Syntaxen är OK.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'UTILTS_ERR', code: 'UTILTS_ERR', outcome: 'negative', required: true, title: 'Skicka UTILTS-ERR', description: 'Process-/funktionsfel enligt anvisning.' },
      { stepNo: 4, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', required: false, title: 'Ta emot APERAK på UTILTS-ERR', description: 'Portalen kvitterar felresponsen om testfallet kräver.' },
    ],
    notes: ['UTILTS-ERR används inte för vanliga anvisningsfel.'],
  }
}

function additionalEdielTgtTestCases(): EdielTgtTestCaseDefinition[] {
  return [
    prodatInboundNegativeCase('2.2.1', 'Z06F – felaktigt anläggningsid', 'Z06', 'Verifierar negativ APERAK på Z06F när anläggningen inte kan identifieras.'),
    prodatInboundNegativeCase('2.2.2', 'Z06F – antal siffror saknas', 'Z06', 'Verifierar negativ APERAK på Z06F när antal siffror saknas.'),
    prodatInboundPositiveCase('2.3.1', 'Z10M – mätarbyte', 'Z10', 'Verifierar korrekt PRODAT Z10M för mätarbyte.'),
    prodatInboundPositiveCase('2.3.2', 'Z10M – mätarbyte', 'Z10', 'Verifierar korrekt PRODAT Z10M för mätarbyte med kompletterande mätaruppgifter.'),
    prodatInboundNegativeCase('2.4.1', 'Z10M – felaktigt mätarbyte', 'Z10', 'Verifierar negativ APERAK på felaktig Z10M.'),
    prodatInboundNegativeCase('2.4.2', 'Z10M – konstant saknas', 'Z10', 'Verifierar negativ APERAK när konstant saknas i Z10M.'),
    prodatOutboundPositiveCase('2.5.1', 'Z09F – avtal om timvärden', 'Z09', 'Verifierar att GridCore som aktör skickar korrekt PRODAT Z09F.'),
    prodatOutboundPositiveCase('2.5.2', 'Z09G – avtal om timvärden upphör', 'Z09', 'Verifierar att GridCore som aktör skickar korrekt PRODAT Z09G.'),
    prodatOutboundPositiveCase('2.5.3', 'Z09D – nytt avtal om mikroproduktion', 'Z09', 'Verifierar att GridCore som aktör skickar korrekt PRODAT Z09D för mikroproduktion.'),
    prodatInboundPositiveCase('3.1.1', 'Z05L', 'Z05', 'Verifierar korrekt PRODAT Z05L.'),
    prodatInboundPositiveCase('3.1.2', 'Z05LK', 'Z05', 'Verifierar korrekt PRODAT Z05LK.'),
    prodatInboundNegativeCase('3.2.1', 'Z05LK – felaktigt anläggningsid', 'Z05', 'Verifierar negativ APERAK när Z05LK har felaktigt anläggningsid.'),
    utiltsPositiveCase('U1.1.1', 'Korrekt UTILTS-S02', 'S02', 'Verifierar korrekt planeringsmeddelande S02.'),
    utiltsNegativeAperakCase('U1.2.1', 'Felaktig UTILTS-S02 – anvisningsfel', 'S02', 'Verifierar negativ APERAK på S02-anvisningsfel.'),
    utiltsErrCase('U1.2.2', 'Felaktig UTILTS-S02 – funktionsfel', 'S02', 'Verifierar UTILTS-ERR på S02-funktionsfel.'),
    utiltsPositiveCase('U1.3.1', 'Korrekt UTILTS-S03', 'S03', 'Verifierar korrekt planeringsmeddelande S03.'),
    utiltsNegativeAperakCase('U1.4.1', 'Felaktig UTILTS-S03 – anvisningsfel', 'S03', 'Verifierar negativ APERAK på S03-anvisningsfel.'),
    utiltsErrCase('U1.4.2', 'Felaktig UTILTS-S03 – funktionsfel', 'S03', 'Verifierar UTILTS-ERR på S03-funktionsfel.'),
    utiltsNegativeAperakCase('U1.2.1b', 'Felaktig UTILTS-S02 – anvisningsfel b-testfall', 'S02', 'Verifierar b-testvariant för negativ APERAK på S02.'),
    utiltsErrCase('U1.2.2b', 'Felaktig UTILTS-S02 – funktionsfel b-testfall', 'S02', 'Verifierar b-testvariant för UTILTS-ERR på S02.'),
    utiltsPositiveCase('U1.3.1b', 'Korrekt UTILTS-S03 – b-testfall', 'S03', 'Verifierar b-testvariant för korrekt S03.'),
    utiltsPositiveCase('U2.1.1', 'Korrekt UTILTS-E66, periodisk månadsavläsning SCH', 'E66', 'Verifierar korrekt E66 för månadsavläst schablon.'),
    utiltsPositiveCase('U2.1.2', 'Korrekt UTILTS-E66, två register SCH', 'E66', 'Verifierar korrekt E66 med två register.'),
    utiltsPositiveCase('U2.1.4', 'Korrekt UTILTS-E66, saknat värde SCH', 'E66', 'Verifierar korrekt E66 där saknat värde är tillåtet enligt testfall.'),
    utiltsPositiveCase('U2.1.5', 'Korrekt UTILTS-E66, energi per kvart', 'E66', 'Verifierar korrekt E66 med kvartsvärden för schablonavräkning.'),
    utiltsPositiveCase('U2.1.6', 'Korrekt UTILTS-E66, dygnsavräknad kvart', 'E66', 'Verifierar korrekt E66 med dygnsavräknade kvartsvärden.'),
    utiltsPositiveCase('U2.1.7', 'Korrekt UTILTS-E66, dygnsavräknad kvart utan mätarställning', 'E66', 'Verifierar korrekt E66 utan mätarställning där testfallet tillåter det.'),
    utiltsPositiveCase('U2.1.8', 'Korrekt UTILTS-E66, mätarbyte kvartsmätare', 'E66', 'Verifierar korrekt E66 vid mätarbyte.'),
    utiltsNegativeAperakCase('U2.2.1', 'Felaktigt UTILTS-E66, anvisningsfel SCH', 'E66', 'Verifierar negativ APERAK på E66-anvisningsfel.'),
    utiltsNegativeAperakCase('U2.2.2', 'Felaktigt UTILTS-E66, anvisningsfel kvart', 'E66', 'Verifierar negativ APERAK på E66-kvartsanvisningsfel.'),
    utiltsErrCase('U2.2.3', 'Felaktigt UTILTS-E66, funktionsfel SCH', 'E66', 'Verifierar UTILTS-ERR på E66-funktionsfel SCH.'),
    utiltsErrCase('U2.2.4', 'Felaktigt UTILTS-E66, funktionsfel kvart', 'E66', 'Verifierar UTILTS-ERR på E66-funktionsfel kvart.'),
    utiltsPositiveCase('U2.1.4b', 'Korrekt UTILTS-E66, saknat värde SCH – b-testfall', 'E66', 'Verifierar b-testvariant för korrekt E66 saknat värde.'),
    utiltsPositiveCase('U2.1.8b', 'Korrekt UTILTS-E66, mätarbyte kvartsmätare – b-testfall', 'E66', 'Verifierar b-testvariant för korrekt E66 mätarbyte.'),
    utiltsNegativeAperakCase('U2.2.1b', 'Felaktigt UTILTS-E66, anvisningsfel SCH – b-testfall', 'E66', 'Verifierar b-testvariant för negativ APERAK på E66.'),
    utiltsErrCase('U2.2.3b', 'Felaktigt UTILTS-E66, funktionsfel SCH – b-testfall', 'E66', 'Verifierar b-testvariant för UTILTS-ERR på E66 SCH.'),
    utiltsErrCase('U2.2.4b', 'Felaktigt UTILTS-E66, funktionsfel kvart – b-testfall', 'E66', 'Verifierar b-testvariant för UTILTS-ERR på E66 kvart.'),
  ]
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

  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.3.2',
    title: 'Negativ APERAK efter Z03LK: fel nätområdesid',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar att portalen avvisar Z03LK med fel nätområdesid och att GridCore kan registrera negativ APERAK.',
    testDataHint: 'Testkund 7. Skicka Z03LK men provocera fel nätområdesid TEX.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka felaktig PRODAT Z03LK', description: 'Skickas med fel nätområdesid TEX.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Syntaxen ska vara korrekt.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Ta emot negativ APERAK', description: 'Förväntat fel: ERC 42, FTX-kod 260, text Felaktigt nätområdesid TEX.' },
    ],
    notes: ['Detta är ett mottagningstest av negativ APERAK. Skapa inte egen APERAK på portalens APERAK.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.3.3',
    title: 'Negativ APERAK efter Z03L: fel transaktionstyp, saknad ärendereferens, fel balansansvarig',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar negativ APERAK när flera affärsfel framprovoceras i Z03.',
    testDataHint: 'Testkund 7. Manipulerad fil: transaktionstyp Z26, RFF+LI saknas och balansansvarig 99999.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka manipulerad PRODAT Z03', description: 'Z03L med Z26, saknad RFF+LI och balansansvarig 99999.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Syntaxen ska vara korrekt.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Ta emot negativ APERAK', description: 'Minst ett av de förväntade felen ska rapporteras enligt portalen.' },
    ],
    notes: ['Detta testfall får manipuleras enligt TGT-handledningen.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.3.4',
    title: 'Negativ APERAK efter Z03: felaktigt datum, flera anläggningar',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar multi-anläggningsflöde där två anläggningar accepteras och en avvisas på grund av felaktigt datum.',
    testDataHint: 'Importera Edielportalens Excel/CSV för 1.3.4. Testet ska skapa en PRODAT/Z03 med flera LIN-block i samma fil.',
    expectedSteps: [
      {
        stepNo: 1,
        direction: 'outbound',
        actor: 'gridex',
        family: 'PRODAT',
        code: 'Z03',
        required: true,
        title: 'Skicka PRODAT Z03 med flera anläggningar',
        description: 'Byggs från importerad portaltestdata. En PRODAT-fil ska innehålla flera LIN-block.',
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
        description: 'Syntaxen ska vara korrekt även när PRODAT innehåller flera LIN-block.',
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
        description: 'Portalen ska avvisa den anläggning/rad där datumet är felaktigt enligt testfallet.',
      },
    ],
    notes: [
      'Detta är inte samma test som 1.3.4B. Kör 1.3.4 när Edielportalen anger: två godkända anläggningar + en avvisad pga felaktigt datum.',
      'Skapa inte en kund per rad i GridCore. Importerad portaltestdata används endast för TGT-utkastet.',
    ],
  },

  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.3.4B',
    title: 'Negativ APERAK efter Z03: avvisad på felaktigt datum',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'B-testfall för system som skickar en anläggning per PRODAT-fil.',
    testDataHint: 'Testkund 9. Avtal startdatum ska vara för gammalt: 20030801.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka PRODAT Z03 med fel datum', description: 'Avtal startdatum sätts till 200308010000.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Syntaxen ska vara korrekt.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Ta emot negativ APERAK', description: 'Förväntat fel: ERC 42, FTX-kod 210.' },
    ],
    notes: ['Kör 1.3.4B om systemet inte ska skicka flera anläggningar i samma PRODAT-fil.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.4.2',
    title: 'Skicka negativ APERAK på inkommande felaktig Z04 med flera anläggningar',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar att GridCore kan hantera ordinarie S1.4.2 med flera anläggningar i samma Z04 och skicka negativ APERAK där en anläggning accepteras och övriga avvisas med rätt Ediel-felkoder.',
    testDataHint: 'Testkund 12, 13 och 14. Inbound Z04 från portalen ska besvaras med CONTRL och negativ APERAK enligt 1.4.2.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka korrekt PRODAT Z03', description: 'Startar testet med korrekt Z03 enligt ordinarie 1.4.2-testdata.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens på Z03.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens applikationskvittens på Z03.' },
      { stepNo: 4, direction: 'inbound', actor: 'portal', family: 'PRODAT', code: 'Z04', required: true, title: 'Ta emot felaktig PRODAT Z04 med flera anläggningar', description: 'Portalen skickar Z04 med flera anläggningar enligt testkund 12, 13 och 14.' },
      { stepNo: 5, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka CONTRL', description: 'Syntaxkvittens på inkommande Z04.' },
      { stepNo: 6, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Skicka negativ APERAK', description: 'Använd preset 1.4.2 i inboundpanelen.' },
    ],
    notes: [
      'Ordinarie 1.4.2 används när systemet kan hantera flera anläggningar i samma PRODAT-fil.',
      'För system som endast hanterar en anläggning per PRODAT-fil används 1.4.2B.',
    ],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.4.2B',
    title: 'Skicka negativ APERAK på inkommande felaktig Z04',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar att GridCore avvisar Z04 med saknad ärendereferens, årsförbrukning, konstant samt fel startdatum.',
    testDataHint: 'Testkund 12. Inbound Z04 från portalen ska besvaras med CONTRL och negativ APERAK.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka korrekt PRODAT Z03', description: 'Startar testet med korrekt Z03 enligt testkund 12.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens på Z03.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens applikationskvittens på Z03.' },
      { stepNo: 4, direction: 'inbound', actor: 'portal', family: 'PRODAT', code: 'Z04', required: true, title: 'Ta emot felaktig PRODAT Z04', description: 'Portalen skickar Z04 med fördefinierade fel.' },
      { stepNo: 5, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka CONTRL', description: 'Syntaxkvittens på inkommande Z04.' },
      { stepNo: 6, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Skicka negativ APERAK', description: 'Använd preset 1.4.2/1.4.2B i inboundpanelen.' },
    ],
    notes: ['Om ni kan hantera flera anläggningar i samma fil kan även 1.4.2 köras senare.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.4.3',
    title: 'Skicka negativ APERAK på Z04D saknad anläggningsreferens',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar negativ APERAK för Z04D där referens till anläggning saknas.',
    testDataHint: 'Testkund 19. Inbound Z04D ska få negativ APERAK med ERC 41 och FTX-kod 319.',
    expectedSteps: [
      { stepNo: 1, direction: 'inbound', actor: 'portal', family: 'PRODAT', code: 'Z04', required: true, title: 'Ta emot felaktig PRODAT Z04D', description: 'Portalen skickar Z04D enligt testkund 19.' },
      { stepNo: 2, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Skicka CONTRL', description: 'Syntaxkvittens på Z04D.' },
      { stepNo: 3, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'negative', required: true, title: 'Skicka negativ APERAK', description: 'Använd preset 1.4.3 i inboundpanelen.' },
    ],
    notes: ['Rör inte positiv Z04D-baseline från S1.2.5. Detta är ett separat feltest.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '1.5.1',
    title: 'Syntaxfel på Z04 → negativ CONTRL → omsändning',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar att GridCore skickar negativ CONTRL vid syntaxfel och sedan hanterar korrigerad omsändning.',
    testDataHint: 'Testkund 12. Portalen skickar först Z04 med fel UNT och saknad BGM/1004, därefter korrekt omsändning.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z03', required: true, title: 'Skicka korrekt PRODAT Z03', description: 'Startar testet enligt testkund 12.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens på Z03.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens positiva APERAK på Z03.' },
      { stepNo: 4, direction: 'inbound', actor: 'portal', family: 'PRODAT', code: 'Z04', required: true, title: 'Ta emot syntaxfelaktig Z04', description: 'Portalens första Z04 har fel antal segment i UNT och saknar BGM/1004.' },
      { stepNo: 5, direction: 'outbound', actor: 'gridex', family: 'CONTRL', code: 'CONTRL', outcome: 'negative', required: true, title: 'Skicka negativ CONTRL', description: 'Använd negativ CONTRL-knappen i inboundpanelen.' },
      { stepNo: 6, direction: 'inbound', actor: 'portal', family: 'PRODAT', code: 'Z04', required: true, title: 'Ta emot korrigerad Z04', description: 'Portalen skickar om korrekt Z04.' },
      { stepNo: 7, direction: 'outbound', actor: 'gridex', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Skicka positiv APERAK på korrigerad Z04', description: 'Positiv APERAK efter korrigerad omsändning.' },
    ],
    notes: ['Portalen begär inte CONTRL på dessa Z04, men testet kräver negativ CONTRL på syntaxfel.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '2.1.1',
    title: 'Z06F – ändrad avräkningsmetod, mätmetod och rapporteringsfrekvens',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar PRODAT Z06F för ändring av avräkningsmetod, mätmetod och rapporteringsfrekvens.',
    testDataHint: 'Driftstest S2.1.1. Skapa PRODAT Z06F.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z06', required: true, title: 'Skicka PRODAT Z06F', description: 'Z06F med E64 som transaktionstyp.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens positiva APERAK.' },
    ],
    notes: ['Z06 är drift/ändringsflöde och ska inte blandas ihop med S1.2 positiva uppstartstester.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '2.1.2',
    title: 'Z06F – ändrad räkneverkskod',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar PRODAT Z06F med ändrad räkneverkskod.',
    testDataHint: 'Driftstest S2.1.2. Endast elmarknaden.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z06', required: true, title: 'Skicka PRODAT Z06F', description: 'Z06F med räkneverkskod/tidsintervall.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens positiva APERAK.' },
    ],
    notes: ['Räkneverkskoden visas i UI som både kod och betydelse när kodlistan finns.'],
  },
  {
    suite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCode: '2.1.3',
    title: 'Z06G – ändring av anläggningsadress',
    approvalVersion: 'TGT 6.0.5 / Edielportalen 4.1',
    market: 'el',
    source: 'TGT_PRODAT_UTILTS_6_0_5',
    scope: 'core',
    status: 'ready_for_file_engine',
    purpose: 'Verifierar PRODAT Z06G för ändring av anläggningsadress.',
    testDataHint: 'Driftstest S2.1.3. Skapa PRODAT Z06G med E32 som transaktionstyp.',
    expectedSteps: [
      { stepNo: 1, direction: 'outbound', actor: 'gridex', family: 'PRODAT', code: 'Z06', required: true, title: 'Skicka PRODAT Z06G', description: 'Z06G för ändrad anläggningsadress.' },
      { stepNo: 2, direction: 'inbound', actor: 'portal', family: 'CONTRL', code: 'CONTRL', outcome: 'positive', required: true, title: 'Ta emot positiv CONTRL', description: 'Portalens syntaxkvittens.' },
      { stepNo: 3, direction: 'inbound', actor: 'portal', family: 'APERAK', code: 'APERAK', outcome: 'positive', required: true, title: 'Ta emot positiv APERAK', description: 'Portalens positiva APERAK.' },
    ],
    notes: ['Z06G ska använda transaktionstyp E32.'],
  },
  ...additionalEdielTgtTestCases(),
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

  if (row.syntax_check_status === 'ok' || row.syntax_check_status === 'warning' || row.functional_check_status === 'ok' || row.functional_check_status === 'warning') return 'positive'
  if (row.syntax_check_status === 'failed' || row.functional_check_status === 'failed') return 'negative'

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
        message.direction === step.direction &&
        (
          normalizeCode(message.message_family) === step.family ||
          normalizeCode(String(message.message_code)) === normalizeCode(step.code)
        )
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
