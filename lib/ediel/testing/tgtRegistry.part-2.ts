// Extracted from tgtRegistry.ts; keep public imports on the facade module.


import type { EdielTgtTestCaseDefinition } from './tgtRegistry.part-1'
import { legacyEscoRegressionCase, prodatAgtEscoInboundPositiveCase, prodatAgtEscoOutboundCase, prodatEscoEndRequestCase, prodatEscoInboundPositiveCase, prodatEscoNegativeAperakCase, prodatEscoStartCase, prodatInboundNegativeCase, prodatInboundPositiveCase, prodatOutboundPositiveCase, utiltsAgtEscoInboundUtiltsErrCase, utiltsErrCase, utiltsEscoErrCase, utiltsEscoNegativeAperakCase, utiltsEscoPositiveCase, utiltsNegativeAperakCase, utiltsPositiveCase } from './tgtRegistry.part-1'

export function additionalEdielTgtTestCases(): EdielTgtTestCaseDefinition[] {
  return [
    prodatAgtEscoOutboundCase({
      testCaseCode: "E3",
      title: "PRODAT Z13V",
      outboundCode: "Z13",
      outboundVariant: "Z13V",
      purpose:
        "AGT DGI/Energitjänsteföretag: aktören skickar Z13V till Edielportalen för att begära tillgång till mätvärden.",
      testDataHint:
        "E3 är aktör → portal. Gridex ska skapa och skicka PRODAT Z13V krypterat till 91100:ZZ:PRODAT.",
    }),
    prodatAgtEscoOutboundCase({
      testCaseCode: "E4",
      title: "PRODAT Z13VH",
      outboundCode: "Z13",
      outboundVariant: "Z13VH",
      purpose:
        "AGT DGI/Energitjänsteföretag: aktören skickar historisk Z13VH till Edielportalen.",
      testDataHint:
        "E4 är aktör → portal. Gridex ska skapa och skicka PRODAT Z13VH, inte vänta på inbound.",
    }),
    prodatAgtEscoInboundPositiveCase({
      testCaseCode: "E5",
      title: "PRODAT Z14V",
      inboundCode: "Z14",
      inboundVariant: "Z14V",
      purpose:
        "AGT DGI/Energitjänsteföretag: portalen/nätägaren skickar positiv Z14V till aktören. Gridex ska ta emot och svara med positiv CONTRL + positiv APERAK.",
      testDataHint:
        "E5 är portal → aktör. Starta testet i Edielportalen; Gridex ska vänta på inbound PRODAT Z14V och får inte skapa första PRODAT-filen.",
    }),
    prodatAgtEscoInboundPositiveCase({
      testCaseCode: "E6",
      title: "PRODAT Z14N",
      inboundCode: "Z14",
      inboundVariant: "Z14N",
      purpose:
        "AGT DGI/Energitjänsteföretag: portalen/nätägaren skickar Z14N till aktören. Gridex ska ta emot, registrera nekandet och svara tekniskt korrekt.",
      testDataHint:
        "E6 är portal → aktör. Z14N är ett affärsmässigt nekande men ett korrekt meddelande ska fortfarande ge positiv CONTRL + positiv APERAK.",
    }),
    prodatAgtEscoInboundPositiveCase({
      testCaseCode: "E7",
      title: "PRODAT Z15V",
      inboundCode: "Z15",
      inboundVariant: "Z15V",
      purpose:
        "AGT DGI/Energitjänsteföretag: portalen/nätägaren skickar Z15V om upphörande av tillstånd till aktören.",
      testDataHint:
        "E7 är portal → aktör. Starta testet i Edielportalen; Gridex ska vänta på inbound PRODAT Z15V och sedan skicka positiv CONTRL + negativ APERAK från backendmotorn.",
      aperakOutcome: "negative",
    }),
    prodatAgtEscoOutboundCase({
      testCaseCode: "E8",
      title: "PRODAT Z18V",
      outboundCode: "Z18",
      outboundVariant: "Z18V",
      purpose:
        "AGT DGI/Energitjänsteföretag: aktören skickar Z18V till Edielportalen för att avsluta rapportering/tillstånd.",
      testDataHint:
        "E8 är aktör → portal. Gridex ska skapa och skicka PRODAT Z18V krypterat till 91100:ZZ:PRODAT.",
    }),
    utiltsAgtEscoInboundUtiltsErrCase({
      testCaseCode: "UE1",
      title: "UTILTS E66-KVART",
      subtype: "KVART",
      purpose:
        "AGT DGI/Energitjänsteföretag: portalen skickar UTILTS E66 med kvartsvärden till aktören.",
      testDataHint:
        "UE1 är portal → aktör. Starta i Edielportalen och låt Gridex hämta inbound UTILTS via IMAP, därefter positiv CONTRL + negativ UTILTS_ERR enligt AGT-facit.",
    }),
    utiltsAgtEscoInboundUtiltsErrCase({
      testCaseCode: "UE2",
      title: "UTILTS E66-SCH",
      subtype: "SCH",
      purpose:
        "AGT DGI/Energitjänsteföretag: portalen skickar UTILTS E66-SCH till aktören.",
      testDataHint:
        "UE2 är portal → aktör. Starta i Edielportalen och låt Gridex hämta inbound UTILTS via IMAP, därefter positiv CONTRL + negativ UTILTS_ERR enligt AGT-facit.",
    }),

    legacyEscoRegressionCase(
      prodatEscoStartCase({
        testCaseCode: "8.1.1",
        title: "PRODAT Z13V och positivt Z14V",
        outboundCode: "Z13",
        inboundCode: "Z14",
        inboundVariant: "Z14V",
        purpose:
          "Verifierar korrekt uppstart av mätvärdesåtkomst för energitjänsteföretag.",
        testDataHint:
          "S8.1.1. Energitjänsteföretag skickar Z13V, portalen svarar med positiv Z14V. Testkunden Anna Andersson/195503072026 kommer från Edielportalens fasta TGT-testdata, inte från riktig kunddata.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoStartCase({
        testCaseCode: "8.1.2",
        title: "PRODAT Z13V och Z14N",
        outboundCode: "Z13",
        inboundCode: "Z14",
        inboundVariant: "Z14N",
        purpose: "Verifierar korrekt nekande Z14N från nätägaren efter Z13V.",
        testDataHint:
          "S8.1.2. Z14N är ett giltigt affärssvar och ska kvitteras positivt om innehållet är korrekt.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoStartCase({
        testCaseCode: "8.1.3",
        title: "PRODAT Z13VH och positivt Z14",
        outboundCode: "Z13",
        inboundCode: "Z14",
        inboundVariant: "Z14VH/Z14V",
        purpose:
          "Verifierar Z13VH och positivt Z14-svar för energitjänsteföretag.",
        testDataHint:
          "S8.1.3. Z13VH med efterföljande positivt Z14 från portalen.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoNegativeAperakCase({
        testCaseCode: "8.2.1",
        title: "Negativ APERAK – Z14V",
        inboundCode: "Z14",
        inboundVariant: "Z14V",
        purpose:
          "Verifierar negativ APERAK när Z14V innehåller affärs-/anvisningsfel.",
        testDataHint:
          "S8.2.1. Portalen skickar felaktig Z14V, GridCore svarar positiv CONTRL + negativ APERAK.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoInboundPositiveCase({
        testCaseCode: "9.1.1",
        title: "PRODAT Z15V",
        inboundCode: "Z15",
        inboundVariant: "Z15V",
        purpose:
          "Verifierar att energitjänsteföretag kan ta emot aktivt tillstånd upphör via Z15V.",
        testDataHint:
          "S9.1.1. Portalen skickar Z15V, GridCore skickar positiv CONTRL + positiv APERAK.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoEndRequestCase({
        testCaseCode: "9.1.2",
        title: "PRODAT Z18V och Z15V",
        purpose:
          "Verifierar att energitjänsteföretag kan begära avslut via Z18V och ta emot Z15V.",
        testDataHint:
          "S9.1.2. GridCore skickar Z18V, portalen kvitterar och skickar Z15V.",
      }),
    ),
    legacyEscoRegressionCase(
      prodatEscoNegativeAperakCase({
        testCaseCode: "9.2.1",
        title: "Negativ APERAK – Z15V",
        inboundCode: "Z15",
        inboundVariant: "Z15V",
        purpose:
          "Verifierar negativ APERAK när Z15V innehåller affärs-/anvisningsfel.",
        testDataHint:
          "S9.2.1. Portalen skickar felaktig Z15V, GridCore svarar positiv CONTRL + negativ APERAK.",
      }),
    ),
    prodatInboundNegativeCase(
      "2.2.1",
      "Z06F – felaktigt anläggningsid",
      "Z06",
      "Verifierar negativ APERAK på Z06F när anläggningen inte kan identifieras.",
    ),
    prodatInboundNegativeCase(
      "2.2.2",
      "Z06F – antal siffror saknas",
      "Z06",
      "Verifierar negativ APERAK på Z06F när antal siffror saknas.",
    ),
    prodatInboundPositiveCase(
      "2.3.1",
      "Z10M – mätarbyte",
      "Z10",
      "Verifierar korrekt PRODAT Z10M för mätarbyte.",
    ),
    prodatInboundPositiveCase(
      "2.3.2",
      "Z10M – mätarbyte",
      "Z10",
      "Verifierar korrekt PRODAT Z10M för mätarbyte med kompletterande mätaruppgifter.",
    ),
    prodatInboundNegativeCase(
      "2.4.1",
      "Z10M – felaktigt mätarbyte",
      "Z10",
      "Verifierar negativ APERAK på felaktig Z10M.",
    ),
    prodatInboundNegativeCase(
      "2.4.2",
      "Z10M – konstant saknas",
      "Z10",
      "Verifierar negativ APERAK när konstant saknas i Z10M.",
    ),
    prodatOutboundPositiveCase(
      "2.5.1",
      "Z09F",
      "Z09",
      "Verifierar korrekt PRODAT Z09F.",
    ),
    prodatOutboundPositiveCase(
      "2.5.2",
      "Z09G",
      "Z09",
      "Verifierar korrekt PRODAT Z09G.",
    ),
    prodatOutboundPositiveCase(
      "2.5.3",
      "Z09D – nytt avtal om mikroproduktion",
      "Z09",
      "Verifierar korrekt PRODAT Z09D för mikroproduktion.",
    ),
    prodatInboundPositiveCase(
      "3.1.1",
      "Z05L",
      "Z05",
      "Verifierar korrekt PRODAT Z05L.",
    ),
    prodatInboundPositiveCase(
      "3.1.2",
      "Z05LK",
      "Z05",
      "Verifierar korrekt PRODAT Z05LK.",
    ),
    prodatInboundNegativeCase(
      "3.2.1",
      "Z05LK – felaktigt anläggningsid",
      "Z05",
      "Verifierar negativ APERAK när Z05LK har felaktigt anläggningsid.",
    ),
    utiltsPositiveCase(
      "U1.1.1",
      "Korrekt UTILTS-S02",
      "S02",
      "Verifierar korrekt planeringsmeddelande S02.",
    ),
    utiltsNegativeAperakCase(
      "U1.2.1",
      "Felaktig UTILTS-S02 – anvisningsfel",
      "S02",
      "Verifierar negativ APERAK på S02-anvisningsfel.",
    ),
    utiltsErrCase(
      "U1.2.2",
      "Felaktig UTILTS-S02 – funktionsfel",
      "S02",
      "Verifierar UTILTS-ERR på S02-funktionsfel.",
    ),
    utiltsPositiveCase(
      "U1.3.1",
      "Korrekt UTILTS-S03",
      "S03",
      "Verifierar korrekt planeringsmeddelande S03.",
    ),
    utiltsNegativeAperakCase(
      "U1.4.1",
      "Felaktig UTILTS-S03 – anvisningsfel",
      "S03",
      "Verifierar negativ APERAK på S03-anvisningsfel.",
    ),
    utiltsErrCase(
      "U1.4.2",
      "Felaktig UTILTS-S03 – funktionsfel",
      "S03",
      "Verifierar UTILTS-ERR på S03-funktionsfel.",
    ),
    utiltsNegativeAperakCase(
      "U1.2.1b",
      "Felaktig UTILTS-S02 – anvisningsfel b-testfall",
      "S02",
      "Verifierar b-testvariant för negativ APERAK på S02.",
    ),
    utiltsErrCase(
      "U1.2.2b",
      "Felaktig UTILTS-S02 – funktionsfel b-testfall",
      "S02",
      "Verifierar b-testvariant för UTILTS-ERR på S02.",
    ),
    utiltsPositiveCase(
      "U1.3.1b",
      "Korrekt UTILTS-S03 – b-testfall",
      "S03",
      "Verifierar b-testvariant för korrekt S03.",
    ),
    utiltsPositiveCase(
      "U2.1.1",
      "Korrekt UTILTS-E66, periodisk månadsavläsning SCH",
      "E66",
      "Verifierar korrekt E66 för månadsavläst schablon.",
    ),
    utiltsPositiveCase(
      "U2.1.2",
      "Korrekt UTILTS-E66, två register SCH",
      "E66",
      "Verifierar korrekt E66 med två register.",
    ),
    utiltsPositiveCase(
      "U2.1.4",
      "Korrekt UTILTS-E66, saknat värde SCH",
      "E66",
      "Verifierar korrekt E66 där saknat värde är tillåtet enligt testfall.",
    ),
    utiltsPositiveCase(
      "U2.1.5",
      "Korrekt UTILTS-E66, energi per kvart",
      "E66",
      "Verifierar korrekt E66 med kvartsvärden för schablonavräkning.",
    ),
    utiltsPositiveCase(
      "U2.1.6",
      "Korrekt UTILTS-E66, dygnsavräknad kvart",
      "E66",
      "Verifierar korrekt E66 med dygnsavräknade kvartsvärden.",
    ),
    utiltsPositiveCase(
      "U2.1.7",
      "Korrekt UTILTS-E66, dygnsavräknad kvart utan mätarställning",
      "E66",
      "Verifierar korrekt E66 utan mätarställning där testfallet tillåter det.",
    ),
    utiltsPositiveCase(
      "U2.1.8",
      "Korrekt UTILTS-E66, mätarbyte kvartsmätare",
      "E66",
      "Verifierar korrekt E66 vid mätarbyte.",
    ),
    utiltsNegativeAperakCase(
      "U2.2.1",
      "Felaktigt UTILTS-E66, anvisningsfel SCH",
      "E66",
      "Verifierar negativ APERAK på E66-anvisningsfel.",
    ),
    utiltsNegativeAperakCase(
      "U2.2.2",
      "Felaktigt UTILTS-E66, anvisningsfel kvart",
      "E66",
      "Verifierar negativ APERAK på E66-kvartsanvisningsfel.",
    ),
    utiltsErrCase(
      "U2.2.3",
      "Felaktigt UTILTS-E66, funktionsfel SCH",
      "E66",
      "Verifierar UTILTS-ERR på E66-funktionsfel SCH.",
    ),
    utiltsErrCase(
      "U2.2.4",
      "Felaktigt UTILTS-E66, funktionsfel kvart",
      "E66",
      "Verifierar UTILTS-ERR på E66-funktionsfel kvart.",
    ),
    utiltsPositiveCase(
      "U2.3.2",
      "Korrekt UTILTS-E31, slutliga andelstal (SCH)",
      "E31",
      "Verifierar att korrekt E31-SCH från portalen ger positiv CONTRL och positiv APERAK.",
    ),
    utiltsNegativeAperakCase(
      "U2.4.1",
      "Felaktigt UTILTS-E31, anvisningsfel (SCH)",
      "E31",
      "Verifierar att E31-SCH med anvisningsfel ger positiv CONTRL och negativ APERAK.",
    ),
    utiltsErrCase(
      "U2.4.3",
      "Felaktigt UTILTS-E31, funktionsfel (SCH)",
      "E31",
      "Verifierar att E31-SCH med process-/funktionsfel ger positiv CONTRL och UTILTS-ERR.",
    ),
    utiltsEscoPositiveCase(
      "U3.1.1",
      "Korrekt UTILTS-E66, periodisk månadsavl. (SCH)",
      "E66",
      "Verifierar att korrekt U3 E66-SCH från Edielportalen ger positiv CONTRL och positiv APERAK.",
    ),
    utiltsEscoPositiveCase(
      "U3.1.2",
      "Korrekt UTILTS-E66, dygnsavräknad (kvart)",
      "E66",
      "Verifierar att korrekt U3 E66-kvart från Edielportalen ger positiv CONTRL och positiv APERAK.",
    ),
    utiltsEscoNegativeAperakCase(
      "U3.2.1",
      "Felaktig UTILTS-E66, anvisningsfel (Kvart)",
      "E66",
      "Verifierar att U3 E66-kvart med anvisningsfel ger positiv CONTRL och negativ APERAK.",
    ),
    utiltsEscoErrCase(
      "U3.2.2",
      "Felaktig UTILTS-E66, funktionsfel (Kvart)",
      "E66",
      "Verifierar att U3 E66-kvart med funktionsfel ger positiv CONTRL och UTILTS-ERR.",
    ),
    utiltsPositiveCase(
      "U2.1.4b",
      "Korrekt UTILTS-E66, saknat värde SCH – b-testfall",
      "E66",
      "Verifierar b-testvariant för korrekt E66 saknat värde.",
    ),
    utiltsPositiveCase(
      "U2.1.8b",
      "Korrekt UTILTS-E66, mätarbyte kvartsmätare – b-testfall",
      "E66",
      "Verifierar b-testvariant för korrekt E66 mätarbyte.",
    ),
    utiltsNegativeAperakCase(
      "U2.2.1b",
      "Felaktigt UTILTS-E66, anvisningsfel SCH – b-testfall",
      "E66",
      "Verifierar b-testvariant för negativ APERAK på E66.",
    ),
    utiltsErrCase(
      "U2.2.3b",
      "Felaktigt UTILTS-E66, funktionsfel SCH – b-testfall",
      "E66",
      "Verifierar b-testvariant för UTILTS-ERR på E66 SCH.",
    ),
    utiltsErrCase(
      "U2.2.4b",
      "Felaktigt UTILTS-E66, funktionsfel kvart – b-testfall",
      "E66",
      "Verifierar b-testvariant för UTILTS-ERR på E66 kvart.",
    ),
  ];
}
