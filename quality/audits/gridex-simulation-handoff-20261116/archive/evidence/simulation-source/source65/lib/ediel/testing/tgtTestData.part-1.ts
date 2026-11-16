// Extracted from tgtTestData.ts; keep public imports on the facade module.
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

export type EdielTgtExcelColumn = {
  index: number
  name: string
  testCase: string
  /**
   * Import order from Edielportalen. This is intentionally separate from the
   * visible column index so dedupe can merge duplicate objects without changing
   * the order that PRODAT LIN blocks should be generated in.
   */
  sourceOrder?: number
}

export type EdielTgtExcelField = {
  fieldCode: string
  fieldName: string
  values: Record<string, string>
}

export type EdielTgtExcelBlock = {
  kind: 'PRODAT' | 'UTILTS'
  sourceWorkbook: string
  sourceSheet: string
  entityLabel: string
  entityNumbers: readonly string[]
  columns: readonly EdielTgtExcelColumn[]
  fields: readonly EdielTgtExcelField[]
}

export type EdielTgtCaseTestDataGroup = {
  block: EdielTgtExcelBlock
  columns: readonly EdielTgtExcelColumn[]
  fields: readonly EdielTgtExcelField[]
}

export type EdielTgtCaseExpectedAck = {
  contrl?: 'positive' | 'negative' | null
  aperak?: 'positive' | 'negative' | null
  utiltsErr?: boolean | null
  /**
   * Optional business reason from the testdata/portal instruction. This is used
   * only by the TGT/systemtest layer; production validation still reads the
   * actual EDIFACT content.
   */
  reason?: string | null
}

export type EdielTgtCaseTestData = {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title: string
  sourceNote: string
  groups: readonly EdielTgtCaseTestDataGroup[]
  /**
   * Expected acknowledgement for a selected Edielportal/TGT test case. Keeping
   * this on the testdata object prevents the ACK engine from hardcoding a
   * specific test-id while still allowing portal-provided expectations to beat
   * overly broad local guide checks.
   */
  expectedAck?: EdielTgtCaseExpectedAck | null
}

export const RAW_PRODAT_BLOCKS = [
  {
    "kind": "PRODAT",
    "sourceSheet": "Testkund 1 - 20 - elleverantör",
    "entityLabel": "Testkund 1",
    "entityNumbers": [
      "1"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - Z03L",
        "testCase": ""
      },
      {
        "index": 3,
        "name": "Testdata - Z04L (register 1)",
        "testCase": "Testfall 1.2.1"
      },
      {
        "index": 4,
        "name": "Z04L - register nr 2",
        "testCase": "Testfall 1.2.1"
      },
      {
        "index": 5,
        "name": "Testdata - Z06F",
        "testCase": "Testfall 2.1.2"
      }
    ],
    "fields": [
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z03L": "735999888000000017",
          "Testdata - Z04L (register 1)": "735999888000000017",
          "Z04L - register nr 2": "735999888000000017",
          "Testdata - Z06F": "735999888000000017"
        }
      },
      {
        "fieldCode": "210",
        "fieldName": "Avtal, startdatum",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren (15:e i nästa månad)",
          "Testdata - Z04L (register 1)": "sätts av avsändaren (15:e i nästa månad)"
        }
      },
      {
        "fieldCode": "216",
        "fieldName": "Giltighetsdatum, fr.o.m.",
        "values": {
          "Testdata - Z06F": "sätts av avsändaren (dag 28 föregående månad, kl 00.00)"
        }
      },
      {
        "fieldCode": "249",
        "fieldName": "Födelsedatum",
        "values": {
          "Testdata - Z03L": "19450701 (optional)",
          "Testdata - Z04L (register 1)": "19450701"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Tidslängd",
        "values": {
          "Testdata - Z04L (register 1)": "1 (2379=802)",
          "Testdata - Z06F": "1 (2379=802)"
        }
      },
      {
        "fieldCode": "213",
        "fieldName": "Uppskattad årsenergi",
        "values": {
          "Testdata - Z03L": "5800 (optional)",
          "Testdata - Z04L (register 1)": "5800",
          "Z04L - register nr 2": "2800"
        }
      },
      {
        "fieldCode": "214",
        "fieldName": "Konstant för mätare",
        "values": {
          "Testdata - Z04L (register 1)": "1",
          "Z04L - register nr 2": "1",
          "Testdata - Z06F": "2"
        }
      },
      {
        "fieldCode": "217",
        "fieldName": "Mätmetod",
        "values": {
          "Testdata - Z03L": "Z03 (nätägaren avgör)",
          "Testdata - Z04L (register 1)": "Z01 (profil)",
          "Testdata - Z06F": "Z01 (profil)"
        }
      },
      {
        "fieldCode": "218",
        "fieldName": "Antal siffror, mätare",
        "values": {
          "Testdata - Z04L (register 1)": "6",
          "Z04L - register nr 2": "6",
          "Testdata - Z06F": "6"
        }
      },
      {
        "fieldCode": "306",
        "fieldName": "Installationsstatus",
        "values": {
          "Testdata - Z04L (register 1)": "Z12(Aktiv)",
          "Testdata - Z06F": "Z12(Aktiv)"
        }
      },
      {
        "fieldCode": "307",
        "fieldName": "Tariffkod",
        "values": {
          "Testdata - Z04L (register 1)": "25A",
          "Testdata - Z06F": "25A"
        }
      },
      {
        "fieldCode": "220",
        "fieldName": "Prioritet",
        "values": {
          "Testdata - Z04L (register 1)": "A",
          "Testdata - Z06F": "A"
        }
      },
      {
        "fieldCode": "222",
        "fieldName": "Rapporteringsfrekvens",
        "values": {
          "Testdata - Z04L (register 1)": "M",
          "Testdata - Z06F": "M"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Transaktionstyp",
        "values": {
          "Testdata - Z03L": "Z22 (Z03L)",
          "Testdata - Z04L (register 1)": "Z22 (Z04L)",
          "Testdata - Z06F": "E64 (Z06F)"
        }
      },
      {
        "fieldCode": "259",
        "fieldName": "Mätare, tidsintervall (räkneverkskod)",
        "values": {
          "Testdata - Z04L (register 1)": "201 (höglast)",
          "Z04L - register nr 2": "202 (låglast)",
          "Testdata - Z06F": "101 (enkeltariff)"
        }
      },
      {
        "fieldCode": "254",
        "fieldName": "Avräkningsmetod",
        "values": {
          "Testdata - Z04L (register 1)": "Z31 (schablonavräkning enl mätare)",
          "Testdata - Z06F": "Z31 (schablonavräkning enl mätare)"
        }
      },
      {
        "fieldCode": "242",
        "fieldName": "Produktkod",
        "values": {
          "Testdata - Z04L (register 1)": "L917 (Slutliga andelstal per BR, SU och NA)",
          "Z04L - register nr 2": "L917 (Slutliga andelstal per BR, SU och NA)",
          "Testdata - Z06F": "L917 (Slutliga andelstal per BR, SU och NA)"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - Z04L (register 1)": "M12345"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - Z03L": "TES",
          "Testdata - Z04L (register 1)": "TES",
          "Testdata - Z06F": "TES"
        }
      },
      {
        "fieldCode": "261",
        "fieldName": "Referens till avtal/fullmakt",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "226",
        "fieldName": "Ärendereferens",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren",
          "Testdata - Z04L (register 1)": "samma som i Z03",
          "Testdata - Z06F": "sätts av avsändarens system"
        }
      },
      {
        "fieldCode": "227",
        "fieldName": "Kund-id (DE 1131=SE2, 3055=260)",
        "values": {
          "Testdata - Z03L": "194507018820",
          "Testdata - Z04L (register 1)": "194507018820"
        }
      },
      {
        "fieldCode": "228",
        "fieldName": "Namn-elanvändare",
        "values": {
          "Testdata - Z03L": "MARGIT PAULSSON",
          "Testdata - Z04L (register 1)": "MARGIT PAULSSON"
        }
      },
      {
        "fieldCode": "229",
        "fieldName": "Adress-elanvändare",
        "values": {
          "Testdata - Z03L": "STORA VÄGEN 25",
          "Testdata - Z04L (register 1)": "STORA VÄGEN 25"
        }
      },
      {
        "fieldCode": "231",
        "fieldName": "Postnr-elanvändare",
        "values": {
          "Testdata - Z03L": "62020",
          "Testdata - Z04L (register 1)": "62020"
        }
      },
      {
        "fieldCode": "232",
        "fieldName": "Postort-elanvändare",
        "values": {
          "Testdata - Z03L": "KLINTEHAMN",
          "Testdata - Z04L (register 1)": "KLINTEHAMN"
        }
      },
      {
        "fieldCode": "316",
        "fieldName": "Land-elanvändare",
        "values": {
          "Testdata - Z03L": "SE",
          "Testdata - Z04L (register 1)": "SE"
        }
      },
      {
        "fieldCode": "233",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z03L": "735999888000000017 (optional)",
          "Testdata - Z04L (register 1)": "735999888000000017",
          "Testdata - Z06F": "735999888000000017"
        }
      },
      {
        "fieldCode": "234",
        "fieldName": "Adress-anläggning",
        "values": {
          "Testdata - Z03L": "VÄDERMYREN 1:22 (optional)",
          "Testdata - Z04L (register 1)": "VÄDERMYREN 1:22",
          "Testdata - Z06F": "VÄDERMYREN 1:22"
        }
      },
      {
        "fieldCode": "235",
        "fieldName": "Postnr-anläggning",
        "values": {
          "Testdata - Z03L": "62020 (optional)",
          "Testdata - Z04L (register 1)": "62020",
          "Testdata - Z06F": "62020"
        }
      },
      {
        "fieldCode": "236",
        "fieldName": "Postort-anläggning",
        "values": {
          "Testdata - Z03L": "KLINTEHAMN (optional)",
          "Testdata - Z04L (register 1)": "KLINTEHAMN",
          "Testdata - Z06F": "KLINTEHAMN"
        }
      },
      {
        "fieldCode": "237",
        "fieldName": "Land-anläggning",
        "values": {
          "Testdata - Z03L": "SE (optional)",
          "Testdata - Z04L (register 1)": "SE",
          "Testdata - Z06F": "SE"
        }
      },
      {
        "fieldCode": "250",
        "fieldName": "Fakturamottagare ID",
        "values": {
          "Testdata - Z03L": "10011 (optional)",
          "Testdata - Z04L (register 1)": "10011",
          "Testdata - Z06F": "10011"
        }
      },
      {
        "fieldCode": "251",
        "fieldName": "Namn-fakturamottagare",
        "values": {
          "Testdata - Z03L": "CONNY PAULSSON (optional)",
          "Testdata - Z04L (register 1)": "CONNY PAULSSON",
          "Testdata - Z06F": "CONNY PAULSSON"
        }
      },
      {
        "fieldCode": "252",
        "fieldName": "Adress-fakturamottagare",
        "values": {
          "Testdata - Z03L": "ÅGATAN 145 (optional)",
          "Testdata - Z04L (register 1)": "ÅGATAN 145",
          "Testdata - Z06F": "ÅGATAN 145"
        }
      },
      {
        "fieldCode": "253",
        "fieldName": "Postnr-fakturamottgare",
        "values": {
          "Testdata - Z03L": "11543 (optional)",
          "Testdata - Z04L (register 1)": "11543",
          "Testdata - Z06F": "11543"
        }
      },
      {
        "fieldCode": "317",
        "fieldName": "Postort-fakturamottagare",
        "values": {
          "Testdata - Z03L": "STOCKHOLM (optional)",
          "Testdata - Z04L (register 1)": "STOCKHOLM",
          "Testdata - Z06F": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "318",
        "fieldName": "Land-fakturamottagare",
        "values": {
          "Testdata - Z03L": "SE (optional)",
          "Testdata - Z04L (register 1)": "SE",
          "Testdata - Z06F": "SE"
        }
      },
      {
        "fieldCode": "262",
        "fieldName": "Balansansvarig",
        "values": {
          "Testdata - Z03L": "valfritt, skall finnas som balansansvarig i aktörsregistret",
          "Testdata - Z04L (register 1)": "samma som i Z03",
          "Testdata - Z06F": "91109"
        }
      }
    ],
    "sourceWorkbook": "TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx"
  },
  {
    "kind": "PRODAT",
    "sourceSheet": "Testkund 1 - 20 - elleverantör",
    "entityLabel": "Testkund 20",
    "entityNumbers": [
      "20"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - Z01LK",
        "testCase": "Testfall 1.1.1"
      },
      {
        "index": 3,
        "name": "Testdata - Z02LK",
        "testCase": "Testfall 1.1.1"
      },
      {
        "index": 4,
        "name": "Testdata - Z03LK",
        "testCase": "Testfall 1.2.2"
      },
      {
        "index": 5,
        "name": "Testdata - Z04LK",
        "testCase": "Testfall 1.2.2"
      },
      {
        "index": 6,
        "name": "Testdata - Z05L",
        "testCase": "Testfall 3.1.1"
      }
    ],
    "fields": [
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z01LK": "735999888000000208",
          "Testdata - Z02LK": "735999888000000208",
          "Testdata - Z03LK": "735999888000000208",
          "Testdata - Z04LK": "735999888000000208",
          "Testdata - Z05L": "735999888000000208"
        }
      },
      {
        "fieldCode": "210",
        "fieldName": "Avtal, startdatum",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren (10:e i nästa månad)",
          "Testdata - Z03LK": "sätts av avsändaren (10:e i nästa månad)",
          "Testdata - Z04LK": "sätts av avsändaren (10:e i nästa månad)"
        }
      },
      {
        "fieldCode": "211",
        "fieldName": "Avtal, slutdatum",
        "values": {
          "Testdata - Z05L": "sätts av avsändaren (15:e i nästa månad)"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Tidslängd",
        "values": {
          "Testdata - Z04LK": "15 (2379=806)"
        }
      },
      {
        "fieldCode": "213",
        "fieldName": "Uppskattad årsenergi",
        "values": {
          "Testdata - Z04LK": "30000"
        }
      },
      {
        "fieldCode": "214",
        "fieldName": "Konstant för mätare",
        "values": {
          "Testdata - Z04LK": "2"
        }
      },
      {
        "fieldCode": "217",
        "fieldName": "Mätmetod",
        "values": {
          "Testdata - Z02LK": "Z04 (kvart)",
          "Testdata - Z03LK": "Z03 (nätägaren avgör)",
          "Testdata - Z04LK": "Z04 (kvart)"
        }
      },
      {
        "fieldCode": "218",
        "fieldName": "Antal siffror, mätare",
        "values": {
          "Testdata - Z04LK": "5"
        }
      },
      {
        "fieldCode": "306",
        "fieldName": "Installationsstatus",
        "values": {
          "Testdata - Z04LK": "Z12(Aktiv)"
        }
      },
      {
        "fieldCode": "222",
        "fieldName": "Rapporteringsfrekvens",
        "values": {
          "Testdata - Z04LK": "D"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Transaktionstyp",
        "values": {
          "Testdata - Z01LK": "Z23 (Z01LK)",
          "Testdata - Z02LK": "Z23 (Z02LK)",
          "Testdata - Z03LK": "Z23 (Z03LK)",
          "Testdata - Z04LK": "Z23 (Z04LK)",
          "Testdata - Z05L": "Z22 (Z05L)"
        }
      },
      {
        "fieldCode": "259",
        "fieldName": "Mätare, tidsintervall (räkneverkskod)",
        "values": {
          "Testdata - Z04LK": "901"
        }
      },
      {
        "fieldCode": "254",
        "fieldName": "Avräkningsmetod",
        "values": {
          "Testdata - Z04LK": "Z32 (dygnsavräkning)"
        }
      },
      {
        "fieldCode": "242",
        "fieldName": "Produktkod",
        "values": {
          "Testdata - Z04LK": "L639Q (Uppmätt förbr. per NA, BR och SU)"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - Z04LK": "M12020"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - Z01LK": "TES",
          "Testdata - Z02LK": "TES",
          "Testdata - Z03LK": "TES",
          "Testdata - Z04LK": "TES",
          "Testdata - Z05L": "TES"
        }
      },
      {
        "fieldCode": "261",
        "fieldName": "Referens till avtal/fullmakt",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren",
          "Testdata - Z03LK": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "226",
        "fieldName": "Ärendereferens",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren",
          "Testdata - Z02LK": "samma som i Z01",
          "Testdata - Z03LK": "sätts av avsändaren",
          "Testdata - Z04LK": "samma som i Z03",
          "Testdata - Z05L": "sätts av avsändarens system"
        }
      },
      {
        "fieldCode": "227",
        "fieldName": "Kund-id (DE 1131=SE1, 3055=260)",
        "values": {
          "Testdata - Z01LK": "5560143041",
          "Testdata - Z02LK": "5560143041",
          "Testdata - Z03LK": "5560143041",
          "Testdata - Z04LK": "5560143041",
          "Testdata - Z05L": "5560143041"
        }
      },
      {
        "fieldCode": "228",
        "fieldName": "Namn-elanvändare",
        "values": {
          "Testdata - Z01LK": "BOLAGET XXX",
          "Testdata - Z02LK": "BOLAGET XXX",
          "Testdata - Z03LK": "BOLAGET XXX",
          "Testdata - Z04LK": "BOLAGET XXX",
          "Testdata - Z05L": "BOLAGET XXX"
        }
      },
      {
        "fieldCode": "229",
        "fieldName": "Adress-elanvändare",
        "values": {
          "Testdata - Z01LK": "BOX 55",
          "Testdata - Z02LK": "BOX 55",
          "Testdata - Z03LK": "BOX 55",
          "Testdata - Z04LK": "BOX 55",
          "Testdata - Z05L": "BOX 55"
        }
      },
      {
        "fieldCode": "231",
        "fieldName": "Postnr-elanvändare",
        "values": {
          "Testdata - Z01LK": "11820",
          "Testdata - Z02LK": "11820",
          "Testdata - Z03LK": "11820",
          "Testdata - Z04LK": "11820",
          "Testdata - Z05L": "11820"
        }
      },
      {
        "fieldCode": "232",
        "fieldName": "Postort-elanvändare",
        "values": {
          "Testdata - Z01LK": "STOCKHOLM",
          "Testdata - Z02LK": "STOCKHOLM",
          "Testdata - Z03LK": "STOCKHOLM",
          "Testdata - Z04LK": "STOCKHOLM",
          "Testdata - Z05L": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "316",
        "fieldName": "Land-elanvändare",
        "values": {
          "Testdata - Z01LK": "SE",
          "Testdata - Z02LK": "SE",
          "Testdata - Z03LK": "SE",
          "Testdata - Z04LK": "SE",
          "Testdata - Z05L": "SE"
        }
      },
      {
        "fieldCode": "233",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z02LK": "735999888000000208",
          "Testdata - Z04LK": "735999888000000208",
          "Testdata - Z05L": "735999888000000208"
        }
      },
      {
        "fieldCode": "234",
        "fieldName": "Adress-anläggning",
        "values": {
          "Testdata - Z02LK": "Guldgränd 12",
          "Testdata - Z04LK": "Guldgränd 12",
          "Testdata - Z05L": "Guldgränd 12"
        }
      },
      {
        "fieldCode": "235",
        "fieldName": "Postnr-anläggning",
        "values": {
          "Testdata - Z02LK": "11820",
          "Testdata - Z04LK": "11820",
          "Testdata - Z05L": "11820"
        }
      },
      {
        "fieldCode": "236",
        "fieldName": "Postort-anläggning",
        "values": {
          "Testdata - Z02LK": "STOCKHOLM",
          "Testdata - Z04LK": "STOCKHOLM",
          "Testdata - Z05L": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "237",
        "fieldName": "Land-anläggning",
        "values": {
          "Testdata - Z02LK": "SE",
          "Testdata - Z04LK": "SE",
          "Testdata - Z05L": "SE"
        }
      },
      {
        "fieldCode": "262",
        "fieldName": "Balansansvarig",
        "values": {
          "Testdata - Z03LK": "valfritt, skall finnas som balansansvarig i aktörsregistret",
          "Testdata - Z04LK": "samma som i Z03",
          "Testdata - Z05L": "91109"
        }
      }
    ],
    "sourceWorkbook": "TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx"
  }
] as const satisfies readonly EdielTgtExcelBlock[]
