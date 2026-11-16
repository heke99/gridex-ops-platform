// Extracted from tgtRegistry.ts; keep public imports on the facade module.
import type { EdielDirection, EdielMessageRow, EdielTestRoleCode, EdielTestRunRow, EdielTestSuite } from "@/lib/ediel/types"


export type EdielTgtExpectedStep = {
  stepNo: number;
  direction: EdielDirection;
  actor: "gridex" | "portal";
  family: "PRODAT" | "UTILTS" | "APERAK" | "CONTRL" | "UTILTS_ERR";
  code: string;
  outcome?: "positive" | "negative";
  required: boolean;
  title: string;
  description: string;
};

export type EdielTgtTestCaseDefinition = {
  suite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCode: string;
  title: string;
  approvalVersion: string;
  market: "el" | "gas" | "generic";
  source: "TGT_PRODAT_UTILTS_6_0_5";
  scope: "core" | "extended" | "future";
  status: "ready_for_file_engine" | "manual_later";
  purpose: string;
  testDataHint: string;
  expectedSteps: EdielTgtExpectedStep[];
  notes: string[];
};

export type EdielTgtStepMatch = {
  step: EdielTgtExpectedStep;
  message: EdielMessageRow | null;
  status: "passed" | "missing" | "mismatch";
  issues: string[];
};

export type EdielTgtRunEvaluation = {
  testRun: EdielTestRunRow;
  definition: EdielTgtTestCaseDefinition | null;
  matches: EdielTgtStepMatch[];
  passedSteps: number;
  requiredSteps: number;
  missingRequiredSteps: number;
  hasMismatch: boolean;
  computedStatus:
    | "not_mapped"
    | "not_started"
    | "in_progress"
    | "passed"
    | "failed";
};

export const PRODAT_POSITIVE_APERAK = {
  outcome: "positive" as const,
  description: "Positiv APERAK med BGM/1225 = 34, ERC = 100 och OK-text.",
};

export function prodatInboundPositiveCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. Portalen skickar PRODAT ${code}, GridCore kvitterar automatiskt via backend-kärnan.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code,
        required: true,
        title: `Ta emot PRODAT ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka positiv CONTRL",
        description: "Syntaxen är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Skicka positiv APERAK",
        description: "Affärsinnehållet är OK.",
      },
    ],
    notes: [
      "Beslut ska komma från backend-kärnan, inte från en testknapp i UI.",
    ],
  };
}

export function prodatInboundNegativeCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. Portalen skickar felaktig PRODAT ${code}, GridCore skickar negativ APERAK efter positiv CONTRL.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code,
        required: true,
        title: `Ta emot felaktig PRODAT ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka positiv CONTRL",
        description: "Syntaxen är OK även om affärsinnehåll är fel.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "negative",
        required: true,
        title: "Skicka negativ APERAK",
        description: "Affärs-/anvisningsfel enligt backend-kärnan.",
      },
    ],
    notes: [
      "Syntaxfel får negativ CONTRL; detta test gäller affärsfel efter godkänd syntax.",
    ],
  };
}

export function prodatOutboundPositiveCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `Driftstest ${testCaseCode}. GridCore/Aktör skickar PRODAT ${code} till Edielportalen. Portalen svarar med CONTRL och APERAK.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "outbound",
        actor: "gridex",
        family: "PRODAT",
        code,
        required: true,
        title: `Skicka PRODAT ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "inbound",
        actor: "portal",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv CONTRL",
        description: "Portalen syntaxkvitterar PRODAT.",
      },
      {
        stepNo: 3,
        direction: "inbound",
        actor: "portal",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv APERAK",
        description: "Portalen applikationskvitterar PRODAT.",
      },
    ],
    notes: [
      "GridCore är aktör i steg 1 och ska skicka PRODAT. Ingen APERAK ska skickas från GridCore i detta steg.",
    ],
  };
}

export function utiltsPositiveCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "UTILTS",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `UTILTS ${code}. Korrekt testfall ska ge positiv CONTRL och positiv APERAK.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "UTILTS",
        code,
        required: true,
        title: `Ta emot UTILTS ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka positiv CONTRL",
        description: "Syntaxkvittens.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Skicka positiv APERAK",
        description: "BGM 312, ERC 100 och OK.",
      },
    ],
    notes: ["Korrekt UTILTS ska inte gå till UTILTS-ERR."],
  };
}

export function utiltsNegativeAperakCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "UTILTS",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `UTILTS ${code}. Anvisningsfel ska ge positiv CONTRL och negativ APERAK.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "UTILTS",
        code,
        required: true,
        title: `Ta emot felaktig UTILTS ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka positiv CONTRL",
        description: "Syntaxen är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "negative",
        required: true,
        title: "Skicka negativ APERAK",
        description: "Anvisnings-/required-fel.",
      },
    ],
    notes: ["Anvisningsfel är APERAK, inte negativ CONTRL."],
  };
}

export function utiltsErrCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    suite: "UTILTS",
    roleCode: "supplier",
    testCaseCode,
    title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose,
    testDataHint: `UTILTS ${code}. Funktions-/processfel ska ge UTILTS-ERR.`,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "UTILTS",
        code,
        required: true,
        title: `Ta emot felaktig UTILTS ${code}`,
        description: title,
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka positiv CONTRL",
        description: "Syntaxen är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "UTILTS_ERR",
        code: "UTILTS_ERR",
        outcome: "negative",
        required: true,
        title: "Skicka UTILTS-ERR",
        description: "Process-/funktionsfel enligt anvisning.",
      },
      {
        stepNo: 4,
        direction: "inbound",
        actor: "portal",
        family: "APERAK",
        code: "APERAK",
        required: false,
        title: "Ta emot APERAK på UTILTS-ERR",
        description: "Portalen kvitterar felresponsen om testfallet kräver.",
      },
    ],
    notes: ["UTILTS-ERR används inte för vanliga anvisningsfel."],
  };
}

export function utiltsEscoPositiveCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    ...utiltsPositiveCase(testCaseCode, title, code, purpose),
    roleCode: "esco",
    testDataHint: `UTILTS ${code}. Korrekt energitjänsteföretag/berättigad-part-test ska ge positiv CONTRL och positiv APERAK.`,
    notes: ["U3 korrekt E66 ska ge APERAK BGM 312 och ERC 100."],
  };
}

export function utiltsEscoNegativeAperakCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    ...utiltsNegativeAperakCase(testCaseCode, title, code, purpose),
    roleCode: "esco",
    testDataHint: `UTILTS ${code}. Energitjänsteföretag/berättigad-part anvisningsfel ska ge positiv CONTRL och negativ APERAK.`,
    notes: ["U3 anvisningsfel är APERAK, inte UTILTS-ERR."],
  };
}

export function utiltsEscoErrCase(
  testCaseCode: string,
  title: string,
  code: string,
  purpose: string,
): EdielTgtTestCaseDefinition {
  return {
    ...utiltsErrCase(testCaseCode, title, code, purpose),
    roleCode: "esco",
    testDataHint: `UTILTS ${code}. Energitjänsteföretag/berättigad-part funktionsfel ska ge UTILTS-ERR.`,
    notes: ["U3 funktionsfel är UTILTS-ERR, inte negativ APERAK."],
  };
}

export function prodatEscoStartCase(params: {
  testCaseCode: string;
  title: string;
  outboundCode: "Z13";
  inboundCode: "Z14";
  inboundVariant: string;
  purpose: string;
  testDataHint: string;
  portalAperakOutcome?: "positive" | "negative";
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "outbound",
        actor: "gridex",
        family: "PRODAT",
        code: params.outboundCode,
        required: true,
        title: `Skicka PRODAT ${params.outboundCode}`,
        description:
          "GridCore agerar energitjänsteföretag och skickar begäran om tillgång till mätvärden.",
      },
      {
        stepNo: 2,
        direction: "inbound",
        actor: "portal",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv CONTRL",
        description: `Portalen syntaxkvitterar ${params.outboundCode}.`,
      },
      {
        stepNo: 3,
        direction: "inbound",
        actor: "portal",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv APERAK",
        description: `Portalen applikationskvitterar ${params.outboundCode}.`,
      },
      {
        stepNo: 4,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code: params.inboundCode,
        required: true,
        title: `Ta emot PRODAT ${params.inboundVariant}`,
        description:
          "Portalen agerar nätägare och svarar på tillståndsbegäran.",
      },
      {
        stepNo: 5,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Skicka CONTRL på ${params.inboundVariant}`,
        description: "Syntaxen i portalens PRODAT är OK.",
      },
      {
        stepNo: 6,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: `Skicka positiv APERAK på ${params.inboundVariant}`,
        description: "Affärsinnehållet i portalens PRODAT är OK.",
      },
    ],
    notes: [
      "Detta är ESCO/tillståndshantering och ska inte blandas ihop med leverantörsbyte Z03/Z04.",
      "Regeln är additiv: gamla negativa PRODAT- och CONTRL-regler ska inte ändras.",
    ],
  };
}

export function prodatEscoInboundPositiveCase(params: {
  testCaseCode: string;
  title: string;
  inboundCode: "Z15";
  inboundVariant: string;
  purpose: string;
  testDataHint: string;
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code: params.inboundCode,
        required: true,
        title: `Ta emot PRODAT ${params.inboundVariant}`,
        description:
          "Portalen agerar nätägare och meddelar att aktivt tillstånd upphör.",
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Skicka CONTRL på ${params.inboundVariant}`,
        description: "Syntaxen är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: `Skicka positiv APERAK på ${params.inboundVariant}`,
        description: "Affärsinnehållet är OK.",
      },
    ],
    notes: ["ESCO-avslutsflöde. Positivt Z15 ska inte trigga negativ APERAK."],
  };
}

export function prodatEscoEndRequestCase(params: {
  testCaseCode: string;
  title: string;
  purpose: string;
  testDataHint: string;
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "outbound",
        actor: "gridex",
        family: "PRODAT",
        code: "Z18",
        required: true,
        title: "Skicka PRODAT Z18V",
        description:
          "GridCore agerar energitjänsteföretag och begär avslut av rapportering.",
      },
      {
        stepNo: 2,
        direction: "inbound",
        actor: "portal",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv CONTRL",
        description: "Portalen syntaxkvitterar Z18V.",
      },
      {
        stepNo: 3,
        direction: "inbound",
        actor: "portal",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Ta emot positiv APERAK",
        description: "Portalen applikationskvitterar Z18V.",
      },
      {
        stepNo: 4,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code: "Z15",
        required: true,
        title: "Ta emot PRODAT Z15V",
        description: "Portalen bekräftar avslut via Z15V.",
      },
      {
        stepNo: 5,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: "Skicka CONTRL på Z15V",
        description: "Syntaxen i portalens Z15V är OK.",
      },
      {
        stepNo: 6,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "positive",
        required: true,
        title: "Skicka positiv APERAK på Z15V",
        description: "Affärsinnehållet i portalens Z15V är OK.",
      },
    ],
    notes: [
      "S9.1.2 kombinerar GridCore-utgående Z18V och portalens inkommande Z15V.",
    ],
  };
}

export function prodatEscoNegativeAperakCase(params: {
  testCaseCode: string;
  title: string;
  inboundCode: "Z14" | "Z15";
  inboundVariant: string;
  purpose: string;
  testDataHint: string;
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "TGT 6.0.5 / Edielportalen 4.1",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code: params.inboundCode,
        required: true,
        title: `Ta emot felaktig PRODAT ${params.inboundVariant}`,
        description: "Portalen skickar PRODAT med affärs-/anvisningsfel.",
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Skicka positiv CONTRL på ${params.inboundVariant}`,
        description: "Syntaxen är OK även om affärsinnehållet är fel.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: "negative",
        required: true,
        title: `Skicka negativ APERAK på ${params.inboundVariant}`,
        description: "Affärs-/anvisningsfel ska avvisas med negativ APERAK.",
      },
    ],
    notes: [
      "Negativ ESCO-APERAK är en separat regel och ska inte ersätta äldre negativa PRODAT-regler.",
    ],
  };
}

export function prodatAgtEscoOutboundCase(params: {
  testCaseCode: "E3" | "E4" | "E8";
  title: string;
  outboundCode: "Z13" | "Z18";
  outboundVariant: string;
  purpose: string;
  testDataHint: string;
  portalAperakOutcome?: "positive" | "negative";
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "AGT / Edielportalen aktörstest",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "outbound",
        actor: "gridex",
        family: "PRODAT",
        code: params.outboundCode,
        required: true,
        title: `Skicka PRODAT ${params.outboundVariant}`,
        description:
          "Gridex agerar energitjänsteföretag/DGI och skickar första PRODAT-meddelandet till Edielportalen.",
      },
      {
        stepNo: 2,
        direction: "inbound",
        actor: "portal",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Ta emot positiv CONTRL på ${params.outboundVariant}`,
        description: "Edielportalen syntaxkvitterar outbound PRODAT.",
      },
      {
        stepNo: 3,
        direction: "inbound",
        actor: "portal",
        family: "APERAK",
        code: "APERAK",
        outcome: params.portalAperakOutcome ?? "negative",
        required: true,
        title: `Ta emot ${params.portalAperakOutcome ?? "negative"} APERAK på ${params.outboundVariant}`,
        description: "Edielportalen applikationskvitterar enligt den kanoniska certifieringsmatrisen.",
      },
    ],
    notes: [
      "AGT E3/E4/E8 är aktör→portal. Gridex ska skapa och skicka första PRODAT-filen.",
      "Outbound PRODAT i AGT ska vara S/MIME-krypterad till Edielportalens publika produktionscertifikat och skickas via Ediel/Strato SMTP.",
    ],
  };
}

export function prodatAgtEscoInboundPositiveCase(params: {
  testCaseCode: "E5" | "E6" | "E7";
  title: string;
  inboundCode: "Z14" | "Z15";
  inboundVariant: string;
  purpose: string;
  testDataHint: string;
  aperakOutcome?: "positive" | "negative";
}): EdielTgtTestCaseDefinition {
  return {
    suite: "PRODAT",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "AGT / Edielportalen aktörstest",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "PRODAT",
        code: params.inboundCode,
        required: true,
        title: `Ta emot PRODAT ${params.inboundVariant}`,
        description:
          "Edielportalen agerar nätägare och skickar meddelandet till aktören. Gridex ska inte skapa första PRODAT-filen.",
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Skicka positiv CONTRL på ${params.inboundVariant}`,
        description: "Syntaxen i portalens PRODAT är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "APERAK",
        code: "APERAK",
        outcome: params.aperakOutcome ?? "positive",
        required: true,
        title: `Skicka ${params.aperakOutcome ?? "positive"} APERAK på ${params.inboundVariant}`,
        description:
          params.aperakOutcome === "negative"
            ? "Backendens certifieringsregel kräver negativ APERAK för scenariot."
            : "Meddelandet är korrekt behandlat och kvitteras enligt certifieringsmatrisen.",
      },
    ],
    notes: [
      "AGT E5/E6/E7 är portal→aktör och ska startas i Edielportalen, inte som outbound-draft i Gridex.",
      "Inbound PRODAT i AGT kan vara S/MIME-krypterad till aktörens publika certifikat och ska dekrypteras med aktörens privata PFX.",
    ],
  };
}

export function utiltsAgtEscoInboundUtiltsErrCase(params: {
  testCaseCode: "UE1" | "UE2";
  title: string;
  subtype: "KVART" | "SCH";
  purpose: string;
  testDataHint: string;
}): EdielTgtTestCaseDefinition {
  return {
    suite: "UTILTS",
    roleCode: "esco",
    testCaseCode: params.testCaseCode,
    title: params.title,
    approvalVersion: "AGT / Edielportalen aktörstest",
    market: "el",
    source: "TGT_PRODAT_UTILTS_6_0_5",
    scope: "core",
    status: "ready_for_file_engine",
    purpose: params.purpose,
    testDataHint: params.testDataHint,
    expectedSteps: [
      {
        stepNo: 1,
        direction: "inbound",
        actor: "portal",
        family: "UTILTS",
        code: "E66",
        required: true,
        title: `Ta emot UTILTS E66-${params.subtype}`,
        description:
          "Edielportalen skickar UTILTS E66 till aktören. Gridex ska vänta på inbound och sedan svara.",
      },
      {
        stepNo: 2,
        direction: "outbound",
        actor: "gridex",
        family: "CONTRL",
        code: "CONTRL",
        outcome: "positive",
        required: true,
        title: `Skicka positiv CONTRL på E66-${params.subtype}`,
        description: "Syntaxen i UTILTS är OK.",
      },
      {
        stepNo: 3,
        direction: "outbound",
        actor: "gridex",
        family: "UTILTS_ERR",
        code: "UTILTS_ERR",
        outcome: "negative",
        required: true,
        title: `Skicka negativ UTILTS_ERR på E66-${params.subtype}`,
        description:
          "AGT UE-flödet ska svara med negativ UTILTS/UTILTS_ERR när testmeddelandet innehåller uppgifter som aktörens produktionsapplikation inte kan processa.",
      },
    ],
    notes: [
      "AGT UE1/UE2 är portal→aktör och ska inte blandas ihop med TGT U3.",
      "UTILTS kräver normalt inte S/MIME i detta flöde.",
      "Systemtest ska skapa positiv CONTRL och negativ UTILTS_ERR från samma backend-engine, inte positiv APERAK.",
    ],
  };
}

export function legacyEscoRegressionCase(
  testCase: EdielTgtTestCaseDefinition,
): EdielTgtTestCaseDefinition {
  return {
    ...testCase,
    scope: "extended",
    notes: [
      ...testCase.notes,
      "Legacy/TGT-regression. Ska inte visas som aktuellt AGT DGI-test i Edielportalens E/UE-lista.",
    ],
  };
}
